/**
 * Tenue layout: places a tenue (holding line) for every requested note so
 * that the result resembles the tenues of the Bauyn manuscript.
 *
 * Each tenue is a single cubic Bézier curve (which fits the traced Bauyn
 * tenues with a median error of 0.01 staff spaces). Its geometry is
 * described by seven parameters:
 *
 *   gap, dy  – where the stroke starts, relative to the notehead
 *   endX     – where it ends (the note's offset)
 *   rise     – how much higher the end is than the start
 *   arch     – whether it arches over or sags
 *   z1, z2   – shape coordinates in the learned shape space (PCA of the
 *              inner control points, expressed in the chord frame)
 *
 * The parameters are chosen by minimising a cost that combines
 *  (a) a prior learned from the Bauyn tenues (bauynModel.json): start
 *      point, upward rise, the side it bulges to and its shape, depending
 *      on length, register, the voice of the note (the top voice's tenues
 *      arch over, the bass's run long and steep) and on where the notes it
 *      passes over lie (it keeps away from them); end height, long tenues
 *      never hooking down at their end, and
 *  (b) layout principles the copyist observed (each checked on the traced
 *      tenues, see tools/tenue-model/README.md): no collisions with
 *      noteheads, accidentals etc., no crossing of other tenues, parallel
 *      bundles stacked like their notes, the notes spanned by a tenue lie
 *      on one side of it, staying within the system.
 *
 * Every tenue is first given its prior shape; then each is optimised (a
 * multi-start pattern search) from left to right, seeing its neighbours,
 * and refined once more when all neighbours are known.
 */
import {
    Box, Cubic, Pt, boundsOf, boxCenter, boxesOverlap, polylineGap,
    polylinesIntersect, sampleCubic, signedBoxDistance
} from './geometry'
import defaultModel from './bauynModel.json'

export type BauynModel = typeof defaultModel

export type ObstacleKind = 'head' | 'accid' | 'stem' | 'beam' | 'other'

export interface Obstacle {
    box: Box
    kind: ObstacleKind
    /** id of the note this obstacle belongs to (if any) */
    owner?: string
}

/**
 * The part the voice of a tenue's note plays in the texture. The copyist
 * treats them differently: the top voice's tenues are short arches over the
 * notes that follow, those of the voices beneath dip below them, and the
 * bass's run long and steep.
 */
export type Voice = 'top' | 'inner' | 'bass'

export interface TenueRequest {
    id: string
    /** the voice of the note (inner if not given) */
    voice?: Voice
    /**
     * where the notes the tenue passes over on its staff lie: 1 all below
     * its note, -1 all above (found among the obstacles if not given)
     */
    passes?: number
    /** box of the notehead the tenue emanates from */
    head: Box
    /** x coordinate at which the tenue should end (the note's offset) */
    endX: number
    /**
     * id of the note whose onset ends this tenue. The tenue may end right
     * in front of it, so it is not treated as an obstacle.
     */
    releasedBy?: string
    /** y of the top and bottom line of the note's staff */
    staffTop: number
    staffBottom: number
    /** the tenue must not go above / below these limits */
    ceiling: number
    floor: number
}

export interface TenueScene {
    requests: TenueRequest[]
    obstacles: Obstacle[]
}

export interface PlacedTenue {
    id: string
    curve: Cubic
    cost: number
    params: TenueParams
}

export interface TenueParams {
    gap: number
    dy: number
    endX: number
    rise: number
    z1: number
    z2: number
    /** 1 if the tenue arches over, 0 if it sags */
    arch: number
}

export interface LayoutWeights {
    start: number
    rise: number
    falling: number
    shape: number
    end: number
    endHeight: number
    endDirection: number
    side: number
    collision: number
    crossing: number
    proximity: number
    parallel: number
    order: number
    split: number
    band: number
}

export const defaultWeights: LayoutWeights = {
    start: 1,
    rise: 1,
    falling: 2,
    shape: 1,
    end: 2,
    endHeight: 0.7,
    endDirection: 2,
    side: 2,
    collision: 60,
    crossing: 25,
    proximity: 12,
    parallel: 0.6,
    order: 4,
    split: 10,
    band: 20
}

/** minimal distance between two tenues (Bauyn: p10 of neighbour gaps 0.42, median 1.07) */
const MIN_GAP = 0.6

const clearance: Record<ObstacleKind, number> = {
    head: 0.35,
    accid: 0.25,
    stem: 0.15,
    beam: 0.2,
    other: 0.2
}

/** Head height relative to the middle line of its staff (y up), clipped. */
const headPosition = (r: TenueRequest) => {
    const mid = (r.staffTop + r.staffBottom) / 2
    return Math.max(-4, Math.min(4, boxCenter(r.head).y - mid))
}

/** What the copyist's tenues depend on besides the note itself: its voice, and the notes the tenue passes over. */
const contextFeatures = (r: TenueRequest) => [r.voice === 'top' ? 1 : 0, r.voice === 'bass' ? 1 : 0, r.passes ?? 0]

const dot = (coef: readonly number[], f: readonly number[]) => coef.reduce((sum, c, j) => sum + c * (f[j] ?? 0), 0)

/** Where a tenue starts, relative to the right edge and the centre of its head. */
const startOf = (m: BauynModel, r: TenueRequest) => ({
    gap: m.start.gapByVoice?.[r.voice ?? 'inner'] ?? m.start.gap,
    dy: m.start.dyCoef ? dot(m.start.dyCoef, [1, ...contextFeatures(r)]) : m.start.dy,
})

const meanRise = (m: BauynModel, run: number, hpos: number, r: TenueRequest) =>
    dot(m.rise.coef, [1, Math.min(Math.max(run, 0), m.rise.maxRun), hpos, ...contextFeatures(r)])

/** Where the notes between a tenue's head and its end lie on its staff: 1 all below the head, -1 all above. */
const passesOver = (r: TenueRequest, obstacles: readonly Obstacle[]) => {
    const y = boxCenter(r.head).y
    let above = 0, below = 0
    for (const o of obstacles) {
        if (o.kind !== 'head' || o.owner === r.id) continue
        const c = boxCenter(o.box)
        if (c.x <= r.head.x1 || c.x >= r.endX || c.y < r.staffBottom - 3 || c.y > r.staffTop + 3) continue
        if (c.y > y + 0.4) above++
        else if (c.y < y - 0.4) below++
    }
    return (below - above) / Math.max(1, below + above)
}

/**
 * Mean inner control points (chord frame) for a context: short tenues of
 * high notes arch over, those of low notes dip (J-shape); long tenues are
 * never arches but flat S- or J-curves.
 */
const meanShape = (m: BauynModel, length: number, hpos: number, r: TenueRequest, arch: boolean) => {
    const h = hpos / 4
    const f = [1, h, Math.min(length, 16) / 8, h * Math.max(0, Math.min(1, 1 - length / 8)), ...contextFeatures(r)]
    const coef = arch ? m.shape.arch : m.shape.sag
    const out = [0, 0, 0, 0]
    for (let k = 0; k < 4; k++) {
        for (let j = 0; j < coef.length; j++) out[k] += f[j] * coef[j][k]
    }
    return out
}

/**
 * How likely the copyist would have a tenue arch over rather than sag: the
 * top voice's mostly do, and so do those that pass over notes lower than
 * their own, or start high in the staff; long ones rather sag.
 */
const archLikelihood = (m: BauynModel, r: TenueRequest, length: number) => {
    const f = [1, ...contextFeatures(r), headPosition(r) / 4, Math.min(length, 16) / 8]
    return 1 / (1 + Math.exp(-dot(m.side.coef, f)))
}

/** Builds the Bézier curve described by a parameter set. */
export const buildCurve = (m: BauynModel, r: TenueRequest, p: TenueParams): Cubic => {
    const c = boxCenter(r.head)
    const p0: Pt = { x: r.head.x1 + p.gap, y: c.y + p.dy }
    const p3: Pt = { x: Math.max(p.endX, p0.x + 0.5), y: p0.y + p.rise }
    const cx = p3.x - p0.x, cy = p3.y - p0.y
    const L = Math.hypot(cx, cy) || 1
    const ux = cx / L, uy = cy / L
    const nx = -uy, ny = ux
    const s = meanShape(m, L, headPosition(r), r, p.arch > 0.5)
    for (let k = 0; k < 4; k++) {
        s[k] += p.z1 * m.shape.pcSd[0] * m.shape.pcs[0][k] + p.z2 * m.shape.pcSd[1] * m.shape.pcs[1][k]
    }
    // the bulge grows with the length of the tenue, but not indefinitely:
    // the longest Bauyn tenues (20–40 staff spaces) bulge by 1–3 spaces only
    const B = Math.min(L, m.shape.maxBulgeLength)
    const p1: Pt = { x: p0.x + L * s[0] * ux + B * s[1] * nx, y: p0.y + L * s[0] * uy + B * s[1] * ny }
    const p2: Pt = { x: p0.x + L * s[2] * ux + B * s[3] * nx, y: p0.y + L * s[2] * uy + B * s[3] * ny }
    return [p0, p1, p2, p3]
}

interface Placed {
    id: string
    pts: Pt[]
    bounds: Box
    angle: number
    /** height of the note the tenue belongs to */
    pitchY: number
}

interface Context {
    model: BauynModel
    w: LayoutWeights
    request: TenueRequest
    obstacles: Obstacle[]
    /** centres of the noteheads in reach (other than the tenue's own) */
    heads: Pt[]
    others: Placed[]
    riseMean: number
    hpos: number
    pitchY: number
    /** how likely the copyist would have the tenue arch over */
    archLikely: number
}

const chordAngle = (pts: Pt[]) => {
    const a = pts[0], b = pts[pts.length - 1]
    return Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI
}

const sq = (x: number) => x * x

/**
 * Cost of a parameter set. Evaluation stops early (returning Infinity) as
 * soon as the partial cost exceeds `bound` – the cheap prior terms are
 * computed first, so most bad candidates never reach the geometric tests.
 */
const evaluate = (ctx: Context, p: TenueParams, bound = Infinity): number => {
    const { model: m, w, request: r } = ctx
    // (a) prior learned from the Bauyn tenues
    let cost = 0
    const start = startOf(m, r)
    cost += w.start * (sq((p.gap - start.gap) / m.start.gapSd) + sq((p.dy - start.dy) / m.start.dySd))
    cost += w.rise * sq((p.rise - ctx.riseMean) / m.rise.sd)
    if (p.rise < 0) cost += w.falling * sq(p.rise)
    cost += w.shape * (sq(p.z1) + sq(p.z2))
    cost -= w.side * Math.log(Math.max(1e-3, p.arch > 0.5 ? ctx.archLikely : 1 - ctx.archLikely))
    const overshoot = p.endX - r.endX
    cost += w.end * sq(overshoot / (overshoot > 0 ? 0.25 : 0.6))
    if (cost > bound) return Infinity

    const curve = buildCurve(m, r, p)
    const endAbove = curve[3].y - (r.staffTop + m.endAboveTop.q75)
    if (endAbove > 0) cost += w.endHeight * sq(endAbove)
    // long tenues end with an upward (or flat) movement, never hooking down
    const length = Math.hypot(curve[3].x - curve[0].x, curve[3].y - curve[0].y)
    const et = m.endTangent
    const longness = Math.max(0, Math.min(1, (length - et.fromLength) / (et.fullLength - et.fromLength)))
    if (longness > 0) {
        const endAngle = Math.atan2(curve[3].y - curve[2].y, curve[3].x - curve[2].x) * 180 / Math.PI
        if (endAngle < et.minAngle) cost += w.endDirection * longness * sq((et.minAngle - endAngle) / 15)
    }

    // (b) layout constraints
    const pts = sampleFor(curve)
    const ds = segmentLength(curve, pts.length)
    const bounds = boundsOf(pts)
    if (longness > 0) {
        const drop = bounds.y1 - curve[3].y - et.maxDropAfterPeak
        if (drop > 0) cost += w.endDirection * longness * 4 * sq(drop)
    }
    let band = 0
    for (const q of pts) {
        if (q.y > r.ceiling) band += sq(q.y - r.ceiling) * ds
        if (q.y < r.floor) band += sq(r.floor - q.y) * ds
    }
    cost += w.band * band
    if (cost > bound) return Infinity

    for (const o of ctx.obstacles) {
        const c = clearance[o.kind]
        if (!boxesOverlap(bounds, o.box, c)) continue
        let coll = 0
        for (const q of pts) {
            if (q.x < o.box.x0 - c || q.x > o.box.x1 + c || q.y < o.box.y0 - c || q.y > o.box.y1 + c) continue
            const d = signedBoxDistance(q, o.box)
            if (d < c) coll += sq(c - d) * (d < 0 ? 4 : 1) * ds
        }
        cost += w.collision * coll
        if (cost > bound) return Infinity
    }

    // a tenue does not cut through the notes it spans: all notes close to
    // it lie on the same side (27 of 30 cases in the Bauyn tenues)
    let above = 0, below = 0
    for (const h of ctx.heads) {
        if (h.x <= pts[0].x + 0.3 || h.x >= pts[pts.length - 1].x - 0.3) continue
        const y = curveYAt(pts, h.x)
        if (y === undefined || Math.abs(h.y - y) > 3) continue
        if (h.y > y) above++
        else below++
    }
    cost += w.split * Math.min(above, below)
    if (cost > bound) return Infinity

    const angle = chordAngle(pts)
    for (const o of ctx.others) {
        if (!boxesOverlap(bounds, o.bounds, 2.5)) continue
        if (boxesOverlap(bounds, o.bounds, 0.05) && polylinesIntersect(pts, o.pts)) {
            cost += w.crossing
            if (cost > bound) return Infinity
            continue
        }
        const gap = polylineGap(pts, o.pts)
        if (gap < MIN_GAP) cost += w.proximity * sq((MIN_GAP - gap) / MIN_GAP)
        // parallel bundles: neighbouring tenues share their direction
        const overlap = Math.min(bounds.x1, o.bounds.x1) - Math.max(bounds.x0, o.bounds.x0)
        const shorter = Math.min(bounds.x1 - bounds.x0, o.bounds.x1 - o.bounds.x0)
        if (gap < 2.5 && shorter > 0 && overlap / shorter > 0.4) {
            cost += w.parallel * sq((angle - o.angle) / 15)
        }
        // tenues are stacked like their notes: the tenue of a lower
        // note runs below that of a higher one
        if (overlap > 0.5 && Math.abs(o.pitchY - ctx.pitchY) > 0.2) {
            let inverted = 0, checked = 0
            for (let k = 1; k <= 3; k++) {
                const x = Math.max(bounds.x0, o.bounds.x0) + overlap * k / 4
                const y1 = curveYAt(pts, x), y2 = curveYAt(o.pts, x)
                if (y1 === undefined || y2 === undefined) continue
                checked++
                if ((y1 - y2) * (ctx.pitchY - o.pitchY) < 0) inverted++
            }
            if (checked && inverted / checked > 0.5) cost += w.order
        }
        if (cost > bound) return Infinity
    }
    return cost
}

/** y of a polyline at x (first crossing), if it spans x */
const curveYAt = (pts: Pt[], x: number) => {
    for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i]
        if ((a.x - x) * (b.x - x) <= 0 && a.x !== b.x) {
            return a.y + (b.y - a.y) * (x - a.x) / (b.x - a.x)
        }
    }
    return undefined
}

const sampleFor = (curve: Cubic) => {
    const L = Math.hypot(curve[3].x - curve[0].x, curve[3].y - curve[0].y)
    return sampleCubic(curve, Math.max(10, Math.min(32, Math.round(L / 0.4))))
}

const segmentLength = (curve: Cubic, n: number) =>
    Math.hypot(curve[3].x - curve[0].x, curve[3].y - curve[0].y) / (n - 1)

/** the side a tenue bulges to is chosen among the starting points, the rest searched */
type Continuous = Exclude<keyof TenueParams, 'arch'>
const steps: Record<Continuous, number> = {
    gap: 0.4, dy: 0.3, endX: 0.4, rise: 1.0, z1: 1.0, z2: 1.0
}
const keys = Object.keys(steps) as Continuous[]

const patternSearch = (ctx: Context, start: TenueParams) => {
    let best = start
    let bestCost = evaluate(ctx, best)
    let factor = 1
    while (factor > 0.2) {
        let improved = false
        for (const k of keys) {
            for (const sign of [1, -1]) {
                const cand = { ...best, [k]: best[k] + sign * steps[k] * factor }
                if (k === 'gap' && cand.gap < 0.1) continue
                const c = evaluate(ctx, cand, bestCost)
                if (c < bestCost - 1e-9) {
                    best = cand
                    bestCost = c
                    improved = true
                    break
                }
            }
        }
        if (!improved) factor /= 2
    }
    return { params: best, cost: bestCost }
}

const startingPoints = (ctx: Context, r: TenueRequest): TenueParams[] => {
    const m = ctx.model
    const start = startOf(m, r)
    // the likelier side first, then the other
    const likely = ctx.archLikely > 0.5 ? 1 : 0
    return [likely, 1 - likely].flatMap(arch => {
        const base: TenueParams = { gap: start.gap, dy: start.dy, endX: r.endX, rise: ctx.riseMean, z1: 0, z2: 0, arch }
        return [
            base,
            { ...base, z1: -1.5 },                       // J-swoosh / pass below
            { ...base, z1: 1.5 },                        // arch / pass above
            { ...base, rise: ctx.riseMean * 0.4, z1: -1.5 },
            { ...base, rise: ctx.riseMean * 0.4, z1: 1.5 },
            { ...base, gap: start.gap * 0.5, dy: start.dy - 0.5 },
            { ...base, rise: 0, z1: -1 },                // under everything
            { ...base, rise: ctx.riseMean * 1.3, z1: 1 } // over everything
        ]
    })
}

export interface LayoutOptions {
    model?: BauynModel
    weights?: Partial<LayoutWeights>
    /** number of refinement passes after the greedy pass */
    refinements?: number
}

/**
 * Lays out all requested tenues in a scene.
 */
export const layoutTenues = (scene: TenueScene, options: LayoutOptions = {}): PlacedTenue[] => {
    const model = options.model ?? defaultModel
    const w = { ...defaultWeights, ...(options.weights ?? {}) }
    const refinements = options.refinements ?? 1

    const requests = [...scene.requests]
        .map(r => (r.passes === undefined ? { ...r, passes: passesOver(r, scene.obstacles) } : r))
        .sort((a, b) => a.head.x0 - b.head.x0)
    const placed = new Map<string, Placed>()
    const result = new Map<string, PlacedTenue>()

    const contextFor = (r: TenueRequest): Context => {
        const region: Box = {
            x0: r.head.x0 - 1,
            x1: Math.max(r.endX, r.head.x1 + 1) + 1,
            y0: r.floor - 1,
            y1: r.ceiling + 1
        }
        const hpos = headPosition(r)
        const run = r.endX - (r.head.x1 + startOf(model, r).gap)
        const obstacles = scene.obstacles.filter(o =>
            boxesOverlap(o.box, region, 0.5) && (o.owner === undefined || o.owner !== r.releasedBy))
        return {
            model, w, request: r, hpos, obstacles,
            pitchY: boxCenter(r.head).y,
            heads: obstacles
                .filter(o => o.kind === 'head' && o.owner !== r.id)
                .map(o => boxCenter(o.box)),
            others: [...placed.values()].filter(o => o.id !== r.id),
            riseMean: meanRise(model, run, hpos, r),
            archLikely: archLikelihood(model, r, Math.hypot(run, meanRise(model, run, hpos, r)))
        }
    }

    const place = (r: TenueRequest, starts: TenueParams[]) => {
        const ctx = contextFor(r)
        // refine only the most promising starting points
        const promising = starts
            .map(s => ({ s, cost: evaluate(ctx, s) }))
            .sort((a, b) => a.cost - b.cost)
            .slice(0, 3)
        let best: { params: TenueParams, cost: number } | undefined
        for (const { s } of promising) {
            const res = patternSearch(ctx, s)
            if (!best || res.cost < best.cost) best = res
        }
        const curve = buildCurve(model, r, best!.params)
        const pts = sampleFor(curve)
        placed.set(r.id, { id: r.id, pts, bounds: boundsOf(pts), angle: chordAngle(pts), pitchY: boxCenter(r.head).y })
        result.set(r.id, { id: r.id, curve, cost: best!.cost, params: best!.params })
    }

    // Every tenue starts out with its prior (most Bauyn-like) shape, so that
    // the tenues placed first already take their later neighbours into account.
    for (const r of requests) {
        const ctx = contextFor(r)
        const curve = buildCurve(model, r, startingPoints(ctx, r)[0])
        const pts = sampleFor(curve)
        placed.set(r.id, { id: r.id, pts, bounds: boundsOf(pts), angle: chordAngle(pts), pitchY: boxCenter(r.head).y })
    }

    // greedy pass, left to right
    for (const r of requests) place(r, startingPoints(contextFor(r), r))

    // refinement: every tenue now sees all its neighbours
    for (let pass = 0; pass < refinements; pass++) {
        for (const r of requests) {
            const prev = result.get(r.id)!
            const base = startingPoints(contextFor(r), r)
            place(r, [prev.params, base[0]])
        }
    }

    return requests.map(r => result.get(r.id)!)
}

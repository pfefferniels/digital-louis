/**
 * Tenues as d'Anglebert's engraver cut them (Pièces de clavecin, 1689), for
 * the semi-measured view: not the copyist's free strokes (see `layout.ts`)
 * but slurs, as an engraver draws them. Measured on the Prélude of the print
 * (62 slurs; staff spaces):
 *
 *  - they start under the right half of their note's head, a little below
 *    it (0.1), and reach towards the note that takes over;
 *  - most (three in four) sag below the notes; arches over the notes are
 *    for notes with others beneath them, mostly of the top voice;
 *  - they are level, both ends at one height (rise median 0.02);
 *  - they bulge by about a sixth of their length, 0.4 for the common
 *    ones (2.4 long), the long ones less: an engraved line spreads its
 *    notes wider than the print, and its slurs with them, bulging alike;
 *  - they are thick in the middle (0.2) and pointed at the ends.
 *
 * Where a slur would touch a head, an accidental, a stem or another slur, it
 * moves away from its note, and bulges a little more, until it is clear.
 */
import {
    Box, Cubic, Pt, boundsOf, boxesOverlap, polylineGap, polylinesIntersect, sampleCubic, signedBoxDistance
} from './geometry'
import { Obstacle, TenueRequest, passesOver } from './layout'

export const engravedStyle = {
    /** how far a slur bulges: base + perSpace × its length, at most max */
    height: { base: 0.3, perSpace: 0.09, max: 1.1 },
    /** how far it starts inside the right edge of its head, and how far from the head */
    start: { inset: 0.3, gap: 0.12 },
    /** its thickness, in the middle and at its pointed ends */
    thickness: { middle: 0.2, ends: 0.03 },
    /** how far it moves away from its note, at each try, to keep clear */
    step: 0.3,
    tries: 8,
    /** what it keeps clear of */
    clearance: 0.15,
    gap: 0.25,
}

export interface EngravedTenue {
    id: string
    curve: Cubic
    above: boolean
}

/** A slur from `from` to `to`, bulging by `height`, upwards if `above`. */
const slur = (from: Pt, to: Pt, height: number, above: boolean): Cubic => {
    // the control points of a symmetric cubic stand 4/3 of the bulge out
    const out = (above ? 1 : -1) * height * 4 / 3
    const along = (k: number) => ({ x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k })
    const [a, b] = [along(0.25), along(0.75)]
    return [from, { x: a.x, y: a.y + out }, { x: b.x, y: b.y + out }, to]
}

/** Whether a slur arches over its notes: those with notes beneath them, as the top voice's mostly. */
const archesOver = (r: TenueRequest) => {
    const passes = r.passes ?? 0
    return passes > 0.3 || (r.voice === 'top' && passes > -0.3)
}

const touching = (pts: Pt[], obstacles: readonly Obstacle[]) => {
    const bounds = boundsOf(pts)
    let overlap = 0
    for (const o of obstacles) {
        if (!boxesOverlap(bounds, o.box, engravedStyle.clearance)) continue
        for (const p of pts) {
            const d = signedBoxDistance(p, o.box)
            if (d < engravedStyle.clearance) overlap += engravedStyle.clearance - d
        }
    }
    return overlap
}

const crowding = (pts: Pt[], others: readonly Pt[][]) => {
    let crowd = 0
    for (const other of others) {
        if (polylinesIntersect(pts, other)) crowd += 10
        else crowd += Math.max(0, engravedStyle.gap - polylineGap(pts, other))
    }
    return crowd
}

/** Lays out the tenues of a scene as d'Anglebert's engraver would. */
export const layoutEngraved = (scene: { requests: TenueRequest[], obstacles: Obstacle[] }): EngravedTenue[] => {
    const { start, height, step, tries } = engravedStyle
    // from left to right, and of a chord, the slurs nearest their notes first
    const requests = scene.requests
        .map(r => ({ ...r, passes: r.passes ?? passesOver(r, scene.obstacles) }))
        .sort((a, b) => a.head.x0 - b.head.x0 || (archesOver(b) ? b.head.y0 - a.head.y0 : a.head.y0 - b.head.y0))
    const placed: Pt[][] = []
    return requests.map(r => {
        const above = archesOver(r)
        const away = above ? 1 : -1
        const from: Pt = { x: r.head.x1 - start.inset, y: above ? r.head.y1 + start.gap : r.head.y0 - start.gap }
        const to: Pt = { x: Math.max(r.endX, from.x + 1), y: from.y }
        const length = to.x - from.x
        const bulge = Math.min(height.max, height.base + height.perSpace * length)
        const obstacles = scene.obstacles.filter(o =>
            o.owner !== r.id && o.owner !== r.releasedBy &&
            boxesOverlap(o.box, { x0: from.x - 1, x1: to.x + 1, y0: r.floor - 1, y1: r.ceiling + 1 } as Box, 0))
        let best: { curve: Cubic, pts: Pt[], cost: number } | undefined
        for (let k = 0; k <= tries; k++) {
            const shift = away * k * step
            const curve = slur({ x: from.x, y: from.y + shift }, { x: to.x, y: to.y + shift }, bulge + 0.05 * k, above)
            const pts = sampleCubic(curve, 24)
            const outside = pts.reduce((sum, p) => sum + Math.max(0, p.y - r.ceiling) + Math.max(0, r.floor - p.y), 0)
            const cost = touching(pts, obstacles) * 4 + crowding(pts, placed) + outside * 2 + k * 0.05
            if (!best || cost < best.cost) best = { curve, pts, cost }
            if (cost <= k * 0.05 + 1e-9) break
        }
        placed.push(best!.pts)
        return { id: r.id, curve: best!.curve, above }
    })
}

/** The outline of an engraved slur: thick in the middle, pointed at the ends. */
export const slurOutline = (curve: Cubic, samples = 32): Pt[] => {
    const { middle, ends } = engravedStyle.thickness
    const pts = sampleCubic(curve, samples)
    const side = (sign: number) => pts.map((p, i) => {
        const [a, b] = [pts[Math.max(0, i - 1)], pts[Math.min(pts.length - 1, i + 1)]]
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
        const s = i / (pts.length - 1)
        const w = ends + (middle - ends) * Math.sin(Math.PI * s) ** 0.7
        return { x: p.x - sign * (b.y - a.y) / len * w / 2, y: p.y + sign * (b.x - a.x) / len * w / 2 }
    })
    return [...side(1), ...side(-1).reverse()]
}

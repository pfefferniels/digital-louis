/**
 * Small 2D geometry toolkit for the tenue engine.
 *
 * All coordinates used by the engine are expressed in staff spaces
 * with the y axis pointing UP (music coordinates). Conversion from and
 * to SVG user units happens only at the DOM boundary (see dom.ts).
 */

export interface Pt {
    x: number
    y: number
}

/** Axis-aligned box. Invariant: x0 <= x1, y0 <= y1 (y up). */
export interface Box {
    x0: number
    y0: number
    x1: number
    y1: number
}

export type Cubic = [Pt, Pt, Pt, Pt]

export const pt = (x: number, y: number): Pt => ({ x, y })
export const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y })
export const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y })
export const scale = (a: Pt, s: number): Pt => ({ x: a.x * s, y: a.y * s })
export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y)

export const bezierPoint = ([p0, p1, p2, p3]: Cubic, t: number): Pt => {
    const u = 1 - t
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t
    return {
        x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
        y: a * p0.y + b * p1.y + c * p2.y + d * p3.y
    }
}

export const bezierTangent = ([p0, p1, p2, p3]: Cubic, t: number): Pt => {
    const u = 1 - t
    const a = 3 * u * u, b = 6 * u * t, c = 3 * t * t
    return {
        x: a * (p1.x - p0.x) + b * (p2.x - p1.x) + c * (p3.x - p2.x),
        y: a * (p1.y - p0.y) + b * (p2.y - p1.y) + c * (p3.y - p2.y)
    }
}

/** Samples a cubic at n points, uniformly in t. */
export const sampleCubic = (c: Cubic, n: number): Pt[] => {
    const out: Pt[] = []
    for (let i = 0; i < n; i++) out.push(bezierPoint(c, i / (n - 1)))
    return out
}

/** Resamples a polyline at n points, uniformly in arc length. */
export const resampleByArcLength = (pts: Pt[], n: number): Pt[] => {
    const cum = [0]
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]))
    const total = cum[cum.length - 1]
    const out: Pt[] = []
    let j = 0
    for (let i = 0; i < n; i++) {
        const s = total * i / (n - 1)
        while (j < cum.length - 2 && cum[j + 1] < s) j++
        const seg = cum[j + 1] - cum[j]
        const f = seg > 0 ? (s - cum[j]) / seg : 0
        out.push({ x: pts[j].x + f * (pts[j + 1].x - pts[j].x), y: pts[j].y + f * (pts[j + 1].y - pts[j].y) })
    }
    return out
}

export const polylineLength = (pts: Pt[]) => {
    let l = 0
    for (let i = 1; i < pts.length; i++) l += dist(pts[i - 1], pts[i])
    return l
}

export const boundsOf = (pts: Pt[]): Box => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const p of pts) {
        if (p.x < x0) x0 = p.x
        if (p.x > x1) x1 = p.x
        if (p.y < y0) y0 = p.y
        if (p.y > y1) y1 = p.y
    }
    return { x0, y0, x1, y1 }
}

export const boxesOverlap = (a: Box, b: Box, margin = 0) =>
    a.x0 - margin <= b.x1 && b.x0 - margin <= a.x1 &&
    a.y0 - margin <= b.y1 && b.y0 - margin <= a.y1

export const boxCenter = (b: Box): Pt => ({ x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 })

/**
 * Signed distance from a point to a box: positive outside,
 * negative inside (depth of penetration).
 */
export const signedBoxDistance = (p: Pt, b: Box): number => {
    const dx = Math.max(b.x0 - p.x, 0, p.x - b.x1)
    const dy = Math.max(b.y0 - p.y, 0, p.y - b.y1)
    if (dx > 0 || dy > 0) return Math.hypot(dx, dy)
    return -Math.min(p.x - b.x0, b.x1 - p.x, p.y - b.y0, b.y1 - p.y)
}

const orient = (a: Pt, b: Pt, c: Pt) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)

export const segmentsIntersect = (p1: Pt, p2: Pt, p3: Pt, p4: Pt) => {
    const d1 = orient(p3, p4, p1), d2 = orient(p3, p4, p2)
    const d3 = orient(p1, p2, p3), d4 = orient(p1, p2, p4)
    return d1 * d2 < 0 && d3 * d4 < 0
}

export const polylinesIntersect = (a: Pt[], b: Pt[]) => {
    for (let i = 1; i < a.length; i++) {
        const ax0 = Math.min(a[i - 1].x, a[i].x), ax1 = Math.max(a[i - 1].x, a[i].x)
        const ay0 = Math.min(a[i - 1].y, a[i].y), ay1 = Math.max(a[i - 1].y, a[i].y)
        for (let j = 1; j < b.length; j++) {
            if (Math.max(b[j - 1].x, b[j].x) < ax0 || Math.min(b[j - 1].x, b[j].x) > ax1) continue
            if (Math.max(b[j - 1].y, b[j].y) < ay0 || Math.min(b[j - 1].y, b[j].y) > ay1) continue
            if (segmentsIntersect(a[i - 1], a[i], b[j - 1], b[j])) return true
        }
    }
    return false
}

/**
 * Minimal distance between the vertices of two polylines (cheap proxy),
 * computed coarse-to-fine: only the neighbourhood of the closest pair of
 * every third vertex is searched exhaustively.
 */
export const polylineGap = (a: Pt[], b: Pt[]) => {
    const step = 3
    let bi = 0, bj = 0, m = Infinity
    for (let i = 0; i < a.length; i += step) {
        for (let j = 0; j < b.length; j += step) {
            const d = (a[i].x - b[j].x) ** 2 + (a[i].y - b[j].y) ** 2
            if (d < m) { m = d; bi = i; bj = j }
        }
    }
    for (let i = Math.max(0, bi - step); i < Math.min(a.length, bi + step + 1); i++) {
        for (let j = Math.max(0, bj - step); j < Math.min(b.length, bj + step + 1); j++) {
            const d = (a[i].x - b[j].x) ** 2 + (a[i].y - b[j].y) ** 2
            if (d < m) m = d
        }
    }
    return Math.sqrt(m)
}

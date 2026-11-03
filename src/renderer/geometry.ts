/**
 * Layout geometry. All lengths are in staff spaces, x grows to the right and
 * y downwards, as in SVG; only the SVG writer knows about any other unit.
 */

export interface Point {
    readonly x: number
    readonly y: number
}

export interface Box {
    readonly left: number
    readonly top: number
    readonly right: number
    readonly bottom: number
}

export const translatePoint = (p: Point, dx: number, dy: number): Point =>
    ({ x: p.x + dx, y: p.y + dy })

export const union = (a: Box, b: Box): Box => ({
    left: Math.min(a.left, b.left),
    top: Math.min(a.top, b.top),
    right: Math.max(a.right, b.right),
    bottom: Math.max(a.bottom, b.bottom),
})

export const unionAll = (boxes: readonly Box[]): Box | undefined =>
    boxes.length === 0 ? undefined : boxes.reduce(union)

/** Whether the interiors of two boxes intersect; touching boxes do not overlap. */
export const overlaps = (a: Box, b: Box): boolean =>
    a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom

export const boxOfPoints = (points: readonly Point[]): Box => ({
    left: Math.min(...points.map(p => p.x)),
    top: Math.min(...points.map(p => p.y)),
    right: Math.max(...points.map(p => p.x)),
    bottom: Math.max(...points.map(p => p.y)),
})

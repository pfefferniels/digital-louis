/**
 * What engraving produces: a tree of semantic groups over a few primitives,
 * in layout coordinates. The groups carry the names the viewer selects by.
 */
import { isDefined } from './algorithms'
import { Box, boxOfPoints, Point, translatePoint, unionAll } from './geometry'
import { glyphBox, GlyphName } from './glyph'
import type { ElementId } from './model'

export interface Bezier {
    readonly control1: Point
    readonly control2: Point
    readonly end: Point
}

export type TextAnchor = 'start' | 'middle' | 'end'

export type Primitive =
    | { readonly kind: 'glyph'; readonly glyph: GlyphName; readonly origin: Point; readonly scale: number }
    | { readonly kind: 'line'; readonly from: Point; readonly to: Point; readonly thickness: number }
    | { readonly kind: 'polygon'; readonly points: readonly Point[] }
    /** a closed, filled outline */
    | { readonly kind: 'shape'; readonly start: Point; readonly curves: readonly Bezier[] }
    | { readonly kind: 'dot'; readonly center: Point; readonly radius: number }
    | { readonly kind: 'text'; readonly origin: Point; readonly text: string; readonly size: number; readonly anchor: TextAnchor }

export interface Group {
    readonly kind: 'group'
    readonly classes: readonly string[]
    readonly id?: ElementId
    /** data attributes, named without their `data-` prefix */
    readonly data?: Readonly<Record<string, string>>
    readonly children: readonly Drawing[]
}

export type Drawing = Group | Primitive

export const group = (
    classes: readonly string[],
    children: readonly Drawing[],
    attributes: Pick<Group, 'id' | 'data'> = {}
): Group => ({ kind: 'group', classes, children, ...attributes })

export const glyph = (name: GlyphName, origin: Point, scale = 1): Primitive =>
    ({ kind: 'glyph', glyph: name, origin, scale })

export const line = (from: Point, to: Point, thickness: number): Primitive =>
    ({ kind: 'line', from, to, thickness })

export const text = (origin: Point, content: string, size: number, anchor: TextAnchor = 'start'): Primitive =>
    ({ kind: 'text', origin, text: content, size, anchor })

const translateBezier = (curve: Bezier, dx: number, dy: number): Bezier => ({
    control1: translatePoint(curve.control1, dx, dy),
    control2: translatePoint(curve.control2, dx, dy),
    end: translatePoint(curve.end, dx, dy),
})

export const translate = (drawing: Drawing, dx: number, dy: number): Drawing => {
    switch (drawing.kind) {
        case 'group': return { ...drawing, children: drawing.children.map(child => translate(child, dx, dy)) }
        case 'glyph': return { ...drawing, origin: translatePoint(drawing.origin, dx, dy) }
        case 'line': return { ...drawing, from: translatePoint(drawing.from, dx, dy), to: translatePoint(drawing.to, dx, dy) }
        case 'polygon': return { ...drawing, points: drawing.points.map(p => translatePoint(p, dx, dy)) }
        case 'shape': return {
            ...drawing,
            start: translatePoint(drawing.start, dx, dy),
            curves: drawing.curves.map(curve => translateBezier(curve, dx, dy)),
        }
        case 'dot': return { ...drawing, center: translatePoint(drawing.center, dx, dy) }
        case 'text': return { ...drawing, origin: translatePoint(drawing.origin, dx, dy) }
    }
}

/** Text is measured roughly: half an em per character, three quarters of an em above the baseline. */
const textBox = ({ origin, text: content, size, anchor }: Extract<Primitive, { kind: 'text' }>): Box => {
    const width = 0.5 * size * content.length
    const left = origin.x - { start: 0, middle: width / 2, end: width }[anchor]
    return { left, right: left + width, top: origin.y - 0.75 * size, bottom: origin.y + 0.25 * size }
}

const widened = (box: Box, by: number): Box =>
    ({ left: box.left - by, top: box.top - by, right: box.right + by, bottom: box.bottom + by })

/** The boxes of the primitives a drawing is made of. */
export const primitiveBoxes = (drawing: Drawing): Box[] => {
    if (drawing.kind === 'group') return drawing.children.flatMap(primitiveBoxes)
    const box = boundsOf(drawing)
    return box ? [box] : []
}

export const boundsOf = (drawing: Drawing): Box | undefined => {
    switch (drawing.kind) {
        case 'group': return unionAll(drawing.children.map(boundsOf).filter(isDefined))
        case 'glyph': return glyphBox(drawing.glyph, drawing.origin, drawing.scale)
        case 'line': return widened(boxOfPoints([drawing.from, drawing.to]), drawing.thickness / 2)
        case 'polygon': return boxOfPoints(drawing.points)
        case 'shape': return boxOfPoints([drawing.start, ...drawing.curves.flatMap(c => [c.control1, c.control2, c.end])])
        case 'dot': return widened(boxOfPoints([drawing.center]), drawing.radius)
        case 'text': return textBox(drawing)
    }
}

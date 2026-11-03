/**
 * Writes a page as SVG markup, in the vocabulary the viewer selects by:
 * `.system > .measure > .staff > .layer > .note > .notehead`, `.stem`, `.accid`,
 * `.beam polygon`, `.ledgerLines`, `.tie`, `.barLine`, `data-id`, `data-next`, ...
 * Glyphs are <use> elements with x, y, width and height, referring to symbols
 * named by their SMuFL codepoint.
 */
import type { Bezier, Drawing, Group, Primitive } from './drawing'
import type { Point } from './geometry'
import { glyphData, GlyphName } from './glyph'
import { staffSpacesPerEm, unitsPerEm } from './leipzig'
import type { Page } from './page'

/** SVG user units per staff space. */
const unit = 100

/** The margin around the page, in staff spaces. */
const margin = 2

/** Shadow semibreves are cloned from the semibreve symbol, so it is always defined. */
const alwaysDefined: readonly GlyphName[] = ['noteheadWhole']

interface SvgElement {
    readonly name: string
    readonly attributes: Readonly<Record<string, string | number | undefined>>
    readonly children: readonly (SvgElement | string)[]
}

const element = (
    name: string,
    attributes: SvgElement['attributes'] = {},
    children: SvgElement['children'] = []
): SvgElement => ({ name, attributes, children })

const escape = (value: string): string =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const serialize = (node: SvgElement | string): string => {
    if (typeof node === 'string') return escape(node)
    const attributes = Object.entries(node.attributes)
        .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
        .map(([key, value]) => ` ${key}="${escape(String(value))}"`)
        .join('')
    return node.children.length === 0
        ? `<${node.name}${attributes}/>`
        : `<${node.name}${attributes}>${node.children.map(serialize).join('')}</${node.name}>`
}

const u = (length: number): number => Math.round(length * unit)

const xy = ({ x, y }: Point): string => `${u(x)} ${u(y)}`

const symbolId = (name: GlyphName): string => `${glyphData(name).codepoint}-louis`

const curveTo = ({ control1, control2, end }: Bezier): string => `C${xy(control1)} ${xy(control2)} ${xy(end)}`

const primitive = (drawing: Primitive): SvgElement => {
    switch (drawing.kind) {
        case 'glyph': {
            const size = u(staffSpacesPerEm * drawing.scale)
            return element('use', {
                'xlink:href': `#${symbolId(drawing.glyph)}`,
                x: u(drawing.origin.x), y: u(drawing.origin.y), width: size, height: size,
            })
        }
        case 'line': return element('path', {
            d: `M${xy(drawing.from)} L${xy(drawing.to)}`,
            stroke: 'currentColor',
            'stroke-width': u(drawing.thickness),
        })
        case 'polygon': return element('polygon', {
            points: drawing.points.map(p => `${u(p.x)},${u(p.y)}`).join(' '),
            fill: 'currentColor',
        })
        case 'shape': return element('path', {
            d: `M${xy(drawing.start)} ${drawing.curves.map(curveTo).join(' ')} Z`,
            fill: 'currentColor',
        })
        case 'dot': return element('ellipse', {
            cx: u(drawing.center.x), cy: u(drawing.center.y), rx: u(drawing.radius), ry: u(drawing.radius),
            fill: 'currentColor',
        })
        case 'text': return element('text', {
            x: u(drawing.origin.x), y: u(drawing.origin.y),
            'font-size': u(drawing.size), 'font-family': 'Times, serif', 'text-anchor': drawing.anchor,
            fill: 'currentColor',
        }, [drawing.text])
    }
}

const groupElement = (drawing: Group, extra: SvgElement['attributes'] = {}): SvgElement => element('g', {
    class: drawing.classes.join(' '),
    'data-id': drawing.id,
    ...Object.fromEntries(Object.entries(drawing.data ?? {}).map(([key, value]) => [`data-${key}`, value])),
    ...extra,
}, drawing.children.map(toElement))

const toElement = (drawing: Drawing): SvgElement =>
    drawing.kind === 'group' ? groupElement(drawing) : primitive(drawing)

const glyphsIn = (drawing: Drawing): GlyphName[] => {
    switch (drawing.kind) {
        case 'group': return drawing.children.flatMap(glyphsIn)
        case 'glyph': return [drawing.glyph]
        default: return []
    }
}

const symbol = (name: GlyphName): SvgElement =>
    element('symbol', { id: symbolId(name), viewBox: `0 0 ${unitsPerEm} ${unitsPerEm}`, overflow: 'inherit' }, [
        element('path', { transform: 'scale(1,-1)', d: glyphData(name).outline }),
    ])

export const writeSvg = (page: Page): string => {
    const used = [...new Set([...alwaysDefined, ...glyphsIn(page.content)])]
    return serialize(element('svg', {
        xmlns: 'http://www.w3.org/2000/svg',
        'xmlns:xlink': 'http://www.w3.org/1999/xlink',
        viewBox: `0 0 ${u(page.width + 2 * margin)} ${u(page.height + 2 * margin)}`,
        color: 'black',
    }, [
        element('desc', {}, ['Engraved by the Digital Louis renderer']),
        element('defs', {}, used.map(symbol)),
        groupElement(page.content, { transform: `translate(${u(margin)}, ${u(margin)})` }),
    ]))
}

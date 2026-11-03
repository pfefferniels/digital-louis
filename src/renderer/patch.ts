/**
 * Draws a page into a live document. The first time, it builds the SVG; after
 * that, it changes only what differs from what is drawn already, so that one
 * frame of a transition after another costs little more than engraving it:
 * where the elements are the same, only their attributes are brought up to
 * date, and only where they differ are they built anew.
 */
import type { SvgElement } from './svg'

const SVG_NS = 'http://www.w3.org/2000/svg'
const XLINK_NS = 'http://www.w3.org/1999/xlink'

/** declarations of namespaces, which elements made in their namespace need not carry */
const namespaces = new Set(['xmlns', 'xmlns:xlink'])

const attributesOf = (node: SvgElement): Map<string, string> => new Map(
    Object.entries(node.attributes)
        .filter((entry): entry is [string, string | number] => entry[1] !== undefined && !namespaces.has(entry[0]))
        .map(([name, value]) => [name, String(value)])
)

const setAttribute = (el: Element, name: string, value: string) => {
    if (name.startsWith('xlink:')) el.setAttributeNS(XLINK_NS, name, value)
    else el.setAttribute(name, value)
}

const build = (node: SvgElement | string): Node => {
    if (typeof node === 'string') return document.createTextNode(node)
    const el = document.createElementNS(SVG_NS, node.name)
    attributesOf(node).forEach((value, name) => setAttribute(el, name, value))
    node.children.forEach(child => el.appendChild(build(child)))
    return el
}

const isLike = (dom: Node | undefined, node: SvgElement | string): boolean =>
    typeof node === 'string'
        ? dom?.nodeType === Node.TEXT_NODE
        : dom?.nodeType === Node.ELEMENT_NODE && (dom as Element).localName === node.name

// Run for every element of every frame, hence written for speed rather than grace.
const patch = (el: Element, node: SvgElement) => {
    let count = 0
    for (const name in node.attributes) {
        const value = node.attributes[name]
        if (value === undefined || namespaces.has(name)) continue
        count++
        const wanted = typeof value === 'string' ? value : String(value)
        if (el.getAttribute(name) !== wanted) setAttribute(el, name, wanted)
    }
    // what was added to the element since, or is no longer drawn
    if (el.attributes.length !== count) {
        for (let i = el.attributes.length - 1; i >= 0; i--) {
            const { name } = el.attributes[i]
            if (node.attributes[name] === undefined) el.removeAttribute(name)
        }
    }

    const children = el.childNodes
    const wanted = node.children
    let alike = children.length === wanted.length
    for (let i = 0; alike && i < wanted.length; i++) alike = isLike(children[i], wanted[i])
    if (!alike) {
        el.replaceChildren(...wanted.map(build))
        return
    }
    for (let i = 0; i < wanted.length; i++) {
        const child = wanted[i]
        if (typeof child !== 'string') patch(children[i] as Element, child)
        else if (children[i].textContent !== child) children[i].textContent = child
    }
}

/** Draws `tree` as the only content of `host`, reusing the SVG drawn there before. Returns the SVG. */
export const drawInto = (host: Element, tree: SvgElement): SVGSVGElement => {
    const drawn = host.firstElementChild
    if (host.childNodes.length === 1 && drawn && isLike(drawn, tree)) {
        patch(drawn, tree)
        return drawn as SVGSVGElement
    }
    const svg = build(tree) as SVGSVGElement
    host.replaceChildren(svg)
    return svg
}

/**
 * Where the view changes what it draws rather than only where - as the
 * semi-measured view beams its ornaments and leaves out the notes tied over,
 * or the unmeasured one writes every note alike - the score as drawn before
 * fades out above the score drawn anew, and the notes both of them draw glide
 * from where they were to where they are now.
 */

/** How long the change takes, in milliseconds */
const duration = 450

interface Point {
    readonly x: number
    readonly y: number
}

export interface Snapshot {
    readonly copy: SVGSVGElement
    /** where the head of each note is, by its id, in pixels of the page */
    readonly heads: ReadonlyMap<string, Point>
    /** the ids of what is drawn */
    readonly ids: ReadonlySet<string>
}

const headsIn = (svg: Element): Map<string, Point> => {
    const heads = new Map<string, Point>()
    svg.querySelectorAll('.note[data-id] > .notehead').forEach(head => {
        const box = head.getBoundingClientRect()
        const id = head.parentElement?.getAttribute('data-id')
        if (id && (box.width > 0 || box.height > 0)) heads.set(id, { x: box.x + box.width / 2, y: box.y + box.height / 2 })
    })
    return heads
}

const byId = (svg: Element, selector: string): Map<string, Element> =>
    new Map(Array.from(svg.querySelectorAll(`${selector}[data-id]`)).map(el => [el.getAttribute('data-id') ?? '', el]))

/** The score as drawn now, to be drawn anew. */
export const snapshot = (svg: SVGSVGElement): Snapshot => ({
    copy: svg.cloneNode(true) as SVGSVGElement,
    heads: headsIn(svg),
    ids: new Set(byId(svg, '').keys()),
})

/** Passes from the score as it was (`from`) to the score now drawn (`svg`), the old one shown in `layer` above. */
export const crossfade = (from: Snapshot, svg: SVGSVGElement, layer: HTMLElement) => {
    layer.getAnimations().forEach(animation => animation.cancel())
    layer.replaceChildren(from.copy)

    // A note that only moved glides, and is not shown twice.
    const scale = svg.getScreenCTM()?.a || 1
    const notes = byId(svg, '.note')
    const copies = byId(from.copy, '.note')
    headsIn(svg).forEach((now, id) => {
        const before = from.heads.get(id)
        if (!before || Math.hypot(before.x - now.x, before.y - now.y) < 1) return
        const [dx, dy] = [(before.x - now.x) / scale, (before.y - now.y) / scale]
        notes.get(id)?.animate(
            [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0px, 0px)' }],
            { duration, easing: 'ease-in-out' }
        )
        copies.get(id)?.setAttribute('visibility', 'hidden')
    })

    // What is new fades in, up to what the view shows of it.
    byId(svg, '').forEach((el, id) => {
        const shown = el.getAttribute('opacity') ?? '1'
        if (!from.ids.has(id) && shown !== '0') {
            el.animate([{ opacity: 0 }, { opacity: shown }], { duration, easing: 'ease-out' })
        }
    })

    layer.animate([{ opacity: 1 }, { opacity: 0 }], { duration, easing: 'ease-in' }).onfinish = () => layer.replaceChildren()
}

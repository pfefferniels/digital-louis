/**
 * Linking score and facsimile: a note of the score and the traces of the
 * facsimile it corresponds to (@corresp) are highlighted together. With a
 * mouse, while one of them is hovered over. On a touch screen, where a
 * notehead is a few pixels across, too small to hit with a finger, and a tap
 * leaves no hover behind, a tap selects the note or trace nearest to it, and
 * it stays highlighted with its counterparts until the next tap.
 *
 * The listeners sit on the views of score and facsimile, not on their notes,
 * so that a score drawn anew needs no new ones.
 */

/** How far from a note or trace, in CSS pixels, a finger still reaches it */
const reach = 24

interface Link {
    readonly head: Element
    readonly traces: readonly Element[]
}

const isVisible = (el: Element) => el.closest('[opacity="0"]') === null

/** The distance from a point to the box of an element, 0 within it. */
const distance = (el: Element, x: number, y: number): number => {
    const box = el.getBoundingClientRect()
    return Math.hypot(Math.max(box.left - x, 0, x - box.right), Math.max(box.top - y, 0, y - box.bottom))
}

const nearest = <T>(candidates: readonly T[], elementOf: (candidate: T) => Element, x: number, y: number): T | undefined => {
    let best: T | undefined
    let bestDistance = reach
    for (const candidate of candidates) {
        const d = distance(elementOf(candidate), x, y)
        if (d <= bestDistance) {
            best = candidate
            bestDistance = d
        }
    }
    return best
}

/** The traces in the facsimile a note corresponds to (@corresp, as `#id #id ...`). */
const tracesOf = (note: Element, facsimile: Element): Element[] =>
    (note.getAttribute('data-corresp') ?? '')
        .split(' ')
        .map(ref => document.getElementById(ref.replace(/^#/, '')))
        .filter((trace): trace is HTMLElement => trace !== null && facsimile.contains(trace))

/** Each note of the score with the traces in the facsimile it corresponds to. */
const linksBetween = (score: Element, facsimile: Element): Link[] =>
    Array.from(score.querySelectorAll('.note[data-corresp]')).flatMap(note => {
        const head = note.querySelector('.notehead')
        const traces = tracesOf(note, facsimile)
        return head && traces.length > 0 ? [{ head, traces }] : []
    })

const linkedNote = (target: EventTarget | null) =>
    target instanceof Element ? target.closest('.note[data-corresp]') : null

/**
 * Lets hovering over a note highlight its traces in the facsimile, and
 * hovering over a trace the notes it is linked to. Returns what undoes it.
 */
export const highlightOnHover = (score: HTMLElement, facsimile: HTMLElement): (() => void) => {
    const glowing = new Set<Element>()
    const glow = (elements: readonly Element[], on: boolean) => elements.forEach(el => {
        el.classList.toggle('with-glow', on)
        if (on) glowing.add(el)
        else glowing.delete(el)
    })

    // Over and out of a note, not of the parts it is drawn with.
    const onScore = (on: boolean) => (event: MouseEvent) => {
        const note = linkedNote(event.target)
        if (note && note !== linkedNote(event.relatedTarget)) glow(tracesOf(note, facsimile), on)
    }

    const headsOf = (trace: Element) => Array.from(score.querySelectorAll(`.note[data-corresp~="#${CSS.escape(trace.id)}"] > .notehead`))
    const onFacsimile = (on: boolean) => (event: MouseEvent) => {
        const trace = event.target
        if (trace instanceof Element && trace.id) glow(headsOf(trace), on)
    }

    const listeners: [HTMLElement, 'mouseover' | 'mouseout', (event: MouseEvent) => void][] = [
        [score, 'mouseover', onScore(true)],
        [score, 'mouseout', onScore(false)],
        [facsimile, 'mouseover', onFacsimile(true)],
        [facsimile, 'mouseout', onFacsimile(false)],
    ]
    listeners.forEach(([view, type, listener]) => view.addEventListener(type, listener))
    return () => {
        listeners.forEach(([view, type, listener]) => view.removeEventListener(type, listener))
        glow([...glowing], false)
    }
}

/**
 * Lets a tap on the score or the facsimile highlight the nearest note or trace
 * and its counterparts. Returns what undoes it.
 */
export const highlightOnTap = (score: HTMLElement, facsimile: HTMLElement): (() => void) => {
    let highlighted: { readonly heads: readonly Element[]; readonly traces: readonly Element[] } = { heads: [], traces: [] }

    const highlight = (heads: readonly Element[], traces: readonly Element[]) => {
        highlighted.heads.forEach(head => head.classList.remove('selected'))
        highlighted.traces.forEach(trace => trace.classList.remove('with-glow'))
        heads.forEach(head => head.classList.add('selected'))
        traces.forEach(trace => trace.classList.add('with-glow'))
        highlighted = { heads, traces }
    }

    const onScoreTap = (event: MouseEvent) => {
        const links = linksBetween(score, facsimile).filter(link => isVisible(link.head))
        const link = nearest(links, link => link.head, event.clientX, event.clientY)
        highlight(link ? [link.head] : [], link ? link.traces : [])
    }

    const onFacsimileTap = (event: MouseEvent) => {
        const links = linksBetween(score, facsimile)
        const trace = nearest([...new Set(links.flatMap(link => link.traces))], trace => trace, event.clientX, event.clientY)
        const heads = links.filter(link => trace && link.traces.includes(trace)).map(link => link.head)
        highlight(heads, trace ? [trace] : [])
    }

    score.addEventListener('click', onScoreTap)
    facsimile.addEventListener('click', onFacsimileTap)
    return () => {
        score.removeEventListener('click', onScoreTap)
        facsimile.removeEventListener('click', onFacsimileTap)
        highlight([], [])
    }
}

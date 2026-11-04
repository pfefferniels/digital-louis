/**
 * Linking the notes of the edition to the traces of the manuscript they
 * correspond to (@corresp). The manuscript is the last layer of the score (see
 * `sourceMorph`): there, a note and its traces are highlighted together, and
 * the note the edition reads shows above the handwritten one. With a mouse,
 * while either is hovered over. On a touch screen, where a notehead is a few
 * pixels across, too small to hit with a finger, and a tap leaves no hover
 * behind, a tap selects the note nearest to it until the next tap. Before the
 * manuscript is laid in, no trace is drawn, and nothing is linked.
 *
 * The listeners sit on the view of the score, not on its notes, so that a
 * score drawn anew needs no new ones.
 */

/** How far from a note, in CSS pixels, a finger still reaches it */
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

/** The traces of the manuscript drawn in `view` that a note corresponds to (@corresp, as `#id #id ...`). */
const tracesOf = (note: Element, view: Element): Element[] =>
    (note.getAttribute('data-corresp') ?? '')
        .split(' ')
        .map(ref => document.getElementById(ref.replace(/^#/, '')))
        .filter((trace): trace is HTMLElement => trace !== null && view.contains(trace))

/** Each note with the traces drawn of it. */
const linksIn = (view: Element): Link[] =>
    Array.from(view.querySelectorAll('.note[data-corresp]')).flatMap(note => {
        const head = note.querySelector('.notehead')
        const traces = tracesOf(note, view)
        return head && traces.length > 0 ? [{ head, traces }] : []
    })

const linkedNote = (target: EventTarget | null) =>
    target instanceof Element ? target.closest('.note[data-corresp]') : null

const trace = (target: EventTarget | null) =>
    target instanceof Element && target.id && target.closest('.source-scan') ? target : null

/**
 * Lets hovering over a note highlight its traces, and hovering over a trace
 * the notes it belongs to. Returns what undoes it.
 */
export const highlightOnHover = (view: HTMLElement): (() => void) => {
    const glowing = new Set<Element>()
    const glow = (elements: readonly Element[], on: boolean) => elements.forEach(el => {
        el.classList.toggle('with-glow', on)
        if (on) glowing.add(el)
        else glowing.delete(el)
    })
    const headsOf = (trace: Element) =>
        Array.from(view.querySelectorAll(`.note[data-corresp~="#${CSS.escape(trace.id)}"] > .notehead`))

    // Over and out of a note, not of the parts it is drawn with.
    const listener = (on: boolean) => (event: MouseEvent) => {
        const note = linkedNote(event.target)
        if (note) {
            if (note !== linkedNote(event.relatedTarget)) glow(tracesOf(note, view), on)
            return
        }
        const over = trace(event.target)
        if (over) glow(headsOf(over), on)
    }

    const [over, out] = [listener(true), listener(false)]
    view.addEventListener('mouseover', over)
    view.addEventListener('mouseout', out)
    return () => {
        view.removeEventListener('mouseover', over)
        view.removeEventListener('mouseout', out)
        glow([...glowing], false)
    }
}

/** Lets a tap highlight the note nearest to it, and its traces. Returns what undoes it. */
export const highlightOnTap = (view: HTMLElement): (() => void) => {
    let highlighted: Link = { head: view, traces: [] }

    const highlight = (link: Link | undefined) => {
        highlighted.head.classList.remove('selected')
        highlighted.traces.forEach(trace => trace.classList.remove('with-glow'))
        link?.head.classList.add('selected')
        link?.traces.forEach(trace => trace.classList.add('with-glow'))
        highlighted = link ?? { head: view, traces: [] }
    }

    const onTap = (event: MouseEvent) => {
        const links = linksIn(view).filter(link => isVisible(link.head))
        highlight(nearest(links, link => link.head, event.clientX, event.clientY))
    }

    view.addEventListener('click', onTap)
    return () => {
        view.removeEventListener('click', onTap)
        highlight(undefined)
    }
}

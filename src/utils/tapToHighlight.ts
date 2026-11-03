/**
 * Linking score and facsimile on a touch screen. On a phone a notehead is a
 * few pixels across, too small to hit with a finger, and a tap leaves no
 * hover behind. So a tap selects the note or facsimile trace nearest to it,
 * and it stays highlighted with its counterparts until the next tap.
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

/** Each note of the score with the traces in the facsimile it corresponds to (@corresp, as `#id #id ...`). */
const linksBetween = (score: Element, facsimile: Element): Link[] =>
    Array.from(score.querySelectorAll('.note[data-corresp]')).flatMap(note => {
        const head = note.querySelector('.notehead')
        const traces = (note.getAttribute('data-corresp') ?? '')
            .split(' ')
            .map(ref => document.getElementById(ref.replace(/^#/, '')))
            .filter((trace): trace is HTMLElement => trace !== null && facsimile.contains(trace))
        return head && traces.length > 0 ? [{ head, traces }] : []
    })

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

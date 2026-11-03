/**
 * The last step of the continuum: from the unmeasured reading into the source
 * itself. Each note the encoding links to the facsimile (@corresp) travels to
 * where the manuscript writes it, and takes the size of the handwritten head;
 * the engraving around the notes fades, the facsimile appears beneath, and at
 * last the engraved heads dissolve into the handwritten ones.
 *
 * The score is engraved once, at the unmeasured end of the continuum, and only
 * moved and faded from there, so that every frame is cheap: `morph` is meant
 * to be called for each frame with the progress from 0 (the engraving) to
 * 1 (the manuscript).
 */

const SVG_NS = 'http://www.w3.org/2000/svg'

interface Rect {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
}

interface Center {
    readonly x: number
    readonly y: number
}

interface Flight {
    readonly note: SVGGElement
    /** where the head is engraved, in the coordinates of the page margin */
    readonly from: Center
    /** where the source writes it, in the same coordinates */
    readonly to: Center
    /** the size of the handwritten head, relative to the engraved one */
    readonly scale: number
    /** when the note sets off, as progress */
    readonly start: number
}

interface Morph {
    readonly flights: readonly Flight[]
    readonly scan: SVGSVGElement
    readonly engravedHeight: number
    readonly sourceHeight: number
    readonly viewBox: string | null
}

/** The share of the progress over which the departures of the notes are spread, in reading order */
const stagger = 0.3

/** The share of the progress one note takes for its way */
const travel = 0.6

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** Eases in and out of the interval from `a` to `b`. */
const smoothstep = (a: number, b: number, x: number) => {
    const t = clamp01((x - a) / (b - a))
    return t * t * (3 - 2 * t)
}

const center = ({ x, y, width, height }: Rect): Center => ({ x: x + width / 2, y: y + height / 2 })

/** The box an element takes up, in the user coordinates of `frame`. */
const boxIn = (frame: SVGGraphicsElement, el: Element): Rect | undefined => {
    const toFrame = frame.getScreenCTM()?.inverse()
    const box = el.getBoundingClientRect()
    if (!toFrame || (box.width === 0 && box.height === 0)) return
    const a = new DOMPoint(box.left, box.top).matrixTransform(toFrame)
    const b = new DOMPoint(box.right, box.bottom).matrixTransform(toFrame)
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) }
}

/** The matrix taking the user coordinates of `from` into those of `to`. */
const between = (from: SVGGraphicsElement, to: SVGGraphicsElement): DOMMatrix | undefined => {
    const [a, b] = [from.getScreenCTM(), to.getScreenCTM()]
    return a && b ? DOMMatrix.fromMatrix(b).inverse().multiply(DOMMatrix.fromMatrix(a)) : undefined
}

const asTransform = ({ a, b, c, d, e, f }: DOMMatrix) => `matrix(${a} ${b} ${c} ${d} ${e} ${f})`

/**
 * The trace of the head among the traces a note is linked to: the smallest,
 * as the others are the strokes of tenues.
 */
const headTrace = (note: Element, facsimile: SVGSVGElement): Rect | undefined =>
    (note.getAttribute('data-corresp') ?? '')
        .split(' ')
        .map(ref => document.getElementById(ref.replace(/^#/, '')))
        .filter((trace): trace is HTMLElement => trace !== null && facsimile.contains(trace))
        .map(trace => boxIn(facsimile, trace))
        .filter((box): box is Rect => box !== undefined)
        .sort((a, b) => a.width * a.height - b.width * b.height)[0]

/** The pages of the facsimile without its traces, for beneath the score. */
const scanOf = (facsimile: SVGSVGElement, frame: Rect): SVGSVGElement => {
    const scan = document.createElementNS(SVG_NS, 'svg')
    scan.setAttribute('class', 'source-scan')
    scan.setAttribute('viewBox', `${frame.x} ${frame.y} ${frame.width} ${frame.height}`)
    for (const image of Array.from(facsimile.querySelectorAll('image'))) {
        const place = between(image, facsimile)
        if (!place) continue
        const copy = image.cloneNode(false) as SVGImageElement
        copy.removeAttribute('id')
        const positioned = document.createElementNS(SVG_NS, 'g')
        positioned.setAttribute('transform', asTransform(place))
        positioned.appendChild(copy)
        scan.appendChild(positioned)
    }
    return scan
}

const prepare = (svg: SVGSVGElement, facsimile: SVGSVGElement): Morph | undefined => {
    const page = svg.querySelector<SVGGElement>('.page-margin')
    const frame = facsimile.viewBox.baseVal
    const engraved = svg.viewBox.baseVal
    const pageFromRoot = page && between(svg, page)
    if (!page || !pageFromRoot || !frame || frame.width === 0 || !engraved || engraved.width === 0) return

    // The facsimile is laid over the page at the width of the page.
    const k = engraved.width / frame.width
    const fromSource = ({ x, y }: Center): Center => {
        const p = new DOMPoint((x - frame.x) * k, (y - frame.y) * k).matrixTransform(pageFromRoot)
        return { x: p.x, y: p.y }
    }

    const systems = Array.from(svg.querySelectorAll('.system'))
    const linked = Array.from(svg.querySelectorAll<SVGGElement>('.note[data-corresp]')).flatMap(note => {
        const head = note.querySelector('.notehead use')
        const engravedHead = head && boxIn(page, head)
        const writtenHead = headTrace(note, facsimile)
        if (!engravedHead || !writtenHead) return []
        return [{
            note,
            from: center(engravedHead),
            to: fromSource(center(writtenHead)),
            scale: Math.min(4, Math.max(0.25, Math.sqrt(
                (writtenHead.width * writtenHead.height * k * k) / (engravedHead.width * engravedHead.height)
            ))),
            system: systems.indexOf(note.closest('.system') as Element),
        }]
    })

    // The notes set off one after another, as they are read.
    const order = [...linked].sort((a, b) => a.system - b.system || a.from.x - b.from.x)
    const flights = order.map(({ note, from, to, scale }, i): Flight => {
        note.classList.add('linked')
        return { note, from, to, scale, start: order.length > 1 ? (stagger * i) / (order.length - 1) : 0 }
    })

    const scan = scanOf(facsimile, frame)
    const corner = new DOMPoint(engraved.x, engraved.y).matrixTransform(pageFromRoot)
    scan.setAttribute('x', String(corner.x))
    scan.setAttribute('y', String(corner.y))
    scan.setAttribute('width', String(engraved.width))
    scan.setAttribute('height', String(frame.height * k))
    page.insertBefore(scan, page.firstChild)

    return {
        flights,
        scan,
        engravedHeight: engraved.height,
        sourceHeight: frame.height * k,
        viewBox: svg.getAttribute('viewBox'),
    }
}

const morphs = new WeakMap<SVGSVGElement, Morph>()

const reset = (svg: SVGSVGElement, morph: Morph) => {
    for (const { note } of morph.flights) {
        note.removeAttribute('transform')
        note.classList.remove('linked')
    }
    morph.scan.remove()
    if (morph.viewBox !== null) svg.setAttribute('viewBox', morph.viewBox)
    svg.removeAttribute('data-morph')
    svg.style.removeProperty('--engraving')
    svg.style.removeProperty('--heads')
    morphs.delete(svg)
}

/** Puts the score back as it is engraved, without a trace of the source. */
export const unmorph = (svg: SVGSVGElement) => {
    const current = morphs.get(svg)
    if (current) reset(svg, current)
}

/**
 * Draws the score `progress` of the way from its engraving (0) into the source (1),
 * the facsimile given as the SVG the viewer shows, fitted to what it draws.
 */
export const morph = (svg: SVGSVGElement, facsimile: SVGSVGElement, progress: number) => {
    const current = morphs.get(svg)
    if (progress <= 0) {
        unmorph(svg)
        return
    }
    const state = current ?? prepare(svg, facsimile)
    if (!state) return
    morphs.set(svg, state)

    svg.setAttribute('data-morph', '')
    svg.style.setProperty('--engraving', String(1 - smoothstep(0, 0.4, progress)))
    svg.style.setProperty('--heads', String(1 - smoothstep(0.85, 1, progress)))
    state.scan.style.opacity = String(smoothstep(0.3, 0.95, progress))

    const height = lerp(state.engravedHeight, state.sourceHeight, smoothstep(0, 0.9, progress))
    const { x, y, width } = svg.viewBox.baseVal
    svg.setAttribute('viewBox', `${x} ${y} ${width} ${height}`)

    for (const { note, from, to, scale, start } of state.flights) {
        const way = smoothstep(start, start + travel, progress)
        const at = { x: lerp(from.x, to.x, way), y: lerp(from.y, to.y, way) }
        note.setAttribute('transform',
            `translate(${at.x} ${at.y}) scale(${lerp(1, scale, way)}) translate(${-from.x} ${-from.y})`)
    }
}

/**
 * Runs `measure` on the score as engraved, its notes back in their places:
 * for what measures the engraving, like the tenues, while the notes travel.
 */
export const atRest = (svg: SVGSVGElement, measure: () => void) => {
    const state = morphs.get(svg)
    const moved = state?.flights.map(({ note }) => [note, note.getAttribute('transform')] as const) ?? []
    moved.forEach(([note]) => note.removeAttribute('transform'))
    try {
        measure()
    }
    finally {
        moved.forEach(([note, transform]) => transform !== null && note.setAttribute('transform', transform))
    }
}

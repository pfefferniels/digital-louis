/**
 * The Digital Louis renderer: draws the préludes non mesurés from their MEI
 * encoding anywhere on the continuum between the editors' measured reading
 * (t = 0) and the reading order of the source (t = 1).
 *
 *     const score = prepare(meiDocument)
 *     element.innerHTML = render(score, t)
 *
 * `prepare` does everything that does not depend on t; `render` is cheap
 * enough to run for every frame of a transition. For such frames, `draw`
 * puts the score into an element of the page directly, changing only what
 * moved since the last frame:
 *
 *     draw(element, score, t)
 */
import { clamp } from './algorithms'
import { analyse, Analysis } from './analysis'
import { layOutHorizontally, SystemLayout } from './horizontal'
import { readScore } from './mei'
import { engravePage, Noteheads, PageOptions } from './page'
import type { Point } from './geometry'
import type { ElementId } from './model'
import { drawInto } from './patch'
import { contentStart } from './signatures'
import { sourceMargins, sourceSpan } from './source'
import { margin, svgTree, writeSvg } from './svg'

export { UnsupportedMei } from './mei'
export type { Noteheads } from './page'

export interface RenderOptions {
    /** the width of the page within its margins, in staff spaces */
    readonly width?: number
    /**
     * Where a source writes the head of each note, by the note's id, as a
     * fraction of the width of its page: from its left edge, and from its
     * top. The page then takes the source's margins, and its staves move
     * towards where the source writes their notes, as far as the reading has
     * come to be the source's.
     */
    readonly source?: ReadonlyMap<string, Point>
}

export interface PreparedScore {
    readonly analysis: Analysis
    readonly systems: readonly SystemLayout[]
    readonly options: PageOptions
}

export const prepare = (document: Document, options: RenderOptions = {}): PreparedScore => {
    const analysis = analyse(readScore(document))
    const width = options.width ?? 110
    // the source's page is laid over this one, margins and all
    const full = width + 2 * margin
    const source = options.source && new Map([...options.source].map(([id, { x, y }]) => [id as ElementId, { x: x * full - margin, y: y * full - margin }]))
    // the first head of a system, after the clefs and a little room
    const start = (analysis.measureStates.length > 0 ? contentStart(analysis.measureStates[0]) : 0) + 1.4
    const { left, right } = source ? sourceMargins(analysis.heads.map(head => head.id), source, width, start) : { left: 0, right: 0 }
    const page: PageOptions = { width, left, systemWidth: width - left - right, source }
    const readingSpan = source && ((heads: readonly { readonly id: ElementId, readonly staff: number }[]) => sourceSpan(heads, source, left))
    return { analysis, systems: layOutHorizontally(analysis, { ...page, readingSpan }), options: page }
}

export interface DrawOptions {
    /**
     * `unmeasured` draws every note as unmeasured notation writes it: a
     * semibreve of one size, without stem, flag, beam or dots.
     */
    readonly noteheads?: Noteheads
    /**
     * How far the staves are spaced as unmeasured heads let them, without
     * stems, from 0 to 1, whichever heads are drawn: for the way into the
     * unmeasured view to close up gradually. By default, as the heads drawn ask.
     */
    readonly unmeasuredSpacing?: number
}

const pageAt = (prepared: PreparedScore, t: number, options: DrawOptions) =>
    engravePage(
        prepared.analysis, prepared.systems, clamp(t, 0, 1), prepared.options, options.noteheads ?? 'notated',
        options.unmeasuredSpacing === undefined ? undefined : clamp(options.unmeasuredSpacing, 0, 1)
    )

/** The score as SVG markup at point `t` of the continuum, from 0 (measured) to 1 (as read in the source). */
export const render = (prepared: PreparedScore, t: number, options: DrawOptions = {}): string =>
    writeSvg(pageAt(prepared, t, options))

/** Draws the score at point `t` of the continuum as the content of `host`, reusing what is drawn there. Returns the SVG. */
export const draw = (host: Element, prepared: PreparedScore, t: number, options: DrawOptions = {}): SVGSVGElement =>
    drawInto(host, svgTree(pageAt(prepared, t, options)))

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
import { drawInto } from './patch'
import { svgTree, writeSvg } from './svg'

export { UnsupportedMei } from './mei'
export type { Noteheads } from './page'

export interface RenderOptions {
    /** the width of a system, in staff spaces */
    readonly systemWidth?: number
}

export interface PreparedScore {
    readonly analysis: Analysis
    readonly systems: readonly SystemLayout[]
    readonly options: PageOptions
}

export const prepare = (document: Document, options: RenderOptions = {}): PreparedScore => {
    const analysis = analyse(readScore(document))
    const page: PageOptions = { systemWidth: options.systemWidth ?? 110 }
    return { analysis, systems: layOutHorizontally(analysis, page), options: page }
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

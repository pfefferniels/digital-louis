/**
 * The Digital Louis renderer: draws the préludes non mesurés from their MEI
 * encoding anywhere on the continuum between the editors' measured reading
 * (t = 0) and the reading order of the source (t = 1).
 *
 *     const score = prepare(meiDocument)
 *     element.innerHTML = render(score, t)
 *
 * `prepare` does everything that does not depend on t; `render` is cheap
 * enough to run for every frame of a transition.
 */
import { clamp } from './algorithms'
import { analyse, Analysis } from './analysis'
import { layOutHorizontally, SystemLayout } from './horizontal'
import { readScore } from './mei'
import { engravePage, Noteheads, PageOptions } from './page'
import { writeSvg } from './svg'

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
}

/** The score as SVG markup at point `t` of the continuum, from 0 (measured) to 1 (as read in the source). */
export const render = (prepared: PreparedScore, t: number, options: DrawOptions = {}): string =>
    writeSvg(engravePage(prepared.analysis, prepared.systems, clamp(t, 0, 1), prepared.options, options.noteheads ?? 'notated'))

/**
 * What each staff shows as the music goes on: the clef and key signature its
 * definition gives it, as score definitions between measures and clef changes
 * within layers change them.
 */
import { inclusiveScan } from './algorithms'
import type { Clef, KeySignature, ElementId, Layer, Score } from './model'
import { Rational } from './rational'
import { timeLayer } from './time'

export interface StaffState {
    readonly clef: Clef
    readonly key: KeySignature
}

/** Where something stands in the music, to tell which changes have taken effect there. */
export interface Moment {
    readonly measure: number
    readonly onset: Rational
    /** the layer and the index within it; none at the start of a measure, before anything in it */
    readonly within: { readonly layer: Layer; readonly index: number } | undefined
}

export interface StaffChangePoint {
    readonly moment: Moment
    readonly id: ElementId | undefined
    readonly before: StaffState
    readonly after: StaffState
}

export interface StaffTimeline {
    readonly initial: StaffState
    /** in the order of the music, only those that change something */
    readonly changes: readonly StaffChangePoint[]
}

export const measureStart = (measure: number): Moment => ({ measure, onset: Rational.zero, within: undefined })

/**
 * Whether a change made at `change` holds at `at`. A change at the start of a
 * measure holds throughout it; a clef within a layer holds for what follows it
 * in its layer, and in the other layers from its moment on.
 */
const holdsAt = (change: Moment, at: Moment): boolean => {
    if (change.measure !== at.measure) return change.measure < at.measure
    if (change.within === undefined) return true
    if (at.within === undefined) return false
    const order = change.onset.compare(at.onset)
    if (order !== 0) return order < 0
    return change.within.layer !== at.within.layer || change.within.index < at.within.index
}

const sameClef = (a: Clef, b: Clef): boolean => a.shape === b.shape && a.line === b.line

const sameKey = (a: KeySignature, b: KeySignature): boolean =>
    a.count === b.count && (a.count === 0 || a.accidental === b.accidental)

export const clefChanges = (point: StaffChangePoint): boolean => !sameClef(point.before.clef, point.after.clef)

export const keyChanges = (point: StaffChangePoint): boolean => !sameKey(point.before.key, point.after.key)

interface Candidate {
    readonly moment: Moment
    readonly id: ElementId | undefined
    readonly clef: Clef | undefined
    readonly key: KeySignature | undefined
}

const candidatesIn = (score: Score, staff: number) => {
    const n = score.staves[staff].n
    return score.measures.flatMap((measure, m): Candidate[] => [
        ...measure.changes
            .filter(change => change.staff === n)
            .map(change => ({ moment: measureStart(m), id: undefined, clef: change.clef, key: change.key })),
        ...measure.staves
            .filter(content => content.n === n)
            .flatMap(content => content.layers)
            .flatMap(layer => timeLayer(layer).flatMap((timed, index): Candidate[] => timed.event.kind === 'clef'
                ? [{ moment: { measure: m, onset: timed.onset, within: { layer, index } }, id: timed.event.id, clef: timed.event.clef, key: undefined }]
                : []))
            .sort((a, b) => a.moment.onset.compare(b.moment.onset)),
    ])
}

export const staffTimeline = (score: Score, staff: number): StaffTimeline => {
    const definition = score.staves[staff]
    const initial: StaffState = { clef: definition.clef, key: definition.key }
    const candidates = candidatesIn(score, staff)
    const states = inclusiveScan(
        candidates,
        (state, candidate) => ({ clef: candidate.clef ?? state.clef, key: candidate.key ?? state.key }),
        initial
    )
    return {
        initial,
        changes: candidates
            .map((candidate, i) => ({
                moment: candidate.moment,
                id: candidate.id,
                before: i === 0 ? initial : states[i - 1],
                after: states[i],
            }))
            .filter(point => clefChanges(point) || keyChanges(point)),
    }
}

/** The index of the change that holds at a moment, or -1 where the staff still shows its definition. */
export const governingChange = (timeline: StaffTimeline, at: Moment): number =>
    timeline.changes.reduce((governing, change, i) => (holdsAt(change.moment, at) ? i : governing), -1)

export const stateAt = (timeline: StaffTimeline, at: Moment): StaffState => {
    const governing = governingChange(timeline, at)
    return governing < 0 ? timeline.initial : timeline.changes[governing].after
}

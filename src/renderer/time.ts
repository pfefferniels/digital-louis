/**
 * Notated time, in whole notes.
 */
import { exclusiveScan, inclusiveScan } from './algorithms'
import { Duration, Layer, LayerEvent, layersOf, Measure, NoteValue } from './model'
import { maxOf, Rational, sumOf } from './rational'

const noteValueLength: Readonly<Record<NoteValue, Rational>> = {
    breve: Rational.of(2),
    whole: Rational.of(1),
    half: Rational.of(1, 2),
    quarter: Rational.of(1, 4),
    eighth: Rational.of(1, 8),
}

/** Each dot adds half of what it follows: n dots make (2^(n+1) - 1) / 2^n of the value. */
const lengthOf = (duration: Duration): Rational =>
    noteValueLength[duration.value].times(Rational.of(2 ** (duration.dots + 1) - 1, 2 ** duration.dots))

const isGrace = (event: LayerEvent): boolean =>
    (event.kind === 'note' && event.grace) || (event.kind === 'chord' && event.notes.every(note => note.grace))

/** The time an event takes up in its layer: none for grace notes. */
const extentOf = (event: LayerEvent): Rational =>
    isGrace(event) ? Rational.zero : lengthOf(event.duration)

/**
 * An event placed in notated time. Grace notes take no time: they lead into the
 * event after them, and `graceRank` says how far ahead of it they stand
 * (1 for the grace note right before it, 0 for anything that is not a grace note).
 */
export interface TimedEvent {
    readonly event: LayerEvent
    /** from the start of the measure */
    readonly onset: Rational
    readonly length: Rational
    readonly graceRank: number
}

export const timeLayer = (layer: Layer): TimedEvent[] => {
    const lengths = layer.events.map(extentOf)
    const onsets = exclusiveScan(lengths, (time, length) => time.plus(length), Rational.zero)
    const graceRanks = inclusiveScan(
        [...layer.events].reverse(),
        (rank, event) => (isGrace(event) ? rank + 1 : 0),
        0
    ).reverse()
    return layer.events.map((event, i) => ({ event, onset: onsets[i], length: lengths[i], graceRank: graceRanks[i] }))
}

/** A measure lasts as long as its longest layer. */
export const measureLength = (measure: Measure): Rational =>
    maxOf(layersOf(measure).map(layer => sumOf(layer.events.map(extentOf))))

/**
 * Whether two events sound at the same time. Spans are half-open; an event that
 * takes no time sounds at its onset only.
 */
export const soundTogether = (a: TimedEvent, b: TimedEvent): boolean => {
    const startsWithin = (x: TimedEvent, y: TimedEvent) =>
        x.onset.compare(y.onset) >= 0 && x.onset.compare(y.onset.plus(y.length)) < 0
    return startsWithin(a, b) || startsWithin(b, a)
}

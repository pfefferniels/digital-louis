/**
 * The musical facts the layout needs, worked out once per score: what is drawn
 * on which staff, in which clef, when it sounds, where it is read, and which
 * way its stem goes. Nothing here depends on where things end up on the page.
 */
import { exclusiveScan, mean } from './algorithms'
import type { GlyphName } from './glyph'
import {
    allNotes, Beam, Chord, ElementId, Layer, LayerEvent, Measure, Note, notesOf, NoteValue, Rest, RestValue, Score,
    StaffNumber, StemDirection,
} from './model'
import { middleLine, StaffPosition, staffPosition } from './pitch'
import { Rational } from './rational'
import { readingOrder } from './reading'
import {
    clefChanges, governingChange, keyChanges, measureStart, Moment, StaffState, stateAt, StaffTimeline, staffTimeline,
} from './staffStates'
import { measureLength, soundTogether, TimedEvent, timeLayer } from './time'

/** The size of grace and cue notes, and of clef changes, relative to ordinary ones. */
export const cueScale = 0.75

export type NoteheadGlyph = Extract<GlyphName, `notehead${string}`>
export type RestGlyph = Extract<GlyphName, `rest${string}`>

const noteheads: Readonly<Record<NoteValue, NoteheadGlyph>> = {
    breve: 'noteheadDoubleWholeSquare',
    whole: 'noteheadWhole',
    half: 'noteheadHalf',
    quarter: 'noteheadBlack',
    eighth: 'noteheadBlack',
}

const rests: Readonly<Record<RestValue, RestGlyph>> = {
    whole: 'restWhole',
    half: 'restHalf',
    quarter: 'restQuarter',
    eighth: 'rest8th',
}

/** Where each rest hangs or sits: the whole rest from the fourth line, the others on the middle line. */
const restPositions: Readonly<Record<RestValue, StaffPosition>> = { whole: 6, half: 4, quarter: 4, eighth: 4 }

const stemmed: ReadonlySet<NoteValue> = new Set(['half', 'quarter', 'eighth'])

interface Placement {
    readonly id: ElementId
    /** the index of the staff, from the top */
    readonly staff: number
    readonly measure: number
    readonly layer: Layer
    /** from the start of the measure */
    readonly onset: Rational
    readonly graceRank: number
    readonly position: StaffPosition
    readonly scale: number
}

export interface NoteHead extends Placement {
    readonly kind: 'note'
    readonly note: Note
    readonly chord: Chord | undefined
    readonly glyph: NoteheadGlyph
    /** undefined for notes without a stem */
    readonly stem: StemDirection | undefined
    /** an eighth note outside a beam */
    readonly flagged: boolean
    /** the step at which the source reads the note, if it does */
    readonly step: number | undefined
}

export interface RestHead extends Placement {
    readonly kind: 'rest'
    readonly rest: Rest
    readonly glyph: RestGlyph
}

/** Something drawn at one horizontal place on a staff. */
export type Head = NoteHead | RestHead

export interface BeamGroup {
    readonly beam: Beam
    readonly staff: number
    readonly measure: number
    readonly direction: StemDirection
    readonly scale: number
}

/**
 * A change of clef or key signature, drawn where it takes effect - unless it
 * comes with a score definition and its measure begins a system, which then
 * shows the new clef and key at its start.
 */
export interface StaffMark {
    readonly id: ElementId | undefined
    readonly staff: number
    readonly measure: number
    readonly onset: Rational
    readonly state: StaffState
    readonly showsClef: boolean
    readonly showsKey: boolean
    readonly atMeasureStart: boolean
    /** the earliest step at which the source reads a note in the new clef or key */
    readonly firstStep: number | undefined
}

export interface Analysis {
    readonly score: Score
    readonly heads: readonly Head[]
    readonly headById: ReadonlyMap<ElementId, Head>
    readonly beams: readonly BeamGroup[]
    readonly marks: readonly StaffMark[]
    /** what each staff shows at the start of each measure: [measure][staff] */
    readonly measureStates: readonly (readonly StaffState[])[]
    readonly measureStarts: readonly Rational[]
    readonly measureLengths: readonly Rational[]
}

// ---------------------------------------------------------------------------
// Stem directions

/** A single voice stems by pitch: from the middle line on, stems go down. */
const directionByPitch = (positions: readonly StaffPosition[]): StemDirection => {
    const highest = Math.max(...positions)
    const lowest = Math.min(...positions)
    return highest - middleLine >= middleLine - lowest ? 'down' : 'up'
}

/** Where voices share a staff, odd layers stem up and even layers down - but only while they sound together. */
const directionByVoice = (timed: TimedEvent, layer: Layer, others: readonly TimedEvent[]): StemDirection | undefined =>
    others.some(other => soundTogether(timed, other)) ? (layer.n % 2 === 1 ? 'up' : 'down') : undefined

const explicitDirection = (event: LayerEvent): StemDirection | undefined => {
    switch (event.kind) {
        case 'note': return event.stem
        case 'chord': return event.stem ?? event.notes.map(note => note.stem).find(stem => stem !== undefined)
        case 'rest':
        case 'space':
        case 'clef': return undefined
    }
}

const eventId = (event: LayerEvent): ElementId | undefined =>
    event.kind === 'space' ? undefined : event.id

const hasStem = (event: LayerEvent): boolean =>
    (event.kind === 'note' || event.kind === 'chord') && stemmed.has(event.duration.value)

const isSounding = (timed: TimedEvent): boolean => timed.event.kind !== 'space' && timed.event.kind !== 'clef'

// ---------------------------------------------------------------------------

interface StaffContext {
    readonly measure: number
    readonly staff: number
    readonly timeline: StaffTimeline
    readonly steps: ReadonlyMap<ElementId, number>
}

interface TimedLayer {
    readonly layer: Layer
    readonly events: readonly TimedEvent[]
}

const analyseStaff = (context: StaffContext, layers: readonly TimedLayer[]) => {
    const othersThan = (layer: Layer) =>
        layers.filter(other => other.layer !== layer).flatMap(other => other.events).filter(isSounding)
    const momentOf = (layer: Layer, events: readonly TimedEvent[], timed: TimedEvent): Moment =>
        ({ measure: context.measure, onset: timed.onset, within: { layer, index: events.indexOf(timed) } })
    const positionOf = (moment: Moment) => (note: Note) =>
        staffPosition(note.pitch, stateAt(context.timeline, moment).clef)

    const beams = layers.flatMap(({ layer, events }) => layer.beams
        .filter(beam => beam.members.length > 1)
        .map((beam): BeamGroup => {
            const members = events.filter(timed => beam.members.some(id => id === eventId(timed.event)))
            const positions = members.flatMap(timed =>
                notesOf(timed.event).map(positionOf(momentOf(layer, events, timed))))
            const direction = members.map(timed => explicitDirection(timed.event)).find(dir => dir !== undefined)
                ?? directionByVoice(members[0], layer, othersThan(layer))
                ?? (mean(positions) >= middleLine ? 'down' : 'up')
            const grace = members.every(timed => notesOf(timed.event).every(note => note.grace || note.cue))
            return { beam, staff: context.staff, measure: context.measure, direction, scale: grace ? cueScale : 1 }
        }))

    const beamOf = (id: ElementId) => beams.find(group => group.beam.members.includes(id))

    const heads = layers.flatMap(({ layer, events }) => events.flatMap((timed): Head[] => {
        const { event } = timed
        const placement = (id: ElementId, position: StaffPosition, scale: number): Placement => ({
            id, staff: context.staff, measure: context.measure, layer,
            onset: timed.onset, graceRank: timed.graceRank, position, scale,
        })
        switch (event.kind) {
            case 'space':
            case 'clef': return []
            case 'rest': {
                const byVoice = directionByVoice(timed, layer, othersThan(layer))
                const offset = byVoice === 'up' ? 2 : byVoice === 'down' ? -2 : 0
                return [{
                    ...placement(event.id, restPositions[event.duration.value] + offset, 1),
                    kind: 'rest', rest: event, glyph: rests[event.duration.value],
                }]
            }
            case 'note':
            case 'chord': {
                const notes = notesOf(event)
                const position = positionOf(momentOf(layer, events, timed))
                const beam = beamOf(event.id)
                const stem = hasStem(event)
                    ? beam?.direction
                        ?? explicitDirection(event)
                        ?? directionByVoice(timed, layer, othersThan(layer))
                        ?? directionByPitch(notes.map(position))
                    : undefined
                return notes.map(note => ({
                    ...placement(note.id, position(note), note.grace || note.cue ? cueScale : 1),
                    kind: 'note',
                    note,
                    chord: event.kind === 'chord' ? event : undefined,
                    glyph: noteheads[event.duration.value],
                    stem,
                    flagged: event.duration.value === 'eighth' && beam === undefined,
                    step: context.steps.get(note.id),
                }))
            }
        }
    }))

    // which change of clef or key each read note stands under, to place the marks in the reading order
    const governed = layers.flatMap(({ layer, events }) => events.flatMap(timed => notesOf(timed.event)
        .map(note => ({ change: governingChange(context.timeline, momentOf(layer, events, timed)), step: context.steps.get(note.id) }))))

    return { heads, beams, governed }
}

/** The index of a staff from the top, the way the layout counts staves. */
export const staffIndex = (score: Score, n: StaffNumber): number => {
    const index = score.staves.findIndex(def => def.n === n)
    if (index < 0) throw new Error(`staff ${n} is not defined in the score definition`)
    return index
}

const analyseMeasure = (
    score: Score, measure: Measure, index: number, timelines: readonly StaffTimeline[], steps: ReadonlyMap<ElementId, number>
) =>
    measure.staves.map(staff => {
        const s = staffIndex(score, staff.n)
        return {
            staff: s,
            ...analyseStaff(
                { measure: index, staff: s, timeline: timelines[s], steps },
                staff.layers.map(layer => ({ layer, events: timeLayer(layer) }))
            ),
        }
    })

const marksOf = (timeline: StaffTimeline, staff: number, firstSteps: ReadonlyMap<number, number>): StaffMark[] =>
    timeline.changes.map((change, i) => ({
        id: change.id,
        staff,
        measure: change.moment.measure,
        onset: change.moment.onset,
        state: change.after,
        showsClef: clefChanges(change),
        showsKey: keyChanges(change),
        atMeasureStart: change.moment.within === undefined,
        firstStep: firstSteps.get(i),
    }))

/** A chord whose tones the source reads one after another is rolled: it cannot share one stem. */
export const isRolled = (tones: readonly NoteHead[]): boolean =>
    new Set(tones.map(tone => tone.step)).size > 1

export const analyse = (score: Score): Analysis => {
    const steps = readingOrder(allNotes(score))
    const timelines = score.staves.map((_, staff) => staffTimeline(score, staff))
    const staves = score.measures.flatMap((measure, index) => analyseMeasure(score, measure, index, timelines, steps))
    const heads = staves.flatMap(staff => staff.heads)
    const measureLengths = score.measures.map(measureLength)

    const marks = timelines.flatMap((timeline, staff) => {
        const read = staves
            .filter(content => content.staff === staff)
            .flatMap(content => content.governed)
            .filter((entry): entry is { change: number; step: number } => entry.step !== undefined && entry.change >= 0)
        const firstSteps = read.reduce(
            (first, { change, step }) => first.set(change, Math.min(step, first.get(change) ?? Infinity)),
            new Map<number, number>()
        )
        return marksOf(timeline, staff, firstSteps)
    })

    return {
        score,
        heads,
        headById: new Map(heads.map(head => [head.id, head])),
        beams: staves.flatMap(staff => staff.beams),
        marks,
        measureStates: score.measures.map((_, m) => timelines.map(timeline => stateAt(timeline, measureStart(m)))),
        measureStarts: exclusiveScan(measureLengths, (time, length) => time.plus(length), Rational.zero),
        measureLengths,
    }
}

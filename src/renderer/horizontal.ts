/**
 * Horizontal layout. Every head gets two places on its system: where notated
 * time puts it (the measured layout) and where the reading order of the source
 * puts it (the unmeasured layout). The views in between blend the two.
 */
import { exclusiveScan, groupBy, inclusiveScan, isDefined, mean, partitionPoint, splitGreedily, sum } from './algorithms'
import type { Analysis, Head } from './analysis'
import { unionAll } from './geometry'
import { glyphBox } from './glyph'
import type { ElementId } from './model'
import { clusterOffsets, Extent, footprint, PlacedHead } from './noteheads'
import { Rational } from './rational'
import { contentStart, markSignature, signatureGlyphs } from './signatures'
import { Gap, minimumWidth, spread, widthAtStretch } from './spacing'

export interface Slot {
    readonly measured: number
    readonly reading: number
}

/** A point of a map from notated time (whole notes from the start of the score) to x. */
export interface Knot {
    readonly time: number
    readonly x: number
}

export interface SystemLayout {
    readonly measures: readonly number[]
    /** where the music begins, after the clefs and key signatures */
    readonly contentStart: number
    /** the x of each head's origin */
    readonly slots: ReadonlyMap<ElementId, Slot>
    /** the left edge of each change of clef or key the system draws, by its index in the analysis */
    readonly marks: ReadonlyMap<number, Slot>
    /** the barline closing each measure of the system */
    readonly barlines: readonly Slot[]
    /** where notated time falls on the system, for what is placed by time stamp */
    readonly time: { readonly measured: readonly Knot[]; readonly reading: readonly Knot[] }
}

export interface HorizontalOptions {
    readonly systemWidth: number
}

/** Piecewise linear between the knots, constant beyond them; at a repeated time the last knot holds. */
export const interpolate = (knots: readonly Knot[], time: number): number => {
    const after = partitionPoint(knots, knot => knot.time <= time)
    if (after === 0) return knots[0].x
    if (after === knots.length) return knots[after - 1].x
    const [a, b] = [knots[after - 1], knots[after]]
    return a.x + ((time - a.time) / (b.time - a.time)) * (b.x - a.x)
}

// ---------------------------------------------------------------------------
// What stands at a place

/** A change of clef or key standing at a place: `x` is the left edge of its glyphs, relative to the place. */
interface PlacedMark {
    readonly mark: number
    readonly x: number
}

interface Content {
    readonly heads: readonly PlacedHead[]
    readonly marks: readonly PlacedMark[]
}

/** White space between neighbouring places, between notes and barlines, after the clefs, and before what leads in. */
const padding = { place: 0.4, barline: 0.9, lineStart: 0.8, leaders: 0.25 }

/** The room a reading step asks for when the line has it to give - what keeps the unmeasured view legible. */
const readingStep = 2

const noExtent: Extent = { left: 0, right: 0 }

const placeCluster = (heads: readonly Head[]): Content => {
    const offsets = clusterOffsets(heads)
    return { heads: heads.map(head => ({ head, x: offsets.get(head.id) ?? 0 })), marks: [] }
}

const markAt = (mark: number): Content => ({ heads: [], marks: [{ mark, x: 0 }] })

const markExtent = (analysis: Analysis, { mark, x }: PlacedMark): Extent | undefined => {
    const box = unionAll(signatureGlyphs(markSignature(analysis.marks[mark], x))
        .map(({ glyph, origin, scale }) => glyphBox(glyph, origin, scale)))
    return box && { left: box.left, right: box.right }
}

const contentExtent = (analysis: Analysis, content: Content): Extent | undefined => {
    const extents = [footprint(content.heads), ...content.marks.map(mark => markExtent(analysis, mark))].filter(isDefined)
    return extents.length === 0 ? undefined : {
        left: Math.min(...extents.map(extent => extent.left)),
        right: Math.max(...extents.map(extent => extent.right)),
    }
}

const shifted = (content: Content, dx: number): Content => ({
    heads: content.heads.map(({ head, x }) => ({ head, x: x + dx })),
    marks: content.marks.map(({ mark, x }) => ({ mark, x: x + dx })),
})

const concatenate = (contents: readonly Content[]): Content => ({
    heads: contents.flatMap(content => content.heads),
    marks: contents.flatMap(content => content.marks),
})

const staffOf = (analysis: Analysis) => (staff: number) => ({
    head: (head: Head) => head.staff === staff,
    mark: (mark: number) => analysis.marks[mark].staff === staff,
})

const stavesOf = (analysis: Analysis, heads: readonly Head[], marks: readonly number[]): number[] =>
    [...new Set([...heads.map(head => head.staff), ...marks.map(mark => analysis.marks[mark].staff)])]

/**
 * What stands before a place and leads into it - the grace notes, the last of
 * them nearest, and before them a change of clef or key - each a little to the
 * left of where the one after it begins.
 */
const leadInto = (analysis: Analysis, main: Content, leaders: readonly Content[]): Content => {
    const extents = leaders.map(leader => contentExtent(analysis, leader) ?? noExtent)
    const shiftFor = (frontier: number, extent: Extent) => frontier - padding.leaders - extent.right
    const frontiers = exclusiveScan(
        extents,
        (frontier, extent) => shiftFor(frontier, extent) + extent.left,
        contentExtent(analysis, main)?.left ?? 0
    )
    return concatenate([main, ...leaders.map((leader, i) => shifted(leader, shiftFor(frontiers[i], extents[i])))])
}

/** The heads of a place on each of its staves, with what leads into them there. */
const placeContent = (
    analysis: Analysis, heads: readonly Head[], marks: readonly number[],
    onStaff: (heads: readonly Head[], marks: readonly number[]) => Content
): Content => concatenate(stavesOf(analysis, heads, marks).map(staff => {
    const on = staffOf(analysis)(staff)
    return onStaff(heads.filter(on.head), marks.filter(on.mark))
}))

// ---------------------------------------------------------------------------
// Places

/** A place on a line: what is drawn there, relative to it - or the barline closing a measure. */
interface Place extends Content {
    readonly measure: number
    /** how far along its measure the place lies: notated time when measured, the reading step when not */
    readonly along: number
    readonly barline: boolean
}

/** The changes of clef or key a measure draws; those of a score definition show at a system's start instead. */
const marksOf = (analysis: Analysis, measure: number, beginsSystem: boolean): number[] =>
    analysis.marks.flatMap((mark, i) => (mark.measure === measure && !(beginsSystem && mark.atMeasureStart) ? [i] : []))

/** At a measured place, the grace notes and then the changes of clef or key lead into the heads. */
const measuredStaff = (analysis: Analysis) => (heads: readonly Head[], marks: readonly number[]): Content => {
    const graceRanks = [...groupBy(heads.filter(head => head.graceRank > 0), head => head.graceRank).entries()]
        .sort(([a], [b]) => a - b)
        .map(([, rank]) => placeCluster(rank))
    return leadInto(analysis, placeCluster(heads.filter(head => head.graceRank === 0)), [...graceRanks, ...marks.map(markAt)])
}

const measuredPlaces = (analysis: Analysis, measure: number, heads: readonly Head[], marks: readonly number[]): Place[] => {
    const length = analysis.measureLengths[measure]
    const onsetOf = (mark: number) => analysis.marks[mark].onset
    const onsets = [...new Map([...heads.map(head => head.onset), ...marks.map(onsetOf)]
        .map(onset => [onset.toString(), onset])).values()]
        .sort((a, b) => a.compare(b))
    const placeAt = (onset: Rational, barline: boolean): Place => ({
        measure,
        along: onset.toNumber(),
        barline,
        ...placeContent(
            analysis,
            heads.filter(head => head.onset.equals(onset)),
            marks.filter(mark => onsetOf(mark).equals(onset)),
            measuredStaff(analysis)
        ),
    })
    return [...onsets.filter(onset => onset.compare(length) < 0).map(onset => placeAt(onset, false)), placeAt(length, true)]
}

/**
 * The reading layout has a place for each step at which the source reads the
 * measure's notes. A change of clef or key leads into the first note read under
 * it; one under which nothing in the measure is read stands before the barline.
 */
const readingPlaces = (analysis: Analysis, measure: number, heads: readonly Head[], marks: readonly number[]): Place[] => {
    const read = heads.flatMap(head => (head.kind === 'note' && head.step !== undefined ? [{ head, step: head.step }] : []))
    const steps = [...groupBy(read, ({ step }) => step).entries()].sort(([a], [b]) => a - b)
    const readSteps = new Set(steps.map(([step]) => step))
    const leadsInto = (step: number | undefined) => (mark: number) => {
        const first = analysis.marks[mark].firstStep
        return step === undefined ? first === undefined || !readSteps.has(first) : first === step
    }
    const onStaff = (staffHeads: readonly Head[], staffMarks: readonly number[]) =>
        leadInto(analysis, placeCluster(staffHeads), staffMarks.map(markAt))
    const placeAt = (step: number | undefined, group: readonly Head[], along: number): Place => ({
        measure,
        along,
        barline: step === undefined,
        ...placeContent(analysis, group, marks.filter(leadsInto(step)), onStaff),
    })
    return [
        ...steps.map(([step, group], i) => placeAt(step, group.map(({ head }) => head), i)),
        placeAt(undefined, [], steps.length),
    ]
}

// ---------------------------------------------------------------------------
// Gaps

const extentsByStaff = (analysis: Analysis, place: Place): Map<number, Extent> =>
    new Map(stavesOf(analysis, place.heads.map(({ head }) => head), place.marks.map(({ mark }) => mark)).map(staff => {
        const on = staffOf(analysis)(staff)
        const content = {
            heads: place.heads.filter(({ head }) => on.head(head)),
            marks: place.marks.filter(({ mark }) => on.mark(mark)),
        }
        return [staff, contentExtent(analysis, content) ?? noExtent]
    }))

/** How far apart two neighbouring places must at least be; a barline stands across all staves. */
const clearance = (analysis: Analysis, before: Place | undefined, after: Place): number => {
    const right = before ? extentsByStaff(analysis, before) : new Map<number, Extent>()
    const left = extentsByStaff(analysis, after)
    const reachLeft = Math.max(0, ...[...left.values()].map(extent => -extent.left))
    if (before === undefined) return reachLeft + padding.lineStart
    if (before.barline) return reachLeft + padding.barline
    if (after.barline) return Math.max(0, reachLeft, ...[...right.values()].map(extent => extent.right)) + padding.barline
    const overlap = [...right.entries()].flatMap(([staff, extent]) => {
        const next = left.get(staff)
        return next ? [extent.right - next.left] : []
    })
    return Math.max(0, ...overlap) + padding.place
}

/** Time - or reading - asks for room only within a measure: a measure starts right after its barline. */
const gapsOf = (analysis: Analysis, places: readonly Place[]): Gap[] =>
    places.map((place, i) => {
        const before: Place | undefined = places[i - 1]
        const weight = before === undefined || before.barline ? 0 : place.along - before.along
        return { minimum: clearance(analysis, before, place), weight }
    })

// ---------------------------------------------------------------------------
// Systems

interface MeasurePlaces {
    readonly measured: readonly Place[]
    readonly reading: readonly Place[]
}

const positions = <K>(places: readonly Place[], xs: readonly number[], parts: (place: Place) => readonly (readonly [K, number])[]) =>
    new Map(places.flatMap((place, i) => parts(place).map(([key, x]) => [key, xs[i] + x] as const)))

const headParts = (place: Place) => place.heads.map(({ head, x }) => [head.id, x] as const)
const markParts = (place: Place) => place.marks.map(({ mark, x }) => [mark, x] as const)

const layOutSystem = (
    analysis: Analysis,
    measures: readonly number[],
    placesOf: (measure: number, beginsSystem: boolean) => MeasurePlaces,
    options: HorizontalOptions
): SystemLayout => {
    const start = contentStart(analysis.measureStates[measures[0]])
    const width = options.systemWidth - start
    const places = measures.map((measure, k) => placesOf(measure, k === 0))
    const measured = places.flatMap(place => place.measured)
    const reading = places.flatMap(place => place.reading)
    const measuredXs = spread(gapsOf(analysis, measured), start, width)
    const readingXs = spread(gapsOf(analysis, reading), start, width)

    const readingHeads = positions(reading, readingXs, headParts)
    const readingMarks = positions(reading, readingXs, markParts)
    const timeOf = (place: Place) => analysis.measureStarts[place.measure].toNumber() + place.along
    const origin = { time: analysis.measureStarts[measures[0]].toNumber(), x: start }

    const measuredKnots = [origin, ...measured.map((place, i) => ({ time: timeOf(place), x: measuredXs[i] }))]

    // The reading layout knows where notated time falls only through the notes it reads:
    // a measured place lies at the mean of where those of its notes are read.
    const readingBarlines = reading.map((place, i) => (place.barline ? readingXs[i] : undefined)).filter(isDefined)
    const barlineIndex = exclusiveScan(measured, (count, place) => count + (place.barline ? 1 : 0), 0)
    const readKnots = measured.flatMap((place, i): Knot[] => {
        if (place.barline) return [{ time: timeOf(place), x: readingBarlines[barlineIndex[i]] }]
        const read = place.heads.map(({ head }) => readingHeads.get(head.id)).filter(isDefined)
        return read.length === 0 ? [] : [{ time: timeOf(place), x: mean(read) }]
    })
    // Read in an order of its own, the music may run back against notated time; the map may not.
    const readingKnots = inclusiveScan(
        [origin, ...readKnots],
        (previous, knot) => ({ time: knot.time, x: Math.max(previous.x, knot.x) }),
        { time: -Infinity, x: -Infinity }
    )

    // What the source does not read - a rest, say - stands where notated time
    // falls in the reading layout, keeping its offset within its measured place.
    const slotsOf = <K>(parts: (place: Place) => readonly (readonly [K, number])[], read: ReadonlyMap<K, number>) =>
        new Map(measured.flatMap((place, i) => parts(place).map(([key, x]) => [key, {
            measured: measuredXs[i] + x,
            reading: read.get(key) ?? interpolate(readingKnots, timeOf(place)) + x,
        }] as const)))

    return {
        measures,
        contentStart: start,
        slots: slotsOf(headParts, readingHeads),
        marks: slotsOf(markParts, readingMarks),
        barlines: measured
            .map((place, i) => (place.barline ? measuredXs[i] : undefined))
            .filter(isDefined)
            .map((x, i) => ({ measured: x, reading: readingBarlines[i] })),
        time: { measured: measuredKnots, reading: readingKnots },
    }
}

export const layOutHorizontally = (analysis: Analysis, options: HorizontalOptions): SystemLayout[] => {
    const headsByMeasure = groupBy(analysis.heads, head => head.measure)
    const placesOf = (measure: number, beginsSystem: boolean): MeasurePlaces => {
        const heads = headsByMeasure.get(measure) ?? []
        const marks = marksOf(analysis, measure, beginsSystem)
        return {
            measured: measuredPlaces(analysis, measure, heads, marks),
            reading: readingPlaces(analysis, measure, heads, marks),
        }
    }
    // A measure joins a system if both its layouts fit: the measured one at its
    // tightest, the unmeasured one with the room its reading steps ask for.
    const widths = analysis.score.measures.map((_, measure) => {
        const { measured, reading } = placesOf(measure, false)
        return Math.max(minimumWidth(gapsOf(analysis, measured)), widthAtStretch(gapsOf(analysis, reading), readingStep))
    })
    const available = (first: number) => options.systemWidth - contentStart(analysis.measureStates[first])

    return splitGreedily(analysis.score.measures.map((_, measure) => measure), (measure, system) =>
        analysis.score.measures[measure].breakBefore
        || sum(system.map(m => widths[m])) + widths[measure] > available(system[0])
    ).map(system => layOutSystem(analysis, system, placesOf, options))
}

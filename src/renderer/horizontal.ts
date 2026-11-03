/**
 * Horizontal layout. Every head gets two places on its system: where notated
 * time puts it (the measured layout) and where the reading order of the source
 * puts it (the unmeasured layout). The views in between blend the two.
 */
import { exclusiveScan, groupBy, inclusiveScan, isDefined, mean, partitionPoint, splitGreedily, sum } from './algorithms'
import type { Analysis, Head } from './analysis'
import type { ElementId } from './model'
import { clusterOffsets, Extent, footprint, PlacedHead } from './noteheads'
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
    /** the x of each head's origin */
    readonly slots: ReadonlyMap<ElementId, Slot>
    /** the barline closing each measure of the system */
    readonly barlines: readonly Slot[]
    /** where notated time falls on the system, for what is placed by time stamp */
    readonly time: { readonly measured: readonly Knot[]; readonly reading: readonly Knot[] }
}

export interface HorizontalOptions {
    readonly systemWidth: number
    /** where the music starts on each system, after the clefs */
    readonly contentStart: number
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
// Places

/** A place on a line: the heads drawn there, relative to it, or the barline closing a measure. */
interface Place {
    readonly measure: number
    /** how far along its measure the place lies: notated time when measured, the reading step when not */
    readonly along: number
    readonly heads: readonly PlacedHead[]
    readonly barline: boolean
}

/** The room a reading step asks for when the line has it to give - what keeps the unmeasured view legible. */
const readingStep = 2

/** White space between neighbouring places, between notes and barlines, and after the clefs. */
const padding = { place: 0.4, barline: 0.9, lineStart: 0.8, graces: 0.25 }

const placeCluster = (heads: readonly Head[], x: number): PlacedHead[] => {
    const offsets = clusterOffsets(heads)
    return heads.map(head => ({ head, x: x + (offsets.get(head.id) ?? 0) }))
}

const shifted = (heads: readonly PlacedHead[], dx: number): PlacedHead[] =>
    heads.map(({ head, x }) => ({ head, x: x + dx }))

const noExtent: Extent = { left: 0, right: 0 }

/**
 * Grace notes stand before the place they lead into, the last of them nearest:
 * each rank of grace notes ends a little before where the rank after it begins.
 */
const placeGraces = (graces: readonly Head[], right: number): PlacedHead[] => {
    const ranks = [...groupBy(graces, head => head.graceRank).entries()]
        .sort(([a], [b]) => a - b)
        .map(([, heads]) => placeCluster(heads, 0))
    const extents = ranks.map(rank => footprint(rank) ?? noExtent)
    const shiftFor = (frontier: number, extent: Extent) => frontier - padding.graces - extent.right
    const frontiers = exclusiveScan(extents, (frontier, extent) => shiftFor(frontier, extent) + extent.left, right)
    return ranks.flatMap((rank, i) => shifted(rank, shiftFor(frontiers[i], extents[i])))
}

/** The main heads of a measured place on each staff, with the grace notes leading into them. */
const measuredHeads = (heads: readonly Head[]): PlacedHead[] =>
    [...groupBy(heads, head => head.staff).values()].flatMap(staffHeads => {
        const main = placeCluster(staffHeads.filter(head => head.graceRank === 0), 0)
        return [...main, ...placeGraces(staffHeads.filter(head => head.graceRank > 0), footprint(main)?.left ?? 0)]
    })

const measuredPlaces = (analysis: Analysis, measure: number, heads: readonly Head[]): Place[] => {
    const length = analysis.measureLengths[measure]
    const byOnset = [...groupBy(heads, head => head.onset.toString()).values()]
        .sort((a, b) => a[0].onset.compare(b[0].onset))
    const columns = byOnset.filter(group => group[0].onset.compare(length) < 0)
    const intoBarline = byOnset.filter(group => group[0].onset.equals(length)).flat()
    return [
        ...columns.map(group => ({ measure, along: group[0].onset.toNumber(), heads: measuredHeads(group), barline: false })),
        { measure, along: length.toNumber(), heads: measuredHeads(intoBarline), barline: true },
    ]
}

const readingPlaces = (measure: number, heads: readonly Head[]): Place[] => {
    const read = heads.flatMap(head => (head.kind === 'note' && head.step !== undefined ? [{ head, step: head.step }] : []))
    const steps = [...groupBy(read, ({ step }) => step).entries()]
        .sort(([a], [b]) => a - b)
        .map(([, group]) => group.map(({ head }) => head))
    return [
        ...steps.map((group, i) => ({
            measure,
            along: i,
            heads: [...groupBy(group, head => head.staff).values()].flatMap(staffHeads => placeCluster(staffHeads, 0)),
            barline: false,
        })),
        { measure, along: steps.length, heads: [], barline: true },
    ]
}

// ---------------------------------------------------------------------------
// Gaps

const extentsByStaff = (place: Place): Map<number, Extent> =>
    new Map([...groupBy(place.heads, placed => placed.head.staff).entries()]
        .map(([staff, heads]) => [staff, footprint(heads) ?? noExtent]))

/** How far apart two neighbouring places must at least be; a barline stands across all staves. */
const clearance = (before: Place | undefined, after: Place): number => {
    const right = before ? extentsByStaff(before) : new Map<number, Extent>()
    const left = extentsByStaff(after)
    if (before === undefined) return Math.max(0, ...[...left.values()].map(extent => -extent.left)) + padding.lineStart
    if (before.barline || after.barline) {
        const reach = before.barline
            ? [...left.values()].map(extent => -extent.left)
            : [...right.values()].map(extent => extent.right)
        return Math.max(0, ...reach) + padding.barline
    }
    const overlap = [...right.entries()].flatMap(([staff, extent]) => {
        const next = left.get(staff)
        return next ? [extent.right - next.left] : []
    })
    return Math.max(0, ...overlap) + padding.place
}

/** Time - or reading - asks for room only within a measure: a measure starts right after its barline. */
const gapsOf = (places: readonly Place[]): Gap[] =>
    places.map((place, i) => {
        const before: Place | undefined = places[i - 1]
        const weight = before === undefined || before.barline ? 0 : place.along - before.along
        return { minimum: clearance(before, place), weight }
    })

// ---------------------------------------------------------------------------
// Systems

interface MeasurePlaces {
    readonly measured: readonly Place[]
    readonly reading: readonly Place[]
}

const placedAt = (places: readonly Place[], xs: readonly number[]): Map<ElementId, number> =>
    new Map(places.flatMap((place, i) => place.heads.map(({ head, x }) => [head.id, xs[i] + x] as const)))

const layOutSystem = (
    analysis: Analysis, measures: readonly number[], places: readonly MeasurePlaces[], options: HorizontalOptions
): SystemLayout => {
    const width = options.systemWidth - options.contentStart
    const measured = measures.flatMap(m => places[m].measured)
    const reading = measures.flatMap(m => places[m].reading)
    const measuredXs = spread(gapsOf(measured), options.contentStart, width)
    const readingXs = spread(gapsOf(reading), options.contentStart, width)

    const readingX = placedAt(reading, readingXs)
    const timeOf = (place: Place) => analysis.measureStarts[place.measure].toNumber() + place.along
    const start = { time: analysis.measureStarts[measures[0]].toNumber(), x: options.contentStart }

    const measuredKnots = [start, ...measured.map((place, i) => ({ time: timeOf(place), x: measuredXs[i] }))]

    // The reading layout knows where notated time falls only through the notes it reads:
    // a measured place lies at the mean of where those of its notes are read.
    const readingBarlines = reading.map((place, i) => (place.barline ? readingXs[i] : undefined)).filter(isDefined)
    const barlineIndex = exclusiveScan(measured, (count, place) => count + (place.barline ? 1 : 0), 0)
    const readKnots = measured.flatMap((place, i): Knot[] => {
        if (place.barline) return [{ time: timeOf(place), x: readingBarlines[barlineIndex[i]] }]
        const read = place.heads.map(({ head }) => readingX.get(head.id)).filter(isDefined)
        return read.length === 0 ? [] : [{ time: timeOf(place), x: mean(read) }]
    })
    // Read in an order of its own, the music may run back against notated time; the map may not.
    const readingKnots = inclusiveScan(
        [start, ...readKnots],
        (previous, knot) => ({ time: knot.time, x: Math.max(previous.x, knot.x) }),
        { time: -Infinity, x: -Infinity }
    )

    // A head the source does not read - a rest, say - stands where notated time
    // falls in the reading layout, keeping its offset within its measured place.
    const slots = new Map(measured.flatMap((place, i) => place.heads.map(({ head, x }) => [head.id, {
        measured: measuredXs[i] + x,
        reading: readingX.get(head.id) ?? interpolate(readingKnots, timeOf(place)) + x,
    }] as const)))

    return {
        measures,
        slots,
        barlines: measured
            .map((place, i) => (place.barline ? measuredXs[i] : undefined))
            .filter(isDefined)
            .map((x, i) => ({ measured: x, reading: readingBarlines[i] })),
        time: { measured: measuredKnots, reading: readingKnots },
    }
}

export const layOutHorizontally = (analysis: Analysis, options: HorizontalOptions): SystemLayout[] => {
    const headsByMeasure = groupBy(analysis.heads, head => head.measure)
    const measures = analysis.score.measures.map((_, m) => m)
    const places: MeasurePlaces[] = measures.map(m => {
        const heads = headsByMeasure.get(m) ?? []
        return { measured: measuredPlaces(analysis, m, heads), reading: readingPlaces(m, heads) }
    })
    // A measure joins a system if both its layouts fit: the measured one at its
    // tightest, the unmeasured one with the room its reading steps ask for.
    const widthOf = (m: number) =>
        Math.max(minimumWidth(gapsOf(places[m].measured)), widthAtStretch(gapsOf(places[m].reading), readingStep))
    const available = options.systemWidth - options.contentStart

    return splitGreedily(measures, (m, system) =>
        analysis.score.measures[m].breakBefore || sum(system.map(widthOf)) + widthOf(m) > available
    ).map(system => layOutSystem(analysis, system, places, options))
}


/**
 * The page: each system engraved at one point of the continuum, its staves
 * stacked as closely as their content allows, the systems one below the other;
 * where a source is known, moving as far towards the source's layout as the
 * reading has come to be the source's (see `source.ts`).
 */
import { adjacentPairs, groupBy, inclusiveScan, isDefined, lerp } from './algorithms'
import { Analysis, asUnmeasured, Head } from './analysis'
import { engraveControls, StaffDrawing } from './controls'
import { boundsOf, Drawing, group, Group, line, primitiveBoxes, text, translate } from './drawing'
import { Box, union, unionAll } from './geometry'
import { interpolate, Segment, Slot, SystemLayout } from './horizontal'
import { engravingDefaults } from './leipzig'
import type { Barline, ElementId } from './model'
import { markSignature, systemSignature } from './signatures'
import { SourceHeads, sourceStaffTop } from './source'
import { keepApart, roomBefore } from './noteheads'
import { engraveStaff } from './staff'

export interface PageOptions {
    /** the width of the page, within its margins */
    readonly width: number
    /** where the systems begin on the page */
    readonly left: number
    readonly systemWidth: number
    /** where a source writes the heads of the notes, on the page */
    readonly source?: SourceHeads
}

/** How the heads are drawn: as notated, or as unmeasured notation writes them. */
export type Noteheads = 'notated' | 'unmeasured'

export interface Page {
    readonly width: number
    readonly height: number
    readonly content: Group
}

const spacing = {
    /** the least distance from one staff's top line to the next */
    staves: 9,
    /** the least white space between what two staves of a system take up */
    clearance: 1.4,
    systems: 3.5,
    title: 2.6,
}

const at = (slot: Slot, t: number): number => lerp(slot.measured, slot.reading, t)

/** The room an ornament keeps before the note it leads into, as grace notes keep it on the beat */
const leaderGap = 0.25

const smoothstep = (from: number, to: number, x: number) => {
    const s = Math.min(1, Math.max(0, (x - from) / (to - from)))
    return s * s * (3 - 2 * s)
}

/** Grace notes - ornaments - with the chord they lead into: in one layer, sounding where it does. */
interface Ornament {
    /** the note of the chord the ornament keeps to, the first the source reads */
    readonly target: ElementId
    readonly chord: readonly Head[]
    /** its grace notes, the nearest first */
    readonly graces: readonly Head[]
}

const ornamentsOf = new WeakMap<Analysis, readonly Ornament[]>()

/** Of the heads of a chord, the one the source reads first: where the source breaks it, the one an ornament leads into. */
const firstRead = (chord: readonly Head[]): Head => {
    const step = (head: Head) => (head.kind === 'note' ? head.step : undefined) ?? Infinity
    return chord.reduce((first, head) => (step(head) < step(first) ? head : first))
}

const ornaments = (analysis: Analysis): readonly Ornament[] => {
    const known = ornamentsOf.get(analysis)
    if (known) return known
    const runs = [...groupBy(analysis.heads, head => `${head.measure} ${head.layer.n} ${head.staff} ${head.onset}`).values()]
        .flatMap(heads => {
            const chord = heads.filter(head => head.graceRank === 0)
            const graces = heads.filter(head => head.graceRank > 0).sort((a, b) => a.graceRank - b.graceRank)
            return chord.length > 0 && graces.length > 0 ? [{ target: firstRead(chord).id, chord, graces }] : []
        })
    ornamentsOf.set(analysis, runs)
    return runs
}

/** Where an ornament stands from the note it keeps to: as measured, and as close as it can. */
interface Offsets {
    readonly target: ElementId
    readonly measured: number
    readonly close: number
}

const offsetsIn = new WeakMap<SystemLayout, ReadonlyMap<ElementId, Offsets>>()

/**
 * The room the measured layout leaves an ornament before the note it leads
 * into: all that leads into the place, on every layer, stands before all the
 * place holds. Once off the beat, each ornament needs room before its own
 * chord only, and comes up to it.
 */
const ornamentOffsets = (analysis: Analysis, layout: SystemLayout): ReadonlyMap<ElementId, Offsets> => {
    const known = offsetsIn.get(layout)
    if (known) return known
    const offsets = new Map(ornaments(analysis).flatMap(({ target, chord, graces }) => {
        const of = layout.slots.get(target)
        const placed = (heads: readonly Head[]) => heads.flatMap(head => {
            const slot = layout.slots.get(head.id)
            return slot ? [{ head, x: slot.measured }] : []
        })
        const [nearest, notes] = [placed(graces.filter(grace => grace.graceRank === graces[0].graceRank)), placed(chord)]
        if (!of || nearest.length === 0) return []
        const closer = Math.max(0, roomBefore(nearest, notes, leaderGap))
        return placed(graces).map(({ head, x }) => {
            const measured = x - of.measured
            return [head.id, { target, measured, close: measured + closer }] as const
        })
    }))
    offsetsIn.set(layout, offsets)
    return offsets
}

/**
 * How far an ornament stands from the note it leads into at point `t` of the
 * continuum: by Jamais d'aplomb (a third of the way) close up to it, and only
 * then more and more where the source's reading has it.
 */
const ornamentOffset = (ornament: Offsets, slot: Slot, of: Slot, t: number): number => t < 1 / 3
    ? lerp(ornament.measured, ornament.close, smoothstep(0, 1 / 3, t))
    : lerp(ornament.close, slot.reading - of.reading, smoothstep(1 / 3, 1, t))

/** What a staff takes up when it holds nothing but its lines. */
const emptyStaff: Box = { left: 0, top: 0, right: 0, bottom: 4 }

const barlineLines = (x: number, style: Barline, top: number): Drawing[] => {
    const { thinBarlineThickness: thin, thickBarlineThickness: thick, barlineSeparation } = engravingDefaults
    const stroke = (centre: number, width: number) => line({ x: centre, y: top }, { x: centre, y: top + 4 }, width)
    switch (style) {
        case 'single': return [stroke(x - thin / 2, thin)]
        case 'end': return [stroke(x - thick - barlineSeparation - thin / 2, thin), stroke(x - thick / 2, thick)]
    }
}

/** What is drawn on a staff, its lines aside. */
const obstaclesOn = (staff: Group): Box[] =>
    staff.children.filter(child => child.kind !== 'line').flatMap(primitiveBoxes)

/** A system engraved staff by staff, before the staves are stacked: each of its segments of measures. */
interface SystemParts {
    readonly measures: readonly { readonly segment: Segment, readonly staves: readonly Group[] }[]
    readonly controls: readonly StaffDrawing[]
    /** what each staff takes up, with what is drawn about it */
    readonly extents: readonly Box[]
    readonly barlines: readonly number[]
}

const engraveParts = (
    analysis: Analysis, layout: SystemLayout, t: number, options: PageOptions, noteheads: Noteheads
): SystemParts => {
    const { score } = analysis
    // On their way between the layouts, heads keep clear of each other: wholly
    // from a third of the way on, and as they first part, more and more.
    // An ornament follows the note it leads into, wherever that gives way to.
    const offsets = ornamentOffsets(analysis, layout)
    const weight = smoothstep(0, 1 / 3, t)
    const shown = (head: Head) => noteheads === 'unmeasured' ? asUnmeasured(head) : head
    const notes = keepApart(new Map(analysis.heads.flatMap(head => {
        const slot = layout.slots.get(head.id)
        return slot && !offsets.has(head.id) ? [[head.id, { head: shown(head), x: at(slot, t) }] as const] : []
    })), weight)
    const placed = keepApart(new Map([...notes, ...analysis.heads.flatMap(head => {
        const ornament = offsets.get(head.id)
        const [slot, of] = [layout.slots.get(head.id), ornament && layout.slots.get(ornament.target)]
        const target = ornament && notes.get(ornament.target)
        return ornament && slot && of && target
            ? [[head.id, { head: shown(head), x: target.x + ornamentOffset(ornament, slot, of, t) }] as const]
            : []
    })]), weight)
    const barlines = layout.barlines.map(slot => at(slot, t))
    const staffIndices = score.staves.map((_, i) => i)

    const measures = layout.segments.map((segment, k) => {
        const { measure } = segment
        const staves = staffIndices.map(staff => engraveStaff({
            analysis,
            measure,
            staff,
            placed: new Map([...placed].filter(([, { head }]) => head.measure === measure && head.staff === staff)),
            t,
            left: k === 0 ? 0 : barlines[k - 1],
            right: barlines[k],
            signatures: [
                ...(k === 0 ? [systemSignature(analysis.measureStates[measure][staff])] : []),
                ...[...layout.marks]
                    .filter(([mark]) => analysis.marks[mark].measure === measure && analysis.marks[mark].staff === staff)
                    .map(([mark, slot]) => markSignature(analysis.marks[mark], at(slot, t))),
            ],
        }))
        return { segment, staves }
    })

    const staffBoxes = new Map(staffIndices.map(staff => [staff, unionAll(
        measures.map(({ staves }) => boundsOf(staves[staff])).filter(isDefined)
    ) ?? emptyStaff]))

    const [first, last] = [layout.segments[0], layout.segments[layout.segments.length - 1]]
    const controls = engraveControls({
        analysis,
        measures: layout.segments.map(segment => segment.measure),
        span: {
            start: analysis.measureStarts[first.measure].plus(first.start).toNumber(),
            end: analysis.measureStarts[last.measure].plus(last.end).toNumber(),
        },
        placed,
        obstacles: new Map(staffIndices.map(staff => [staff, measures.flatMap(({ staves }) => obstaclesOn(staves[staff]))])),
        staffBoxes,
        timeX: time => lerp(interpolate(layout.time.measured, time), interpolate(layout.time.reading, time), t),
        lineStart: layout.contentStart,
        lineEnd: options.systemWidth,
    })

    const extents = staffIndices.map(staff => controls
        .filter(control => control.staff === staff)
        .map(control => boundsOf(control.drawing))
        .filter(isDefined)
        .reduce(union, staffBoxes.get(staff) ?? emptyStaff))
    return { measures, controls, extents, barlines }
}

/** Each staff goes as close below the one above as what both take up allows. */
const stack = (extents: readonly Box[]): number[] => [0, ...inclusiveScan(
    adjacentPairs(extents),
    (top, [above, below]) => top + Math.max(spacing.staves, above.bottom - below.top + spacing.clearance),
    0
)]

const assemble = (analysis: Analysis, parts: SystemParts, tops: readonly number[]): Group => {
    const { score } = analysis
    const onStaff = ({ staff, drawing }: StaffDrawing) => translate(drawing, 0, tops[staff])
    const systemLine = line(
        { x: 0, y: tops[0] },
        { x: 0, y: tops[tops.length - 1] + 4 },
        engravingDefaults.thinBarlineThickness
    )
    return group(['system'], [
        systemLine,
        ...parts.measures.map(({ segment: { measure, part, last }, staves }, k) => {
            const id = score.measures[measure].id
            return group(['measure'], [
                ...staves.map((staff, s) => translate(staff, 0, tops[s])),
                // where the source breaks the line within a measure, there is no barline
                group(['barLine'], last ? tops.flatMap(top => barlineLines(parts.barlines[k], score.measures[measure].rightBarline, top)) : []),
                ...parts.controls.filter(control => control.measure === measure).map(onStaff),
            ], { id: id && part > 0 ? `${id}-${part}` as ElementId : id })
        }),
    ])
}

const lerpBox = (a: Box, b: Box, t: number): Box => ({
    left: lerp(a.left, b.left, t), top: lerp(a.top, b.top, t), right: lerp(a.right, b.right, t), bottom: lerp(a.bottom, b.bottom, t),
})

/** The centre of the head of each note in a drawing, by the note's id. */
const headCentres = (drawing: Drawing, into = new Map<ElementId, { x: number, y: number }>()) => {
    if (drawing.kind !== 'group') return into
    const head = drawing.classes.includes('note') && drawing.id !== undefined
        ? drawing.children.find(child => child.kind === 'group' && child.classes.includes('notehead'))
        : undefined
    const box = head && boundsOf(head)
    if (box && drawing.id !== undefined) into.set(drawing.id as ElementId, { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 })
    drawing.children.forEach(child => headCentres(child, into))
    return into
}

/**
 * A system with its heads drawn as `noteheads` says, and its staves spaced
 * `unmeasuredSpacing` of the way from as notated heads ask (0) to as
 * unmeasured ones let them (1), which are without stems and take less room:
 * the way the view closes up as it comes to the unmeasured notation.
 */
interface EngravedSystem {
    /** as drawn */
    readonly parts: SystemParts
    /** while the staves are spaced between the two kinds of heads: the system with either, and how far between */
    readonly between?: { readonly notated: SystemParts, readonly unmeasured: SystemParts, readonly spacing: number }
    /** the top line of each staff, the first at 0 */
    readonly tops: readonly number[]
    /** the height of each head on its staff, from its top line, by staff */
    readonly heads: readonly ReadonlyMap<ElementId, number>[]
}

const engraveSystem = (
    analysis: Analysis, layout: SystemLayout, t: number, options: PageOptions,
    noteheads: Noteheads, unmeasuredSpacing: number
): EngravedSystem => {
    const parts = engraveParts(analysis, layout, t, options, noteheads)
    const heads = parts.extents.map((_, staff) => new Map([...parts.measures.flatMap(({ staves }) => [...headCentres(staves[staff])])]
        .map(([id, { y }]) => [id, y])))
    if (unmeasuredSpacing === (noteheads === 'unmeasured' ? 1 : 0)) return { parts, tops: stack(parts.extents), heads }
    const other = engraveParts(analysis, layout, t, options, noteheads === 'unmeasured' ? 'notated' : 'unmeasured')
    const [notated, unmeasured] = noteheads === 'unmeasured' ? [other, parts] : [parts, other]
    const [notatedTops, unmeasuredTops] = [stack(notated.extents), stack(unmeasured.extents)]
    return {
        parts,
        between: { notated, unmeasured, spacing: unmeasuredSpacing },
        tops: notatedTops.map((top, i) => lerp(top, unmeasuredTops[i], unmeasuredSpacing)),
        heads,
    }
}

/** The room a system takes up with its staves at `tops`: what each staff takes up, where it stands. */
const roomOf = (parts: SystemParts, tops: readonly number[]): Box =>
    parts.extents.map((extent, k) => ({ ...extent, top: extent.top + tops[k], bottom: extent.bottom + tops[k] })).reduce(union)

/**
 * The room a system takes up with its staves at `tops`: between what either
 * kind of heads would take, while it is spaced between them, so that what
 * follows moves on smoothly.
 */
const boxOf = (system: EngravedSystem, tops: readonly number[]): Box => {
    const { between } = system
    return between
        ? lerpBox(roomOf(between.notated, tops), roomOf(between.unmeasured, tops), between.spacing)
        : roomOf(system.parts, tops)
}

/** What is above a system: where its content ends, and the top line of its last staff. */
interface Above {
    readonly bottom: number
    readonly lastStaff: number | undefined
}

/**
 * Where the staves of a system stand on the page: as closely below what is
 * above as their content allows, or `towardsSource` of the way to where the
 * source writes their notes, though never closer to each other than their
 * content allows. Following the source, a system keeps clear only of the
 * staves above, not of all they hold: the source's lines too stand closer
 * than what is written about them.
 */
const placeStaves = (
    analysis: Analysis, system: EngravedSystem, above: Above, source: SourceHeads | undefined, towardsSource: number
) => {
    const natural = system.tops
    const first = above.bottom + spacing.systems - boxOf(system, natural).top
    const targets = source && towardsSource > 0 ? system.heads.map(heads => sourceStaffTop(heads, source)) : []
    const known = targets.findIndex(isDefined)
    if (known < 0) return { drawing: assemble(analysis, system.parts, natural), box: boxOf(system, natural), top: first, tops: natural }

    // a staff the source tells nothing of keeps its distance to one it does
    const wanted = natural.map((top, k) => {
        const target = targets[k] ?? (targets[known] as number) - natural[known] + top
        return lerp(first + top, target, towardsSource)
    })
    for (let k = 1; k < wanted.length; k++) wanted[k] = Math.max(wanted[k], wanted[k - 1] + natural[k] - natural[k - 1])
    const tops = wanted.map(top => top - wanted[0])
    const box = boxOf(system, tops)
    const clear = above.lastStaff === undefined
        ? above.bottom + spacing.systems - box.top
        : lerp(above.bottom + spacing.systems - box.top, above.lastStaff + spacing.staves, towardsSource)
    return { drawing: assemble(analysis, system.parts, tops), box, top: Math.max(wanted[0], clear), tops }
}

export const engravePage = (
    analysis: Analysis, layouts: readonly SystemLayout[], t: number, options: PageOptions, noteheads: Noteheads,
    unmeasuredSpacing = noteheads === 'unmeasured' ? 1 : 0,
    towardsSource = t
): Page => {
    const { title } = analysis.score
    const heading = title === undefined ? [] : [
        group(['pgHead'], [text({ x: options.width / 2, y: spacing.title }, title, spacing.title, 'middle')]),
    ]
    const systems: Drawing[] = []
    let above: Above = { bottom: title === undefined ? 0 : 1.5 * spacing.title, lastStaff: undefined }
    for (const layout of layouts) {
        const system = engraveSystem(analysis, layout, t, options, noteheads, unmeasuredSpacing)
        const { drawing, box, top, tops } = placeStaves(analysis, system, above, options.source, towardsSource)
        systems.push(translate(drawing, options.left, top))
        above = { bottom: Math.max(above.bottom, top + box.bottom), lastStaff: top + tops[tops.length - 1] }
    }
    return {
        width: options.width,
        height: Math.max(0, above.bottom),
        content: group(['page-margin'], [...heading, ...systems]),
    }
}

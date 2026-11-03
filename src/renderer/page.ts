/**
 * The page: each system engraved at one point of the continuum, its staves
 * stacked as closely as their content allows, the systems one below the other.
 */
import { adjacentPairs, exclusiveScan, inclusiveScan, isDefined, lerp } from './algorithms'
import { Analysis, asUnmeasured } from './analysis'
import { engraveControls, StaffDrawing } from './controls'
import { boundsOf, Drawing, group, Group, line, primitiveBoxes, text, translate } from './drawing'
import { Box, union, unionAll } from './geometry'
import { interpolate, Slot, SystemLayout } from './horizontal'
import { engravingDefaults } from './leipzig'
import type { Barline } from './model'
import { markSignature, systemSignature } from './signatures'
import { engraveStaff } from './staff'

export interface PageOptions {
    readonly systemWidth: number
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

interface EngravedSystem {
    readonly drawing: Group
    readonly box: Box
}

const engraveSystem = (
    analysis: Analysis, layout: SystemLayout, t: number, options: PageOptions, noteheads: Noteheads
): EngravedSystem => {
    const { score } = analysis
    const placed = new Map(analysis.heads.flatMap(head => {
        const slot = layout.slots.get(head.id)
        const shown = noteheads === 'unmeasured' ? asUnmeasured(head) : head
        return slot ? [[head.id, { head: shown, x: at(slot, t) }] as const] : []
    }))
    const barlines = layout.barlines.map(slot => at(slot, t))
    const staffIndices = score.staves.map((_, i) => i)

    const measures = layout.measures.map((measure, k) => {
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
        return { measure, staves }
    })

    const staffBoxes = new Map(staffIndices.map(staff => [staff, unionAll(
        measures.map(({ staves }) => boundsOf(staves[staff])).filter(isDefined)
    ) ?? emptyStaff]))

    const controls = engraveControls({
        analysis,
        measures: layout.measures,
        placed,
        obstacles: new Map(staffIndices.map(staff => [staff, measures.flatMap(({ staves }) => obstaclesOn(staves[staff]))])),
        staffBoxes,
        timeX: time => lerp(interpolate(layout.time.measured, time), interpolate(layout.time.reading, time), t),
        lineStart: layout.contentStart,
        lineEnd: options.systemWidth,
    })

    // Each staff goes as close below the one above as what both take up allows.
    const extents = staffIndices.map(staff => controls
        .filter(control => control.staff === staff)
        .map(control => boundsOf(control.drawing))
        .filter(isDefined)
        .reduce(union, staffBoxes.get(staff) ?? emptyStaff))
    const tops = [0, ...inclusiveScan(
        adjacentPairs(extents),
        (top, [above, below]) => top + Math.max(spacing.staves, above.bottom - below.top + spacing.clearance),
        0
    )]
    const onStaff = ({ staff, drawing }: StaffDrawing) => translate(drawing, 0, tops[staff])

    const systemLine = line(
        { x: 0, y: tops[0] },
        { x: 0, y: tops[tops.length - 1] + 4 },
        engravingDefaults.thinBarlineThickness
    )
    const drawing = group(['system'], [
        systemLine,
        ...measures.map(({ measure, staves }, k) => group(['measure'], [
            ...staves.map((staff, s) => translate(staff, 0, tops[s])),
            group(['barLine'], tops.flatMap(top => barlineLines(barlines[k], score.measures[measure].rightBarline, top))),
            ...controls.filter(control => control.measure === measure).map(onStaff),
        ], { id: score.measures[measure].id })),
    ])
    return { drawing, box: boundsOf(drawing) ?? emptyStaff }
}

export const engravePage = (
    analysis: Analysis, layouts: readonly SystemLayout[], t: number, options: PageOptions, noteheads: Noteheads
): Page => {
    const { title } = analysis.score
    const heading = title === undefined ? [] : [
        group(['pgHead'], [text({ x: options.systemWidth / 2, y: spacing.title }, title, spacing.title, 'middle')]),
    ]
    const systems = layouts.map(layout => engraveSystem(analysis, layout, t, options, noteheads))
    const heightOf = (box: Box) => box.bottom - box.top
    const tops = exclusiveScan(
        systems,
        (top, system) => top + heightOf(system.box) + spacing.systems,
        (title === undefined ? 0 : 1.5 * spacing.title) + spacing.systems
    )
    const last = systems.length - 1
    return {
        width: options.systemWidth,
        height: last < 0 ? 0 : tops[last] + heightOf(systems[last].box),
        content: group(['page-margin'], [
            ...heading,
            ...systems.map((system, i) => translate(system.drawing, 0, tops[i] - system.box.top)),
        ]),
    }
}

/**
 * What is placed against notes, or by time stamp, rather than drawn in a
 * layer: ties, ornaments, figured bass, and the cadence labels and brackets.
 */
import { clamp } from './algorithms'
import { Analysis, NoteHead, staffIndex } from './analysis'
import { Drawing, glyph, group, line, text } from './drawing'
import { Box, overlaps, Point } from './geometry'
import { glyphBox, GlyphName } from './glyph'
import { engravingDefaults } from './leipzig'
import type {
    Bracket, ControlEvent, Direction, ElementId, FiguredBass, Ornament, OrnamentSign, Place, Tie, Timestamp,
} from './model'
import { headBox, isNoteHead, isPlacedNote, PlacedHead, stemRoot } from './noteheads'
import { middleLine, positionY } from './pitch'

/** A drawing that belongs to one staff of one measure, in the staff's own coordinates. */
export interface StaffDrawing {
    readonly staff: number
    readonly measure: number
    readonly drawing: Drawing
}

export interface ControlScene {
    readonly analysis: Analysis
    /** the measures of the system, whole or in part */
    readonly measures: readonly number[]
    /** the stretch of notated time the system holds, in whole notes from the start of the score */
    readonly span: { readonly start: number, readonly end: number }
    /** the heads of the system at their places */
    readonly placed: ReadonlyMap<ElementId, PlacedHead>
    /** what is drawn on each staff, for ornaments to keep clear of */
    readonly obstacles: ReadonlyMap<number, readonly Box[]>
    /** what the notes of each staff take up across the system */
    readonly staffBoxes: ReadonlyMap<number, Box>
    /** where notated time, in whole notes from the start of the score, falls on the system */
    readonly timeX: (time: number) => number
    readonly lineStart: number
    readonly lineEnd: number
}

const timeOf = (analysis: Analysis, measure: number, at: Timestamp): number => {
    const target = Math.min(measure + at.measuresAhead, analysis.measureStarts.length - 1)
    return analysis.measureStarts[target].toNumber() + (at.beat - 1) / analysis.score.meter.unit
}


// ---------------------------------------------------------------------------
// Ties

/** Ties curve away from the stems; without a stem, away from the middle of the staff. */
const tieCurve = (head: NoteHead, tie: Tie): Place => {
    if (tie.curve) return tie.curve
    if (head.stem) return head.stem === 'up' ? 'below' : 'above'
    return head.position >= middleLine ? 'above' : 'below'
}

/** A tie is a crescent: thin at its ends, thickest in its middle. */
const tieShape = (from: Point, to: Point, curve: Place): Drawing => {
    const length = to.x - from.x
    const away = curve === 'above' ? -1 : 1
    const height = clamp(0.1 * length + 0.4, 0.5, 1.4)
    const inner = height - engravingDefaults.tieMidpointThickness
    const at = (fraction: number, rise: number): Point => ({ x: from.x + fraction * length, y: from.y + away * rise })
    return {
        kind: 'shape',
        start: from,
        curves: [
            { control1: at(0.25, height), control2: at(0.75, height), end: to },
            { control1: at(0.75, inner), control2: at(0.25, inner), end: from },
        ],
    }
}

/** A tie reaching across a system break is drawn as two halves, each running into the margin. */
const drawTie = (scene: ControlScene, tie: Tie): StaffDrawing[] => {
    const start = scene.placed.get(tie.start)
    const end = scene.placed.get(tie.end)
    const tied = scene.analysis.headById.get(tie.start)
    const anchor = start ?? end
    if (anchor === undefined || tied === undefined || !isNoteHead(tied)) return []

    const curve = tieCurve(tied, tie)
    const y = positionY(tied.position) + (curve === 'above' ? -0.6 : 0.6)
    const from = start ? headBox(start).right + 0.1 : scene.lineStart - 0.6
    const to = end ? headBox(end).left - 0.1 : scene.lineEnd + 0.4
    if (to - from < 0.3) return []
    return [{
        staff: anchor.head.staff,
        measure: anchor.head.measure,
        drawing: group(['tie'], [tieShape({ x: from, y }, { x: to, y }, curve)], {
            id: tie.id,
            data: { startid: `#${tie.start}`, endid: `#${tie.end}` },
        }),
    }]
}

// ---------------------------------------------------------------------------
// Ornaments

interface OrnamentStyle {
    readonly glyph: GlyphName
    readonly side: Place
    readonly className: string
}

/**
 * The ornaments as the Bauyn manuscript writes them: the tremblement as a short
 * wavy line a little above its note, the pincé - the wavy line struck through -
 * just below it.
 */
const ornamentStyles: Readonly<Record<OrnamentSign, OrnamentStyle>> = {
    trill: { glyph: 'ornamentTremblement', side: 'above', className: 'trill' },
    lowerMordent: { glyph: 'ornamentMordent', side: 'below', className: 'mordent' },
    upperMordent: { glyph: 'ornamentShortTrill', side: 'above', className: 'mordent' },
}

/** Bauyn's signs are about as wide as one and a half noteheads. */
const ornamentScale = 0.6

/** How close a sign comes to its note, and how far it moves at a time to clear something in its way. */
const ornamentGap = 0.35
const ornamentStep = 0.25

/**
 * An ornament stands as close to its note as it can: over or under the head,
 * on the far side of the note's own stem, and moving away from the head only
 * as far as it must to clear the other heads, stems, accidentals and beams.
 */
const drawOrnament = (scene: ControlScene, measure: number, ornament: Ornament): StaffDrawing[] => {
    const placed = scene.placed.get(ornament.on)
    if (placed === undefined) return []
    const { glyph: name, side, className } = ornamentStyles[ornament.sign]
    const head = headBox(placed)
    const shape = glyphBox(name, { x: 0, y: 0 }, ornamentScale)
    const width = shape.right - shape.left
    const centred = (head.left + head.right) / 2 - width / 2

    const stem = isPlacedNote(placed) ? placed.head.stem : undefined
    const stemX = isPlacedNote(placed) && stem ? stemRoot(placed, stem).x : undefined
    const left = stemX === undefined ? centred
        : side === 'above' && stem === 'up' ? Math.min(centred, stemX - ornamentGap - width)
        : side === 'below' && stem === 'down' ? Math.max(centred, stemX + ornamentGap)
        : centred

    const originAt = (distance: number): Point => ({
        x: left - shape.left,
        y: side === 'above'
            ? head.top - ornamentGap - distance - shape.bottom
            : head.bottom + ornamentGap + distance - shape.top,
    })
    const obstacles = scene.obstacles.get(placed.head.staff) ?? []
    const isClear = (origin: Point) => !obstacles.some(obstacle => overlaps(glyphBox(name, origin, ornamentScale), obstacle))
    const origin = Array.from({ length: 40 }, (_, k) => originAt(k * ornamentStep)).find(isClear) ?? originAt(0)

    return [{
        staff: placed.head.staff,
        measure,
        drawing: group([className], [glyph(name, origin, ornamentScale)], { id: ornament.id, data: { startid: ornament.on } }),
    }]
}

// ---------------------------------------------------------------------------
// Figured bass, cadence labels and brackets

const figureSize = 1.7
const labelSize = 2

/** Figures stand below the staff, level across the system and clear of its lowest notes. */
const drawFiguredBass = (scene: ControlScene, measure: number, figures: FiguredBass): StaffDrawing[] => {
    const staff = staffIndex(scene.analysis.score, figures.staff)
    const x = scene.timeX(timeOf(scene.analysis, measure, figures.at))
    const first = Math.max(6.4, (scene.staffBoxes.get(staff)?.bottom ?? 4) + figureSize)
    return [{
        staff,
        measure,
        drawing: group(['harm'], [
            group(['fb'], figures.figures.map((figure, i) =>
                group(['f'], [text({ x, y: first + i * figureSize }, figure, figureSize)])
            )),
        ], { id: figures.id }),
    }]
}

/** The line of a bracket above the staff, clear of its highest notes. */
const bracketHeight = (scene: ControlScene, staff: number): number =>
    Math.min(-1.6, (scene.staffBoxes.get(staff)?.top ?? 0) - 1)

const drawDirection = (scene: ControlScene, measure: number, direction: Direction): StaffDrawing[] => {
    const staff = staffIndex(scene.analysis.score, direction.staff)
    const x = scene.timeX(timeOf(scene.analysis, measure, direction.at))
    return [{
        staff,
        measure,
        drawing: group(['dir', ...direction.types], [
            text({ x, y: bracketHeight(scene, staff) - 0.5 }, direction.text, labelSize),
        ], { id: direction.id }),
    }]
}

/** A bracket reaching across a system break is drawn in each system it reaches, hooked where it begins and ends. */
const drawBracket = (scene: ControlScene, measure: number, bracket: Bracket): StaffDrawing[] => {
    const { span } = scene
    const from = timeOf(scene.analysis, measure, bracket.from)
    const to = timeOf(scene.analysis, measure, bracket.to)
    if (to < span.start || from >= span.end) return []

    const staff = staffIndex(scene.analysis.score, bracket.staff)
    const y = bracketHeight(scene, staff)
    const startsHere = from >= span.start
    const endsHere = to <= span.end
    const left = startsHere ? scene.timeX(from) : scene.lineStart - 0.6
    const right = endsHere ? scene.timeX(to) : scene.lineEnd
    const thickness = engravingDefaults.thinBarlineThickness
    const hook = (x: number) => line({ x, y }, { x, y: y + 0.7 }, thickness)
    return [{
        staff,
        measure: startsHere ? measure : scene.measures[0],
        drawing: group(['bracketSpan', ...bracket.types], [
            line({ x: left, y }, { x: right, y }, thickness),
            ...(startsHere ? [hook(left)] : []),
            ...(endsHere ? [hook(right)] : []),
        ], { id: bracket.id }),
    }]
}

// ---------------------------------------------------------------------------

/**
 * Everything a system draws besides its staves. Ties and brackets are looked
 * up across the whole score, since they may reach into the system from before it.
 */
export const engraveControls = (scene: ControlScene): StaffDrawing[] => {
    const inSystem = new Set(scene.measures)
    // a measure the source breaks within is on two systems: what stands at a time stamp goes to the one holding that time
    const atTime = (measure: number, at: Timestamp) => {
        const time = timeOf(scene.analysis, measure, at)
        return inSystem.has(measure) && time >= scene.span.start - 1e-9 && time < scene.span.end - 1e-9
    }
    return scene.analysis.score.measures.flatMap((measure, index) => measure.controls.flatMap(
        (control: ControlEvent): StaffDrawing[] => {
            switch (control.kind) {
                case 'tie': return drawTie(scene, control)
                case 'bracket': return drawBracket(scene, index, control)
                case 'ornament': return inSystem.has(index) ? drawOrnament(scene, index, control) : []
                case 'figuredBass': return atTime(index, control.at) ? drawFiguredBass(scene, index, control) : []
                case 'direction': return atTime(index, control.at) ? drawDirection(scene, index, control) : []
            }
        }
    ))
}

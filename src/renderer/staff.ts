/**
 * Engraving one staff of one measure at one point of the continuum: the staff
 * lines and clef, and the notes and rests of its layers with their stems,
 * flags, beams, accidentals, dots and ledger lines.
 */
import { clamp, isDefined, splitGreedily } from './algorithms'
import { Analysis, BeamGroup, isRolled, NoteHead, staffIndex } from './analysis'
import { boundsOf, Drawing, glyph, group, Group, line } from './drawing'
import type { Box, Point } from './geometry'
import { glyphWidth } from './glyph'
import { engravingDefaults } from './leipzig'
import { ElementId, Layer, LayerEvent, Note, notesOf, Score, StemDirection } from './model'
import {
    dotCenters, dotRadius, flagAt, headOrigin, headWidth, isPlacedNote, PlacedAccidental, placeAccidentals, PlacedHead,
    stemLength, stemRoot, stemTip,
} from './noteheads'
import { clefGlyphs, clefPosition, positionY, StaffPosition, topLine } from './pitch'

const clefX = 0.8

/** Where the music begins on a system: after the widest clef. */
export const contentStartFor = (score: Score): number =>
    clefX + Math.max(...score.staves.map(staff => glyphWidth(clefGlyphs[staff.clef.shape]))) + 0.6

export interface StaffScene {
    readonly analysis: Analysis
    readonly measure: number
    /** the index of the staff from the top */
    readonly staff: number
    /** the heads of the staff in the measure, at their place for this point of the continuum */
    readonly placed: ReadonlyMap<ElementId, PlacedHead>
    /** how far towards the unmeasured layout the continuum has gone, from 0 to 1 */
    readonly t: number
    readonly left: number
    readonly right: number
    readonly withClef: boolean
}

export interface EngravedStaff {
    readonly drawing: Group
    /** the box of each note as drawn, for what is placed against notes */
    readonly noteBoxes: ReadonlyMap<ElementId, Box>
}

/** A stem's centre line, from where it leaves the head to its tip. */
interface Stem {
    readonly x: number
    readonly root: number
    readonly tip: number
}

const stemLine = (stem: Stem): Drawing =>
    group(['stem'], [line({ x: stem.x, y: stem.root }, { x: stem.x, y: stem.tip }, engravingDefaults.stemThickness)])

const references = (ids: readonly ElementId[]): string => ids.map(id => `#${id}`).join(' ')

const noteData = (note: Note): Record<string, string> => Object.fromEntries([
    ['corresp', note.corresp],
    ['precedes', note.precedes.length > 0 ? references(note.precedes) : undefined],
    ['next', note.next && references([note.next])],
].filter((entry): entry is [string, string] => entry[1] !== undefined))

// ---------------------------------------------------------------------------
// Stems and beams

/** The head a stem leaves from - the one farthest from its tip - and the head nearest to the tip. */
const stemEnds = (tones: readonly PlacedHead<NoteHead>[], direction: StemDirection) => {
    const byHeight = [...tones].sort((a, b) => a.head.position - b.head.position)
    const [lowest, highest] = [byHeight[0], byHeight[byHeight.length - 1]]
    return direction === 'up' ? { root: lowest, nearest: highest } : { root: highest, nearest: lowest }
}

const freeStem = (tones: readonly PlacedHead<NoteHead>[], direction: StemDirection): Stem => {
    const { root } = stemEnds(tones, direction)
    const { x, y } = stemRoot(root, direction)
    return { x, root: y, tip: stemTip(tones, direction) }
}

/** Beams slant with the notes, but no more than this. */
const maximumSlope = 0.25

/** Under a beam no stem is shorter than this, in staff spaces at full size. */
const shortestBeamedStem = 2.5

interface BeamedMember {
    readonly event: LayerEvent
    readonly tones: readonly PlacedHead<NoteHead>[]
}

/**
 * A beam runs between the tips its first and last stems would have, slanted no
 * more than `maximumSlope`, and moves away from the notes as far as it must for
 * every stem under it to keep a playable length.
 */
const beamStems = (members: readonly BeamedMember[], beam: BeamGroup): { stems: Stem[]; outline: Point[] } => {
    const { direction, scale } = beam
    const away = direction === 'up' ? -1 : 1
    const ends = members.map(({ tones }) => {
        const { root, nearest } = stemEnds(tones, direction)
        const start = stemRoot(root, direction)
        return { x: start.x, root: start.y, nearest: positionY(nearest.head.position) }
    })
    const [first, last] = [ends[0], ends[ends.length - 1]]
    const idealTip = (end: (typeof ends)[number]) => end.nearest + away * stemLength * scale
    const run = last.x - first.x
    const slope = run > 0 ? clamp((idealTip(last) - idealTip(first)) / run, -maximumSlope, maximumSlope) : 0
    const along = (x: number) => idealTip(first) + slope * (x - first.x)
    const shortfall = ends.map(end => (end.nearest + away * shortestBeamedStem * scale - along(end.x)) * away)
    const shift = Math.max(0, ...shortfall) * away
    const tipAt = (x: number) => along(x) + shift

    const half = engravingDefaults.stemThickness / 2
    const thickness = engravingDefaults.beamThickness * scale * -away
    const [left, right] = [first.x - half, last.x + half]
    return {
        stems: ends.map(end => ({ x: end.x, root: end.root, tip: tipAt(end.x) })),
        outline: [
            { x: left, y: tipAt(left) }, { x: right, y: tipAt(right) },
            { x: right, y: tipAt(right) + thickness }, { x: left, y: tipAt(left) + thickness },
        ],
    }
}

// ---------------------------------------------------------------------------
// Notes, chords and rests

interface LayerScene {
    readonly placed: ReadonlyMap<ElementId, PlacedHead>
    readonly accidentals: ReadonlyMap<ElementId, PlacedAccidental>
    readonly t: number
}

const drawNote = (scene: LayerScene, placed: PlacedHead<NoteHead>, stem: Stem | undefined, flagged: boolean): Group => {
    const { head } = placed
    const accidental = scene.accidentals.get(head.id)
    const dots = dotCenters(placed)
    const flag = stem && flagged && head.stem ? flagAt(stem.x, stem.tip, head.stem, head.scale) : undefined
    return group(['note', ...head.note.types], [
        group(['notehead'], [glyph(head.glyph, headOrigin(placed), head.scale)]),
        ...(accidental ? [group(['accid'], [glyph(accidental.glyph, accidental.origin, head.scale)])] : []),
        ...(dots.length > 0
            ? [group(['dots'], dots.map(center => ({ kind: 'dot', center, radius: dotRadius * head.scale }) as const))]
            : []),
        ...(stem ? [stemLine(stem)] : []),
        ...(flag ? [group(['flag'], [glyph(flag.glyph, flag.origin, flag.scale)])] : []),
    ], { id: head.note.id, data: noteData(head.note) })
}

const tonesOf = (scene: LayerScene, event: LayerEvent): PlacedHead<NoteHead>[] =>
    notesOf(event).map(note => scene.placed.get(note.id)).filter(isDefined).filter(isPlacedNote)

/**
 * A note or chord, with the stem a beam gives it or one of its own. A chord
 * the source reads one tone after another loses its common stem as soon as
 * its tones part: each tone is stemmed on its own.
 */
const drawEvent = (scene: LayerScene, event: LayerEvent, beamed?: Stem): Drawing[] => {
    switch (event.kind) {
        case 'space': return []
        case 'rest': {
            const placed = scene.placed.get(event.id)
            if (placed === undefined) return []
            const dots = dotCenters(placed)
            return [group(['rest'], [
                glyph(placed.head.glyph, headOrigin(placed)),
                ...dots.map(center => ({ kind: 'dot', center, radius: dotRadius }) as const),
            ], { id: event.id })]
        }
        case 'note': {
            const [placed] = tonesOf(scene, event)
            if (placed === undefined) return []
            const direction = placed.head.stem
            const stem = beamed ?? (direction && freeStem([placed], direction))
            return [drawNote(scene, placed, stem, placed.head.flagged)]
        }
        case 'chord': {
            const tones = tonesOf(scene, event)
            if (tones.length === 0) return []
            const direction = tones[0].head.stem
            if (scene.t > 0 && isRolled(tones.map(tone => tone.head)) && beamed === undefined) {
                return [group(['chord'], tones.map(tone =>
                    drawNote(scene, tone, direction && freeStem([tone], direction), tone.head.flagged)
                ), { id: event.id })]
            }
            const stem = beamed ?? (direction && freeStem(tones, direction))
            const flag = stem && direction && tones[0].head.flagged ? flagAt(stem.x, stem.tip, direction, tones[0].head.scale) : undefined
            return [group(['chord'], [
                ...(stem ? [stemLine(stem)] : []),
                ...(flag ? [group(['flag'], [glyph(flag.glyph, flag.origin, flag.scale)])] : []),
                ...tones.map(tone => drawNote(scene, tone, undefined, false)),
            ], { id: event.id })]
        }
    }
}

const drawBeam = (scene: LayerScene, events: readonly LayerEvent[], beam: BeamGroup): Drawing => {
    const members = events
        .map(event => ({ event, tones: tonesOf(scene, event) }))
        .filter(member => member.tones.length > 0)
    if (members.length < 2) return group(['beam'], members.flatMap(({ event }) => drawEvent(scene, event)))
    const { stems, outline } = beamStems(members, beam)
    return group(['beam', ...beam.beam.types], [
        { kind: 'polygon', points: outline },
        ...members.flatMap(({ event }, i) => drawEvent(scene, event, stems[i])),
    ], { id: beam.beam.id })
}

const eventId = (event: LayerEvent): ElementId | undefined => (event.kind === 'space' ? undefined : event.id)

const drawLayer = (scene: LayerScene, layer: Layer, beams: readonly BeamGroup[]): Group => {
    const beamOf = (event: LayerEvent) => {
        const id = eventId(event)
        return id && beams.find(beam => beam.beam.members.includes(id))
    }
    const runs = splitGreedily(layer.events, (event, run) => beamOf(event) !== beamOf(run[run.length - 1]))
    return group(['layer', ...(layer.voice ? [layer.voice] : [])], runs.flatMap(run => {
        const beam = beamOf(run[0])
        return beam ? [drawBeam(scene, run, beam)] : run.flatMap(event => drawEvent(scene, event))
    }))
}

// ---------------------------------------------------------------------------
// Ledger lines, staff lines, clef

/** The ledger lines a head needs: every line between it and the staff. */
const ledgerPositions = (position: StaffPosition): StaffPosition[] => {
    const below = Math.max(0, Math.floor(-position / 2))
    const above = Math.max(0, Math.floor((position - topLine) / 2))
    return [
        ...Array.from({ length: below }, (_, i) => -2 * (i + 1)),
        ...Array.from({ length: above }, (_, i) => topLine + 2 * (i + 1)),
    ]
}

const drawLedgerLines = (heads: readonly PlacedHead<NoteHead>[]): Drawing[] => {
    const dashes = heads.flatMap(placed => {
        const { scale } = placed.head
        const extension = engravingDefaults.legerLineExtension * scale
        return ledgerPositions(placed.head.position).map(position => ({
            side: position > topLine ? 'above' : 'below',
            drawing: line(
                { x: placed.x - extension, y: positionY(position) },
                { x: placed.x + headWidth(placed.head) + extension, y: positionY(position) },
                engravingDefaults.legerLineThickness * scale
            ),
        }))
    })
    const side = (name: 'above' | 'below'): Drawing[] => {
        const lines = dashes.filter(dash => dash.side === name).map(dash => dash.drawing)
        return lines.length > 0 ? [group(['ledgerLines', name], lines)] : []
    }
    return [...side('above'), ...side('below')]
}

const staffLines = (left: number, right: number): Drawing[] =>
    [0, 1, 2, 3, 4].map(y => line({ x: left, y }, { x: right, y }, engravingDefaults.staffLineThickness))

const noteBox = (drawing: Group): [ElementId, Box][] => {
    if (!drawing.classes.includes('note') || drawing.id === undefined) return []
    const box = boundsOf(drawing)
    return box ? [[drawing.id, box]] : []
}

const notesIn = (drawing: Drawing): [ElementId, Box][] =>
    drawing.kind === 'group' ? [...noteBox(drawing), ...drawing.children.flatMap(notesIn)] : []

export const engraveStaff = (scene: StaffScene): EngravedStaff => {
    const { analysis, measure, staff } = scene
    const score = analysis.score
    const content = score.measures[measure].staves.find(candidate => staffIndex(score, candidate.n) === staff)
    const placed = [...scene.placed.values()]
    const layerScene: LayerScene = {
        placed: scene.placed,
        accidentals: new Map(placeAccidentals(placed).map(accidental => [accidental.placed.head.id, accidental])),
        t: scene.t,
    }
    const beams = analysis.beams.filter(beam => beam.measure === measure && beam.staff === staff)
    const clef = score.staves[staff].clef
    const layers = (content?.layers ?? []).map(layer => drawLayer(layerScene, layer, beams))

    const drawing = group(['staff'], [
        ...staffLines(scene.left, scene.right),
        ...(scene.withClef
            ? [group(['clef'], [glyph(clefGlyphs[clef.shape], { x: clefX, y: positionY(clefPosition(clef)) })])]
            : []),
        ...drawLedgerLines(placed.filter(isPlacedNote)),
        ...layers,
    ], { data: { n: String(score.staves[staff].n) } })

    return { drawing, noteBoxes: new Map(layers.flatMap(notesIn)) }
}

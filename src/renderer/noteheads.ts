/**
 * The geometry of heads and of what hangs on them: offsets where heads share a
 * place, accidentals, dots, stems and flags. Spacing and drawing both use these
 * functions, so the room reserved for a place is the room its drawing takes.
 */
import { fixedPoint, groupBy, inclusiveScan, isDefined, mapWithPrevious } from './algorithms'
import type { Head, NoteHead } from './analysis'
import { Box, overlaps, Point, unionAll } from './geometry'
import { anchorOffset, glyphBox, GlyphName, glyphWidth } from './glyph'
import { engravingDefaults } from './leipzig'
import type { Accidental, ElementId, StemDirection } from './model'
import { isOnLine, middleLine, positionY } from './pitch'

/** A head at its horizontal place: `x` is the head's origin, its left edge. */
export interface PlacedHead<H extends Head = Head> {
    readonly head: H
    readonly x: number
}

export const isNoteHead = (head: Head): head is NoteHead => head.kind === 'note'

export const isPlacedNote = (placed: PlacedHead): placed is PlacedHead<NoteHead> => isNoteHead(placed.head)

export const headOrigin = ({ head, x }: PlacedHead): Point => ({ x, y: positionY(head.position) })

export const headBox = (placed: PlacedHead): Box => glyphBox(placed.head.glyph, headOrigin(placed), placed.head.scale)

export const headWidth = (head: Head): number => glyphWidth(head.glyph, head.scale)

// ---------------------------------------------------------------------------
// Heads sharing a place

/** Two voices share one notehead where they sound the same pitch with the same head, stems apart. */
const sharesHead = (a: NoteHead, b: NoteHead): boolean =>
    a.position === b.position && a.glyph === b.glyph && a.stem !== undefined && b.stem !== undefined && a.stem !== b.stem

/**
 * Whether `a` steps to the right of `b`, a head of another voice a second or a
 * unison away: the voice stemmed up moves, or the later voice where the stems agree.
 */
const stepsAside = (a: NoteHead, b: NoteHead): boolean => {
    if (a.layer === b.layer || Math.abs(a.position - b.position) > 1 || sharesHead(a, b)) return false
    return a.stem === b.stem ? a.layer.n > b.layer.n : a.stem === 'up'
}

/**
 * In a chord a tone a second from its neighbour goes to the other side of the
 * stem - rightwards from the bottom with the stem up, leftwards from the top
 * with the stem down - unless the neighbour has already gone.
 */
const chordOffsets = (tones: readonly NoteHead[]): [ElementId, number][] => {
    const up = tones[0].stem !== 'down'
    const ordered = [...tones].sort((a, b) => (up ? a.position - b.position : b.position - a.position))
    const isSecond = ordered.map((tone, i) => i > 0 && Math.abs(tone.position - ordered[i - 1].position) === 1)
    const displaced = inclusiveScan(isSecond, (neighbourDisplaced, second) => second && !neighbourDisplaced, false)
    return ordered
        .filter((_, i) => displaced[i])
        .map(tone => [tone.id, (up ? 1 : -1) * headWidth(tone)])
}

/** How far each of the heads sharing one place on a staff stands off that place. */
export const clusterOffsets = (heads: readonly Head[]): ReadonlyMap<ElementId, number> => {
    const notes = heads.filter(isNoteHead)
    const chords = groupBy(notes.filter(note => note.chord !== undefined), note => note.chord)
    const inChords = new Map([...chords.values()].flatMap(chordOffsets))
    return new Map(heads.map(head => {
        // clear of the head it steps aside from, which may be the wider
        const from = isNoteHead(head) ? notes.filter(other => stepsAside(head, other)) : []
        const aside = from.length > 0 ? Math.max(headWidth(head), ...from.map(headWidth)) : 0
        return [head.id, (inChords.get(head.id) ?? 0) + aside]
    }))
}

// ---------------------------------------------------------------------------
// Accidentals

export type AccidentalGlyph = Extract<GlyphName, `accidental${string}`>

const accidentalGlyphs: Readonly<Record<Accidental, AccidentalGlyph>> = {
    sharp: 'accidentalSharp',
    flat: 'accidentalFlat',
    natural: 'accidentalNatural',
}

/** The white space between an accidental and whatever it stands clear of. */
const accidentalGap = 0.12

export interface PlacedAccidental {
    readonly placed: PlacedHead<NoteHead>
    readonly glyph: AccidentalGlyph
    readonly origin: Point
}

const accidentalBox = ({ placed, glyph, origin }: PlacedAccidental): Box =>
    glyphBox(glyph, origin, placed.head.scale)

/** Heads near enough to each other to be read as one place. */
const atSamePlace = (a: PlacedHead, b: PlacedHead): boolean =>
    Math.abs(a.x - b.x) < 1.5 * Math.max(headWidth(a.head), headWidth(b.head))

/**
 * The accidentals of the heads on one staff, each as close to its head as it can
 * stand without touching a head of the same place or an accidental placed
 * before it - going from left to right and, within a place, from the top down.
 */
export const placeAccidentals = (heads: readonly PlacedHead[]): PlacedAccidental[] => {
    const candidates = heads
        .filter(isPlacedNote)
        .flatMap(placed => (placed.head.note.accidental ? [{ placed, glyph: accidentalGlyphs[placed.head.note.accidental] }] : []))
        .sort((a, b) => a.placed.x - b.placed.x || b.placed.head.position - a.placed.head.position)

    return mapWithPrevious(candidates, ({ placed, glyph }, previous): PlacedAccidental => {
        const { scale } = placed.head
        const y = positionY(placed.head.position)
        const width = glyphWidth(glyph, scale)
        const boxAt = (right: number) => glyphBox(glyph, { x: right - width, y }, scale)
        const obstacles = [
            ...heads.filter(other => other !== placed && atSamePlace(other, placed)).map(headBox),
            ...previous.filter(accidental => atSamePlace(accidental.placed, placed)).map(accidentalBox),
        ]
        const clear = (right: number) => {
            const hit = obstacles.find(obstacle => overlaps(boxAt(right), obstacle))
            return hit ? Math.min(right, hit.left - accidentalGap * scale) : right
        }
        const right = fixedPoint(placed.x - accidentalGap * scale, clear, obstacles.length + 1)
        return { placed, glyph, origin: { x: right - width, y } }
    })
}

// ---------------------------------------------------------------------------
// Dots

export const dotRadius = 0.2

/** Dots follow the head, in the space above where the head sits on a line. */
export const dotCenters = (placed: PlacedHead): Point[] => {
    const { head } = placed
    const y = positionY(isOnLine(head.position) ? head.position + 1 : head.position)
    const first = headBox(placed).right + 0.35 * head.scale
    return Array.from({ length: head.dots }, (_, i) => ({ x: first + i * 0.5 * head.scale, y }))
}

const dotBox = ({ x, y }: Point): Box =>
    ({ left: x - dotRadius, right: x + dotRadius, top: y - dotRadius, bottom: y + dotRadius })

// ---------------------------------------------------------------------------
// Stems and flags

/** The length of an ordinary stem, before any extension to the middle line. */
export const stemLength = 3.5

/** The x of a stem's centre line, and the y where it leaves the head. */
export const stemRoot = (placed: PlacedHead<NoteHead>, direction: StemDirection): Point => {
    const { glyph, scale } = placed.head
    const anchor = anchorOffset(glyph, direction === 'up' ? 'stemUpSE' : 'stemDownNW', scale)
    if (anchor === undefined) throw new Error(`${glyph} takes no stem`)
    const half = engravingDefaults.stemThickness / 2
    const origin = headOrigin(placed)
    return { x: origin.x + anchor.x + (direction === 'up' ? -half : half), y: origin.y + anchor.y }
}

/**
 * Where an unbeamed stem ends: an ordinary stem's length beyond the head
 * farthest from that end, and at least as far as the middle line for notes
 * that lie outside the staff - though grace notes keep their short stems.
 */
export const stemTip = (heads: readonly PlacedHead<NoteHead>[], direction: StemDirection): number => {
    const ys = heads.map(placed => positionY(placed.head.position))
    const { scale, note } = heads[0].head
    const middle = positionY(middleLine)
    if (direction === 'up') {
        const tip = Math.min(...ys) - stemLength * scale
        return note.grace ? tip : Math.min(tip, middle)
    }
    const tip = Math.max(...ys) + stemLength * scale
    return note.grace ? tip : Math.max(tip, middle)
}

export type FlagGlyph = Extract<GlyphName, `flag${string}`>

export interface PlacedFlag {
    readonly glyph: FlagGlyph
    readonly origin: Point
    readonly scale: number
}

/** A flag hangs from the stem's tip, its origin on the stem's left edge. */
export const flagAt = (stemX: number, tip: number, direction: StemDirection, scale: number): PlacedFlag => ({
    glyph: direction === 'up' ? 'flag8thUp' : 'flag8thDown',
    origin: { x: stemX - engravingDefaults.stemThickness / 2, y: tip },
    scale,
})

const flagBox = (placed: PlacedHead): Box | undefined => {
    if (!isPlacedNote(placed) || !placed.head.flagged || placed.head.stem === undefined) return undefined
    const direction = placed.head.stem
    const flag = flagAt(stemRoot(placed, direction).x, stemTip([placed], direction), direction, placed.head.scale)
    return glyphBox(flag.glyph, flag.origin, flag.scale)
}

// ---------------------------------------------------------------------------

export interface Extent {
    readonly left: number
    readonly right: number
}

/** The horizontal room heads take on one staff, with their accidentals, dots and flags. */
export const footprint = (heads: readonly PlacedHead[]): Extent | undefined => {
    const box = unionAll([
        ...heads.map(headBox),
        ...placeAccidentals(heads).map(accidentalBox),
        ...heads.flatMap(dotCenters).map(dotBox),
        ...heads.map(flagBox).filter(isDefined),
    ])
    return box && { left: box.left, right: box.right }
}

// ---------------------------------------------------------------------------
// Heads on their way between the layouts

/** The room two heads keep between them, beyond what they take up */
const partingGap = 0.15

/** How far a head reaches to the right of its place: its glyph, and its dots and flag. */
const reachRight = (placed: PlacedHead): number => {
    const { head, x } = placed
    const box = headBox(placed)
    const dots = isNoteHead(head) && head.dots > 0 ? Math.max(...dotCenters(placed).map(dot => dot.x)) + dotRadius : box.right
    const flag = isNoteHead(head) && head.flagged && head.stem === 'up' ? box.right + 0.9 * head.scale : box.right
    return Math.max(box.right, dots, flag) - x
}

/** How far a head reaches to the left of its place: its glyph, and the accidental placed for it, if given. */
const reachLeft = (placed: PlacedHead, accidental: Box | undefined): number =>
    placed.x - Math.min(headBox(placed).left, accidental?.left ?? Infinity)

interface Span {
    readonly top: number
    readonly bottom: number
}

/** The height a head takes up where it stands, and to its right: the head, and a stem rising from its right side. */
const heightOf = (placed: PlacedHead): Span => {
    const box = headBox(placed)
    const { head } = placed
    const stem = isNoteHead(head) && head.stem === 'up' ? positionY(head.position) - stemLength * head.scale : box.top
    return { top: Math.min(box.top, stem), bottom: box.bottom }
}

/** Whether two heights come close enough for what stands in them to touch. */
const meet = (a: Span, b: Span) => Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > -0.1

/**
 * Between the measured layout and the source's, the heads of a chord part one
 * after another, and on their way they would run into each other. Where a
 * head, or its accidental, would touch a head before it on the staff (or the
 * stem rising from it), it gives way to the right, `weight` of the way to
 * keeping clear (1: wholly). Heads at one place stay together, as one chord.
 */
export const keepApart = (placed: ReadonlyMap<ElementId, PlacedHead>, weight: number): Map<ElementId, PlacedHead> => {
    if (weight <= 0) return new Map(placed)
    const apart = new Map(placed)
    const notes = [...placed.values()].filter(isPlacedNote)
    for (const heads of groupBy(notes, ({ head }) => head.staff).values()) {
        // the heads at one place, from left to right
        const places = [...groupBy(heads, ({ x }) => Math.round(x * 1000)).values()].sort((a, b) => a[0].x - b[0].x)
        const moved: { readonly x: number, readonly by: number, readonly heads: readonly PlacedHead<NoteHead>[] }[] = []
        for (const group of places) {
            const x = group[0].x
            // The accidentals of the place as the staff will set them: several perhaps in
            // columns, and clear of those of heads just before, where these now stand.
            const before = moved
                .filter(earlier => x - (earlier.x + earlier.by) < 3)
                .flatMap(earlier => earlier.heads.map(head => ({ ...head, x: head.x + earlier.by })))
            const accidentals = new Map(placeAccidentals([...before, ...group])
                .filter(placed => group.includes(placed.placed as PlacedHead<NoteHead>))
                .map(placed => [placed.placed.head.id, accidentalBox(placed)]))
            let by = 0
            for (const before of moved) {
                const natural = x - before.x
                if (natural > 6) continue
                for (const a of before.heads) for (const b of group) {
                    const height = heightOf(a)
                    const accidental = accidentals.get(b.head.id)
                    const byAccidental = accidental !== undefined && meet(height, accidental)
                    if (!byAccidental && !meet(height, headBox(b))) continue
                    // from where the earlier head now stands, which may have given way itself
                    const reach = reachRight(a) + partingGap + reachLeft(b, byAccidental ? accidental : undefined)
                    const near = Math.min(natural, reach)
                    by = Math.max(by, before.x + before.by + near + (reach - near) * weight - x)
                }
            }
            moved.push({ x, by, heads: group })
            if (by > 0) group.forEach(head => apart.set(head.head.id, { ...head, x: head.x + by }))
        }
    }
    return apart
}

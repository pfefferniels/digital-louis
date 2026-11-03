/**
 * Clefs and key signatures: where their glyphs go at the start of a system,
 * and where a change of clef or key takes effect within one.
 */
import { cueScale, StaffMark } from './analysis'
import { unionAll, type Point } from './geometry'
import { glyphBox, GlyphName, glyphWidth } from './glyph'
import { Clef, KeyAccidental, KeySignature, pitchNames, PitchName } from './model'
import { clefGlyphs, clefPosition, positionY, staffPosition, StaffPosition } from './pitch'
import type { StaffState } from './staffStates'

export interface PlacedGlyph {
    readonly glyph: GlyphName
    readonly origin: Point
    readonly scale: number
}

const accidentalOrder: Readonly<Record<KeyAccidental, readonly PitchName[]>> = {
    sharp: ['f', 'c', 'g', 'd', 'a', 'e', 'b'],
    flat: ['b', 'e', 'a', 'd', 'g', 'c', 'f'],
}

/**
 * The octave of each accidental of a key signature, above or below the fourth,
 * as engraving practice places them in each clef (the table Verovio uses):
 * a row for each clef from the French violin clef (G1) to the sub-bass clef
 * (F5), a column for each pitch from c to b.
 */
const octaveOffsets: Readonly<Record<KeyAccidental, readonly (readonly number[])[]>> = {
    flat: [
        [1, 1, 1, 0, 0, 0, 0], [1, 1, 1, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, -1, -1], [0, 0, 0, -1, -1, -1, -1], [0, 0, 0, -1, -1, -1, -1],
        [-1, -1, -1, -1, -1, -1, -1], [-1, -1, -1, -2, -2, -2, -2], [-1, -1, -1, -1, -1, -2, -2],
    ],
    sharp: [
        [1, 1, 1, 1, 1, 0, 0], [1, 1, 1, 1, 1, 0, 0], [0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, -1, -1], [0, 0, 0, -1, -1, -1, -1],
        [-1, -1, -1, -1, -1, -1, -1], [-1, -1, -1, -1, -1, -2, -2], [-1, -1, -1, -1, -1, -2, -2],
    ],
}

/** The row of a clef in `octaveOffsets`; clefs that hardly exist go with their nearest neighbour. */
const clefRow = ({ shape, line }: Clef): number => {
    switch (shape) {
        case 'G': return line - 1
        case 'C': return line + 1
        case 'F': return line >= 3 ? line + 3 : 8
    }
}

export const keyPositions = (key: KeySignature, clef: Clef): StaffPosition[] =>
    accidentalOrder[key.accidental].slice(0, key.count).map(name => staffPosition(
        { name, octave: 4 + octaveOffsets[key.accidental][clefRow(clef)][pitchNames.indexOf(name)] },
        clef
    ))

const keyGlyph = (accidental: KeyAccidental): GlyphName => (accidental === 'sharp' ? 'accidentalSharp' : 'accidentalFlat')

/** The white space between the accidentals of a key signature, and between a clef and its key. */
const gaps = { accidentals: 0.12, clefToKey: 0.6 }

const keyGlyphs = (key: KeySignature, clef: Clef, left: number): PlacedGlyph[] => {
    const glyph = keyGlyph(key.accidental)
    const advance = glyphWidth(glyph) + gaps.accidentals
    return keyPositions(key, clef).map((position, i) => ({
        glyph, origin: { x: left + i * advance, y: positionY(position) }, scale: 1,
    }))
}

const clefGlyph = (clef: Clef, left: number, scale: number): PlacedGlyph =>
    ({ glyph: clefGlyphs[clef.shape], origin: { x: left, y: positionY(clefPosition(clef)) }, scale })

const right = (glyphs: readonly PlacedGlyph[], fallback: number): number =>
    unionAll(glyphs.map(({ glyph, origin, scale }) => glyphBox(glyph, origin, scale)))?.right ?? fallback

export interface Signature {
    readonly clef: readonly PlacedGlyph[]
    readonly key: readonly PlacedGlyph[]
}

/** A clef followed by a key signature, from `left`: what a staff shows as a system begins, or as it changes. */
const clefAndKey = (state: StaffState, left: number, clef: boolean, key: boolean, clefScale: number): Signature => {
    const clefs = clef ? [clefGlyph(state.clef, left, clefScale)] : []
    const keyLeft = clef ? right(clefs, left) + gaps.clefToKey : left
    return { clef: clefs, key: key ? keyGlyphs(state.key, state.clef, keyLeft) : [] }
}

/** Where the clef of a system stands. */
const clefX = 0.8

/** What a staff shows where a system begins. */
export const systemSignature = (state: StaffState): Signature =>
    clefAndKey(state, clefX, true, true, 1)

/** A change of clef or key within a system: the clef drawn small, the key as it is. */
export const markSignature = (mark: StaffMark, left: number): Signature =>
    clefAndKey(mark.state, left, mark.showsClef, mark.showsKey, cueScale)

export const signatureGlyphs = (signature: Signature): PlacedGlyph[] => [...signature.clef, ...signature.key]

/** Where the music begins on a system: after the widest of its staves' clefs and keys. */
export const contentStart = (states: readonly StaffState[]): number =>
    Math.max(...states.map(state => right(signatureGlyphs(systemSignature(state)), clefX))) + 0.6

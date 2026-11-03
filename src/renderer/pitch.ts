import type { GlyphName } from './glyph'
import { Clef, ClefShape, Pitch, pitchNames } from './model'

/**
 * Staff positions count diatonic steps upwards from the bottom line: 0 is the
 * bottom line, 1 the space above it, 8 the top line. Odd positions are spaces.
 */
export type StaffPosition = number

export const middleLine: StaffPosition = 4
export const topLine: StaffPosition = 8

const diatonicStep = (pitch: Pitch): number => pitch.octave * 7 + pitchNames.indexOf(pitch.name)

/** The pitch each clef names on its line. */
const clefPitch: Readonly<Record<ClefShape, Pitch>> = {
    C: { name: 'c', octave: 4 },
    F: { name: 'f', octave: 3 },
    G: { name: 'g', octave: 4 },
}

export const clefPosition = (clef: Clef): StaffPosition => 2 * (clef.line - 1)

export const clefGlyphs: Readonly<Record<ClefShape, Extract<GlyphName, `${string}Clef`>>> = {
    C: 'cClef',
    F: 'fClef',
    G: 'gClef',
}

export const staffPosition = (pitch: Pitch, clef: Clef): StaffPosition =>
    diatonicStep(pitch) - diatonicStep(clefPitch[clef.shape]) + clefPosition(clef)

/** The y of a staff position, in staff spaces below the top line. */
export const positionY = (position: StaffPosition): number => (topLine - position) / 2

export const isOnLine = (position: StaffPosition): boolean => position % 2 === 0

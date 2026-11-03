/**
 * The score as the renderer understands it: the subset of MEI that the
 * Digital Louis encodings use, and nothing else. Every value is immutable.
 */

declare const brand: unique symbol
type Brand<T, Name extends string> = T & { readonly [brand]: Name }

/** The @xml:id of an encoded element. */
export type ElementId = Brand<string, 'ElementId'>
export const elementId = (value: string): ElementId => value as ElementId

/** The @n of a staff. */
export type StaffNumber = Brand<number, 'StaffNumber'>
export const staffNumber = (value: number): StaffNumber => value as StaffNumber

export const pitchNames = ['c', 'd', 'e', 'f', 'g', 'a', 'b'] as const
export type PitchName = (typeof pitchNames)[number]

export interface Pitch {
    readonly name: PitchName
    readonly octave: number
}

export type Accidental = 'sharp' | 'flat' | 'natural'

export type NoteValue = 'breve' | 'whole' | 'half' | 'quarter' | 'eighth'

export type RestValue = Exclude<NoteValue, 'breve'>

export interface Duration<Value extends NoteValue = NoteValue> {
    readonly value: Value
    readonly dots: number
}

export type StemDirection = 'up' | 'down'

export type Place = 'above' | 'below'

export interface Note {
    readonly kind: 'note'
    readonly id: ElementId
    readonly pitch: Pitch
    readonly duration: Duration
    /** grace notes take no notated time; in this dialect they are the ornaments */
    readonly grace: boolean
    readonly cue: boolean
    /** the stem direction as encoded */
    readonly stem: StemDirection | undefined
    /** the accidental as written; accidentals that are only sounding are not drawn */
    readonly accidental: Accidental | undefined
    /** the tokens of @type, such as `ornam`, `entry` or `virtual` */
    readonly types: readonly string[]
    /** the notes read next in the source (@precedes) */
    readonly precedes: readonly ElementId[]
    /** the next note of the same voice (@next) */
    readonly next: ElementId | undefined
    /** the facsimile traces of the note (@corresp), passed through untouched */
    readonly corresp: string | undefined
}

export interface Chord {
    readonly kind: 'chord'
    readonly id: ElementId
    readonly duration: Duration
    readonly stem: StemDirection | undefined
    readonly types: readonly string[]
    readonly notes: readonly Note[]
}

export interface Rest {
    readonly kind: 'rest'
    readonly id: ElementId
    readonly duration: Duration<RestValue>
}

/** Notated time that nothing is drawn for. */
export interface Space {
    readonly kind: 'space'
    readonly duration: Duration
}

export type LayerEvent = Note | Chord | Rest | Space

export interface Beam {
    readonly id: ElementId | undefined
    readonly types: readonly string[]
    /** the notes and chords under the beam, in order */
    readonly members: readonly ElementId[]
}

export interface Layer {
    readonly n: number
    /** the voice of the layer (@type): cantus, altus, tenor, quintus, sextus or bassus */
    readonly voice: string | undefined
    readonly events: readonly LayerEvent[]
    readonly beams: readonly Beam[]
}

export interface Staff {
    readonly n: StaffNumber
    readonly layers: readonly Layer[]
}

/** A moment given as an MEI time stamp: a beat, counted from 1, some measures ahead. */
export interface Timestamp {
    readonly measuresAhead: number
    readonly beat: number
}

export interface Tie {
    readonly kind: 'tie'
    readonly id: ElementId | undefined
    readonly start: ElementId
    readonly end: ElementId
    readonly curve: Place | undefined
}

export type OrnamentSign = 'trill' | 'lowerMordent' | 'upperMordent'

export interface Ornament {
    readonly kind: 'ornament'
    readonly id: ElementId | undefined
    readonly sign: OrnamentSign
    readonly on: ElementId
}

export interface FiguredBass {
    readonly kind: 'figuredBass'
    readonly id: ElementId | undefined
    readonly staff: StaffNumber
    readonly at: Timestamp
    /** the figures from top to bottom */
    readonly figures: readonly string[]
}

export interface Direction {
    readonly kind: 'direction'
    readonly id: ElementId | undefined
    readonly staff: StaffNumber
    readonly at: Timestamp
    readonly text: string
    readonly types: readonly string[]
}

export interface Bracket {
    readonly kind: 'bracket'
    readonly id: ElementId | undefined
    readonly staff: StaffNumber
    readonly from: Timestamp
    readonly to: Timestamp
    readonly types: readonly string[]
}

export type ControlEvent = Tie | Ornament | FiguredBass | Direction | Bracket

export type Barline = 'single' | 'end'

export interface Measure {
    readonly id: ElementId | undefined
    readonly staves: readonly Staff[]
    readonly controls: readonly ControlEvent[]
    readonly rightBarline: Barline
    /** whether an encoded system break (<sb/>) comes right before the measure */
    readonly breakBefore: boolean
}

export type ClefShape = 'C' | 'F' | 'G'

export interface Clef {
    readonly shape: ClefShape
    /** the staff line the clef sits on, counted from the bottom */
    readonly line: number
}

export interface StaffDef {
    readonly n: StaffNumber
    readonly clef: Clef
}

export interface Meter {
    readonly count: number
    readonly unit: number
}

export interface Score {
    readonly title: string | undefined
    /** the staves from top to bottom */
    readonly staves: readonly StaffDef[]
    /** never drawn - préludes non mesurés have none - but it gives time stamps their meaning */
    readonly meter: Meter
    readonly measures: readonly Measure[]
}

export const notesOf = (event: LayerEvent): readonly Note[] => {
    switch (event.kind) {
        case 'note': return [event]
        case 'chord': return event.notes
        case 'rest':
        case 'space': return []
    }
}

export const layersOf = (measure: Measure): readonly Layer[] =>
    measure.staves.flatMap(staff => staff.layers)

export const allNotes = (score: Score): readonly Note[] =>
    score.measures.flatMap(layersOf).flatMap(layer => layer.events).flatMap(notesOf)

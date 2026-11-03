/**
 * Reads the Digital Louis MEI dialect into the score model. This is the only
 * module that touches the DOM. It is strict: whatever lies outside the dialect
 * is reported as UnsupportedMei rather than silently drawn wrong.
 */
import { isDefined, splitGreedily } from './algorithms'
import {
    Accidental, Barline, Beam, Bracket, Chord, Clef, ClefShape, ControlEvent, Direction, Duration, ElementId,
    elementId, FiguredBass, KeySignature, Layer, LayerEvent, Measure, Meter, noKeySignature, Note, NoteValue,
    Ornament, OrnamentSign, Pitch, PitchName, Place, Rest, RestValue, Score, Space, Staff, StaffChange, StaffDef,
    StaffNumber, staffNumber, StemDirection, Tie, Timestamp,
} from './model'

const MEI = 'http://www.music-encoding.org/ns/mei'
const XML = 'http://www.w3.org/XML/1998/namespace'

export class UnsupportedMei extends Error {
    constructor(element: Element, problem: string) {
        const id = element.getAttributeNS(XML, 'id')
        super(`<${element.localName}${id ? ` xml:id="${id}"` : ''}>: ${problem}`)
        this.name = 'UnsupportedMei'
    }
}

const fail = (element: Element, problem: string): never => {
    throw new UnsupportedMei(element, problem)
}

// ---------------------------------------------------------------------------
// Element and attribute access

const children = (element: Element): Element[] =>
    Array.from(element.children).filter(child => child.namespaceURI === MEI)

const childrenNamed = (element: Element, name: string): Element[] =>
    children(element).filter(child => child.localName === name)

const requiredChild = (element: Element, name: string): Element =>
    childrenNamed(element, name)[0] ?? fail(element, `<${name}> is missing`)

const expectChildren = (element: Element, allowed: readonly string[]): void => {
    const unexpected = children(element).find(child => !allowed.includes(child.localName))
    if (unexpected) fail(unexpected, `not expected inside <${element.localName}>`)
}

const optional = (element: Element, attribute: string): string | undefined =>
    element.getAttribute(attribute) ?? undefined

const required = (element: Element, attribute: string): string =>
    optional(element, attribute) ?? fail(element, `@${attribute} is missing`)

const number = (element: Element, attribute: string, value: string): number => {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : fail(element, `@${attribute}="${value}" is not a number`)
}

const requiredNumber = (element: Element, attribute: string): number =>
    number(element, attribute, required(element, attribute))

const optionalNumber = (element: Element, attribute: string): number | undefined => {
    const value = optional(element, attribute)
    return value === undefined ? undefined : number(element, attribute, value)
}

const oneOf = <T>(element: Element, attribute: string, values: Readonly<Partial<Record<string, T>>>): T | undefined => {
    const value = optional(element, attribute)
    return value === undefined ? undefined : values[value] ?? fail(element, `@${attribute}="${value}" is not supported`)
}

const requiredOneOf = <T>(element: Element, attribute: string, values: Readonly<Partial<Record<string, T>>>): T =>
    oneOf(element, attribute, values) ?? fail(element, `@${attribute} is missing`)

const tokens = (value: string | undefined): string[] =>
    value?.split(/\s+/).filter(token => token !== '') ?? []

const references = (value: string | undefined): ElementId[] =>
    tokens(value).map(token => elementId(token.replace(/^#/, '')))

const requiredReference = (element: Element, attribute: string): ElementId =>
    references(required(element, attribute))[0] ?? fail(element, `@${attribute} is empty`)

const optionalId = (element: Element): ElementId | undefined => {
    const id = element.getAttributeNS(XML, 'id')
    return id ? elementId(id) : undefined
}

const requiredId = (element: Element): ElementId =>
    optionalId(element) ?? fail(element, '@xml:id is missing')

const text = (element: Element): string =>
    (element.textContent ?? '').replace(/\s+/g, ' ').trim()

// ---------------------------------------------------------------------------
// Value tables

const pitchNames: Partial<Record<string, PitchName>> = { c: 'c', d: 'd', e: 'e', f: 'f', g: 'g', a: 'a', b: 'b' }

/** `brevis` is the mensural name some encodings use for the breve */
const noteValues: Partial<Record<string, NoteValue>> = {
    breve: 'breve', brevis: 'breve', 1: 'whole', 2: 'half', 4: 'quarter', 8: 'eighth',
}

const restValues: Partial<Record<string, RestValue>> = { 1: 'whole', 2: 'half', 4: 'quarter', 8: 'eighth' }

const accidentals: Partial<Record<string, Accidental>> = { s: 'sharp', f: 'flat', n: 'natural' }

const stemDirections: Partial<Record<string, StemDirection>> = { up: 'up', down: 'down' }

const places: Partial<Record<string, Place>> = { above: 'above', below: 'below' }

const clefShapes: Partial<Record<string, ClefShape>> = { C: 'C', F: 'F', G: 'G' }

const barlines: Partial<Record<string, Barline>> = { single: 'single', end: 'end' }

const mordentSigns: Partial<Record<string, OrnamentSign>> = { lower: 'lowerMordent', upper: 'upperMordent' }

// ---------------------------------------------------------------------------
// Clefs and key signatures

const readClef = (element: Element): Clef =>
    ({ shape: requiredOneOf(element, 'shape', clefShapes), line: requiredNumber(element, 'line') })

/** The clef a staff definition gives, as a <clef> or as attributes. */
const clefOf = (staffDef: Element): Clef | undefined => {
    const clef = childrenNamed(staffDef, 'clef')[0]
    if (clef) return readClef(clef)
    return staffDef.hasAttribute('clef.shape')
        ? { shape: requiredOneOf(staffDef, 'clef.shape', clefShapes), line: requiredNumber(staffDef, 'clef.line') }
        : undefined
}

const readKeySignature = (element: Element, sig: string): KeySignature => {
    if (sig === '0') return noKeySignature
    const match = /^([1-7])([sf])$/.exec(sig) ?? fail(element, `key signature "${sig}" is not supported`)
    return { accidental: match[2] === 's' ? 'sharp' : 'flat', count: Number(match[1]) }
}

/** The key signature a staff or score definition gives, as a <keySig> or as @key.sig. */
const keyOf = (definition: Element): KeySignature | undefined => {
    const keySig = childrenNamed(definition, 'keySig')[0]
    const sig = keySig ? optional(keySig, 'sig') : optional(definition, 'key.sig')
    return sig === undefined ? undefined : readKeySignature(keySig ?? definition, sig)
}

// ---------------------------------------------------------------------------
// Layer content

const readDuration = (element: Element): Duration | undefined => {
    const value = oneOf(element, 'dur', noteValues)
    return value && { value, dots: optionalNumber(element, 'dots') ?? 0 }
}

const requiredDuration = (element: Element): Duration =>
    readDuration(element) ?? fail(element, '@dur is missing')

/** The accidental as written - as an attribute, or as an <accid> that may be editorially supplied. */
const writtenAccidental = (note: Element): Accidental | undefined => {
    const accidElements = [
        ...childrenNamed(note, 'accid'),
        ...childrenNamed(note, 'supplied').flatMap(supplied => childrenNamed(supplied, 'accid')),
    ]
    return oneOf(note, 'accid', accidentals) ?? accidElements.map(accid => oneOf(accid, 'accid', accidentals)).find(isDefined)
}

interface NoteContext {
    readonly grace: boolean
    readonly duration?: Duration
}

const readNote = (element: Element, context: NoteContext): Note => {
    expectChildren(element, ['accid', 'supplied'])
    const pitch: Pitch = {
        name: requiredOneOf(element, 'pname', pitchNames),
        octave: requiredNumber(element, 'oct'),
    }
    return {
        kind: 'note',
        id: requiredId(element),
        pitch,
        duration: readDuration(element) ?? context.duration ?? fail(element, '@dur is missing'),
        grace: context.grace || element.hasAttribute('grace'),
        cue: optional(element, 'cue') === 'true',
        stem: oneOf(element, 'stem.dir', stemDirections),
        accidental: writtenAccidental(element),
        types: tokens(optional(element, 'type')),
        precedes: references(optional(element, 'precedes')),
        next: references(optional(element, 'next'))[0],
        corresp: optional(element, 'corresp'),
    }
}

const readChord = (element: Element, grace: boolean): Chord => {
    expectChildren(element, ['note'])
    const duration = requiredDuration(element)
    return {
        kind: 'chord',
        id: requiredId(element),
        duration,
        stem: oneOf(element, 'stem.dir', stemDirections),
        types: tokens(optional(element, 'type')),
        notes: children(element).map(note => readNote(note, { grace: grace || element.hasAttribute('grace'), duration })),
    }
}

const readRest = (element: Element): Rest => ({
    kind: 'rest',
    id: requiredId(element),
    duration: { value: requiredOneOf(element, 'dur', restValues), dots: optionalNumber(element, 'dots') ?? 0 },
})

const readSpace = (element: Element): Space =>
    ({ kind: 'space', duration: requiredDuration(element) })

interface LayerContent {
    readonly events: readonly LayerEvent[]
    readonly beams: readonly Beam[]
}

const single = (event: LayerEvent): LayerContent => ({ events: [event], beams: [] })

const concatenate = (parts: readonly LayerContent[]): LayerContent => ({
    events: parts.flatMap(part => part.events),
    beams: parts.flatMap(part => part.beams),
})

const readBeam = (element: Element, grace: boolean): LayerContent => {
    const content = concatenate(children(element).map(child => readLayerContent(child, grace)))
    const beam: Beam = {
        id: optionalId(element),
        types: tokens(optional(element, 'type')),
        members: content.events.flatMap(event => (event.kind === 'note' || event.kind === 'chord' ? [event.id] : [])),
    }
    return { events: content.events, beams: [...content.beams, beam] }
}

const readLayerContent = (element: Element, grace: boolean): LayerContent => {
    switch (element.localName) {
        case 'note': return single(readNote(element, { grace }))
        case 'chord': return single(readChord(element, grace))
        case 'rest': return single(readRest(element))
        case 'space': return single(readSpace(element))
        case 'beam': return readBeam(element, grace)
        case 'graceGrp': return concatenate(children(element).map(child => readLayerContent(child, true)))
        case 'clef': return single({ kind: 'clef', id: optionalId(element), clef: readClef(element) })
        default: return fail(element, 'not part of the dialect')
    }
}

const readLayer = (element: Element): Layer => {
    const content = concatenate(children(element).map(child => readLayerContent(child, false)))
    return {
        n: requiredNumber(element, 'n'),
        voice: optional(element, 'type'),
        events: content.events,
        beams: content.beams,
    }
}

const readStaff = (element: Element): Staff => {
    expectChildren(element, ['layer'])
    return { n: staffNumber(requiredNumber(element, 'n')), layers: children(element).map(readLayer) }
}

// ---------------------------------------------------------------------------
// Control events

const readTimestamp = (element: Element, attribute: string): Timestamp => {
    const value = required(element, attribute)
    const match = /^(?:(\d+)m\+)?(\d+(?:\.\d+)?)$/.exec(value) ?? fail(element, `@${attribute}="${value}" is not a time stamp`)
    return { measuresAhead: Number(match[1] ?? 0), beat: Number(match[2]) }
}

const readTie = (element: Element): Tie => ({
    kind: 'tie',
    id: optionalId(element),
    start: requiredReference(element, 'startid'),
    end: requiredReference(element, 'endid'),
    curve: oneOf(element, 'curvedir', places),
})

const readOrnament = (element: Element, sign: OrnamentSign): Ornament =>
    ({ kind: 'ornament', id: optionalId(element), sign, on: requiredReference(element, 'startid') })

const readFiguredBass = (element: Element): FiguredBass => {
    expectChildren(element, ['fb'])
    const fb = requiredChild(element, 'fb')
    expectChildren(fb, ['f'])
    return {
        kind: 'figuredBass',
        id: optionalId(element),
        staff: staffNumber(requiredNumber(element, 'staff')),
        at: readTimestamp(element, 'tstamp'),
        figures: childrenNamed(fb, 'f').map(text),
    }
}

const readDirection = (element: Element): Direction => ({
    kind: 'direction',
    id: optionalId(element),
    staff: staffNumber(requiredNumber(element, 'staff')),
    at: readTimestamp(element, 'tstamp'),
    text: text(element),
    types: tokens(optional(element, 'type')),
})

const readBracket = (element: Element): Bracket => ({
    kind: 'bracket',
    id: optionalId(element),
    staff: staffNumber(requiredNumber(element, 'staff')),
    from: readTimestamp(element, 'tstamp'),
    to: readTimestamp(element, 'tstamp2'),
    types: tokens(optional(element, 'type')),
})

/** Editorial annotations are part of the edition, not of the notation. */
const ignoredInMeasure = ['annot']

const readControl = (element: Element): ControlEvent[] => {
    switch (element.localName) {
        case 'tie': return [readTie(element)]
        case 'trill': return [readOrnament(element, 'trill')]
        case 'mordent': return [readOrnament(element, oneOf(element, 'form', mordentSigns) ?? 'lowerMordent')]
        case 'harm': return [readFiguredBass(element)]
        case 'dir': return [readDirection(element)]
        case 'bracketSpan': return [readBracket(element)]
        default: return ignoredInMeasure.includes(element.localName) ? [] : fail(element, 'not part of the dialect')
    }
}

const readMeasure = (element: Element, breakBefore: boolean, changes: readonly StaffChange[]): Measure => ({
    id: optionalId(element),
    staves: childrenNamed(element, 'staff').map(readStaff),
    controls: children(element).filter(child => child.localName !== 'staff').flatMap(readControl),
    rightBarline: oneOf(element, 'right', barlines) ?? 'single',
    breakBefore,
    changes,
})

const readStaffChange = (staffDef: Element): StaffChange =>
    ({ staff: staffNumber(requiredNumber(staffDef, 'n')), clef: clefOf(staffDef), key: keyOf(staffDef) })

/** What a score or staff definition between measures changes; a key of the score changes every staff. */
const readChanges = (element: Element, staves: readonly StaffNumber[]): StaffChange[] => {
    switch (element.localName) {
        case 'staffDef': return [readStaffChange(element)]
        case 'scoreDef': {
            const key = keyOf(element)
            return [
                ...(key ? staves.map(staff => ({ staff, clef: undefined, key })) : []),
                ...Array.from(element.getElementsByTagNameNS(MEI, 'staffDef')).map(readStaffChange),
            ]
        }
        case 'sb': return []
        default: return fail(element, 'not part of the dialect')
    }
}

/** Each measure, with the system break and the changes of definition that come before it. */
const readSection = (section: Element, staves: readonly StaffNumber[]): Measure[] =>
    splitGreedily(children(section), (_, run) => run[run.length - 1].localName === 'measure')
        .flatMap(run => {
            const [last, before] = [run[run.length - 1], run.slice(0, -1)]
            if (last.localName !== 'measure') return before.length > 0 ? fail(last, 'nothing follows it') : []
            return [readMeasure(
                last,
                before.some(element => element.localName === 'sb'),
                before.flatMap(element => readChanges(element, staves))
            )]
        })

// ---------------------------------------------------------------------------
// Score definition

const readStaffDef = (element: Element, scoreDef: Element): StaffDef => ({
    n: staffNumber(requiredNumber(element, 'n')),
    clef: clefOf(element) ?? fail(element, 'the staff has no clef'),
    key: keyOf(element) ?? keyOf(scoreDef) ?? noKeySignature,
})

const readMeter = (scoreDef: Element, staffDefs: readonly Element[]): Meter => {
    const meterSig = staffDefs.flatMap(staffDef => childrenNamed(staffDef, 'meterSig'))[0]
    return meterSig
        ? { count: requiredNumber(meterSig, 'count'), unit: requiredNumber(meterSig, 'unit') }
        : { count: requiredNumber(scoreDef, 'meter.count'), unit: requiredNumber(scoreDef, 'meter.unit') }
}

const readTitle = (mei: Element, scoreDef: Element): string | undefined => {
    const pageHead = childrenNamed(scoreDef, 'pgHead')[0]
    const title = mei.getElementsByTagNameNS(MEI, 'titleStmt')[0]?.getElementsByTagNameNS(MEI, 'title')[0]
    return [pageHead, title].filter(isDefined).map(text).find(value => value !== '')
}

export const readScore = (document: Document): Score => {
    const mei = document.documentElement
    if (mei.namespaceURI !== MEI || mei.localName !== 'mei') fail(mei, 'not an MEI document')

    const score = requiredChild(requiredChild(requiredChild(requiredChild(mei, 'music'), 'body'), 'mdiv'), 'score')
    expectChildren(score, ['scoreDef', 'section'])
    const scoreDef = requiredChild(score, 'scoreDef')
    const staffDefs = Array.from(scoreDef.getElementsByTagNameNS(MEI, 'staffDef'))
    const staves = staffDefs.map(staffDef => readStaffDef(staffDef, scoreDef))

    return {
        title: readTitle(mei, scoreDef),
        staves,
        meter: readMeter(scoreDef, staffDefs),
        measures: childrenNamed(score, 'section').flatMap(section => readSection(section, staves.map(staff => staff.n))),
    }
}

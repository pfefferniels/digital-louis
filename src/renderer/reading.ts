import { isDefined, unfold } from './algorithms'
import type { ElementId, Note } from './model'

/**
 * The order in which the source is read, as the step at which the eye meets each
 * note. It starts from the note typed `entry` and follows @precedes; notes that
 * several notes precede are met once, and the notes of one step are met together.
 */
export type ReadingOrder = ReadonlyMap<ElementId, number>

interface Walk {
    readonly step: readonly Note[]
    readonly visited: ReadonlySet<ElementId>
}

export const readingOrder = (notes: readonly Note[]): ReadingOrder => {
    const byId = new Map(notes.map(note => [note.id, note]))
    const entry = notes.find(note => note.types.includes('entry'))
    if (!entry) return new Map()

    const steps = unfold<Walk, readonly Note[]>({ step: [entry], visited: new Set([entry.id]) }, ({ step, visited }) => {
        if (step.length === 0) return undefined
        const following = [...new Set(step.flatMap(note => note.precedes))]
            .filter(id => !visited.has(id))
            .map(id => byId.get(id))
            .filter(isDefined)
        return [step, { step: following, visited: new Set([...visited, ...following.map(note => note.id)]) }]
    })

    return new Map(steps.flatMap((step, index) => step.map(note => [note.id, index] as const)))
}

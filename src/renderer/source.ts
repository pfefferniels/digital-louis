/**
 * The page as a source lays it out. Where the source writes the heads of the
 * notes - which the encoding links to its facsimile - tells where its lines
 * begin and end, and at what height each staff stands. The page takes the
 * source's margins, and as the reading becomes the source's, its staves move
 * towards the heights at which the source writes their notes: so that, in the
 * end, the notes have but a short way into the source.
 */
import { isDefined } from './algorithms'
import type { Point } from './geometry'
import type { ElementId } from './model'

/** Where the source writes the head of each note, by the note's id, in staff spaces on the page. */
export type SourceHeads = ReadonlyMap<ElementId, Point>

const sorted = (values: readonly number[]) => [...values].sort((a, b) => a - b)

const quantile = (values: readonly number[], q: number): number => {
    const s = sorted(values)
    return s[Math.round(q * (s.length - 1))]
}

export const median = (values: readonly number[]): number => quantile(values, 0.5)

/** Too few notes linked to tell anything of the layout of the source */
const enough = 8

export interface Margins {
    readonly left: number
    readonly right: number
}

/**
 * The margins of the source on a page `width` staff spaces wide: its first
 * notes begin where the music of a system begins (`start`, after the clefs),
 * its last ones end a little before the end of the system. The extremes of
 * the source, a note or two beyond the rest, are left aside.
 */
export const sourceMargins = (heads: readonly ElementId[], source: SourceHeads, width: number, start: number): Margins => {
    const xs = heads.map(id => source.get(id)?.x).filter(isDefined)
    if (xs.length < enough) return { left: 0, right: 0 }
    const most = width / 3
    return {
        left: Math.min(most, Math.max(0, quantile(xs, 0.02) - start)),
        right: Math.min(most, Math.max(0, width - quantile(xs, 0.98) - 1.5)),
    }
}

/**
 * Where the source would have the top line of a staff stand: for each of its
 * notes the source writes, the height of the head in the source less its
 * height on the staff (`heads`, by id, from the top line down), the middle
 * of those. Undefined where the source writes too few of them.
 */
export const sourceStaffTop = (heads: ReadonlyMap<ElementId, number>, source: SourceHeads): number | undefined => {
    const tops = [...heads].map(([id, y]) => {
        const written = source.get(id)
        return written && written.y - y
    }).filter(isDefined)
    return tops.length < 2 ? undefined : median(tops)
}

/** How far, in staff spaces, the notes a source writes on a staff lie above or below the middle of them */
const staffReach = 10

/**
 * Where on a system, which begins at `left` on the page, the source writes
 * the notes `heads` (by staff) - if it writes nearly all of them on one line,
 * each staff's notes about one height - from the first to the last, with a
 * little room.
 */
export const sourceSpan = (heads: readonly { readonly id: ElementId, readonly staff: number }[], source: SourceHeads, left: number) => {
    const written = heads.map(({ id, staff }) => ({ staff, at: source.get(id) })).filter(head => head.at !== undefined) as { staff: number, at: Point }[]
    if (written.length < 3) return
    const middles = new Map([...new Set(written.map(head => head.staff))]
        .map(staff => [staff, median(written.filter(head => head.staff === staff).map(head => head.at.y))]))
    const line = written.filter(head => Math.abs(head.at.y - (middles.get(head.staff) as number)) <= staffReach)
    if (line.length < 0.85 * written.length) return
    const xs = line.map(head => head.at.x - left)
    return { start: Math.min(...xs) - 1, end: Math.max(...xs) + 1 }
}

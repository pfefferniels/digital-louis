/**
 * The sequence algorithms the renderer is built from. Loops live here and
 * nowhere else; every algorithm is linear unless its name says otherwise.
 */

export const sum = (values: readonly number[]): number =>
    values.reduce((total, value) => total + value, 0)

export const mean = (values: readonly number[]): number =>
    sum(values) / values.length

export const lerp = (from: number, to: number, t: number): number =>
    from + (to - from) * t

export const clamp = (value: number, low: number, high: number): number =>
    Math.min(high, Math.max(low, value))

export const isDefined = <T>(value: T | undefined): value is T => value !== undefined

/** The state accumulated before each element: the result has the length of `values`. */
export const exclusiveScan = <T, A>(values: readonly T[], step: (state: A, value: T) => A, initial: A): A[] => {
    const states: A[] = []
    let state = initial
    for (const value of values) {
        states.push(state)
        state = step(state, value)
    }
    return states
}

/** The state accumulated after each element. */
export const inclusiveScan = <T, A>(values: readonly T[], step: (state: A, value: T) => A, initial: A): A[] => {
    const states: A[] = []
    let state = initial
    for (const value of values) {
        state = step(state, value)
        states.push(state)
    }
    return states
}

/** [a, b, c] -> [[a, b], [b, c]] */
export const adjacentPairs = <T>(values: readonly T[]): [T, T][] =>
    values.slice(1).map((value, i) => [values[i], value])

/** Groups in order of first appearance, each keeping the order of `values`. */
export const groupBy = <T, K>(values: readonly T[], key: (value: T) => K): Map<K, T[]> => {
    const groups = new Map<K, T[]>()
    for (const value of values) {
        const k = key(value)
        const group = groups.get(k)
        if (group) group.push(value)
        else groups.set(k, [value])
    }
    return groups
}

/** Repeatedly applies `next` to the state, collecting what it yields, until it yields nothing. */
export const unfold = <S, T>(seed: S, next: (state: S) => readonly [T, S] | undefined): T[] => {
    const results: T[] = []
    for (let step = next(seed); step !== undefined; step = next(step[1])) results.push(step[0])
    return results
}

/** The first index of `values`, partitioned by `predicate`, at which the predicate is false. Logarithmic. */
export const partitionPoint = <T>(values: readonly T[], predicate: (value: T) => boolean): number => {
    let low = 0
    let high = values.length
    while (low < high) {
        const middle = (low + high) >>> 1
        if (predicate(values[middle])) low = middle + 1
        else high = middle
    }
    return low
}

/** Applies `step` until it no longer changes the value, at most `limit` times. */
export const fixedPoint = <T>(initial: T, step: (value: T) => T, limit: number): T => {
    let value = initial
    for (let i = 0; i < limit; ++i) {
        const next = step(value)
        if (next === value) return value
        value = next
    }
    return value
}

/** Maps each value while seeing the results for the values before it: for placements that avoid earlier ones. */
export const mapWithPrevious = <T, R>(values: readonly T[], f: (value: T, previous: readonly R[]) => R): R[] => {
    const results: R[] = []
    for (const value of values) results.push(f(value, results))
    return results
}

/**
 * Splits `values` into consecutive groups, starting a new group wherever
 * `startsGroup` says so for the next value and the group collected so far.
 */
export const splitGreedily = <T>(values: readonly T[], startsGroup: (value: T, group: readonly T[]) => boolean): T[][] => {
    const groups: T[][] = []
    for (const value of values) {
        const current = groups[groups.length - 1]
        if (current === undefined || startsGroup(value, current)) groups.push([value])
        else current.push(value)
    }
    return groups
}

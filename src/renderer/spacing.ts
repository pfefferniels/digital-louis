import { inclusiveScan, partitionPoint, sum } from './algorithms'

/**
 * The gap between two neighbouring places on a line: at least `minimum`, so that
 * nothing collides, and otherwise in proportion to `weight` - the notated time
 * between them in the measured layout, one reading step in the unmeasured one.
 */
export interface Gap {
    readonly minimum: number
    readonly weight: number
}

const widthAt = (gap: Gap, stretch: number): number => Math.max(gap.minimum, stretch * gap.weight)

/**
 * The stretch at which the gaps fill `width` exactly. The total grows linearly
 * between the stretches at which one more gap leaves its minimum, so it is
 * found exactly in the interval holding `width`. When even the minima overflow
 * the line, they are kept as they are.
 */
const stretchFor = (gaps: readonly Gap[], width: number): number => {
    const total = (stretch: number) => widthAtStretch(gaps, stretch)
    const weighted = gaps.filter(gap => gap.weight > 0)
    if (weighted.length === 0 || total(0) >= width) return 0

    const thresholdOf = (gap: Gap) => gap.minimum / gap.weight
    const thresholds = weighted.map(thresholdOf).sort((a, b) => a - b)
    const below = thresholds[partitionPoint(thresholds, threshold => total(threshold) < width) - 1] ?? 0
    const stretched = weighted.filter(gap => thresholdOf(gap) <= below)
    const atMinimum = gaps.filter(gap => !stretched.includes(gap))
    return (width - sum(atMinimum.map(gap => gap.minimum))) / sum(stretched.map(gap => gap.weight))
}

/**
 * The positions the gaps lead to from `start`, filling `width`. A line that
 * cannot hold even the minima is compressed evenly rather than run long.
 */
export const spread = (gaps: readonly Gap[], start: number, width: number): number[] => {
    const minimum = minimumWidth(gaps)
    const stretch = stretchFor(gaps, width)
    const compression = minimum > width ? width / minimum : 1
    return inclusiveScan(gaps, (x, gap) => x + widthAt(gap, stretch) * compression, start)
}

export const minimumWidth = (gaps: readonly Gap[]): number => sum(gaps.map(gap => gap.minimum))

/** The width the gaps take at a given stretch. */
export const widthAtStretch = (gaps: readonly Gap[], stretch: number): number =>
    sum(gaps.map(gap => widthAt(gap, stretch)))

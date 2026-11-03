/**
 * Calligraphic rendering of a tenue centre line.
 *
 * The ink width of the Bauyn tenues follows a broad-edged pen: measured
 * along the traced tenues, strokes moving in the direction of the nib edge
 * (≈ 42°, i.e. the typical rising tenue) are hairlines, strokes moving
 * across it (horizontal or falling) are about 2.5× thicker. In addition,
 * the pen swells in quickly and is lifted towards the end, so tenues end
 * in a hairline.
 */
import { Cubic, Pt, bezierPoint, bezierTangent } from './geometry'

export interface PenModel {
    /** angle of the nib edge in degrees (y up) */
    nibAngle: number
    /** width of a stroke moving parallel to the nib edge (staff spaces) */
    hairline: number
    /** width of a stroke moving perpendicular to the nib edge */
    full: number
    /** fraction of the stroke over which the pen swells in */
    entry: number
    /** fraction of the stroke over which the pen is lifted */
    exit: number
    /** relative width that remains at the very end */
    exitWidth: number
}

const smoothstep = (x: number) => {
    const t = Math.max(0, Math.min(1, x))
    return t * t * (3 - 2 * t)
}

/** Width of the stroke at parameter t, moving in direction `angle` (rad). */
export const penWidth = (pen: PenModel, t: number, angle: number) => {
    const nib = pen.nibAngle * Math.PI / 180
    const across = 1 - Math.abs(Math.cos(angle - nib))
    let w = pen.hairline + (pen.full - pen.hairline) * across
    const swell = 0.45 + 0.55 * smoothstep(t / pen.entry)
    const lift = 1 - (1 - pen.exitWidth) * smoothstep((t - (1 - pen.exit)) / pen.exit)
    w *= swell * lift
    return Math.max(w, pen.hairline * 0.6)
}

/**
 * Returns the closed outline of the calligraphic stroke as a polygon
 * (left side forwards, right side backwards).
 */
export const penOutline = (curve: Cubic, pen: PenModel, samples = 48): Pt[] => {
    const left: Pt[] = []
    const right: Pt[] = []
    for (let i = 0; i < samples; i++) {
        const t = i / (samples - 1)
        const p = bezierPoint(curve, t)
        let d = bezierTangent(curve, t)
        if (Math.hypot(d.x, d.y) < 1e-9) d = bezierTangent(curve, Math.min(1, Math.max(0, t + (t < 0.5 ? 0.01 : -0.01))))
        const len = Math.hypot(d.x, d.y) || 1
        const nx = -d.y / len, ny = d.x / len
        const half = penWidth(pen, t, Math.atan2(d.y, d.x)) / 2
        left.push({ x: p.x + nx * half, y: p.y + ny * half })
        right.push({ x: p.x - nx * half, y: p.y - ny * half })
    }
    return [...left, ...right.reverse()]
}

/**
 * Converts a polygon given in staff spaces (y up) to an SVG path string
 * in SVG user units (y down).
 */
export const polygonToSvgPath = (poly: Pt[], unit: number) => {
    const f = (v: number) => (Math.round(v * 10) / 10).toString()
    return poly.map((p, i) => `${i === 0 ? 'M' : 'L'}${f(p.x * unit)} ${f(-p.y * unit)}`).join(' ') + ' Z'
}

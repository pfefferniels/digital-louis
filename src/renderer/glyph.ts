import type { Box, Point } from './geometry'
import { leipzig } from './leipzig'

/** A point in the font's own orientation: staff spaces, y up. */
export interface FontPoint {
    readonly x: number
    readonly y: number
}

export type AnchorName = 'stemUpSE' | 'stemDownNW' | 'cutOutNE' | 'cutOutNW' | 'cutOutSE' | 'cutOutSW'

export interface GlyphData {
    readonly codepoint: string
    /** in staff spaces, y up, relative to the glyph's origin */
    readonly bbox: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
    readonly anchors: Readonly<Partial<Record<AnchorName, FontPoint>>>
    /** SVG path data in font units, y up */
    readonly outline: string
}

export type GlyphName = keyof typeof leipzig

export const glyphData = (name: GlyphName): GlyphData => leipzig[name]

/** The box a glyph covers with its origin at `origin`, drawn at `scale`. */
export const glyphBox = (name: GlyphName, origin: Point, scale = 1): Box => {
    const { bbox } = glyphData(name)
    return {
        left: origin.x + bbox.x * scale,
        right: origin.x + (bbox.x + bbox.width) * scale,
        top: origin.y - (bbox.y + bbox.height) * scale,
        bottom: origin.y - bbox.y * scale,
    }
}

export const glyphWidth = (name: GlyphName, scale = 1): number => glyphData(name).bbox.width * scale

/** Where an anchor of the glyph lies relative to its origin, in layout orientation. */
export const anchorOffset = (name: GlyphName, anchor: AnchorName, scale = 1): Point | undefined => {
    const point = glyphData(name).anchors[anchor]
    return point && { x: point.x * scale, y: -point.y * scale }
}

/**
 * Evaluates the tenue engine against the traced Bauyn tenues: every tenue
 * is regenerated from the note positions alone (plus the x position where
 * it ends, i.e. the note's offset) and compared with the original trace.
 *
 *   npx esbuild tools/tenue-model/evaluate.ts --bundle --platform=node \
 *       --format=esm --outfile=tools/tenue-model/out/evaluate.mjs
 *   node tools/tenue-model/out/evaluate.mjs [corpus.json] [model.json] [piece ...]
 *
 * The error of a tenue is the mean distance (in staff spaces) between the
 * generated and the original curve, both resampled at 30 points equally
 * spaced along the curve.
 */
import { readFileSync } from 'fs'
import { BauynModel, LayoutWeights, Obstacle, TenueRequest, Voice, layoutTenues } from '../../src/utils/tenues/layout'
import { Cubic, Pt, dist, resampleByArcLength, sampleCubic } from '../../src/utils/tenues/geometry'
import defaultModel from '../../src/utils/tenues/bauynModel.json'

interface CorpusPiece {
    heads: { id: string, box: { x0: number, y0: number, x1: number, y1: number } }[]
    tenues: { id: string, head: string, voice?: Voice, linked: boolean, staffTop: number, staffBottom: number, pts: Pt[] }[]
}

const [corpusPath = 'tools/tenue-model/out/corpus.json', modelPath, ...onlyPieces] = process.argv.slice(2)
const corpus: Record<string, CorpusPiece> = JSON.parse(readFileSync(corpusPath, 'utf8'))
const model: BauynModel = modelPath ? JSON.parse(readFileSync(modelPath, 'utf8')) : defaultModel
const pieces = onlyPieces.length ? onlyPieces : Object.keys(corpus)

const curveError = (a: Pt[], b: Pt[]) => {
    const A = resampleByArcLength(a, 30), B = resampleByArcLength(b, 30)
    return A.reduce((s, p, i) => s + dist(p, B[i]), 0) / 30
}

type Generator = (requests: TenueRequest[], obstacles: Obstacle[]) => { id: string, curve: Cubic }[]

/** baseline: a straight stroke with the learned start point and rise */
const straight: Generator = requests => requests.map(r => {
    const cy = (r.head.y0 + r.head.y1) / 2
    const p0 = { x: r.head.x1 + model.start.gap, y: cy + model.start.dy }
    const rise = model.rise.coef[0] + model.rise.coef[1] * Math.min(r.endX - p0.x, model.rise.maxRun)
    const p3 = { x: r.endX, y: p0.y + rise }
    return { id: r.id, curve: [p0, p0, p3, p3] }
})

const engine = (weights: Partial<LayoutWeights> = {}): Generator =>
    (requests, obstacles) => layoutTenues({ requests, obstacles }, { model, weights })

const run = (label: string, generate: Generator) => {
    const errors: number[] = []
    const t0 = performance.now()
    for (const piece of pieces) {
        const P = corpus[piece]
        const heads = new Map(P.heads.map(h => [h.id, h.box]))
        const obstacles: Obstacle[] = P.heads.map(h => ({ kind: 'head', box: h.box, owner: h.id }))
        const originals = new Map<string, Pt[]>()
        const requests: TenueRequest[] = P.tenues.map(t => {
            originals.set(t.id, t.pts)
            return {
                id: t.id,
                voice: t.voice,
                head: heads.get(t.head)!,
                endX: t.pts[t.pts.length - 1].x,
                staffTop: t.staffTop,
                staffBottom: t.staffBottom,
                ceiling: t.staffTop + 5,
                floor: t.staffBottom - 5
            }
        })
        for (const { id, curve } of generate(requests, obstacles)) {
            errors.push(curveError(sampleCubic(curve, 60), originals.get(id)!))
        }
    }
    errors.sort((a, b) => a - b)
    const mean = errors.reduce((a, b) => a + b, 0) / errors.length
    const q = (p: number) => errors[Math.floor(errors.length * p)]
    console.log(`${label.padEnd(34)} n=${errors.length}  mean ${mean.toFixed(3)}  median ${q(0.5).toFixed(3)}  p90 ${q(0.9).toFixed(3)}  (${(performance.now() - t0).toFixed(0)} ms)`)
}

console.log(`model: ${model.source}\npieces: ${pieces.join(', ')}  (errors in staff spaces)`)
run('straight stroke (learned start/rise)', straight)
run('learned prior only', engine({
    collision: 0, crossing: 0, proximity: 0, parallel: 0, order: 0, split: 0, band: 0, endHeight: 0
}))
run('full engine', engine())

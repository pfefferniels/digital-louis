/**
 * Bridge between the rendered score and the tenue engine: collects notes,
 * offsets and obstacles from the rendered score, runs the layout and
 * inserts the calligraphic tenues.
 */
import { Box } from './geometry'
import { Obstacle, ObstacleKind, PlacedTenue, TenueRequest, layoutTenues } from './layout'
import { penOutline, polygonToSvgPath } from './pen'
import model from './bauynModel.json'

const SVG_NS = 'http://www.w3.org/2000/svg'

/** horizontal distance between the end of a tenue and the releasing note */
const END_GAP = 0.3
/** a tenue is at least this long (measured from the notehead's right edge) */
const MIN_REACH = 2.2
/** how far a tenue continuing on the next system may run into the margin */
const MARGIN_REACH = 1.2
/**
 * How far a tenue reaches, by the distance to the note of its voice that
 * takes over: in the Bauyn manuscript it stops well short of that note, the
 * more so the farther away the note is (a fit to its 132 tenues: from 4.5
 * spaces for a note 5 away to 17 for one 40 away).
 */
const REACH = { base: 2.6, perSpace: 0.37 }
/** where the note that takes over stands on a later system: this far beyond the end of the line */
const ONWARD = 4

interface StaffInfo {
    el: Element
    top: number
    bottom: number
    right: number
}

const isVisible = (el: Element) => el.closest('[opacity="0"]') === null

/**
 * Collects staff line geometry (in staff spaces, y up).
 */
const staffInfo = (staff: Element, unit: number): StaffInfo | undefined => {
    const ys: number[] = []
    let right = -Infinity
    for (const child of Array.from(staff.children)) {
        if (child.tagName !== 'path') continue
        const m = (child.getAttribute('d') || '').match(/^M\s*(-?[\d.]+)\s+(-?[\d.]+)\s*L\s*(-?[\d.]+)\s+(-?[\d.]+)/)
        if (!m || m[2] !== m[4]) continue
        ys.push(+m[2])
        right = Math.max(right, +m[1], +m[3])
    }
    if (ys.length < 2) return
    return {
        el: staff,
        top: -Math.min(...ys) / unit,
        bottom: -Math.max(...ys) / unit,
        right: right / unit
    }
}

/**
 * The staves right above and below a staff. A system holds one staff element
 * per staff and measure, so neighbours are found by height, not by order:
 * the staves of the other measures stand level with this one.
 */
const neighbours = (staves: StaffInfo[], staff: StaffInfo) => ({
    above: staves.filter(s => s.bottom > staff.top).sort((a, b) => a.bottom - b.bottom)[0],
    below: staves.filter(s => s.top < staff.bottom).sort((a, b) => b.top - a.top)[0]
})

const staffSpace = (svgEl: Element) => {
    for (const staff of Array.from(svgEl.querySelectorAll('.staff'))) {
        const ys = Array.from(staff.children)
            .filter(c => c.tagName === 'path')
            .map(c => (c.getAttribute('d') || '').match(/^M\s*-?[\d.]+\s+(-?[\d.]+)/))
            .filter((m): m is RegExpMatchArray => m !== null)
            .map(m => +m[1])
            .sort((a, b) => a - b)
        if (ys.length >= 2) return (ys[ys.length - 1] - ys[0]) / (ys.length - 1)
    }
    return 180
}

/**
 * Returns a function computing the bounding box of an element in the
 * coordinate system of the page margin group, in staff spaces (y up).
 */
const boxMeasurer = (pageMargin: SVGGraphicsElement, unit: number) => {
    const inv = pageMargin.getScreenCTM()?.inverse()
    return (el: Element): Box | undefined => {
        if (!inv) return
        const r = el.getBoundingClientRect()
        if (r.width === 0 && r.height === 0) return
        const a = new DOMPoint(r.left, r.top).matrixTransform(inv)
        const b = new DOMPoint(r.right, r.bottom).matrixTransform(inv)
        return {
            x0: Math.min(a.x, b.x) / unit,
            x1: Math.max(a.x, b.x) / unit,
            y0: -Math.max(a.y, b.y) / unit,
            y1: -Math.min(a.y, b.y) / unit
        }
    }
}

const obstacleSelectors: [string, ObstacleKind][] = [
    ['.accid use', 'accid'],
    ['.stem path', 'stem'],
    ['.beam polygon', 'beam'],
    ['.dots ellipse, .dots use', 'other'],
    ['.rest use', 'other'],
    ['.clef use', 'other'],
    ['.flag use', 'other'],
    ['.trill, .mordent, .turn, .fermata', 'other']
]

/** obstacles outside of the systems (title etc.) */
const pageObstacleSelectors = ['.pgHead']

/** The notehead of a note. */
const visibleHead = (note: Element) => note.querySelector('.notehead use')

export const removeTenues = (svgEl: Element) => {
    svgEl.querySelectorAll('.tenue').forEach(tenue => tenue.remove())
}

/**
 * Inserts tenues for all visible notes that are held until a later note
 * of the same voice (@next) takes over.
 */
export const insertTenues = (svgEl: SVGElement) => {
    removeTenues(svgEl)
    const pageMargin = svgEl.querySelector('.page-margin') as SVGGraphicsElement | null
    if (!pageMargin) return

    const unit = staffSpace(svgEl)
    const measure = boxMeasurer(pageMargin, unit)

    const pageObstacles: Obstacle[] = []
    for (const el of Array.from(svgEl.querySelectorAll(pageObstacleSelectors.join(',')))) {
        if (!isVisible(el)) continue
        const box = measure(el)
        if (box) pageObstacles.push({ kind: 'other', box })
    }

    for (const system of Array.from(svgEl.querySelectorAll('.system'))) {
        const staves = Array.from(system.querySelectorAll('.staff'))
            .map(s => staffInfo(s, unit))
            .filter((s): s is StaffInfo => s !== undefined)
        const staffOf = (el: Element) => {
            const s = el.closest('.staff')
            return staves.find(info => info.el === s)
        }
        // each measure draws its own stretch of the staves: the line ends with the last
        const lineEnd = Math.max(...staves.map(info => info.right))

        const obstacles: Obstacle[] = [...pageObstacles]
        const heads = new Map<string, Box>()
        for (const note of Array.from(system.querySelectorAll('.note'))) {
            const head = visibleHead(note)
            if (!head || !isVisible(head)) continue
            const box = measure(head)
            if (!box) continue
            const id = note.getAttribute('data-id') || ''
            heads.set(id, box)
            obstacles.push({ kind: 'head', box, owner: id })
        }
        for (const [selector, kind] of obstacleSelectors) {
            for (const el of Array.from(system.querySelectorAll(selector))) {
                if (!isVisible(el)) continue
                const box = measure(el)
                if (box) obstacles.push({ kind, box })
            }
        }

        const requests: TenueRequest[] = []
        for (const note of Array.from(system.querySelectorAll('.note[data-next]'))) {
            const classes = (note.getAttribute('class') || '').split(' ')
            if (classes.includes('ornam') || classes.includes('virtual')) continue
            const id = note.getAttribute('data-id') || ''
            const head = heads.get(id)
            const staff = staffOf(note)
            if (!head || !staff) continue

            // the note sounds until the next note of its voice begins
            const nextId = (note.getAttribute('data-next') || '').replace(/^#/, '')
            const next = svgEl.querySelector(`[data-id="${nextId}"]`)
            let takesOver = lineEnd + ONWARD
            let releasedBy: string | undefined
            if (next && next.closest('.system') === system) {
                const nextHead = heads.get(nextId) ?? (visibleHead(next) ? measure(visibleHead(next)!) : undefined)
                if (nextHead) {
                    takesOver = nextHead.x0
                    releasedBy = nextId
                }
            }
            // the tenue reaches towards the note that takes over, short of it
            // (unless that note comes too soon for a tenue to show); one
            // continuing on the next system may run a little into the margin
            const distance = takesOver - head.x1
            const reach = Math.max(MIN_REACH, Math.min(REACH.base + REACH.perSpace * distance, distance - END_GAP))
            const endX = Math.min(head.x1 + reach, releasedBy ? lineEnd - END_GAP : lineEnd + MARGIN_REACH)

            const { above, below } = neighbours(staves, staff)
            requests.push({
                id,
                head,
                endX,
                releasedBy,
                staffTop: staff.top,
                staffBottom: staff.bottom,
                ceiling: Math.min(staff.top + 5, above ? above.bottom - 0.8 : Infinity),
                floor: Math.max(staff.bottom - 5, below ? below.top + 0.8 : -Infinity)
            })
        }
        if (requests.length === 0) continue

        const placed = layoutTenues({ requests, obstacles })
        if (document.documentElement.dataset.tenueDebug === '1') {
            drawDebug(pageMargin, unit, obstacles, requests, placed)
        }
        for (const tenue of placed) {
            const path = document.createElementNS(SVG_NS, 'path')
            path.setAttribute('class', 'tenue')
            path.setAttribute('data-id', tenue.id)
            path.setAttribute('fill', 'currentColor')
            path.setAttribute('d', polygonToSvgPath(penOutline(tenue.curve, model.pen), unit))
            pageMargin.appendChild(path)
        }
    }
}

/**
 * Debugging aid (enable with document.documentElement.dataset.tenueDebug = '1'):
 * draws obstacle boxes, offsets and the control polygons of the curves.
 */
const drawDebug = (
    parent: Element, unit: number, obstacles: Obstacle[],
    requests: TenueRequest[], placed: PlacedTenue[]
) => {
    const add = (tag: string, attrs: Record<string, string>) => {
        const el = document.createElementNS(SVG_NS, tag)
        el.setAttribute('class', 'tenue tenue-debug')
        for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
        parent.appendChild(el)
    }
    const colors: Record<ObstacleKind, string> = { head: 'red', accid: 'orange', stem: 'green', beam: 'green', other: 'purple' }
    for (const o of obstacles) {
        add('rect', {
            x: `${o.box.x0 * unit}`, y: `${-o.box.y1 * unit}`,
            width: `${(o.box.x1 - o.box.x0) * unit}`, height: `${(o.box.y1 - o.box.y0) * unit}`,
            fill: 'none', stroke: colors[o.kind], 'stroke-width': '25'
        })
    }
    for (const r of requests) {
        add('line', {
            x1: `${r.endX * unit}`, x2: `${r.endX * unit}`,
            y1: `${-(r.head.y1 + 0.5) * unit}`, y2: `${-(r.head.y0 - 0.5) * unit}`,
            stroke: 'blue', 'stroke-width': '25'
        })
    }
    for (const t of placed) {
        add('polyline', {
            points: t.curve.map(p => `${p.x * unit},${-p.y * unit}`).join(' '),
            fill: 'none', stroke: 'magenta', 'stroke-width': '15', 'stroke-dasharray': '60 60'
        })
        add('text', {
            x: `${t.curve[3].x * unit}`, y: `${-t.curve[3].y * unit}`, 'font-size': '120', fill: 'magenta'
        })
        parent.lastElementChild!.textContent = `${t.cost.toFixed(1)}`
    }
}

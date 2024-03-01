import { v4 } from "uuid"
import * as d3 from 'd3'
import { quadraticScale } from "./scales"

export interface ScoreNode extends d3.SimulationNodeDatum {
    type: 'note' | 'start' | 'middle' | 'end',
    id: string,
    x: number,
    y: number,
    radius: number,
    isLiaison?: boolean
}

const determineNodes = (svgEl: SVGElement) => {
    const notes = svgEl.querySelectorAll('*[data-next][data-precedes]')

    const nodes: ScoreNode[] = []
    for (const note of notes) {
        // in any case push the note itself
        const bbox = (note.querySelector('.notehead use') as SVGGraphicsElement).getBBox()
        nodes.push({
            type: 'note',
            id: note.getAttribute('data-id') || 'unknown',
            x: bbox.x + 100,
            y: bbox.y + 100,
            radius: 125
        })

        const isLiaison = note.getAttribute('data-next') === note.getAttribute('data-precedes')
        const targetName = note.getAttribute('data-next')!
        const targetEl = svgEl.querySelector(`[data-id='${targetName.slice(1)}']`)
        if (!targetEl) continue

        if (note.closest('.system')?.getAttribute('data-id') !== targetEl.closest('.system')?.getAttribute('data-id')) {
            // The notes are on different systems. Ignore for now.
            continue
        }

        const id = v4()

        // starting points
        const startX = bbox.x + 300
        const startY = bbox.y + 70
        nodes.push({
            type: 'start',
            id,
            x: startX,
            y: startY,
            radius: isLiaison ? 10 : 150,
            isLiaison
        })

        // end points
        const targetBBox = (targetEl.querySelector('.notehead use') as SVGGraphicsElement).getBBox()
        const xDistance = (targetBBox.x - bbox.x)
        const yDistance = (targetBBox.y - bbox.y)
        const endX = targetBBox.x + (isLiaison ? -10 : -500)
        const endY = isLiaison ? targetBBox.y - 10 : bbox.y + yDistance / 2 - 275
        nodes.push({
            type: 'end',
            id,
            x: endX,
            y: endY,
            radius: isLiaison ? 10 : 250,
            isLiaison
        })

        if (xDistance > 1600) {
            // middle points
            nodes.push({
                type: 'middle',
                id,
                x: startX + (endX - startX) / 2,
                y: startY + (endY - startY) / 2,
                radius: isLiaison ? 90 : Math.pow(xDistance / 4.5, 1 / 1.1),
                isLiaison
            })
        }
    }

    return nodes
}

export const insertTenues = (svgEl: SVGElement, displacement: number) => {
    const nodes = determineNodes(svgEl).slice(0)

    const strengthes = {
        'note': 1,
        'start': 0.95,
        'middle': 0.35,
        'end': 0.85
    }

    return d3.forceSimulation(nodes)
        .force('x', d3.forceX()
            .x((d) => d.x!)
            .strength((datum: d3.SimulationNodeDatum) => {
                const d = datum as ScoreNode
                if (d.isLiaison) {
                    return 12.5
                }
                else return strengthes[(d.type as 'note' | 'start' | 'middle' | 'end')]
            }))
        .force('y', d3.forceY()
            .y((d) => d.y!)
            .strength((datum: d3.SimulationNodeDatum) => {
                const d = datum as ScoreNode
                if (d.isLiaison) return 12.5
                else return strengthes[(d.type as 'note' | 'start' | 'middle' | 'end')]
            }))
        .force('collision', d3.forceCollide().radius((datum: d3.SimulationNodeDatum) => {
            const d = datum as ScoreNode
            return d.radius
        }))
        .on('tick', () => {
            const showCircles = false
            if (showCircles) {
                nodes.forEach(node => {
                    const existing = svgEl.querySelector(`circle[data-type='${node.type}'][data-id='${node.id}']`)
                    const circle = existing || document.createElementNS('http://www.w3.org/2000/svg', 'circle')
                    if (!circle.hasAttribute('data-id') || !circle.hasAttribute('data-type')) {
                        circle.setAttribute('data-type', node.type)
                        circle.setAttribute('data-id', node.id)
                    }
                    circle.setAttribute('cx', node.x.toString())
                    circle.setAttribute('cy', node.y.toString())
                    circle.setAttribute('r', node.radius.toString())
                    circle.setAttribute('fill-opacity', '0.1')
                    if (node.type === 'note') {
                        circle.setAttribute('fill', 'red')
                    }
                    else if (node.type === 'start') {
                        circle.setAttribute('fill', 'green')
                    }
                    else if (node.type === 'middle') {
                        circle.setAttribute('fill', 'blue')
                    }
                    else {
                        circle.setAttribute('fill', 'gray')
                    }
                    svgEl.querySelector('.page-margin')!.appendChild(circle)
                })
            }

            nodes.filter(node => node.type === 'start').forEach(startNode => {
                const endNode = nodes.find(node => node.type === 'end' && node.id === startNode.id)
                const middleNode = nodes.find(node => node.type === 'middle' && node.id === startNode.id)

                if (!endNode) return

                let tenue = svgEl.querySelector(`[class*='tenue'][data-id='${startNode.id}']`)
                if (!tenue) {
                    tenue = document.createElementNS('http://www.w3.org/2000/svg', 'path')
                    tenue.setAttribute('data-id', startNode.id)
                    tenue.setAttribute('class', 'tenue')
                    tenue.setAttribute('stroke-width', '5')
                    tenue.setAttribute('stroke', 'black')
                    tenue.setAttribute('fill', 'black')
                    console.log('displacement=', displacement)
                    tenue.setAttribute('opacity', quadraticScale(displacement, 200).toString())
                }

                let path
                if (startNode.isLiaison) {
                    // make a regularly curved line if it's a liaison
                    tenue.setAttribute('data-type', 'liaison')
                    const middleX = startNode.x + (endNode.x - startNode.x) / 2
                    const middleY = startNode.y < endNode.y ? startNode.y - 100 : endNode.y + 100
                    path = `M${startNode.x},${startNode.y} Q${middleX},${middleY} ${endNode.x},${endNode.y} Q${middleX},${middleY - 90} ${startNode.x},${startNode.y}`
                }
                else if (middleNode) {
                    tenue.setAttribute('data-type', 'tenue')
                    // if the tenue is long and therefore has a middle node 
                    path = `M${startNode.x},${startNode.y} Q${middleNode.x},${middleNode.y} ${endNode.x},${endNode.y} Q${middleNode.x},${middleNode.y - 80} ${startNode.x},${startNode.y}`
                }
                else {
                    tenue.setAttribute('data-type', 'short-tenue')
                    // if the tenue is short but not a liaison, use a straight line
                    const middleX = startNode.x + (endNode.x - startNode.x) / 2
                    const middleY = startNode.y + (endNode.y - startNode.y) / 2
                    path = `M${startNode.x},${startNode.y} Q${middleX},${middleY} ${endNode.x},${endNode.y} Q${middleX},${middleY - 80} ${startNode.x},${startNode.y}`
                }
                tenue.setAttribute('d', path)
                svgEl.querySelector('.page-margin')!.appendChild(tenue)
            })
        })
}

export const removeTenues = (svgEl: Element) => {
    svgEl.querySelectorAll('.tenue').forEach(tenue => {
        tenue.parentNode?.removeChild(tenue)
    })
}

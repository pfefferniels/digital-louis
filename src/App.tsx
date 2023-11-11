import { Box, Checkbox, FormControlLabel, FormGroup, Paper, Slider, Typography } from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2'
import { loadVerovio } from './loadVerovio.mts'
import { useEffect, useRef, useState } from 'react';
import { VerovioToolkit } from 'verovio/esm';
import './App.css'
import * as d3 from 'd3'
import { v4 } from 'uuid'

interface ScoreNode extends d3.SimulationNodeDatum {
  type: 'note' | 'start' | 'middle' | 'end',
  id: string,
  x: number,
  y: number,
  radius: number,
  isLiaison?: boolean
}

const determineNodes = (svgEl: SVGElement) => {
  const notes = svgEl.querySelectorAll('*[data-next]')

  const nodes: ScoreNode[] = []
  for (const note of notes) {
    // in any case push the note itself
    const bbox = (note.querySelector('.notehead use') as SVGGraphicsElement).getBBox()
    nodes.push({
      type: 'note',
      id: note.getAttribute('data-id') || 'unknown',
      x: bbox.x + 100,
      y: bbox.y + 100,
      radius: 100
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
    nodes.push({
      type: 'start',
      id,
      x: bbox.x + 300,
      y: bbox.y + 70,
      radius: isLiaison ? 30 : 200,
      isLiaison
    })

    // end points
    const targetBBox = (targetEl.querySelector('.notehead use') as SVGGraphicsElement).getBBox()
    const xDistance = (targetBBox.x - bbox.x)
    nodes.push({
      type: 'end',
      id,
      x: targetBBox.x + (isLiaison ? 10 : -140),
      y: targetBBox.y + (isLiaison ? -20 : - 200),
      radius: isLiaison ? 30 : Math.sqrt(xDistance * 30),
      isLiaison
    })

    // middle points
    nodes.push({
      type: 'middle',
      id,
      x: bbox.x + xDistance / 2,
      y: bbox.y + (targetBBox.y - bbox.y) / 2,
      radius: isLiaison ? 90 : Math.sqrt(xDistance * 80),
      isLiaison
    })
  }

  return nodes
}

const insertTenues = (svgEl: SVGElement, displacement: number) => {
  const nodes = determineNodes(svgEl).slice(0)

  const strengthes = {
    'note': 11,
    'start': 7,
    'middle': 0.01,
    'end': 0.05
  }

  d3.forceSimulation(nodes)
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
      /*
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
      }*/

      nodes.filter(node => node.type === 'start').forEach(startNode => {
        const endNode = nodes.find(node => node.type === 'end' && node.id === startNode.id)
        const middleNode = nodes.find(node => node.type === 'middle' && node.id === startNode.id)

        if (!endNode || !middleNode) return

        let tenue = svgEl.querySelector(`[class*='tenue'][data-id='${startNode.id}']`)
        if (!tenue) {
          tenue = document.createElementNS('http://www.w3.org/2000/svg', 'path')
          tenue.setAttribute('data-id', startNode.id)
          tenue.setAttribute('class', 'tenue')
          tenue.setAttribute('stroke-width', "5")
          tenue.setAttribute('stroke', 'black')
          tenue.setAttribute('fill', 'black')
          tenue.setAttribute('opacity', (displacement / 300).toString())
        }
        const path = `M${startNode.x},${startNode.y} Q${middleNode.x},${middleNode.y} ${endNode.x},${endNode.y} Q${middleNode.x},${middleNode.y - 40} ${startNode.x},${startNode.y}`
        tenue.setAttribute('d', path)
        svgEl.querySelector('.page-margin')!.appendChild(tenue)
      })
    });
}

const addTenueInfo = (mei: Document) => {
  const layerTypes = ['cantus', 'altus', 'tenor', 'quintus', 'bassus']
  layerTypes.forEach(layerType => {
    [...mei.querySelectorAll(`layer[type='${layerType}']`)]
      .map(layer => [...layer.querySelectorAll('note,rest')])
      .flat()
      .filter(note => !note.getAttribute('type')?.split(' ').includes('ornam'))
      .forEach((note, i, allNotes) => {
        if (i === allNotes.length - 1) return

        const nextName = allNotes[i + 1].getAttribute('xml:id')
        if (!nextName) return

        note.setAttribute('next', `#${nextName}`)
      })
  })
}

const connectNotesToFacsimile = () => {
  const notes = document.querySelectorAll('.note[data-corresp]')
  notes.forEach(note => {
    const corresps = note.getAttribute('data-corresp')?.split(' ')
    if (!corresps) return

    note.addEventListener('mouseover', () => {
      for (const corresp of corresps) {
        const correspEl = document.querySelector(corresp)
        if (!correspEl) return

        correspEl.classList.add('with-glow')
      }
    })

    note.addEventListener('mouseleave', () => {
      for (const corresp of corresps) {
        const correspEl = document.querySelector(corresp)
        if (!correspEl) return

        correspEl.classList.remove('with-glow')
      }
    })

    for (const corresp of corresps) {
      const correspEl = document.querySelector(corresp)
      if (!correspEl) return

      correspEl.addEventListener('mouseover', () => {
        note.querySelector('.notehead')!.classList.add('with-glow')
      })

      correspEl.addEventListener('mouseleave', () => {
        note.querySelector('.notehead')!.classList.remove('with-glow')
      })
    }
  })
}

const calculateNotePositions = (displacement: number, toolkit: VerovioToolkit) => {
  // make barlines and stems slowly disappear
  document.querySelectorAll('.barLine, .stem, .trill, .ledgerLines, .beam polygon, .dots').forEach(el => {
    el.setAttribute('opacity', (1 - (displacement / 240)).toString())
  })

  let currentNotes = [document.querySelector(`.note[class*='entry']`)]
  if (!currentNotes.length) {
    console.log('no entry found')
    return
  }
  let nextNotes = currentNotes[0]!.getAttribute('data-precedes')?.split(' ').map(noteId => {
    return document.querySelector(`.note[data-id=${noteId.slice(1)}`)
  })
  if (!nextNotes || !nextNotes.length) {
    console.log('no next notes found')
  }

  let prevScoreTime = 0
  let buffer: Element[] = []
  while (currentNotes.length && nextNotes && nextNotes.length) {
    const currentNote = currentNotes[0]
    const currentNoteId = currentNotes[0]?.getAttribute('data-id')
    if (!currentNote || !currentNoteId || currentNote === nextNotes[0]) break

    const scoreTime =
      currentNote.getAttribute('class')?.split(' ').indexOf('ornam') !== -1
        ? prevScoreTime
        : (toolkit.getTimesForElement(currentNoteId).scoreTimeOnset as unknown as number[])[0]
    if (scoreTime === prevScoreTime) {
      buffer.push(...(currentNotes.filter(note => note !== null) as Element[]))
    }
    else {
      // Process all the notes in the buffer.
      // Since not all at the same score time have the same horizontal
      // position, choose *one* x position (not a grace note) as a common starting point.
      const bufferWithoutGraceNotes = buffer.filter(note => note.getAttribute('class')?.split(' ').indexOf('ornam') === -1)
      const startX = +(bufferWithoutGraceNotes[0].querySelector('use')?.getAttribute('x') || 0)
      buffer.forEach((note, i) => {
        const use = note.querySelector('use')
        if (!use) return

        const myX = +(use.getAttribute('x') || 0)
        const startCompensation = startX - myX

        use.setAttribute('x', (myX + startCompensation + i * (displacement * 5 / buffer.length)).toString())
        const stem = note.querySelector('.stem path')
        if (stem) {
          stem.setAttribute('transform', `translate(${i * (displacement * 5 / buffer.length)}, 0)`)
        }
      })
      buffer = []
      buffer.push(...(currentNotes.filter(note => note !== null) as Element[]))
    }
    prevScoreTime = scoreTime

    currentNotes = nextNotes
    if (!currentNotes[0]) break

    nextNotes = currentNotes[0].getAttribute('data-precedes')?.split(' ').map(noteId => {
      return document.querySelector(`.note[data-id=${noteId.slice(1)}`)
    })
  }
}

function App() {
  const [toolkit, setToolkit] = useState<VerovioToolkit>()
  const [encoding, setEncoding] = useState<string>()
  const [facsimile, setFacsimile] = useState<string>()

  const [displacement, setDisplacement] = useState<number>(0)
  const [displayTenues, setDisplayTenues] = useState(false)

  const verovio = useRef<HTMLDivElement>(null)

  const removeTenues = () => {
    if (!verovio.current) return

    const previousTenues = verovio.current.querySelectorAll('.tenue')
    for (const tenue of previousTenues) {
      tenue.remove()
    }
  }

  const showTenues = () => {
    if (!verovio.current) return
    insertTenues(verovio.current.querySelector('svg') as SVGElement, displacement)
  }

  useEffect(() => {
    loadVerovio().then((toolkit: VerovioToolkit) => setToolkit(toolkit))
  }, [])

  useEffect(() => {
    if (!toolkit) return

    const loadFacsimile = async () => {
      const response = await fetch('prelude10.svg')
      setFacsimile(await response.text())
    }

    const loadEncoding = async () => {
      const response = await fetch('prelude10.mei')
      let mei = await response.text()
      const meiDoc = new DOMParser().parseFromString(mei, 'text/xml')
      addTenueInfo(meiDoc)
      mei = new XMLSerializer().serializeToString(meiDoc)
      toolkit.setOptions({
        adjustPageHeight: true,
        adjustPageWidth: true,
        svgHtml5: true,
        svgViewBox: true,
        spacingLinear: 0.5,
        svgAdditionalAttribute: ['note@corresp', 'note@precedes', 'note@next', 'slur@startid'],
      })
      toolkit.loadData(mei)
      setEncoding(toolkit.renderToSVG(1))

      setTimeout(() => {
        connectNotesToFacsimile()
      }, 800)
    }

    loadEncoding()
    loadFacsimile()
  }, [toolkit])

  return (
    <Grid container spacing={1}>
      <Grid xs={6}>
        <Paper style={{ position: 'relative' }} elevation={3}>
          <Typography sx={{ padding: 1 }}>
            <i style={{ color: 'black' }}>
              Hover over the notes to highlight their counterparts in the facsimile/score.
            </i>
          </Typography>

          {facsimile && <div dangerouslySetInnerHTML={{ __html: facsimile }} />}
        </Paper>
      </Grid>
      <Grid xs={6}>
        <Paper elevation={3}>
          <Box sx={{ width: 200, ml: 'auto', mr: 'auto' }}>
            <Slider
              min={0}
              max={300}
              step={1}
              marks={
                [{
                  value: 0,
                  label: 'mesuré'
                },
                {
                  value: 300,
                  label: 'non mesuré'
                }
                ]
              }
              value={displacement}
              onChange={(_, newValue: number | number[]) => {
                if (Array.isArray(newValue)) return
                setDisplacement(newValue as number)

                if (newValue === 0) {
                  setEncoding(toolkit?.renderToSVG(1))
                  setTimeout(() => {
                    connectNotesToFacsimile()
                  }, 800)
                }
                else {
                  calculateNotePositions(newValue, toolkit!)
                }
              }}
              onChangeCommitted={() => {
                if (displayTenues) {
                  removeTenues()
                  setTimeout(showTenues, 100)
                }
              }}
            />
          </Box>
          <Box sx={{ pl: 2 }}>
            <FormGroup>
              <FormControlLabel
                control={<Checkbox
                  disabled={displacement === 0}
                  value={displayTenues}
                  onChange={(_, checked) => {
                    removeTenues()
                    if (checked) setTimeout(showTenues, 100)
                    setDisplayTenues(checked)
                  }} />}
                label="Tenues and liaisons" />
            </FormGroup>
          </Box>
          {encoding && <div id='verovio' ref={verovio} dangerouslySetInnerHTML={{ __html: encoding }} />}
        </Paper>
      </Grid>
    </Grid>
  )
}

export default App

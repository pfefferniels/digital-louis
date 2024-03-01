import { Box, Checkbox, FormControlLabel, FormGroup, Paper, Slider, Typography } from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2'
import { loadVerovio } from './loadVerovio.mts'
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { VerovioToolkit } from 'verovio/esm';
import './App.css'
import * as d3 from 'd3'
import { ScoreNode, insertTenues, removeTenues } from './utils/StrokeEngine';
import { changeVisibilities } from './utils/changeVisibilities';
import { modernizeClefs } from './utils/modernizeClefs';
import { insertShadowSemibreves } from './utils/insertShadowSemibreves';

export const continuumLength = 300

const shiftStemTo = (path: Element, newX: number) => {
  const d = path.getAttribute('d')
  if (!d) return
  const points = d.split(' ')
  const y1 = +points[1]
  const y2 = +points[3]

  const shift = +(path.getAttribute('data-shift-notehead') || 0)

  path.setAttribute('d', `M${newX - shift} ${y1} L${newX - shift} ${y2}`)
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

const addShiftInfo = () => {
  document.querySelectorAll('.stem path, .accid path').forEach(el_ => {
    const el = el_ as SVGGraphicsElement
    const note = el.closest('.note')
    if (!note) return
    const notehead = note.querySelector('.notehead') as SVGGraphicsElement
    const noteheadX = notehead.getBBox().x
    const stemX = el.getBBox().x
    el.setAttribute('data-shift-notehead', (noteheadX - stemX).toString())
  })
}

const displaceNotes = (displacement: number, toolkit: VerovioToolkit) => {
  let currentNotes = [document.querySelector(`.note[class*='entry']`)]
  if (!currentNotes.length || !currentNotes[0]) {
    console.log('no entry found')
    return
  }

  document.querySelectorAll('[data-precedes]').forEach(el => el.removeAttribute('data-visited'))

  let nextNotes = currentNotes[0].getAttribute('data-precedes')?.split(' ').map(noteId => {
    return document.querySelector(`.note[data-id=${noteId.slice(1)}`)
  })
  if (!nextNotes || !nextNotes.length) {
    console.log('no next notes found')
  }

  let prevScoreTime = 0
  let buffer: Element[] = []
  while (currentNotes.length && nextNotes && nextNotes.length) {
    const currentNote = currentNotes[0]
    // console.log('current note=', currentNote)
    if (currentNote.hasAttribute('data-visited')) {
      console.log('Circular links detected.', currentNote.getAttribute('data-id'), 'has been used already.')
      break;
    }

    const currentNoteId = currentNotes[0]?.getAttribute('data-id')
    if (!currentNote || !currentNoteId || currentNote === nextNotes[0]) break
    currentNote.setAttribute('data-visited', 'true')

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
      let availableSpace = 2500
      // TODO: find a good way to calculate the available space
      if (buffer.length > 1) {
        const nextNonGraceNote = currentNotes.find(note => note && note.getAttribute('class')?.split(' ').indexOf('ornam') === -1)
        if (nextNonGraceNote) {
          const suggestion = +(nextNonGraceNote.querySelector('use')?.getAttribute('x') || 0) - startX
          if (suggestion > 0) {
            availableSpace = suggestion
          }
        }
      }
      const spacePerNote = availableSpace / buffer.length * (displacement / 150)
      buffer.forEach((note, i) => {
        const use = note.querySelector('use')
        if (!use) return

        const myX = +(use.getAttribute('x') || 0)
        const startCompensation = startX - myX

        const newX = (myX + startCompensation + i * spacePerNote).toString()
        use.setAttribute('x', newX)

        const accid = note.querySelector('.accid')
        accid?.querySelector('use')?.setAttribute('x', (+newX - 120).toString())

        const stem = note.querySelector('.stem path')
        if (stem) {
          shiftStemTo(stem, +newX)
        }
        note
          .querySelector('.shadow-semibreve')?.setAttribute('x', newX)
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
  const [modernClefs, setModernClefs] = useState(false)

  const [position, setPosition] = useState<number>(150)
  const [strokeSimulation, setStrokeSimulation] = useState<d3.Simulation<ScoreNode, undefined>>()

  const verovio = useRef<HTMLDivElement>(null)

  const hideTenues = () => {
    if (strokeSimulation) {
      strokeSimulation.stop()
      setStrokeSimulation(undefined)
    }
    removeTenues(verovio.current!.querySelector('svg') as SVGElement)
  }

  const showTenues = () => {
    if (!verovio.current) return

    hideTenues()
    setStrokeSimulation(
      insertTenues(verovio.current.querySelector('svg') as SVGElement, position - 150))
  }

  useEffect(() => {
    loadVerovio().then((toolkit: VerovioToolkit) => setToolkit(toolkit))

    const loadFacsimile = async () => {
      const response = await fetch(import.meta.env.BASE_URL  + '/prelude7.svg')
      setFacsimile(await response.text())
    }

    loadFacsimile()
  }, [])

  useEffect(() => {
    if (!toolkit) return

    const loadEncoding = async () => {
      const response = await fetch(import.meta.env.BASE_URL + '/prelude7.mei')
      let mei = await response.text()
      const meiDoc = new DOMParser().parseFromString(mei, 'text/xml')
      addTenueInfo(meiDoc)
      if (modernClefs) modernizeClefs(meiDoc)
      mei = new XMLSerializer().serializeToString(meiDoc)
      toolkit.setOptions({
        adjustPageHeight: true,
        adjustPageWidth: true,
        svgHtml5: true,
        svgViewBox: true,
        spacingLinear: 0.05,
        spacingNonLinear: 1,
        svgAdditionalAttribute: ['note@corresp', 'note@precedes', 'note@next', 'slur@startid', 'tie@startid', 'tie@endid'],
      })
      toolkit.loadData(mei)
      setEncoding(toolkit.renderToSVG(1))
    }

    loadEncoding()
  }, [toolkit, modernClefs])

  useLayoutEffect(() => {
    connectNotesToFacsimile()
    insertShadowSemibreves()
    addShiftInfo()
    changeVisibilities(0)
    setPosition(0)
  }, [encoding])

  return (
    <Grid container spacing={1}>
      <Grid xs={6}>
        <Paper elevation={3}>
          <Box sx={{ width: 600, ml: 'auto', mr: 'auto' }}>
            <Slider
              min={0}
              max={continuumLength}
              step={1}
              marks={
                [
                  {
                    value: 0,
                    label: <span style={{ color: 'lightgray' }}>Papier</span>
                  },
                  {
                    value: 30,
                    label: <span style={{ color: 'lightgray' }}>Plan</span>
                  },
                  {
                    value: 60,
                    label: <span style={{ color: 'lightgray' }}>Basse</span>
                  },
                  {
                    value: 100,
                    label: <span style={{ color: 'lightgray' }}>Chant</span>
                  },
                  {
                    value: 150,
                    label: <b>Mesuré</b>
                  },
                  {
                    value: continuumLength,
                    label: <b>Non mesuré</b>
                  }
                ]
              }
              value={position}
              onChange={(_, newValue: number | number[]) => {
                if (Array.isArray(newValue)) return
                setPosition(newValue as number)

                if (newValue === 0) {
                  setEncoding(toolkit?.renderToSVG(1))
                }
                else {
                  if (newValue >= 150) {
                    displaceNotes(newValue - 150, toolkit!)
                  }
                  else {
                    hideTenues()
                  }
                }
                changeVisibilities(newValue)
              }}
              onChangeCommitted={(_, newValue) => {
                if (Array.isArray(newValue)) return

                if (newValue >= 150) {
                  setTimeout(showTenues, 100)
                }
              }}
            />
          </Box>
          <Box sx={{ pl: 2 }}>
            <FormGroup>
              <FormControlLabel
                control={<Checkbox
                  value={modernClefs}
                  onChange={(_, checked) => {
                    setModernClefs(checked)
                  }} />}
                label="Modern clefs" />
            </FormGroup>
          </Box>

          {encoding && <div id='verovio' ref={verovio} dangerouslySetInnerHTML={{ __html: encoding }} />}

        </Paper>
      </Grid>
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
    </Grid>
  )
}

export default App

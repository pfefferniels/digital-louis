import { Box, Paper, Slider, Typography } from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2'
import { loadVerovio } from './loadVerovio.mts'
import { useEffect, useState } from 'react';
import { VerovioToolkit } from 'verovio/esm';
import './App.css'

const addSlurs = (mei: Document) => {
  const measures = mei.querySelectorAll('measure')
  measures.forEach(measure => {
    const layers = measure.querySelectorAll('layer')
    layers.forEach(layer => {
      const notes = layer.querySelectorAll('note:not([type*="ornam"])')
      notes.forEach((note, i) => {
        if (i === notes.length - 1) return

        const startId = note.getAttribute('xml:id')
        const endId = notes[i + 1].getAttribute('xml:id')

        if (!startId || !endId) {
          console.log('@startid or @endid not defined')
          return
        }

        // slur from note => notes[i+1]
        const slur = mei.createElementNS('http://www.music-encoding.org/ns/mei', 'slur')
        slur.setAttribute('startid', `#${startId}`)
        slur.setAttribute('endid', `#${endId}`)
        // slur.setAttribute('curvedir', 'mixed')
        measure.appendChild(slur)
      })
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
  document.querySelectorAll('.barLine, .stem, .trill, .ledgerLines').forEach(barline => {
    barline.setAttribute('opacity', (1 - (displacement / 240)).toString())
  })

  // make slurs appear
  document.querySelectorAll('.slur').forEach(barline => {
    barline.setAttribute('opacity', (displacement / 800).toString())
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
        if (!note) return
        const myX = +(note.querySelector('use')?.getAttribute('x') || 0)
        const startCompensation = startX - myX
        note.setAttribute('transform', `translate(${startCompensation + i * (displacement * 5 / buffer.length)}, 0)`)
        const correspSlur = document.querySelector(`.slur[data-startid='#${note.getAttribute('data-id')}']`)
        if (correspSlur) {
          correspSlur.setAttribute('transform-origin', `top left`)
          correspSlur.setAttribute('transform', `translate(${startCompensation + i * (displacement * 5 / buffer.length)}, 0)`)
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
      // addSlurs(meiDoc)
      mei = new XMLSerializer().serializeToString(meiDoc)
      toolkit.setOptions({
        adjustPageHeight: true,
        adjustPageWidth: true,
        svgHtml5: true,
        svgViewBox: true,
        spacingLinear: 0.5,
        svgAdditionalAttribute: ['note@corresp', 'note@precedes', 'slur@startid'],
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
          {facsimile && <div dangerouslySetInnerHTML={{ __html: facsimile }} />}
        </Paper>
      </Grid>
      <Grid xs={6}>
        <Paper elevation={3}>
          <Typography sx={{ padding: 1 }}>
            <i style={{ color: 'black' }}>Hover over the notes to highlight their counterparts in the facsimile/score.</i>
          </Typography>
          <Box sx={{ width: 200, p: 2 }}>
            <Slider style={{ width: '80%' }} min={0} max={300} step={1} value={displacement} onChange={(_, newValue: number | number[]) => {
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
            }} />
          </Box>
          {encoding && <div dangerouslySetInnerHTML={{ __html: encoding }} />}
        </Paper>
      </Grid>
    </Grid>
  )
}

export default App

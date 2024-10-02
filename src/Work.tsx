import { Box, Checkbox, CircularProgress, FormControlLabel, FormGroup, Paper, Slider, Stack, Typography } from '@mui/material';
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
import { displaceNotes } from './utils/displaceNotes';
import { GlowDefs } from './GlowDefs';

export const continuumLength = 300

// Wrap wrapper around nodes
// Just pass a collection of nodes, and a wrapper element
const wrapAll = (nodes: Element[], wrapper: Element) => {
  if (nodes.length === 0) return;

  // Cache the current parent and previous sibling of the first node.
  const parent = nodes[0].parentNode;
  const previousSibling = nodes[0].previousSibling;

  // Place each node in wrapper.
  //  - If nodes is an array, we must increment the index we grab from 
  //    after each loop.
  //  - If nodes is a NodeList, each node is automatically removed from 
  //    the NodeList when it is removed from its parent with appendChild.
  for (let i = 0; nodes.length - i; wrapper.firstChild === nodes[0] && i++) {
    wrapper.appendChild(nodes[i]);
  }

  // Place the wrapper just after the cached previousSibling,
  // or if that is null, just before the first child.
  if (parent) {
    const nextSibling = previousSibling ? previousSibling.nextSibling : parent.firstChild;
    parent.insertBefore(wrapper, nextSibling);
  }

  return wrapper;
}

const removeTiedNotes = (meiDoc: Document) => {
  meiDoc.querySelectorAll('tie').forEach(tie => {
    const endId = tie.getAttribute('endid')
    if (!endId) return

    const endNote = meiDoc.querySelector(`note[*|id="${endId.slice(1)}"]`)
    if (!endNote) return

    const dur = endNote.getAttribute('dur')
    if (!dur) return

    const space = document.createElementNS('http://www.music-encoding.org/ns/mei', 'space')
    space.setAttribute('dur', dur)

    endNote.parentNode?.replaceChild(space, endNote)
    tie.remove()
  })
}

// const cloneDocument = (doc: Document) => {
//   return doc.cloneNode(true) as Document
// }

const cloneDocument2 = (doc: Document) => {
  const str = new XMLSerializer().serializeToString(doc)
  return new DOMParser().parseFromString(str, 'text/xml')
}

const insertBeamedOrnaments = (meiDoc: Document) => {
  const processBuffer = (notes: Element[]) => {
    wrapAll(notes, meiDoc.createElementNS('http://www.music-encoding.org/ns/mei', 'beam'))
    notes.forEach(note => {
      note.setAttribute('dur', '8')
    })
  }

  const notes = Array.from(meiDoc.querySelectorAll('note[type="ornam"]'));

  let buffer: Element[] = []

  notes.forEach((note, index) => {
    buffer.push(note)

    if (index === notes.length - 1) {
      processBuffer(buffer)
      buffer = []
      return
    }

    const precedesId = note.getAttribute('precedes')
    if (!precedesId) {
      processBuffer(buffer)
      buffer = []
      return
    }

    const precedesNote = meiDoc.querySelector(`note[*|id="${precedesId.slice(1)}"]`)
    if (!precedesNote) {
      processBuffer(buffer)
      buffer = []
      return
    }

    if (precedesNote === notes[index + 1]) {
      buffer.push(precedesNote)
    }
    else {
      processBuffer(buffer)
      buffer = []
    }
  })
}

const removeBeamedOrnaments = (meiDoc: Document) => {
  meiDoc.querySelectorAll('beam').forEach(beam => {
    const childNotes = beam.querySelectorAll('note[type="ornam"]');
    if (childNotes.length === 0) return;

    const parent = beam.parentNode;
    if (!parent) return;

    childNotes.forEach(child => {
      child.setAttribute('dur', '4')
      parent.insertBefore(child, beam)
    });
    parent.removeChild(beam);
  });
}

export const shiftStemTo = (path: Element, newX: number) => {
  const d = path.getAttribute('d')
  if (!d) return
  const points = d.split(' ')
  const y1 = +points[1]
  const y2 = +points[3]

  const shift = +(path.getAttribute('data-shift-notehead') || 0)

  path.setAttribute('d', `M${newX - shift} ${y1} L${newX - shift} ${y2}`)
}

const addTenueInfo = (mei: Document) => {
  const layerTypes = ['cantus', 'altus', 'tenor', 'quintus', 'sextus', 'bassus']
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

interface WorkProps {
  id: string
}

const Work = ({ id }: WorkProps) => {
  const [toolkit, setToolkit] = useState<VerovioToolkit>()
  const [meiDoc, setMeiDoc] = useState<Document>()
  const [scoreSVG, setScoreSVG] = useState<string>()

  const [facsimile, setFacsimile] = useState<string>()
  const [svgFile, setSVGFile] = useState<string>()

  const [modernClefs, setModernClefs] = useState(false)
  const [figuredBass, setFiguredBass] = useState(false)
  const [cadences, setCadences] = useState(false)

  const [position, setPosition] = useState<number>(150)

  const strokeSimulation = useRef<d3.Simulation<ScoreNode, undefined>>()
  const verovio = useRef<HTMLDivElement>(null)

  const hideTenues = () => {
    if (!verovio.current) return
    if (strokeSimulation.current) {
      strokeSimulation.current.stop()
    }

    removeTenues(verovio.current.querySelector('svg') as SVGElement)
  }

  useEffect(() => {
    loadVerovio().then((toolkit: VerovioToolkit) => setToolkit(toolkit))

    const loadFacsimile = async () => {
      const response = await fetch(import.meta.env.BASE_URL + '/' + svgFile)
      setFacsimile(await response.text())
    }

    loadFacsimile()
  }, [svgFile])

  useEffect(() => {
    if (!toolkit) return

    const loadEncoding = async () => {
      const response = await fetch(import.meta.env.BASE_URL + '/' + id + '.mei')
      const mei = await response.text()
      const meiDoc = new DOMParser().parseFromString(mei, 'text/xml')
      setMeiDoc(meiDoc)

      const targetSVG = meiDoc.querySelector('source')?.getAttribute('target') || undefined
      setSVGFile(targetSVG)
    }

    loadEncoding()
  }, [toolkit, modernClefs, id])

  useEffect(() => {
    if (!meiDoc || !toolkit) return

    addTenueInfo(meiDoc)
    if (modernClefs) modernizeClefs(meiDoc)

    const mei = new XMLSerializer().serializeToString(meiDoc)
    toolkit.setOptions({
      adjustPageHeight: true,
      svgHtml5: true,
      svgViewBox: true,
      spacingLinear: 0.05,
      spacingNonLinear: 1,
      svgAdditionalAttribute: ['note@corresp', 'note@precedes', 'note@next', 'slur@startid', 'tie@startid', 'tie@endid', 'note@stem.dir', 'staff@n', 'note@dur'],
      breaks: 'encoded'
    })
    toolkit.loadData(mei)
    setScoreSVG(toolkit.renderToSVG(1))
  }, [meiDoc, modernClefs, toolkit])

  useLayoutEffect(() => {
    if (!scoreSVG || !facsimile) return

    // once encoding and facsimile are 
    // loaded, connect them
    connectNotesToFacsimile()
  }, [scoreSVG, facsimile])

  useLayoutEffect(() => {
    const showTenues = (tendency: 'up' | 'equal') => {
      if (!verovio.current) return

      hideTenues()

      strokeSimulation.current = insertTenues(
        verovio.current.querySelector('svg') as SVGElement,
        position - 150,
        tendency
      )
    }

    if (position === 300) {
      insertShadowSemibreves()
    }

    addShiftInfo()
    changeVisibilities(position)

    if (position > 150) {
      displaceNotes(position - 150, toolkit!)
    }

    if (position > 250) {
      setTimeout(showTenues, 100, 'up')
    }
    else if (position > 200) {
      setTimeout(showTenues, 100, 'equal')
    }
    else {
      hideTenues()
    }

  }, [scoreSVG, position, toolkit])

  useLayoutEffect(() => {
    document.querySelectorAll('#svg1 path').forEach(el => {
      (el as SVGElement).addEventListener('click', () => {
        navigator.clipboard.writeText('#' + el.getAttribute('id') || 'unknown')
      })
    })
  }, [facsimile])

  useEffect(() => {
    if (!toolkit) return

    if (position === 0) {
      setScoreSVG(toolkit.renderToSVG(1))
    }
    else {
      if (position === 250) {
        setMeiDoc(prev => {
          if (!prev) return

          insertBeamedOrnaments(prev);
          removeTiedNotes(prev);
          return cloneDocument2(prev);
        })
      }
      else {
        setMeiDoc(prev => {
          if (!prev) return

          removeBeamedOrnaments(prev);
          return cloneDocument2(prev);
        })
      }
    }
  }, [position, toolkit])

  const handleFiguredBass = (checked: boolean) => {
    setFiguredBass(checked)

    if (checked) {
      document.querySelectorAll('.fb').forEach(fb => {
        fb.setAttribute('opacity', '1')
      })
    }
    else {
      document.querySelectorAll('.fb').forEach(fb => {
        fb.setAttribute('opacity', '0')
      })
    }
  }

  const handleCadences = (checked: boolean) => {
    setCadences(checked)

    if (checked) {
      document.querySelectorAll('.cadence').forEach(cadence => {
        cadence.setAttribute('opacity', '1')
      })
    }
    else {
      document.querySelectorAll('.cadence').forEach(cadence => {
        cadence.setAttribute('opacity', '0')
      })
    }
  }

  return (
    <Grid container spacing={1}>
      <GlowDefs />

      <Grid xs={6}>
        <Paper elevation={3}>
          <Box sx={{ width: 600, ml: 'auto', mr: 'auto' }}>
            <Slider
              min={0}
              max={continuumLength}
              step={50}
              marks={
                [
                  {
                    value: 0,
                    label: <span style={{ transform: 'rotate(90deg)', color: 'lightgray' }}>Papier</span>
                  },
                  {
                    value: 50,
                    label: <span style={{ color: 'lightgray' }}>Basse</span>
                  },
                  {
                    value: 100,
                    label: <span style={{ color: 'lightgray' }}>Basse + Chant</span>
                  },
                  {
                    value: 150,
                    label: <b>Mesuré</b>
                  },
                  {
                    value: 200,
                    label: <span style={{ color: 'lightgray' }}>Jamais d'aplomb</span>
                  },
                  {
                    value: 250,
                    label: <span style={{ color: 'lightgray' }}>Semi-mesuré</span>
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
              }}
            />
          </Box>
          <Stack pl={2} spacing={2} direction='row'>
            <FormGroup>
              <FormControlLabel
                control={<Checkbox
                  value={modernClefs}
                  onChange={(_, checked) => {
                    setModernClefs(checked)
                  }} />}
                label="Modern clefs" />
            </FormGroup>
            <FormGroup>
              <FormControlLabel
                control={<Checkbox
                  value={figuredBass}
                  onChange={(_, checked) => {
                    handleFiguredBass(checked)
                  }} />}
                label="Figured bass" />
            </FormGroup>
            <FormGroup>
              <FormControlLabel
                control={<Checkbox
                  value={cadences}
                  onChange={(_, checked) => {
                    handleCadences(checked)
                  }} />}
                label="Cadences" />
            </FormGroup>
          </Stack>

          {scoreSVG && <div id='verovio' ref={verovio} dangerouslySetInnerHTML={{ __html: scoreSVG }} />}

        </Paper>
      </Grid>
      <Grid xs={6}>
        <Paper style={{ position: 'relative' }} elevation={3}>
          <Typography sx={{ padding: 1 }}>
            <i style={{ color: 'black' }}>
              Hover over the notes to highlight their counterparts in the facsimile/score.
            </i>
          </Typography>

          {facsimile
            ? <div dangerouslySetInnerHTML={{ __html: facsimile }} />
            : <CircularProgress />}
        </Paper>
      </Grid>
    </Grid>
  )
}

export default Work

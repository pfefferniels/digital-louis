import { Alert, Box, Checkbox, CircularProgress, FormControlLabel, FormGroup, Paper, Slider, Stack, Typography, useMediaQuery } from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import './App.css'
import { prepare, PreparedScore, render } from './renderer';
import { insertTenues, removeTenues } from './utils/tenues/dom';
import { addTenueInfo } from './utils/addTenueInfo';
import { changeVisibilities } from './utils/changeVisibilities';
import { modernizeClefs } from './utils/modernizeClefs';
import { cloneDocument, insertBeamedOrnaments, removeTiedNotes } from './utils/meiTransforms';
import { GlowDefs } from './GlowDefs';
import { highlightOnTap } from './utils/tapToHighlight';

export const continuumLength = 300

/** Where the slider shows the measured reading; from here to its end the notes move into the order of the source. */
const measured = 150

/** How far a slider position has gone from the measured reading towards the reading order of the source. */
const continuumAt = (position: number) => Math.max(0, position - measured) / (continuumLength - measured)

/** The distance between two marks of the slider */
const step = 50

/** The room left and right of the slider, in spacing units, into which the labels at its ends reach */
const sliderInset = { xs: 4, sm: 6 }

/**
 * Lets the facsimile, drawn in Inkscape at a size in millimetres, take the width it is
 * given: its view box becomes what it draws, and its height follows from its width.
 */
const fitToContent = (svg: SVGSVGElement) => {
  const { x, y, width, height } = svg.getBBox()
  if (width === 0 || height === 0) return
  svg.setAttribute('viewBox', `${x} ${y} ${width} ${height}`)
  svg.removeAttribute('width')
  svg.removeAttribute('height')
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

interface ViewOptions {
  readonly modernClefs: boolean
  /** the semi-measured view beams the ornaments and leaves out the notes tied over */
  readonly semiMeasured: boolean
}

type Prepared = { readonly score: PreparedScore } | { readonly error: string }

/** The score for a view of the encoding, which is left as it was loaded. */
const prepareView = (meiDoc: Document, options: ViewOptions): Prepared => {
  const doc = cloneDocument(meiDoc)
  addTenueInfo(doc)
  if (options.modernClefs) modernizeClefs(doc)
  if (options.semiMeasured) {
    insertBeamedOrnaments(doc)
    removeTiedNotes(doc)
  }
  try {
    return { score: prepare(doc) }
  }
  catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

const showAll = (selector: string, shown: boolean) =>
  document.querySelectorAll(selector).forEach(el => el.setAttribute('opacity', shown ? '1' : '0'))

interface WorkProps {
  id: string
}

const Work = ({ id }: WorkProps) => {
  const [meiDoc, setMeiDoc] = useState<Document>()

  const [facsimile, setFacsimile] = useState<string>()
  const [svgFile, setSVGFile] = useState<string>()

  const [modernClefs, setModernClefs] = useState(false)
  const [figuredBass, setFiguredBass] = useState(false)
  const [cadences, setCadences] = useState(false)

  const [position, setPosition] = useState<number>(measured)

  const score = useRef<HTMLDivElement>(null)
  const facsimileView = useRef<HTMLDivElement>(null)

  // on a touch screen, a note is tapped rather than hovered over
  const touch = useMediaQuery('(hover: none)')

  useEffect(() => {
    if (!svgFile) return

    const loadFacsimile = async () => {
      const response = await fetch(import.meta.env.BASE_URL + '/' + svgFile)
      setFacsimile(await response.text())
    }

    loadFacsimile()
  }, [svgFile])

  useEffect(() => {
    const loadEncoding = async () => {
      const response = await fetch(import.meta.env.BASE_URL + '/' + id + '.mei')
      const mei = await response.text()
      const meiDoc = new DOMParser().parseFromString(mei, 'text/xml')
      setMeiDoc(meiDoc)

      const targetSVG = meiDoc.querySelector('source')?.getAttribute('target') || undefined
      setSVGFile(targetSVG)
    }

    loadEncoding()
  }, [id])

  const semiMeasured = position === 250
  const prepared = useMemo(
    () => meiDoc && prepareView(meiDoc, { modernClefs, semiMeasured }),
    [meiDoc, modernClefs, semiMeasured]
  )
  const t = continuumAt(position)
  // the unmeasured view writes every note alike, as the source does
  const noteheads = position === continuumLength ? 'unmeasured' : 'notated'
  const scoreSVG = useMemo(
    () => (prepared && 'score' in prepared ? render(prepared.score, t, { noteheads }) : undefined),
    [prepared, t, noteheads]
  )

  useLayoutEffect(() => {
    if (!scoreSVG || !facsimile) return

    // once encoding and facsimile are
    // loaded, connect them: by hovering
    // with a mouse, by tapping on a touch screen
    if (!touch) {
      connectNotesToFacsimile()
      return
    }
    if (score.current && facsimileView.current) return highlightOnTap(score.current, facsimileView.current)
  }, [scoreSVG, facsimile, touch])

  useLayoutEffect(() => {
    const svg = score.current?.querySelector('svg')
    if (!svg) return

    changeVisibilities(position)
    showAll('.fb', figuredBass)
    showAll('.cadence', cadences)

    // Both the semi-measured and the unmeasured view draw
    // tenues following the practice of the Bauyn manuscript.
    if (position > 200) {
      const timer = setTimeout(() => insertTenues(svg), 100)
      return () => clearTimeout(timer)
    }
    removeTenues(svg)
  }, [scoreSVG, position, figuredBass, cadences])

  useLayoutEffect(() => {
    const svg = facsimileView.current?.querySelector('svg')
    if (svg) fitToContent(svg)
  }, [facsimile])

  useLayoutEffect(() => {
    // An aid for the editors, who work with a mouse. On a touch screen,
    // a tap is only to highlight a note, not to fill the clipboard.
    if (!window.matchMedia('(hover: hover)').matches) return

    document.querySelectorAll('#svg1 path').forEach(el => {
      (el as SVGElement).addEventListener('click', () => {
        navigator.clipboard.writeText('#' + el.getAttribute('id') || 'unknown')
      })
    })
  }, [facsimile])

  return (
    <Grid container spacing={1}>
      <GlowDefs />

      <Grid xs={12} md={6}>
        <Paper elevation={3}>
          <Box sx={{ px: sliderInset, pt: 1, pb: { xs: 2, sm: 1.5 } }}>
            <Slider
              min={0}
              max={continuumLength}
              step={step}
              sx={{
                // Each label may take the room between two marks, and wraps where it needs more.
                // Centred on their marks, the labels at the ends must not reach beyond the inset.
                '& .MuiSlider-markLabel': {
                  width: `calc(100% * ${step / continuumLength})`,
                  maxWidth: { xs: 2 * sliderInset.xs * 8, sm: 2 * sliderInset.sm * 8 },
                  whiteSpace: 'normal',
                  textAlign: 'center',
                  lineHeight: 1.2,
                  fontSize: { xs: '0.7rem', sm: '0.875rem' }
                }
              }}
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
          <Stack px={2} columnGap={2} direction='row' flexWrap='wrap' useFlexGap>
            <FormGroup>
              <FormControlLabel
                control={<Checkbox
                  checked={modernClefs}
                  onChange={(_, checked) => setModernClefs(checked)} />}
                label="Modern clefs" />
            </FormGroup>
            <FormGroup>
              <FormControlLabel
                control={<Checkbox
                  checked={figuredBass}
                  onChange={(_, checked) => setFiguredBass(checked)} />}
                label="Figured bass" />
            </FormGroup>
            <FormGroup>
              <FormControlLabel
                control={<Checkbox
                  checked={cadences}
                  onChange={(_, checked) => setCadences(checked)} />}
                label="Cadences" />
            </FormGroup>
          </Stack>

          {prepared && 'error' in prepared && <Alert severity='error'>{prepared.error}</Alert>}
          {scoreSVG && <div id='score' ref={score} dangerouslySetInnerHTML={{ __html: scoreSVG }} />}

        </Paper>
      </Grid>
      <Grid xs={12} md={6}>
        <Paper style={{ position: 'relative' }} elevation={3}>
          <Typography sx={{ padding: 1 }}>
            <i style={{ color: 'black' }}>
              {touch
                ? 'Tap a note to highlight its counterparts in the facsimile/score.'
                : 'Hover over the notes to highlight their counterparts in the facsimile/score.'}
            </i>
          </Typography>

          {facsimile
            ? <div className='facsimile' ref={facsimileView} dangerouslySetInnerHTML={{ __html: facsimile }} />
            : <CircularProgress />}
        </Paper>
      </Grid>
    </Grid>
  )
}

export default Work

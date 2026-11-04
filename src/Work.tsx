import { Alert, Box, Checkbox, Container, FormControlLabel, Paper, Slider, Stack, Typography, useMediaQuery } from '@mui/material';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import './App.css'
import { draw, Noteheads, prepare, PreparedScore } from './renderer';
import { insertTenues, removeTenues } from './utils/tenues/dom';
import { addTenueInfo } from './utils/addTenueInfo';
import { changeVisibilities } from './utils/changeVisibilities';
import { modernizeClefs } from './utils/modernizeClefs';
import { cloneDocument, insertBeamedOrnaments, removeTiedNotes } from './utils/meiTransforms';
import { GlowDefs } from './GlowDefs';
import { highlightOnHover, highlightOnTap } from './utils/highlightCounterparts';
import { atRest, headsInSource, morph, unmorph } from './utils/sourceMorph';
import { crossfade, Snapshot, snapshot } from './utils/crossfade';

export const continuumLength = 300

/** Where the slider shows the measured reading; from here to its end the notes move into the order of the source. */
const measured = 150

/** How far a slider position has gone from the measured reading towards the reading order of the source. */
const continuumAt = (position: number) => Math.max(0, position - measured) / (continuumLength - measured)

/** The distance between two marks of the slider */
const step = 50

/** The step before the end of the continuum, which beams the ornaments and leaves out the notes tied over */
const semiMeasured = continuumLength - step

/** The last step, past the end of the continuum: the source itself, into which the notes travel */
const manuscript = continuumLength + step

/**
 * How long the view takes from one step to the next, in milliseconds, by the
 * lower of the two: the voices appear quickly, the notes take their time to
 * move, and longest to travel into the source.
 */
const stepDuration = (from: number) => (from >= continuumLength ? 2800 : from >= measured ? 900 : 500)

/**
 * The position of the slider the view shows: it follows the slider frame by
 * frame, at the pace of each step it passes through, or at once if `animate`
 * is false.
 */
const useShownPosition = (target: number, animate: boolean): number => {
  const [shown, setShown] = useState(target)
  const current = useRef(target)

  useEffect(() => {
    if (!animate) {
      current.current = target
      setShown(target)
      return
    }
    let frame = 0
    let last: number | undefined
    const advance = (now: number) => {
      const elapsed = last === undefined ? 0 : now - last
      last = now
      const at = current.current
      const up = target > at
      const from = up ? Math.floor(at / step) * step : Math.ceil(at / step) * step - step
      const way = (elapsed / stepDuration(from)) * step
      current.current = up ? Math.min(target, at + way) : Math.max(target, at - way)
      setShown(current.current)
      if (current.current !== target) frame = requestAnimationFrame(advance)
    }
    frame = requestAnimationFrame(advance)
    return () => cancelAnimationFrame(frame)
  }, [target, animate])

  return shown
}

/** The room left and right of the slider, in spacing units, into which the labels at its ends reach */
const sliderInset = { xs: 4, sm: 6 }

interface ViewOptions {
  readonly modernClefs: boolean
  /** the semi-measured view beams the ornaments and leaves out the notes tied over */
  readonly semiMeasured: boolean
  /** where the source writes the notes, for the page to be laid out like it */
  readonly source?: ReadonlyMap<string, { readonly x: number, readonly y: number }>
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
    return { score: prepare(doc, { source: options.source }) }
  }
  catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

interface WorkProps {
  id: string
}

const Work = ({ id }: WorkProps) => {
  const [meiDoc, setMeiDoc] = useState<Document>()

  // the facsimile of the source, laid into the score as its last step
  const [source, setSource] = useState<SVGSVGElement>()
  const [svgFile, setSVGFile] = useState<string>()

  const [modernClefs, setModernClefs] = useState(false)

  const [position, setPosition] = useState<number>(measured)

  const score = useRef<HTMLDivElement>(null)
  const ghost = useRef<HTMLDivElement>(null)

  // on a touch screen, a note is tapped rather than hovered over
  const touch = useMediaQuery('(hover: none)')

  const animate = !useMediaQuery('(prefers-reduced-motion: reduce)')
  const shown = useShownPosition(position, animate)

  useEffect(() => {
    if (!svgFile) return

    const loadFacsimile = async () => {
      const response = await fetch(import.meta.env.BASE_URL + '/' + svgFile)
      const facsimile = new DOMParser().parseFromString(await response.text(), 'image/svg+xml').documentElement
      setSource(facsimile instanceof SVGSVGElement ? facsimile : undefined)
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

  // Where the facsimile writes the notes linked to it, once it is there.
  const [sourceHeads, setSourceHeads] = useState<ReturnType<typeof headsInSource>>()
  useEffect(() => {
    if (!meiDoc || !source) return
    const links = Array.from(meiDoc.querySelectorAll('note[corresp]'))
      .map(note => [note.getAttribute('xml:id') ?? '', note.getAttribute('corresp') ?? ''] as const)
    setSourceHeads(headsInSource(source, links))
  }, [meiDoc, source])

  // Both readings are prepared at once, for the view to pass from one to the other without delay.
  const regular = useMemo(
    () => meiDoc && prepareView(meiDoc, { modernClefs, semiMeasured: false, source: sourceHeads }),
    [meiDoc, modernClefs, sourceHeads]
  )
  const semi = useMemo(
    () => meiDoc && prepareView(meiDoc, { modernClefs, semiMeasured: true, source: sourceHeads }),
    [meiDoc, modernClefs, sourceHeads]
  )

  // What the view shows, at `shown`: the semi-measured reading only where the slider rests on it;
  // after it, the staves closing up for the unmeasured noteheads, which are written from the end of
  // the continuum on; and from there the way into the source.
  const prepared = shown === semiMeasured ? semi : regular
  const t = continuumAt(Math.min(shown, continuumLength))
  const noteheads: Noteheads = shown >= continuumLength ? 'unmeasured' : 'notated'
  const unmeasuredSpacing = Math.min(1, Math.max(0, (shown - semiMeasured) / step))
  const intoSource = Math.min(1, Math.max(0, (shown - continuumLength) / step))

  const drawn = useRef<{
    readonly score: PreparedScore, readonly t: number, readonly noteheads: Noteheads, readonly unmeasuredSpacing: number
  }>()

  useLayoutEffect(() => {
    const host = score.current
    if (!host) return
    if (!prepared || 'error' in prepared) {
      host.replaceChildren()
      drawn.current = undefined
      return
    }
    // The score is drawn anew only where what is drawn changes, frame by frame
    // between the measured and the unmeasured view; the steps before only fade
    // voices in and out, the way into the source only moves what is drawn.
    let svg = host.querySelector('svg')
    const last = drawn.current
    let before: Snapshot | undefined
    if (!svg || !last || last.score !== prepared.score || last.t !== t || last.noteheads !== noteheads || last.unmeasuredSpacing !== unmeasuredSpacing) {
      // where the view changes what it draws, not only where, it passes from the one to the other
      const changesWhat = last !== undefined && (last.score !== prepared.score || last.noteheads !== noteheads)
      if (svg) {
        unmorph(svg)
        // (in the source, where the engraving is gone, there is nothing to pass between)
        if (animate && changesWhat && intoSource === 0) before = snapshot(svg)
        removeTenues(svg)
      }
      svg = draw(host, prepared.score, t, { noteheads, unmeasuredSpacing })
      drawn.current = { score: prepared.score, t, noteheads, unmeasuredSpacing }
    }

    changeVisibilities(svg, shown)
    if (before && ghost.current) crossfade(before, svg, ghost.current)
    if (source) morph(svg, source, intoSource)
  }, [prepared, t, noteheads, unmeasuredSpacing, shown, intoSource, source, animate])

  // Both the semi-measured and the unmeasured view draw tenues following the
  // practice of the Bauyn manuscript, once the view has come to rest. They are
  // fitted to the notes where they are engraved, even in the source.
  const resting = shown === position
  useEffect(() => {
    const svg = score.current?.querySelector('svg')
    if (!svg || !resting || shown <= measured + step) return
    const timer = setTimeout(() => atRest(svg, () => insertTenues(svg)), 100)
    return () => clearTimeout(timer)
  }, [resting, shown, prepared])

  // In the manuscript, the notes are linked to their traces:
  // by hovering with a mouse, by tapping on a touch screen.
  useLayoutEffect(() => {
    if (!score.current) return
    return (touch ? highlightOnTap : highlightOnHover)(score.current)
  }, [touch])

  const sourceName = meiDoc?.querySelector('source')?.textContent?.replace(/\s+/g, ' ').trim() || 'Manuscrit'

  useEffect(() => {
    // An aid for the editors, who work with a mouse: in the manuscript, a click
    // on a trace copies its id, to link it to a note. On a touch screen, a tap
    // is only to highlight a note, not to fill the clipboard.
    const view = score.current
    if (!view || touch) return

    const copyId = (event: MouseEvent) => {
      const trace = event.target
      if (trace instanceof SVGPathElement && trace.id && trace.closest('.source-scan')) {
        navigator.clipboard.writeText('#' + trace.id)
      }
    }
    view.addEventListener('click', copyId)
    return () => view.removeEventListener('click', copyId)
  }, [touch])

  // While the view moves, frame by frame, the controls stay as they are.
  const controls = useMemo(() => (
    <>
      <Box sx={{ px: sliderInset, pt: 1, pb: { xs: 2, sm: 1.5 } }}>
        <Slider
          min={0}
          max={manuscript}
          step={step}
          sx={{
            // Each label may take the room between two marks, and wraps where it needs more.
            // Centred on their marks, the labels at the ends must not reach beyond the inset.
            '& .MuiSlider-markLabel': {
              width: `calc(100% * ${step / manuscript})`,
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
              },
              {
                value: manuscript,
                label: <b>{sourceName}</b>
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
      <Stack direction='row' alignItems='center' justifyContent='space-between' flexWrap='wrap' columnGap={2} sx={{ px: 2 }}>
        <FormControlLabel
          control={<Checkbox
            checked={modernClefs}
            onChange={(_, checked) => setModernClefs(checked)} />}
          label="Modern clefs" />
        {/* kept in place where it is hidden, for the score not to move when it shows */}
        <Typography variant='body2' sx={{ fontStyle: 'italic', color: 'text.secondary', visibility: position === manuscript ? 'visible' : 'hidden' }}>
          {touch
            ? 'Tap a note of the manuscript to see how the edition reads it.'
            : 'Hover over a note of the manuscript to see how the edition reads it.'}
        </Typography>
      </Stack>
    </>
  ), [position, sourceName, modernClefs, touch])

  return (
    <Container maxWidth='md' disableGutters>
      <GlowDefs />
      <Paper elevation={3}>
        {controls}

        {prepared && 'error' in prepared && <Alert severity='error'>{prepared.error}</Alert>}
        <Box sx={{ position: 'relative' }}>
          {/* drawn by the effects above, not by React */}
          <div id='score' ref={score} />
          <div className='score-ghost' ref={ghost} />
        </Box>
      </Paper>
    </Container>
  )
}

export default Work

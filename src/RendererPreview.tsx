import { Alert, Box, Checkbox, CircularProgress, FormControlLabel, Paper, Slider, Stack, Typography } from '@mui/material'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { prepare, PreparedScore, render } from './renderer'
import { addTenueInfo } from './utils/addTenueInfo'
import { insertTenues, removeTenues } from './utils/tenues/dom'

type Loaded = { readonly score: PreparedScore } | { readonly error: string }

const load = async (id: string): Promise<Loaded> => {
    const response = await fetch(`${import.meta.env.BASE_URL}/${id}.mei`)
    const mei = new DOMParser().parseFromString(await response.text(), 'text/xml')
    addTenueInfo(mei)
    try {
        return { score: prepare(mei) }
    }
    catch (error) {
        return { error: error instanceof Error ? error.message : String(error) }
    }
}

/**
 * The new renderer on its own: the score anywhere between the measured
 * reading (0) and the reading order of the source (1).
 */
export const RendererPreview = () => {
    const { workId: id = '' } = useParams()
    const [loaded, setLoaded] = useState<Loaded>()
    const [t, setT] = useState(0)
    const [tenues, setTenues] = useState(false)
    const container = useRef<HTMLDivElement>(null)

    useEffect(() => {
        let current = true
        load(id).then(result => current && setLoaded(result))
        return () => { current = false }
    }, [id])

    const svg = useMemo(() => (loaded && 'score' in loaded ? render(loaded.score, t) : undefined), [loaded, t])

    useLayoutEffect(() => {
        const element = container.current?.querySelector('svg')
        if (!element) return
        if (tenues) insertTenues(element)
        else removeTenues(element)
    }, [svg, tenues])

    if (loaded === undefined) return <CircularProgress />
    if ('error' in loaded) return <Alert severity='error'>{loaded.error}</Alert>

    return (
        <Paper elevation={3} sx={{ p: 2 }}>
            <Stack direction='row' spacing={3} alignItems='center' sx={{ maxWidth: 900, mx: 'auto' }}>
                <Typography variant='body2'>Mesuré</Typography>
                <Slider
                    min={0}
                    max={1}
                    step={0.01}
                    value={t}
                    onChange={(_, value) => setT(Array.isArray(value) ? value[0] : value)}
                    aria-label='Position on the continuum'
                />
                <Typography variant='body2'>Non mesuré</Typography>
                <FormControlLabel
                    control={<Checkbox checked={tenues} onChange={(_, checked) => setTenues(checked)} />}
                    label='Tenues'
                />
            </Stack>
            <Box ref={container} id='renderer' dangerouslySetInnerHTML={{ __html: svg ?? '' }} />
        </Paper>
    )
}

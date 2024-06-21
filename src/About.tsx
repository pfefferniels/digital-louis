import { Box, Typography } from "@mui/material"

export const About = () => {
    return (
        <Box>
            <Typography variant='h5'>About</Typography>
            <Typography variant='body1'>
                How might a digital edition of Préludes non mesurés of Louis Couperin look like?
                How can it make visible the path from the underlying harmonic framework to the
                ornamental surface – and what potential arises from this?
            </Typography>

            <Typography variant='body1'>
                This prototype suggests an encoding based on the format of
                the <a href='https://music-encoding.org/'>Music Encoding Initiative (MEI)</a>.
                We first determine how – in the editors' understanding – notes can be
                grouped into chords and voices, and which notes can be interpreted as
                ornamental fillings of this structural framework. At the same time,
                an order of events is established – just as they appear in the original notation.
                Additionally, the original notation is recreated in a scalable vector graphic (SVG).
                Each note in the MEI encoding is linked to a corresponding path in the SVG,
                allowing the user to critically compare the encoded notes with the
                original notation.
            </Typography>

            <Typography variant='body1'>
                The viewer allows for seamless transition between structure
                (form, harmonic progressions) and unmeasured notation.
            </Typography>
        </Box>
    )
}
import { Box } from "@mui/material"
import Logo from "./Logo"

export const Header = () => {
    return (
        <Box sx={{
            display: 'flex',
            alignItems: 'flex-start',
            mx: { xs: 0, sm: 2 },
            my: 2,
            p: 2,
            borderRadius: '10px',
            background: 'rgba(255, 255, 255, 0.8)',
            boxShadow: '0 0 10px rgba(0, 0, 0, 0.1)'
        }}>
            <Box className="logo" sx={{
                flexShrink: 0,
                width: { xs: 126, sm: 186 },
                minHeight: { sm: 110 },
                pr: { xs: 1, sm: 0.5 },
                borderRight: '1px solid black',
                '& svg': { display: 'block', width: '100%', height: 'auto' }
            }}>
                <Logo />
            </Box>
            <Box sx={{
                fontFamily: 'sans-serif',
                fontSize: { xs: '1rem', sm: '1.2em' },
                lineHeight: 1.2,
                maxWidth: 200,
                ml: { xs: 1.5, sm: 2 },
                mt: { xs: 0.5, sm: 2 }
            }}>
                Digital Edition of the Préludes non mesurés of Louis Couperin
            </Box>
        </Box>
    )
}

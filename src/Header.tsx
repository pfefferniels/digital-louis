import Logo from "./Logo"

export const Header = () => {
    return (
        <div style={{
            margin: '1rem',
            borderRadius: '10px',
            padding: '1rem',
            background: 'rgba(255, 255, 255, 0.8)',
            boxShadow: '0 0 10px rgba(0, 0, 0, 0.1)'
        }}>
            <>
                <div style={{ height: '110px', position: 'sticky' }}>
                    <div className="logo" style={{ height: '110px', width: '190px', float: 'left', borderRight: '1px solid black' }}>
                        <Logo style={{ transform: "scale(0.4)", transformOrigin: 'top left' }} />
                    </div>
                    <div style={{ fontFamily: 'sans-serif', fontSize: '1.2em', height: '110px', width: '200px', float: 'left', marginLeft: '1rem', marginTop: '1rem', lineHeight: '1.2' }}>
                        Digital Edition of the Préludes non mesurés of Louis Couperin
                    </div>
                </div>

                <div
                    style={{
                        fontSize: '1.2em',
                        fontFamily: "sans-serif"
                    }}>
                </div>
            </>
        </div>
    )
}
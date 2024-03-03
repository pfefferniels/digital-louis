export const GlowDefs = () => {
    return (
        <svg width={0} height={0}>
            <defs>
                <filter id="purple-glow" x="-5000%" y="-5000%" width="10000%" height="10000%">
                    <feFlood result="flood" floodColor="darkred" floodOpacity="1"></feFlood>
                    <feComposite in="flood" result="mask" in2="SourceGraphic" operator="in"></feComposite>
                    <feMorphology in="mask" result="dilated" operator="dilate" radius="1"></feMorphology>
                    <feGaussianBlur in="dilated" result="blurred" stdDeviation="0.7"></feGaussianBlur>
                    <feMerge>
                        <feMergeNode in="blurred"></feMergeNode>
                        <feMergeNode in="SourceGraphic"></feMergeNode>
                    </feMerge>
                </filter>
            </defs>
        </svg>
    )
}

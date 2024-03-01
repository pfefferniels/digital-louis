/**
 * Modernizes the clefs of a given MEI document
 * @param mei MEI as DOM document
 */
export const modernizeClefs = (mei: Document) => {
    const rightHandClef = mei.querySelector('clef[shape="C"]')
    const leftHandClef = mei.querySelector('clef[shape="F"]')

    if (!rightHandClef || !leftHandClef) return

    rightHandClef.setAttribute('shape', 'G')
    rightHandClef.setAttribute('line', '2')
    leftHandClef.setAttribute('line', '4')
}


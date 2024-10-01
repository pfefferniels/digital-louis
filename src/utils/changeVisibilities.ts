// import { quadraticScale } from "./scales"

const positionMap = new Map([
    [0, 'papier'],
    [50, 'basse'],
    [100, 'basse-chant'],
    [150, 'mesure'],
    [200, 'jamais-daplomb'],
    [250, 'semi-mesure'],
    [300, 'non-mesure']
])

const visibilityMap = new Map<string, string[]>([
    [
        'papier', []
    ],
    [
        'basse', ['.bassus', '.not-semibreve', '.clef', '.stem', '.barLine']
    ],
    [
        'basse-chant', ['.bassus', '.cantus', '.not-semibreve', '.clef', '.stem', '.barLine']
    ],
    [
        'mesure', ['.clef', '.bassus', '.cantus', '.altus', '.tenor', '.quintus', '.sextus', '.barLine', '.stem', '.virtual', '.ledgerLines', '.beam polygon', '.dots', '.not-semibreve', '.tie']
    ],
    [
        'jamais-daplomb', ['.clef', '.bassus', '.cantus', '.altus', '.tenor', '.quintus', '.sextus', '.ornam', '.barLine', '.stem', '.ledgerLines', '.beam polygon', '.dots', '.not-semibreve', '.tie']
    ],
    [
        'semi-mesure', ['.clef', '.beam polygon', '.beam .stem', '.bassus', '.cantus', '.altus', '.tenor', '.quintus', '.sextus', '.ornam', '.shadow-semibreve']
    ],
    [
        'non-mesure', ['.clef', '.bassus', '.cantus', '.altus', '.tenor', '.quintus', '.sextus', '.ornam', '.shadow-semibreve']
    ]
])

const allSelectors = ['.mNum', '.cadence', '.clef', '.bassus', '.fb', '.cantus', '.altus', '.tenor', '.quintus', '.sextus', '.barLine', '.stem', '.virtual', '.ledgerLines', '.beam polygon', '.dots', '.not-semibreve', '.tie', '.ornam', '.shadow-semibreve']

/**
 * Changes visibilities based on the current position of the slider.
 * @param position 
 */
export const changeVisibilities = (position: number) => {
    const aspect = positionMap.get(position)
    if (aspect === undefined) return

    const selectors = visibilityMap.get(aspect)
    if (selectors === undefined) return

    const invisible = allSelectors.filter(selector => !selectors.includes(selector))
    document.querySelectorAll(invisible.join(',')).forEach(el => {
        el.setAttribute('opacity', '0')
    })

    selectors.forEach(selector => {
        document.querySelectorAll(selector).forEach(el => {
            el.setAttribute('opacity', '1')
        })
    })
}

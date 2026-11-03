/** The steps of the slider below the manuscript, by their position. */
const positionMap = new Map([
    [0, 'papier'],
    [50, 'basse'],
    [100, 'basse-chant'],
    [150, 'mesure'],
    [200, 'jamais-daplomb'],
    [250, 'semi-mesure'],
    [300, 'non-mesure']
])

const stepLength = 50
const lastStep = 300

/** What each step shows. The figured bass belongs to the harmonic framework, the cadences to the form. */
const visibilityMap = new Map<string, string[]>([
    [
        'papier', []
    ],
    [
        'basse', ['.bassus', '.clef', '.stem', '.barLine', '.cadence']
    ],
    [
        'basse-chant', ['.bassus', '.cantus', '.clef', '.stem', '.barLine', '.fb', '.cadence']
    ],
    [
        'mesure', ['.clef', '.bassus', '.cantus', '.altus', '.tenor', '.quintus', '.sextus', '.barLine', '.stem', '.virtual', '.ledgerLines', '.beam polygon', '.dots', '.tie', '.fb']
    ],
    [
        'jamais-daplomb', ['.clef', '.bassus', '.cantus', '.altus', '.tenor', '.quintus', '.sextus', '.ornam', '.barLine', '.stem', '.ledgerLines', '.beam polygon', '.dots', '.tie']
    ],
    [
        'semi-mesure', ['.clef', '.beam polygon', '.beam .stem', '.bassus', '.cantus', '.altus', '.tenor', '.quintus', '.sextus', '.ornam']
    ],
    [
        'non-mesure', ['.clef', '.bassus', '.cantus', '.altus', '.tenor', '.quintus', '.sextus', '.ornam']
    ]
])

const allSelectors = ['.mNum', '.cadence', '.clef', '.bassus', '.fb', '.cantus', '.altus', '.tenor', '.quintus', '.sextus', '.barLine', '.stem', '.virtual', '.ledgerLines', '.beam polygon', '.dots', '.tie', '.ornam']

/** Every selector a step decides on. */
const controlled = [...new Set([...allSelectors, ...[...visibilityMap.values()].flat()])].join(',')

/** What a step shows: whatever one of its selectors matches. */
const shownAt = (position: number): ((el: Element) => boolean) => {
    const selector = (visibilityMap.get(positionMap.get(position) ?? '') ?? []).join(',')
    return selector === '' ? () => false : el => el.matches(selector)
}

/**
 * Shows in the score `root` what the step of the slider at `position` shows,
 * and hides the rest. Between two steps, what only one of them shows is
 * faded in or out in proportion to the way from the one to the other.
 */
export const changeVisibilities = (root: Element, position: number) => {
    const at = Math.min(lastStep, Math.max(0, position))
    const before = Math.min(lastStep - stepLength, Math.floor(at / stepLength) * stepLength)
    const after = before + stepLength
    const way = (at - before) / stepLength

    // run for every frame of a transition: one query, and each element tested once for each step
    const [from, to] = [shownAt(before), shownAt(after)]
    root.querySelectorAll(controlled).forEach(el => {
        const opacity = (way < 1 && from(el) ? 1 - way : 0) + (way > 0 && to(el) ? way : 0)
        const value = opacity >= 1 ? '1' : opacity <= 0 ? '0' : opacity.toFixed(3)
        if (el.getAttribute('opacity') !== value) el.setAttribute('opacity', value)
    })
}

import { quadraticScale } from "./scales"

/**
 * Changes visibilities based on the current position of the slider.
 * @param position 
 */
export const changeVisibilities = (position: number) => {
    document.querySelectorAll('.mNum').forEach(el => el.setAttribute('opacity', '0'))

    document.querySelectorAll('.clef,.cadence').forEach(el => {
        el.setAttribute('opacity', `${quadraticScale(position, 5)}`)
    })
    document.querySelectorAll('.bassus, .fb').forEach(el => {
        el.setAttribute('opacity', `${quadraticScale(position, 30)}`)
    })
    document.querySelectorAll('.cantus, .barLine').forEach(el => {
        el.setAttribute('opacity', `${quadraticScale(position, 70)}`)
    })
    document.querySelectorAll('.altus, .quintus, .tenor, .sextus, .trill, .mordent, .ledgerLines, .tie').forEach(el => {
        el.setAttribute('opacity', `${quadraticScale(position, 150)}`)
    })
    document.querySelectorAll('.ornam').forEach(el => el.setAttribute('opacity', '0'))

    if (position >= 150) {
        // make barlines, stems etc. slowly disappear
        document.querySelectorAll('.barLine, .stem, .virtual, .trill, .mordent, .ledgerLines, .beam polygon, .dots, .not-semibreve, .fb, .cadence, .tie').forEach(el => {
            el.setAttribute('opacity', `${1 - quadraticScale(position - 150, 150)}`)
        })

        // make tied notes disappear too
        document
            .querySelectorAll('.tie[data-endid]')
            .forEach(tie => {
                const endId = tie.getAttribute('data-endid')
                console.log('making disappear', endId)
                if (!endId) return

                const secondNote = document.querySelector(`[data-id="${endId.slice(1)}"]`)
                if (!secondNote) return

                secondNote.setAttribute('opacity', `${1 - quadraticScale(position - 150, 150)}`)
            })

        // make ornamental notes appear quickly
        document.querySelectorAll('.ornam').forEach(semibreve =>
            semibreve.setAttribute('opacity', `${quadraticScale(position - 150, 20)}`)
        )

        // make semibreves slowly appear
        document.querySelectorAll('.shadow-semibreve').forEach(semibreve =>
            semibreve.setAttribute('opacity', `${quadraticScale(position - 150, 150)}`)
        )
    }
}

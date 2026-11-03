/**
 * Modernizes the clefs of a given MEI document, wherever they occur: the
 * soprano clef (C1) becomes the treble clef, the baritone clef (F3) the bass
 * clef. The pitches stay as they are; only where the notes stand changes.
 * @param mei MEI as DOM document
 */
export const modernizeClefs = (mei: Document) => {
  mei.querySelectorAll('clef[shape="C"][line="1"]').forEach(clef => {
    clef.setAttribute('shape', 'G')
    clef.setAttribute('line', '2')
  })
  mei.querySelectorAll('clef[shape="F"][line="3"]').forEach(clef => {
    clef.setAttribute('line', '4')
  })
}

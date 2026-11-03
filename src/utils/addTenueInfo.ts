/**
 * Links every note of a voice to the next one (@next): a tenue is held until
 * the next note of its voice takes over. Ornaments do not take over.
 * @param mei MEI as DOM document
 */
export const addTenueInfo = (mei: Document) => {
  const layerTypes = ['cantus', 'altus', 'tenor', 'quintus', 'sextus', 'bassus']
  layerTypes.forEach(layerType => {
    [...mei.querySelectorAll(`layer[type='${layerType}']`)]
      .map(layer => [...layer.querySelectorAll('note,rest')])
      .flat()
      .filter(note => !note.getAttribute('type')?.split(' ').includes('ornam'))
      .forEach((note, i, allNotes) => {
        if (i === allNotes.length - 1) return

        const nextName = allNotes[i + 1].getAttribute('xml:id')
        if (!nextName) return

        note.setAttribute('next', `#${nextName}`)
      })
  })
}

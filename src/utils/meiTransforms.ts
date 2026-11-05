/**
 * The changes the semi-measured view makes to an encoding before it is drawn.
 * They work on a copy: the encoding itself stays as it was loaded.
 */

const MEI = 'http://www.music-encoding.org/ns/mei'

export const cloneDocument = (doc: Document): Document =>
  new DOMParser().parseFromString(new XMLSerializer().serializeToString(doc), 'text/xml')

/** Puts `nodes` into `wrapper`, which takes the place of the first of them. */
const wrapAll = (nodes: readonly Element[], wrapper: Element) => {
  const [first] = nodes
  if (!first) return
  first.parentNode?.insertBefore(wrapper, first)
  nodes.forEach(node => wrapper.appendChild(node))
}

/** The second note of a tie is not struck again: it becomes the space it takes. */
export const removeTiedNotes = (meiDoc: Document) => {
  meiDoc.querySelectorAll('tie').forEach(tie => {
    const endId = tie.getAttribute('endid')
    if (!endId) return

    const endNote = meiDoc.querySelector(`note[*|id="${endId.slice(1)}"]`)
    const dur = endNote?.getAttribute('dur')
    if (!endNote || !dur) return

    const space = meiDoc.createElementNS(MEI, 'space')
    space.setAttribute('dur', dur)
    endNote.parentNode?.replaceChild(space, endNote)
    tie.remove()
  })
}

/**
 * Beams each run of ornamental notes read one after the other, as eighths,
 * as long as they stand side by side in one voice. Ornaments inside an
 * encoded beam are beamed already.
 */
export const insertBeamedOrnaments = (meiDoc: Document) => {
  const ornaments = Array.from(meiDoc.querySelectorAll('note[type="ornam"]'))
  const leadsTo = (note: Element, next: Element | undefined) =>
    next !== undefined && note.getAttribute('precedes') === `#${next.getAttribute('xml:id')}` &&
    note.parentNode === next.parentNode && note.nextElementSibling === next

  const runs = ornaments.reduce<Element[][]>((runs, note, i) => {
    const current = runs[runs.length - 1]
    if (current && leadsTo(ornaments[i - 1], note)) current.push(note)
    else runs.push([note])
    return runs
  }, [])

  runs
    .map(run => run.filter(note => !note.closest('beam')))
    .filter(run => run.length > 0)
    .forEach(run => {
      const beam = meiDoc.createElementNS(MEI, 'beam')
      beam.setAttribute('type', 'ornam-beam')
      wrapAll(run, beam)
      run.forEach(note => note.setAttribute('dur', '8'))
    })
}

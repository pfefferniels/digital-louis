import { VerovioToolkit } from 'verovio/esm';
import { shiftStemTo } from '../Work';

/**
 * Displaces notes in a verovio-rendered score
 * by a given amount. 
 * @param displacement 
 * @param toolkit the verovio toolkit. Used to find
 * score notes with the same onset time
´ */
export const displaceNotes = (displacement: number, toolkit: VerovioToolkit) => {
  let currentNotes = [document.querySelector(`.note[class*='entry']`)];
  if (!currentNotes.length || !currentNotes[0]) {
    console.log('no entry found');
    return;
  }

  document.querySelectorAll('[data-precedes]').forEach(el => el.removeAttribute('data-visited'));

  let nextNotes = currentNotes[0].getAttribute('data-precedes')?.split(' ').map(noteId => {
    return document.querySelector(`.note[data-id=${noteId.slice(1)}`);
  });
  if (!nextNotes || !nextNotes.length) {
    console.log('no next notes found');
  }

  let prevScoreTime = 0;
  let buffer: Element[] = [];
  while (currentNotes.length && nextNotes && nextNotes.length) {
    const currentNote = currentNotes[0];
    // console.log('current note=', currentNote)
    if (currentNote.hasAttribute('data-visited')) {
      console.log('Circular links detected.', currentNote.getAttribute('data-id'), 'has been used already.');
      break;
    }

    const currentNoteId = currentNotes[0]?.getAttribute('data-id');
    if (!currentNote || !currentNoteId || currentNote === nextNotes[0]) break;
    currentNote.setAttribute('data-visited', 'true');

    const scoreTime = currentNote.getAttribute('class')?.split(' ').indexOf('ornam') !== -1
      ? prevScoreTime
      : (toolkit.getTimesForElement(currentNoteId).scoreTimeOnset as unknown as number[])[0];
    if (scoreTime === prevScoreTime) {
      buffer.push(...(currentNotes.filter(note => note !== null) as Element[]));
    }
    else {
      // Process all the notes in the buffer.
      // Since not all at the same score time have the same horizontal
      // position, choose *one* x position (not a grace note) as a common starting point.
      const bufferWithoutGraceNotes = buffer.filter(note => note.getAttribute('class')?.split(' ').indexOf('ornam') === -1);
      const startX = +(bufferWithoutGraceNotes[0].querySelector('use')?.getAttribute('x') || 0);
      let availableSpace = 2500;
      // TODO: find a good way to calculate the available space
      if (buffer.length > 1) {
        const nextNonGraceNote = currentNotes.find(note => note && note.getAttribute('class')?.split(' ').indexOf('ornam') === -1);
        if (nextNonGraceNote) {
          const suggestion = +(nextNonGraceNote.querySelector('use')?.getAttribute('x') || 0) - startX;
          if (suggestion > 0) {
            availableSpace = suggestion;
          }
        }
      }
      const spacePerNote = availableSpace / buffer.length * (displacement / 150);
      buffer.forEach((note, i) => {
        const use = note.querySelector('use');
        if (!use) return;

        const myX = +(use.getAttribute('x') || 0);
        const startCompensation = startX - myX;

        const newX = (myX + startCompensation + i * spacePerNote).toString();
        use.setAttribute('x', newX);

        const accid = note.querySelector('.accid');
        accid?.querySelector('use')?.setAttribute('x', (+newX - 120).toString());

        const stem = note.querySelector('.stem path');
        if (stem) {
          shiftStemTo(stem, +newX);
        }
        note
          .querySelector('.shadow-semibreve')?.setAttribute('x', newX);
      });
      buffer = [];
      buffer.push(...(currentNotes.filter(note => note !== null) as Element[]));
    }
    prevScoreTime = scoreTime;

    currentNotes = nextNotes;
    if (!currentNotes[0]) break;

    nextNotes = currentNotes[0].getAttribute('data-precedes')?.split(' ').map(noteId => {
      return document.querySelector(`.note[data-id=${noteId.slice(1)}`);
    });
  }
};

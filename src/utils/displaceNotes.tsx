import { VerovioToolkit } from 'verovio/esm';
import { shiftStemTo } from '../Work';

const followNoteUntil = (note: Element, predicate: (el: Element) => boolean) => {
  let current = note;
  while (current) {
    if (predicate(current)) {
      return current;
    }
    const nextId = current.getAttribute('data-precedes');
    if (!nextId) {
      return null;
    }
    const next = document.querySelector(`.note[data-id=${nextId.slice(1)}`);
    if (!next) return null;
    current = next;
  }
  return null;
}

function findNextBarLine(currentNote: Element) {
  const barlines = currentNote.closest('.system')?.querySelectorAll('.barLine');
  const barline = barlines ? barlines[barlines.length - 1] : null;
  if (barline) {
    const barlinePath = barline.querySelector('path');
    if (barlinePath) {
      const bbox = barlinePath.getBBox();
      // console.log('barline at', bbox.x);
      return bbox.x;
    }
  }
  return 0;
}

const calculateAvailableSpace = (buffer: Element[], nextNotes: Element[], currentNote: Element, startX: number): number => {
  const defaultSpace = 2500

  console.log('calculating space for', buffer, 'using', nextNotes);

  if (buffer.length <= 1) {
    return defaultSpace;
  }

  if (nextNotes.length === 0) {
    // we might have reached the end of the piece.
    // Try to find the final barline, or, if not
    // available, use the default space.
    const nextBarLine = findNextBarLine(currentNote);
    return nextBarLine ? nextBarLine - startX : defaultSpace;
  }

  // Calculate the displacement suggestion for the next non-grace note
  const suggestion = +(nextNotes[0].querySelector('use')?.getAttribute('x') || 0) - startX;
  if (suggestion > 0) {
    return suggestion;
  }

  // use the final barline of the system
  const nextBarLine = findNextBarLine(currentNote);
  return nextBarLine ? nextBarLine - startX : defaultSpace;
}

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

    const scoreTime = calculateScoreTime(currentNote, toolkit) ?? prevScoreTime

    if (scoreTime === prevScoreTime) {
      buffer.push(...(currentNotes.filter(note => note !== null) as Element[]));
    }
    else {
      // Process all the notes in the buffer.
      processBuffer(buffer, currentNotes, currentNote, displacement);
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
}

function calculateScoreTime(currentNote: Element, toolkit: VerovioToolkit) {
  const currentNoteId = currentNote?.getAttribute('data-id');
  if (!currentNoteId) return null

  let scoreTime: number;
  if (isOrnam(currentNote)) {
    const nextNote = followNoteUntil(currentNote, el => !isOrnam(el));
    console.log('next note following ornam=', nextNote);

    if (!nextNote) {
      return null;
    }
    else {
      const times = toolkit.getTimesForElement(nextNote.getAttribute('data-id') || '').scoreTimeOnset as unknown as number[];
      scoreTime = times[0];
      console.log('new score time=', scoreTime);
    }
  } else {
    const times = toolkit.getTimesForElement(currentNoteId).scoreTimeOnset as unknown as number[];
    scoreTime = times[0];
    console.log('old score time', scoreTime);
  }
  return scoreTime;
}

function isOrnam(currentNote: Element) {
  return currentNote.getAttribute('class')?.split(' ').includes('ornam');
}

function processBuffer(buffer: Element[], currentNotes: (Element | null)[], currentNote: Element, displacement: number) {
  // Since not all at the same score time have the same horizontal
  // position, choose *one* x position as a common starting point.
  const startX = buffer
    .map(note => +(note.querySelector('use')?.getAttribute('x') ?? 0))
    .find(x => x !== 0) ?? 0;

  const availableSpace = calculateAvailableSpace(
    buffer,
    currentNotes as Element[],
    currentNote,
    startX
  );

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
  })
}

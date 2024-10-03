import { VerovioToolkit } from 'verovio/esm';
import { shiftStemTo } from '../Work';


function redoBeams() {
  const beams = document.querySelectorAll('.beam');
  for (const beam of beams) {
    // get the x's of the first and the last stem
    const stems = beam.querySelectorAll('.note .stem path');
    if (stems.length <= 1) continue;

    const stem1 = stems[0];
    const stem2 = stems[stems.length - 1];

    const x1 = stem1.getAttribute('d')?.split(' ')[0].slice(1);
    const x2 = stem2.getAttribute('d')?.split(' ')[0].slice(1);
    // console.log('beam from', x1, 'to', x2)
    const polygon = beam.querySelector('polygon');
    const points = polygon?.getAttribute('points');
    if (!points) continue;

    const pointArr = points.split(' ').map(p => p.split(','));
    polygon?.setAttribute('points', `${x1},${pointArr[0][1]} ${x2},${pointArr[1][1]} ${x2},${pointArr[2][1]} ${x1},${pointArr[3][1]}`);
  }
}

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
  if (!toolkit) {
    console.log('Toolkit not ready yet')
    return
  }

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

  redoBeams()
}

function calculateScoreTime(currentNote: Element, toolkit: VerovioToolkit) {
  const getScoreOnsetTime = (noteId: string) => {
    const times = toolkit.getTimesForElement(noteId).scoreTimeOnset as unknown as number[];
    if (!times) return null;
    return times[0];
  }

  const currentNoteId = currentNote?.getAttribute('data-id');
  if (!currentNoteId) return null

  if (isOrnam(currentNote)) {
    const nextNote = followNoteUntil(currentNote, el => !isOrnam(el));

    if (!nextNote) {
      return null;
    }
    else {
      return getScoreOnsetTime(nextNote.getAttribute('data-id') || '')
    }
  }

  return getScoreOnsetTime(currentNoteId)
}

function isOrnam(currentNote: Element) {
  return currentNote.getAttribute('class')?.split(' ').includes('ornam');
}

function processBuffer(buffer: Element[], nextNotes: (Element | null)[], currentNote: Element, displacement: number) {
  // Since not all at the same score time have the same horizontal
  // position, choose *one* x position as a common starting point.
  const startX = buffer
    .map(note => +(note.querySelector('use')?.getAttribute('x') ?? 0))
    .find(x => x !== 0) ?? 0;

  let availableSpace = calculateAvailableSpace(
    buffer,
    nextNotes as Element[],
    currentNote,
    startX
  );

  const notesWithAccid = buffer.filter(note => note.querySelector('.accid') !== null);
  const spacePerAccid = 160;

  if (notesWithAccid.length) {
    availableSpace -= notesWithAccid.length * spacePerAccid;
  }

  const spacePerNote = Math.max(200, availableSpace / buffer.length * (displacement / 150));

  let accidCount = 0;
  buffer.forEach((note, i) => {
    const use = note.querySelector('use');
    if (!use) return;

    const myX = +(use.getAttribute('x') || 0);
    const startCompensation = startX - myX;

    if (note.querySelector('.accid')) {
      accidCount += 1;
    }
    const space = i * spacePerNote + accidCount * spacePerAccid;

    const newX = (myX + startCompensation + space).toString();
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

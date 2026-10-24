// What the start screen offers, and whether it opens with Aftertake.
export type StartTask =
  'effects' | 'video' | 'image' | 'region' | 'person' | 'camera' | 'motion' | 'finish' | 'film';

/**
 * Task-first entry points; previews are cut from real outputs (scripts/build-start-previews.py,
 * and scripts/build-one-tap-previews.py for the effects card).
 */
export const startTasks: { id: StartTask; title: string; line: string }[] = [
  {
    id: 'effects',
    title: 'One-tap effects',
    line: 'One photo in, a vertical clip to share out.',
  },
  { id: 'video', title: 'Make a video', line: 'From a sentence, with sound if you want it.' },
  { id: 'image', title: 'Make an image', line: 'From a sentence, or from a product starter.' },
  {
    id: 'region',
    title: 'Change part of a shot',
    line: 'Paint where, say what. The rest stays yours.',
  },
  {
    id: 'person',
    title: 'Recast or copy a person',
    line: 'Track someone, then replace, copy or echo them.',
  },
  { id: 'camera', title: 'Move the camera', line: 'Pull back, push in or orbit from one still.' },
  { id: 'motion', title: 'Put a move on a character', line: 'Their gesture, your character.' },
  { id: 'finish', title: 'Color and finish', line: 'Looks, grades, and hiding names or keys.' },
  { id: 'film', title: 'Cut a film', line: 'Titles, transitions, cut to the beat.' },
];

const START_KEY = 'aftertake-start';
/** The start screen opens with Aftertake unless the viewer chose their workspace instead. */
export function startScreenWanted() {
  try {
    return localStorage.getItem(START_KEY) !== 'workspace';
  } catch {
    return true;
  }
}
export function rememberStartScreen(show: boolean) {
  try {
    if (show) localStorage.removeItem(START_KEY);
    else localStorage.setItem(START_KEY, 'workspace');
  } catch {
    // Storage can be unavailable (private windows); the choice then lasts this visit.
  }
}

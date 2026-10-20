// The Aftertake competition film, authored as native Film projects on a beat grid.
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILM = path.resolve(HERE, '..');
const R = path.resolve(FILM, '..');
// prepare.py writes the music, its beats, plates and the new CPU renders here.
const WORK = process.env.AFTERTAKE_FILM_WORK || path.join(FILM, 'work');
const RECORDINGS = path.join(FILM, 'recordings');
// music.json names the soundtrack, its beat analysis and the downbeat the logo
// lands on; the edit counts beats from that drop, so any steady track can drive it.
export const music = JSON.parse(readFileSync(`${WORK}/music.json`, 'utf8'));
const allBeats = JSON.parse(readFileSync(`${WORK}/${music.beats}`, 'utf8')).beats;
const drop = allBeats.reduce((best, time, index) =>
  Math.abs(time - music.dropTime) < Math.abs(allBeats[best] - music.dropTime) ? index : best, 0);
const period = allBeats.slice(1).map((time, index) => time - allBeats[index]).sort((a, b) => a - b)[Math.floor((allBeats.length - 1) / 2)];
/** Song seconds of any beat index, extrapolated before the first and after the last. */
const songBeat = (index) =>
  index < 0 ? allBeats[0] + index * period
    : index >= allBeats.length ? allBeats.at(-1) + (index - allBeats.length + 1) * period : allBeats[index];
/** The film opens 21 beats before the drop; the song is shifted to match. */
const INTRO = 21;
const shift = -songBeat(drop - INTRO);
/** Where the music sits on the film clock (start / source trim), for the master. */
export const placement = { start: Math.max(0, shift), sourceStart: Math.max(0, -shift) };
/** Film seconds of beat k, counted from the drop (k = 0). */
export const T = (k) => {
  const whole = Math.floor(k), part = k - whole;
  const a = songBeat(drop + whole) + shift;
  return part ? a + (songBeat(drop + whole + 1) + shift - a) * part : a;
};
export const F = (seconds) => Math.round(seconds * 24);

export const LIME = '#d5eb94', CREAM = '#f3f1e9', INK = '#121713', HOT = '#ff6b3d', PINK = '#ff4fa3', DIM = '#8c9a88';

export const files = {
  music: `${WORK}/${music.file}`,
  black: `${WORK}/plate-black.png`,
  graph: `${WORK}/graph-portal.png`,
  dark: `${WORK}/plate-dark.png`,
  logo: `${WORK}/logo-dark.png`,
  // HD source plates and their 720p examples (examples/hd-examples-v2.md).
  heroSrc: `${R}/source-plates-v2/hero-walk/source.mp4`, dancerSrc: `${R}/source-plates-v2/dancer/source.mp4`,
  loftSrc: `${R}/portal-v2/source.mp4`, portal: `${R}/portal-v2/result.mp4`, refPortal: `${R}/reference-portal/result.mp4`,
  fallsSrc: `${R}/golden-falls/source.mp4`, falls: `${R}/golden-falls/result.mp4`, crystal: `${R}/crystal-forest/result.mp4`,
  crystalMove: `${R}/crystal-transition/result.mp4`,
  castle: `${R}/castle-pullback-v2/result.mp4`, coastalSrc: `${R}/coastal-kingdom/source.mp4`, coastal: `${R}/coastal-kingdom/result.mp4`,
  observatory: `${R}/observatory/result.mp4`, observatoryStill: `${R}/observatory/source.png`,
  reclaimed: `${R}/reclaimed/result.mp4`, winterSrc: `${R}/winter-valley/source.mp4`, winter: `${R}/winter-valley/result.mp4`,
  robot: `${R}/signal-v2/source.mp4`, teddy: `${R}/signal-v2/result.mp4`,
  perfume: `${R}/text-video/square/result.mp4`, perfumeTall: `${R}/text-video/portrait/result.mp4`,
  headphones: `${R}/agent-generation/take.mp4`,
  bridgeSrc: `${R}/character-h3-high-v2/before-720p.mp4`, bridgeMask: `${R}/character-h3-high-v2/selection-preview.mp4`,
  bridge: `${R}/character-h3-high-v2/result.mp4`,
  dancer: `${R}/subject-duplicates-v2/before-720p.mp4`, ensemble: `${WORK}/ensemble.mp4`, echoes: `${WORK}/echoes.mp4`,
  warm: `${WORK}/castle-warm.mp4`, cool: `${WORK}/castle-cool.mp4`, noir: `${WORK}/castle-noir.mp4`,
  vintage: `${WORK}/castle-vintage.mp4`,
  depthSrc: `${R}/depth-effects-v2/source.png`, depthMap: `${R}/depth-effects-v2/depth.png`, depth: `${R}/depth-effects-v2/result.png`,
  layers: `${R}/layer-stack/result.png`,
  guided: `${R}/guided-pullback/result.mp4`, quiet: `${R}/quiet-approach/result.mp4`,
  agentAd: `${R}/agent-edit/result.mp4`,
  uiPaint: `${RECORDINGS}/u1-paint.mp4`, uiCompare: `${RECORDINGS}/u2-compare.mp4`, uiVideo: `${RECORDINGS}/u3-video.mp4`,
  uiImage: `${RECORDINGS}/u4-image.mp4`, uiFinish: `${RECORDINGS}/u6-finish.mp4`,
  uiFilm: `${RECORDINGS}/u7-film.mp4`,
};

const cover = { zoom: 1, endZoom: 1, x: 0.5, y: 0.5, fit: 'cover' };
const push = (from = 1, to = 1.12, x = 0.5, y = 0.5) => ({ zoom: from, endZoom: to, x, y, fit: 'cover' });
const ui = (x, y, from, to) => ({ zoom: from, endZoom: to, x, y });

/**
 * A scene: shots between beats a..b with optional styled transitions centred on
 * their starting beat, titles and graphics on beat times. Times are scene-local.
 */
export function scene(name, a, b, build) {
  const shots = [], titles = [], graphics = [];
  const local = (k) => T(k) - T(a);
  const api = {
    shot(key, from, to, options = {}) { shots.push({ key, from, to, ...options }); },
    title(text, from, to, options = {}) {
      titles.push({ id: randomUUID(), text, start: local(from) + (options.delay || 0), end: local(to) - (options.early || 0),
        style: 'headline', position: 'center', animation: 'slam', color: CREAM, ...strip(options) });
    },
    graphic(spec, from, to) { graphics.push({ id: randomUUID(), start: local(from), end: local(to), ...spec }); },
    local,
  };
  build(api);
  return { name, a, b, shots, titles, graphics };
}
const strip = ({ delay, early, ...rest }) => rest;

/** Resolve beat-indexed shots into Film shots whose transition midpoints sit on beats. */
export function resolveShots(sc, assets, durations) {
  const out = [];
  const startFrame = F(T(sc.a));
  sc.shots.forEach((shot, index) => {
    const overlap = index ? F(shot.dissolve || 0) : 0;
    const nextOverlap = index + 1 < sc.shots.length ? F(sc.shots[index + 1].dissolve || 0) : 0;
    const first = F(T(shot.from)) - startFrame - overlap / 2;
    const last = F(T(shot.to)) - startFrame + nextOverlap / 2;
    const count = last - first;
    const source = shot.in || 0;
    const end = source + count / 24;
    const available = durations[shot.key];
    if (end > available + 1e-6) throw Error(`${sc.name}: ${shot.key} needs ${end.toFixed(3)}s, has ${available}`);
    if (overlap % 2 || nextOverlap % 2) throw Error(`${sc.name}: use even overlap frames`);
    out.push({
      assetId: assets[shot.key].id, start: source, end,
      ...(index && shot.dissolve ? { dissolve: overlap / 24 } : {}),
      ...(shot.transition && shot.transition !== 'dissolve' ? { transition: shot.transition } : {}),
      ...(shot.framing ? { framing: shot.framing } : {}),
    });
  });
  return out;
}

function still(x, y) {
  return { keys: [{ at: 0, x, y, scale: 1, opacity: 1 }, { at: 1, x, y, scale: 1, opacity: 1 }] };
}
function pop() {
  return { keys: [{ at: 0, x: 0, y: 0, scale: 0.2, opacity: 0 }, { at: 0.04, x: 0, y: 0, scale: 1.08, opacity: 1, easing: 'ease-out' },
    { at: 0.07, x: 0, y: 0, scale: 1, opacity: 1, easing: 'ease-in-out' }, { at: 1, x: 0, y: 0, scale: 1, opacity: 1 }] };
}
function popTitle(x, y) {
  return { keys: [{ at: 0, x, y, scale: 0.2, opacity: 0 }, { at: 0.05, x, y, scale: 1.08, opacity: 1, easing: 'ease-out' },
    { at: 0.09, x, y, scale: 1, opacity: 1, easing: 'ease-in-out' }, { at: 1, x, y, scale: 1, opacity: 1 }] };
}

// Captions over footage sit on Film's dark caption panel so they read over bright shots.
const kicker = (options = {}) => ({ style: 'caption', position: 'bottom', align: 'left', font: 'mono', animation: 'scramble', fontSize: 28, color: LIME, ...options });
const big = (options = {}) => ({ font: 'display', fontSize: 120, ...options });

/** Normalize authoring shorthands to the native Film graphic schema. */
export function nativeGraphic(spec, assets) {
  const { fill, stroke, assetKey, kind, ...rest } = spec;
  const motion = rest.motion ? { keys: rest.motion.keys.map((key) => ({ rotation: 0, ...key })) } : undefined;
  return {
    ...rest, name: rest.name || (assetKey || kind),
    kind: kind === 'rectangle' ? 'rect' : kind,
    color: fill || '#ffffff',
    ...(stroke ? { strokeColor: stroke } : {}),
    ...(assetKey ? { assetId: assets[assetKey].id } : {}),
    ...(motion ? { motion } : {}),
  };
}
export function nativeTitle(title) {
  return title.motion ? { ...title, motion: { keys: title.motion.keys.map((key) => ({ rotation: 0, ...key })) } } : title;
}

const D = 0.25; // six-frame transitions

// Big titles quote the line being sung, on the beats where Whisper's word
// timestamps put it (aftertake-song.words.json, and .vocals.words.json from
// the isolated vocal).
export const scenes = [
  // 1 · Cold open over the whispered intro: real sources, then the promise.
  scene('01 Every shot ends', -21, 0, ({ shot, title }) => {
    shot('black', -21, -16);
    title('EVERY SHOT', -18.2, -17.1, { animation: 'pop', font: 'display', fontSize: 120, motionDuration: 0.35, early: 0.02 });
    title('ENDS.', -17.1, -13, { animation: 'glitch', font: 'display', fontSize: 150 });
    shot('heroSrc', -16, -13, { in: 0.5, framing: push(1, 1.08), dissolve: D });
    shot('dancerSrc', -13, -10, { in: 1.0, framing: push(1.04, 1.12), dissolve: D });
    shot('loftSrc', -10, -6, { in: 0.5, framing: push(1.06, 1.14, 0.5, 0.45), dissolve: D });
    title('YOUR FOOTAGE · ONE TAKE', -15.6, -9.8, { style: 'caption', position: 'bottom', align: 'left', font: 'mono', animation: 'scramble', fontSize: 32, color: LIME });
    shot('black', -6, 0);
    title('THEN COMES THE', -9.5, 0, { animation: 'pop', font: 'display', fontSize: 104, motionDuration: 1.1, early: 0.04 });
  }),
  // 2 · The drop: the logo, then generated results on every beat.
  scene('02 Aftertake', 0, 16, ({ shot, title, graphic }) => {
    shot('black', 0, 2);
    graphic({ kind: 'image', assetKey: 'logo', x: 0.5, y: 0.47, width: 0.66, height: 0.2, fit: 'contain', opacity: 1,
      motion: { keys: [{ at: 0, x: 0, y: 0, scale: 2.6, opacity: 0 }, { at: 0.1, x: 0, y: 0, scale: 1, opacity: 1, easing: 'ease-in' },
        { at: 0.16, x: 0.004, y: -0.003, scale: 1, opacity: 1 }, { at: 0.22, x: 0, y: 0, scale: 1, opacity: 1 }, { at: 1, x: 0, y: 0, scale: 1.05, opacity: 1 }] } }, 0, 2);
    title('make the next take.', 0.4, 2, { style: 'kicker', position: 'bottom', font: 'mono', animation: 'scramble', fontSize: 34, color: LIME, stroke: false, early: 0.02 });
    shot('portal', 2, 4, { in: 1.4, framing: push(1.08, 1.0), dissolve: D, transition: 'flash' });
    const rapid = [['crystal', 1.4], ['falls', 1.2], ['castle', 1.0], ['winter', 1.6], ['reclaimed', 1.4], ['observatory', 0.8], ['perfume', 0.5], ['teddy', 0.8]];
    rapid.forEach(([key, start], index) => shot(key, 4 + index, 5 + index, { in: start, framing: push(1.02, 1.1),
      ...(index % 3 === 1 ? { dissolve: D, transition: index % 2 ? 'whip' : 'glitch' } : {}) }));
    title('EVERY FRAME HERE WAS MADE IN AFTERTAKE', 4.1, 11.9, { style: 'caption', position: 'bottom', align: 'left', font: 'mono', animation: 'scramble', fontSize: 30, color: LIME });
    shot('ensemble', 12, 16, { in: 0.4, framing: push(1.0, 1.06), dissolve: D, transition: 'flash' });
    title('ANY SCENE.', 12, 13, { font: 'display', fontSize: 120, color: CREAM, box: 'highlight', tilt: -2, early: 0.02 });
    title('ANY CAST.', 13, 14, { font: 'display', fontSize: 120, color: LIME, box: 'highlight', tilt: 3, early: 0.02 });
    title('ANY CUT.', 14, 16, { font: 'display', fontSize: 132, box: 'highlight', tilt: -4, stroke: false });
  }),
  // 3 · “Paint it, change it, make it new. Same scene, a different view.”
  scene('03 Paint it', 16, 32, ({ shot, title }) => {
    shot('uiPaint', 16, 20, { in: 1.9, framing: ui(0.47, 0.52, 1.75, 1.9) });
    title('PAINT IT.', 17.7, 18.7, big({ position: 'top', box: 'stamp', tilt: -4, color: LIME, fontSize: 96, early: 0.02 }));
    title('CHANGE IT.', 18.7, 19.7, big({ position: 'top', fontSize: 96, animation: 'pop', motionDuration: 0.35, early: 0.02 }));
    title('MAKE IT NEW.', 19.7, 22, big({ position: 'top', fontSize: 96, box: 'highlight', tilt: -3, color: LIME, early: 0.05 }));
    shot('uiCompare', 20, 24, { in: 2.1, framing: ui(0.47, 0.52, 1.55, 1.62) });
    title('LOCAL LTX-2.5 · ONLY THE PAINTED REGION CHANGES', 20.2, 23.9, kicker());
    shot('loftSrc', 24, 27, { in: 0.4, framing: push(1.0, 1.04) });
    title('SAME SCENE.', 24.9, 27.3, big({ fontSize: 124, early: 0.02 }));
    shot('portal', 27, 29, { in: 2.16, framing: push(1.04, 1.06), dissolve: D, transition: 'flash' });
    title('A DIFFERENT VIEW.', 27.4, 29.6, big({ fontSize: 104, box: 'highlight', tilt: -3, early: 0.04 }));
    shot('fallsSrc', 29, 30, { in: 1.0, framing: push(1.02, 1.06) });
    shot('falls', 30, 32, { in: 1.2, framing: push(1.02, 1.1), dissolve: D, transition: 'whip' });
    title('SAME SOURCE · A NEW TAKE', 29.8, 31.9, kicker());
  }),
  // 4 · “Open weights on your own machine.” The real graph, the SDK call
  // that submits it, the job that ran, and the stack around it.
  scene('04 How it is built', 32, 48, ({ shot, title, graphic }) => {
    shot('graph', 32, 38, { framing: push(1.0, 1.1, 0.42, 0.5) });
    title('HOW IT’S BUILT', 32, 38, { position: 'top', font: 'display', fontSize: 84, animation: 'reveal', early: 0.05 });
    title('THE WINDOW REPAINT’S EXECUTED GRAPH · 50 NODES · 10 AFTERTAKE NODES', 32.2, 35.4, kicker({ fontSize: 24 }));
    title('LTX-2.5 · OPEN WEIGHTS · ON YOUR OWN MACHINE', 35.5, 37.9, kicker({ fontSize: 24 }));
    shot('dark', 38, 44);
    title('POWERED BY THE COMFY SDK', 38, 44, big({ position: 'top', fontSize: 52, animation: 'reveal', early: 0.05 }));
    const code = [
      ['server/sdk-worker.mjs', 38.3, DIM],
      ["import { Comfy } from '@comfyorg/sdk'", 38.8, CREAM],
      ['client = new Comfy({ timeoutMs })', 39.5, CREAM],
      ['workflow = client.workflows.fromJson(graph)', 40.2, CREAM],
      ['job = await client.submit(workflow, { idempotencyKey })', 41.2, CREAM],
      ['→ job f402b3b2 · 50 nodes · ComfyUI ran it in 203 s', 42.4, LIME],
    ];
    code.forEach(([text, from, color], index) => title(text, from, 44, { style: 'caption', font: 'mono', fontSize: 30, animation: 'typewriter', motionDuration: 0.5,
      align: 'left', color, stroke: false, motion: still(0, -0.16 + index * 0.075), early: 0.05 }));
    title('OPEN WEIGHTS · YOUR GPU · MIT', 44, 48, { position: 'top', font: 'mono', style: 'kicker', animation: 'scramble', fontSize: 24, color: LIME, stroke: false,
      motion: still(0, 0.1), early: 0.1 });
    shot('dark', 44, 48);
    const box = (x, label, sub, from) => {
      graphic({ kind: 'rectangle', x, y: 0.43, width: 0.24, height: 0.17, fill: INK, fillOpacity: 0.96, stroke: LIME, strokeWidth: 3, radius: 0.012, opacity: 1,
        motion: pop() }, from, 48);
      title(`${label}\n${sub}`, from, 48, { font: 'display', fontSize: 34, animation: 'pop', motionDuration: 0.3, stroke: false, color: CREAM,
        motion: still(x - 0.5, -0.07), early: 0.1 });
    };
    box(0.18, 'AFTERTAKE', 'studio + agents', 44);
    box(0.5, 'COMFY SDK', '@comfyorg/sdk', 44.5);
    box(0.82, 'YOUR COMFYUI', 'local GPU', 45);
    for (const [x, from] of [[0.34, 44.3], [0.66, 44.8]])
      graphic({ kind: 'rectangle', x, y: 0.43, width: 0.08, height: 0.008, fill: LIME, fillOpacity: 1, strokeWidth: 0, opacity: 1,
        motion: { keys: [{ at: 0, x: 0, y: 0, scale: 1, scaleX: 0.02, opacity: 1 }, { at: 0.1, x: 0, y: 0, scale: 1, scaleX: 1, opacity: 1, easing: 'ease-out' }, { at: 1, x: 0, y: 0, scale: 1, scaleX: 1, opacity: 1 }] } }, from, 48);
    const models = ['Z-IMAGE', 'QWEN EDIT', 'LTX-2.5', 'WAN 2', 'MINIMAX H3', 'SAM 3', 'DA3', 'KOKORO'];
    models.forEach((model, index) => {
      const x = 0.12 + index * 0.108, from = 45.5 + index * 0.25;
      graphic({ kind: 'rectangle', x, y: 0.7, width: 0.098, height: 0.075, fill: LIME, fillOpacity: 1, strokeWidth: 0, radius: 0.01, opacity: 1, motion: pop() }, from, 48);
      title(model, from, 48, { font: 'mono', style: 'kicker', fontSize: 19, animation: 'none', stroke: false, color: INK, fontWeight: 700, motion: popTitle(x - 0.5, 0.2), early: 0.1 });
    });
  }),
  // 5 · “Recast the lead, keep the move. Five more dancers in the groove.
  // Words to video, still to light. Pull the camera, cut it right.”
  scene('05 Change', 48, 69, ({ shot, title }) => {
    shot('bridgeSrc', 48, 50, { in: 0.3, framing: cover });
    title('TRACK ONE PERSON.', 48, 50, kicker({ position: 'top', fontSize: 30 }));
    shot('bridgeMask', 50, 52, { in: 0.3, framing: cover });
    title('SAM 3 · EVERY FRAME', 50, 52, kicker({ position: 'top', fontSize: 30 }));
    shot('bridge', 52, 56, { in: 0.2, framing: cover, dissolve: D, transition: 'glitch' });
    title('RECAST THE LEAD.', 53.2, 55.3, big({ fontSize: 112, box: 'highlight', tilt: -3, early: 0.02 }));
    title('MINIMAX H3 · LOCAL · SAME PERFORMANCE', 52.2, 55.9, kicker());
    shot('bridgeSrc', 56, 57, { in: 2.0, framing: cover });
    title('KEEP THE MOVE.', 55.3, 57, big({ fontSize: 112, color: LIME, animation: 'pop', motionDuration: 0.35, early: 0.02 }));
    title('BEFORE', 56, 57, kicker({ position: 'top', fontSize: 30, color: CREAM, early: 0.02 }));
    shot('dancer', 57, 58, { in: 0.2, framing: push(1.0, 1.04), dissolve: D, transition: 'flash' });
    shot('ensemble', 58, 61, { in: 0.8, framing: push(1.0, 1.04) });
    title('FIVE MORE DANCERS', 57, 59.5, big({ position: 'top', fontSize: 96, color: INK, stroke: false, early: 0.02 }));
    title('IN THE GROOVE.', 59.5, 61, big({ position: 'top', fontSize: 104, animation: 'glitch', color: PINK, early: 0.02 }));
    title('SUBJECT COPIES · ORIGINAL PIXELS · CPU', 57.2, 60.9, kicker());
    shot('uiVideo', 61, 62, { in: 0.9, framing: ui(0.82, 0.42, 1.45, 1.52), dissolve: D, transition: 'flash' });
    shot('perfumeTall', 62, 63, { in: 0.4, framing: push(1.0, 1.06, 0.5, 0.5) });
    title('WORDS TO VIDEO.', 61.5, 63.5, big({ position: 'bottom', align: 'left', animation: 'reveal', fontSize: 96, early: 0.02 }));
    shot('observatoryStill', 63, 64, { framing: push(1.0, 1.02) });
    shot('observatory', 64, 65, { in: 0, framing: push(1.0, 1.04) });
    title('STILL TO LIGHT.', 63.5, 65, big({ position: 'bottom', align: 'left', fontSize: 96, color: LIME, early: 0.02 }));
    title('LTX-2.5 · TEXT → VIDEO · IMAGE → VIDEO', 61.2, 64.9, kicker({ position: 'top' }));
    shot('castle', 65, 67, { in: 1.2, framing: push(1.0, 1.0), dissolve: D, transition: 'flash' });
    title('PULL THE CAMERA.', 65.1, 67.5, big({ fontSize: 104, box: 'highlight', tilt: -3, early: 0.02 }));
    shot('guided', 67, 69, { in: 1.6, framing: push(1.0, 1.0), dissolve: D, transition: 'whip' });
    title('CUT IT RIGHT.', 67.5, 69, big({ fontSize: 112, color: LIME, animation: 'pop', motionDuration: 0.35, early: 0.02 }));
    title('ONE STILL · PULL BACK · PUSH IN · ORBIT', 65.2, 68.9, kicker());
  }),
  // 6 · “An agent cuts it, frame by frame. Forty-four tools, still the same.
  // On the beat, on the beat, cut to the beat.”
  scene('06 Agents and Film', 69, 84, ({ shot, title }) => {
    shot('dark', 69, 73);
    title('AN AGENT CUTS IT,', 69.3, 71.5, big({ position: 'top', fontSize: 64, animation: 'reveal', early: 0.02 }));
    title('FRAME BY FRAME.', 71.5, 73, big({ position: 'top', fontSize: 64, color: LIME, animation: 'pop', motionDuration: 0.35, early: 0.02 }));
    const lines = [
      ['› aftertake_detect_beats      102 BPM in 0.9 s', 69.6],
      ['› aftertake_save_film_edit    aftertake-film/5', 70.4],
      ['› aftertake_export_plan       native render', 71.2],
      ['› aftertake_review_film       decoded frames', 72.0],
    ];
    lines.forEach(([text, from], index) => title(text, from, 73, { style: 'caption', font: 'mono', fontSize: 34, animation: 'typewriter', motionDuration: 0.6,
      align: 'left', color: index ? CREAM : LIME, stroke: false, motion: still(0, -0.06 + index * 0.085), early: 0.05 }));
    shot('agentAd', 73, 77, { in: 2.2, dissolve: D, transition: 'flash' });
    title('44 MCP\nTOOLS,', 73.2, 75.7, big({ align: 'left', fontSize: 68, color: LIME, early: 0.02 }));
    title('STILL\nTHE SAME.', 75.7, 77, big({ align: 'left', fontSize: 68, animation: 'pop', motionDuration: 0.35, early: 0.02 }));
    title('THIS AD WAS\nASSEMBLED\nTHROUGH MCP', 73.4, 76.95, kicker());
    shot('uiFilm', 77, 79, { in: 1.2, framing: ui(0.38, 0.5, 2.1, 2.2), dissolve: D, transition: 'zoom' });
    title('ON THE BEAT,', 77.3, 79.4, big({ position: 'top', fontSize: 100, early: 0.02 }));
    title('SLAM · GLITCH · SCRAMBLE · POP', 77.3, 78.95, kicker());
    shot('uiFilm', 79, 81, { in: 7.6, framing: ui(0.36, 0.56, 2.2, 2.3), dissolve: D, transition: 'whip' });
    title('ON THE BEAT,', 79.4, 81.4, big({ position: 'top', fontSize: 100, color: LIME, animation: 'glitch', early: 0.02 }));
    title('WHIP · ZOOM · FLASH', 79.3, 80.95, kicker());
    shot('uiFilm', 81, 84, { in: 10.2, framing: ui(0.46, 0.5, 2.2, 2.35), dissolve: D, transition: 'glitch' });
    title('CUT TO THE BEAT.', 81.4, 84, big({ position: 'top', fontSize: 100, box: 'highlight', color: LIME, tilt: -3, early: 0.04 }));
    title('THIS FILM WAS CUT IN AFTERTAKE', 81.6, 83.95, kicker({ color: CREAM }));
  }),
  // 7 · “Your clip! Your clip! Your models, your call!” Finishing and motion
  // transfer through the instrumental, the second chorus over the takes, and
  // the intro's line again before the end card.
  scene('07 Your call', 84, music.endBeat, ({ shot, title, graphic }) => {
    const card = music.cardBeat, end = music.endBeat;
    shot('coastalSrc', 84, 86, { in: 0.6, framing: push(1.0, 1.06) });
    shot('coastal', 86, 88, { in: 1.0, framing: push(1.06, 1.0), dissolve: D, transition: 'flash' });
    title('YOUR CLIP.', 84, 87.4, big({ fontSize: 140, early: 0.02 }));
    title('YOUR CLIP.', 87.5, 89.3, big({ fontSize: 140, animation: 'glitch', early: 0.02 }));
    shot('winterSrc', 88, 89, { in: 0.8, framing: push(1.0, 1.04) });
    shot('winter', 89, 91, { in: 1.4, framing: push(1.02, 1.08), dissolve: D, transition: 'glitch' });
    shot('reclaimed', 91, 92, { in: 1.4, framing: push(1.02, 1.08) });
    title('YOUR MODELS.', 89.3, 92, big({ fontSize: 140, color: LIME, animation: 'glitch', early: 0.02 }));
    const looks = [['warm', 'WARM', HOT], ['cool', 'COOL', '#7cc7ff'], ['noir', 'NOIR', CREAM], ['vintage', 'VINTAGE', INK]];
    looks.forEach(([key, label, color], index) => {
      shot(key, 92 + index, 93 + index, { in: 1.0 + index * 0.4, framing: push(1.0, 1.03) });
      if (index > 1) title(label, 92 + index, 93 + index, big({ fontSize: 150, color, animation: index % 2 ? 'glitch' : 'slam', early: 0.02 }));
    });
    title('YOUR CALL.', 92, 94, big({ fontSize: 150, box: 'highlight', tilt: -4, color: CREAM, early: 0.04 }));
    title('COLOR & FINISH · LOOKS · CURVES · LUTS', 92.1, 95.95, kicker());
    shot('robot', 96, 98, { in: 0.6 });
    title('THEIR\nGESTURE.', 96, 98, big({ align: 'left', fontSize: 72, animation: 'reveal', early: 0.05 }));
    shot('teddy', 98, 101, { in: 1.8, dissolve: D, transition: 'zoom' });
    title('YOUR\nCHARACTER.', 98, 101, big({ align: 'left', fontSize: 72, color: LIME, delay: 0.1, early: 0.05 }));
    title('WAN ANIMATE 2 · MOTION TRANSFER', 98.2, 100.9, kicker());
    shot('refPortal', 101, 102, { in: 1.0, framing: push(1.02, 1.08) });
    shot('falls', 102, 103, { in: 2.0, framing: push(1.02, 1.08) });
    shot('crystal', 103, 105, { in: 0.6, framing: push(1.02, 1.1), dissolve: D, transition: 'flash' });
    title('PAINT IT.', 101.5, 102.7, big({ position: 'top', box: 'stamp', tilt: -4, color: LIME, fontSize: 96, early: 0.02 }));
    title('CHANGE IT.', 102.7, 103.7, big({ position: 'top', fontSize: 96, animation: 'pop', motionDuration: 0.35, early: 0.02 }));
    title('MAKE IT NEW.', 103.7, 105.4, big({ position: 'top', fontSize: 96, box: 'highlight', tilt: -3, color: LIME, early: 0.04 }));
    shot('depthSrc', 105, 106, { framing: cover });
    shot('depthMap', 106, 107, { framing: cover });
    shot('depth', 107, 108, { framing: cover });
    title('DEPTH → LENS BLUR', 105.4, 108, big({ position: 'bottom', align: 'left', fontSize: 80, animation: 'pop', early: 0.03 }));
    shot('layers', 108, 109, { framing: cover });
    title('LAYERS & MASKS', 108, 109, big({ position: 'bottom', align: 'left', fontSize: 80, color: INK, stroke: false, early: 0.03 }));
    const montage = [['portal', 1.4], ['bridge', 0.6], ['echoes', 1.0], ['crystalMove', 1.8], ['noir', 1.6], ['teddy', 1.6], ['falls', 1.8], ['winter', 2.2], ['ensemble', 1.6]];
    montage.slice(0, 118 - 109).forEach(([key, start], index) => shot(key, 109 + index, 110 + index, { in: start,
      framing: push(1.03, 1.1),
      ...(index && index % 2 === 0 ? { dissolve: D, transition: index % 4 ? 'glitch' : 'flash' } : {}) }));
    title('MAKE THE NEXT TAKE.', 109.5, 111.7, big({ fontSize: 120, early: 0.02 }));
    title('RUN THE SCENE.', 111.7, 114, big({ fontSize: 132, color: LIME, animation: 'glitch', early: 0.02 }));
    title('EVERY EFFECT · OPEN WEIGHTS · YOUR GPU', 114.2, 117.9, kicker());
    // The song's last break: the intro's line again, then the logo on “Aftertake”.
    shot('black', 118, card);
    title('THEN COMES THE', 118, card, { animation: 'pop', font: 'display', fontSize: 104, motionDuration: 0.6, early: 0.04 });
    shot('black', card, end, { dissolve: D, transition: 'flash' });
    graphic({ kind: 'image', assetKey: 'logo', x: 0.5, y: 0.27, width: 0.56, height: 0.17, fit: 'contain', opacity: 1,
      motion: { keys: [{ at: 0, x: 0, y: 0, scale: 2.2, opacity: 0 }, { at: 0.03, x: 0, y: 0, scale: 1, opacity: 1, easing: 'ease-in' },
        { at: 0.96, x: 0, y: 0, scale: 1.04, opacity: 1 }, { at: 1, x: 0, y: 0, scale: 1.04, opacity: 0 }] } }, card, end);
    title('OPEN SOURCE · MIT', card + 1.5, end, big({ fontSize: 52, box: 'stamp', tilt: -4, color: LIME, stroke: false, motion: still(0, -0.04), early: 0.15 }));
    title('BUILT ON THE COMFY SDK · OPEN WEIGHTS · YOUR GPU', card + 2.5, end, { style: 'kicker', font: 'mono', animation: 'scramble', fontSize: 26, color: CREAM, stroke: false, motion: still(0, 0.06), early: 0.15 });
    title('github.com/ItsSNOWMOBILE/aftertake', card + 3.5, end, { style: 'caption', font: 'mono', animation: 'typewriter', fontSize: 34, color: LIME, stroke: false, motion: still(0, 0.14), early: 0.15 });
    [
      ...music.credit,
      'Source plates generated with LTX-2.5 and Z-Image Turbo in Aftertake · every person shown is fictional',
      'Footage: Curtis Adams, Mikhail Nilov, Dean Diemert, Florian Delée, Michael Burrows / Pexels',
      'Every effect rendered in Aftertake with open-weight models.',
      'Edited, titled and cut to the beat in Aftertake Film.',
    ].forEach((line, index, lines) => title(line, Math.max(card + 6, end - 8), end, { style: 'kicker', position: 'bottom', font: 'mono', animation: 'fade', fontSize: 16, color: '#9aa58d',
      stroke: false, motion: still(0, -0.03 - (lines.length - 1 - index) * 0.026), early: 0.15 }));
  }),
];

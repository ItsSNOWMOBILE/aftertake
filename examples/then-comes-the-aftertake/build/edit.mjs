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
const beatsFile = JSON.parse(readFileSync(`${WORK}/big-boi-pants.beats.json`, 'utf8'));
const allBeats = beatsFile.beats;
const drop = allBeats.findIndex((time) => Math.abs(time - 12.4691) < 0.02);
/** Master seconds of beat k, counted from the drop (k = 0). */
const beatAt = (index) => (index < 0 ? 0 : allBeats[index]);
export const T = (k) => {
  const whole = Math.floor(k), part = k - whole;
  const a = beatAt(drop + whole);
  return part ? a + (beatAt(drop + whole + 1) - a) * part : a;
};
export const F = (seconds) => Math.round(seconds * 24);

export const LIME = '#d5eb94', CREAM = '#f3f1e9', INK = '#121713', HOT = '#ff6b3d', PINK = '#ff4fa3';

export const files = {
  music: `${WORK}/big-boi-pants.mp3`,
  black: `${WORK}/plate-black.png`,
  dark: `${WORK}/plate-dark.png`,
  logo: `${WORK}/logo-dark.png`,
  roomSrc: `${R}/portal/source.mp4`, portal: `${R}/portal/result.mp4`, refPortal: `${R}/reference-portal/result.mp4`,
  fallsSrc: `${R}/golden-falls/source.mp4`, falls: `${R}/golden-falls/result.mp4`, crystal: `${R}/crystal-forest/result.mp4`,
  crystalMove: `${R}/crystal-transition/result.mp4`,
  castle: `${R}/castle-pullback/result.mp4`, coastalSrc: `${R}/coastal-kingdom/source.mp4`, coastal: `${R}/coastal-kingdom/result.mp4`,
  observatory: `${R}/observatory/result.mp4`, observatoryStill: `${R}/observatory/source.png`,
  reclaimed: `${R}/reclaimed/result.mp4`, winterSrc: `${R}/winter-valley/source.mp4`, winter: `${R}/winter-valley/result.mp4`,
  robot: `${R}/signal/source.mp4`, teddy: `${R}/signal/result.mp4`,
  perfume: `${R}/text-video/square/result.mp4`, perfumeTall: `${R}/text-video/portrait/result.mp4`,
  headphones: `${R}/agent-generation/take.mp4`,
  bridgeSrc: `${R}/character-h3-high/prepared-source.mp4`, bridgeMask: `${R}/character-h3-high/selection-preview.mp4`,
  bridge: `${R}/character-h3-high/result.mp4`,
  dancer: `${R}/subject-duplicates/prepared-source.mp4`, ensemble: `${WORK}/ensemble.mp4`, echoes: `${WORK}/echoes.mp4`,
  warm: `${WORK}/castle-warm.mp4`, cool: `${WORK}/castle-cool.mp4`, noir: `${WORK}/castle-noir.mp4`,
  vintage: `${WORK}/castle-vintage.mp4`,
  depthSrc: `${R}/depth-effects/source.png`, depthMap: `${R}/depth-effects/depth.png`, depth: `${R}/depth-effects/result.png`,
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

const D = 0.25; // six-frame transitions

export const scenes = [
  // 1 · Cold open over the quiet intro: real sources, then the promise.
  scene('01 Every shot ends', -21, 0, ({ shot, title }) => {
    shot('black', -21, -16);
    title('EVERY SHOT', -20, -16, { animation: 'reveal', font: 'display', fontSize: 120, early: 0.05 });
    shot('roomSrc', -16, -12, { in: 0.2, framing: push(1, 1.08), dissolve: D });
    shot('fallsSrc', -12, -8, { in: 0, framing: push(1.04, 1.12), dissolve: D });
    shot('bridgeSrc', -8, -5, { in: 0.2, framing: push(1.1, 1.18, 0.5, 0.45), dissolve: D });
    title('YOUR FOOTAGE · SHOT ONCE', -15.6, -5.2, { style: 'kicker', position: 'bottom', align: 'left', font: 'mono', animation: 'scramble', fontSize: 32, color: LIME, stroke: false });
    title('ENDS.', -13, -9, { animation: 'glitch', font: 'display', fontSize: 150, delay: 0.05 });
    shot('black', -5, 0);
    title('THEN COMES THE', -4, 0, { animation: 'pop', font: 'display', fontSize: 104, motionDuration: 1.1, early: 0.04 });
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
    rapid.forEach(([key, start], index) => shot(key, 4 + index, 5 + index, { in: start, framing: key === 'teddy' ? push(1.2, 1.3, 0.5, 0.4) : push(1.02, 1.1),
      ...(index % 3 === 1 ? { dissolve: D, transition: index % 2 ? 'whip' : 'glitch' } : {}) }));
    title('EVERY FRAME HERE WAS MADE IN AFTERTAKE', 4.1, 11.9, { style: 'kicker', position: 'bottom', align: 'left', font: 'mono', animation: 'scramble', fontSize: 30, color: LIME, stroke: false });
    shot('ensemble', 12, 16, { in: 0.4, framing: push(1.0, 1.06), dissolve: D, transition: 'flash' });
    title('ANY SCENE.', 12, 13, { font: 'display', fontSize: 120, color: CREAM, box: 'highlight', tilt: -2, early: 0.02 });
    title('ANY CAST.', 13, 14, { font: 'display', fontSize: 120, color: LIME, box: 'highlight', tilt: 3, early: 0.02 });
    title('ANY CUT.', 14, 16, { font: 'display', fontSize: 132, box: 'highlight', tilt: -4, stroke: false });
  }),
  // 3 · How it's built: an animated architecture made of Film graphics.
  scene('03 How it is built', 16, 32, ({ shot, title, graphic }) => {
    shot('dark', 16, 32);
    title('HOW IT’S BUILT', 16, 32, { position: 'top', font: 'display', fontSize: 84, animation: 'reveal', early: 0.1 });
    title('OPEN WEIGHTS · YOUR GPU · MIT', 17, 32, { position: 'top', font: 'mono', style: 'kicker', animation: 'scramble', fontSize: 24, color: LIME, stroke: false,
      motion: still(0, 0.1), early: 0.1 });
    const box = (x, label, sub, from, color = LIME) => {
      graphic({ kind: 'rectangle', x, y: 0.43, width: 0.24, height: 0.17, fill: INK, fillOpacity: 0.96, stroke: color, strokeWidth: 3, radius: 0.012, opacity: 1,
        motion: pop() }, from, 32);
      title(`${label}\n${sub}`, from, 32, { font: 'display', fontSize: 34, animation: 'pop', motionDuration: 0.4, stroke: false, color: CREAM,
        motion: still(x - 0.5, -0.07), early: 0.1 });
    };
    box(0.18, 'AFTERTAKE', 'studio + agents', 18);
    box(0.5, 'COMFY SDK', '@comfyorg/sdk', 20);
    box(0.82, 'YOUR COMFYUI', 'local GPU', 22);
    for (const [x, from] of [[0.34, 19.5], [0.66, 21.5]])
      graphic({ kind: 'rectangle', x, y: 0.43, width: 0.08, height: 0.008, fill: LIME, fillOpacity: 1, strokeWidth: 0, opacity: 1,
        motion: { keys: [{ at: 0, x: 0, y: 0, scale: 1, scaleX: 0.02, opacity: 1 }, { at: 0.06, x: 0, y: 0, scale: 1, scaleX: 1, opacity: 1, easing: 'ease-out' }, { at: 1, x: 0, y: 0, scale: 1, scaleX: 1, opacity: 1 }] } }, from, 32);
    const models = ['Z-IMAGE', 'QWEN EDIT', 'LTX-2.5', 'WAN 2', 'MINIMAX H3', 'SAM 3', 'DA3', 'KOKORO'];
    models.forEach((model, index) => {
      const x = 0.12 + index * 0.108, from = 23.5 + index * 0.5;
      graphic({ kind: 'rectangle', x, y: 0.7, width: 0.098, height: 0.075, fill: LIME, fillOpacity: 1, strokeWidth: 0, radius: 0.01, opacity: 1, motion: pop() }, from, 32);
      title(model, from, 32, { font: 'mono', style: 'kicker', fontSize: 19, animation: 'none', stroke: false, color: INK, fontWeight: 700, motion: popTitle(x - 0.5, 0.2), early: 0.1 });
    });
    title('OPEN-WEIGHT MODELS · RUNNING ON YOUR MACHINE', 28, 32, { position: 'bottom', font: 'mono', style: 'kicker', animation: 'scramble', fontSize: 22, color: CREAM, stroke: false, early: 0.1 });
  }),
];

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

const kicker = (options = {}) => ({ style: 'kicker', position: 'bottom', align: 'left', font: 'mono', animation: 'scramble', fontSize: 28, color: LIME, stroke: false, ...options });
const big = (options = {}) => ({ font: 'display', fontSize: 120, ...options });

scenes.push(
  // 4 · Create: paint a region, words to video, still to motion, camera.
  scene('04 Create', 32, 64, ({ shot, title }) => {
    shot('uiPaint', 32, 35, { in: 1.9, framing: ui(0.47, 0.52, 1.75, 1.9) });
    title('PAINT IT.', 32, 35, big({ position: 'top', box: 'stamp', tilt: -4, color: LIME, fontSize: 96, early: 0.05 }));
    shot('uiCompare', 35, 39, { in: 2.1, framing: ui(0.47, 0.52, 1.55, 1.62) });
    title('DESCRIBE IT.', 35, 39, big({ position: 'top', fontSize: 96, animation: 'pop', early: 0.05 }));
    title('LOCAL LTX-2.5 · ONLY THE PAINTED REGION CHANGES', 35.2, 38.9, kicker());
    shot('crystalMove', 39, 41, { in: 0.6, framing: push(1.02, 1.1), dissolve: D, transition: 'zoom' });
    shot('uiVideo', 41, 45, { in: 0.9, framing: ui(0.82, 0.42, 1.45, 1.52), dissolve: D, transition: 'flash' });
    title('WORDS IN.', 41, 45, big({ position: 'bottom', align: 'left', animation: 'reveal', fontSize: 100, delay: 0.1, early: 0.05 }));
    shot('perfumeTall', 45, 49, { in: 0.4, framing: push(1.0, 1.08, 0.5, 0.5) });
    title('VIDEO + SOUND OUT.', 45, 49, big({ position: 'bottom', align: 'left', animation: 'slam', fontSize: 92, color: CREAM, early: 0.05 }));
    title('TEXT → VIDEO · LTX-2.5 · NO SOURCE NEEDED', 45.2, 48.9, kicker({ position: 'top' }));
    shot('uiImage', 49, 52, { in: 0.6, framing: ui(0.7, 0.55, 1.6, 1.7), dissolve: D, transition: 'whip' });
    title('ONE IMAGE.', 49.2, 52, big({ position: 'top', fontSize: 96, animation: 'glitch', early: 0.05 }));
    shot('observatoryStill', 52, 53, { framing: push(1.0, 1.02) });
    shot('observatory', 53, 57, { in: 0, framing: push(1.0, 1.04) });
    title('A MOVING SHOT.', 52, 57, big({ position: 'top', fontSize: 96, color: INK, stroke: false, early: 0.05 }));
    title('Z-IMAGE TURBO → LTX-2.5 · ANIMATE A FRAME', 52.2, 56.9, kicker());
    shot('castle', 57, 61, { in: 1.2, framing: push(1.0, 1.0), dissolve: D, transition: 'flash' });
    title('DIRECT THE CAMERA.', 57, 61, big({ fontSize: 104, box: 'highlight', tilt: -3, early: 0.05 }));
    shot('guided', 61, 64, { in: 1.6, framing: push(1.0, 1.0), dissolve: D, transition: 'whip' });
    title('PULL BACK. PUSH IN. ORBIT.', 61.1, 64, big({ position: 'bottom', fontSize: 72, animation: 'pop', box: 'highlight', color: LIME, early: 0.05 }));
  }),
  // 5 · Change: recast, duplicate, transfer motion, finish.
  scene('05 Change', 64, 97, ({ shot, title }) => {
    shot('bridgeSrc', 64, 66, { in: 0.3, framing: cover });
    title('TRACK ONE PERSON.', 64, 66, kicker({ position: 'top', fontSize: 30 }));
    shot('bridgeMask', 66, 68, { in: 0.3, framing: cover });
    title('SAM 3 · EVERY FRAME', 66, 68, kicker({ position: 'top', fontSize: 30 }));
    shot('bridge', 68, 72, { in: 0.2, framing: cover, dissolve: D, transition: 'glitch' });
    title('RECAST ANYONE.', 68, 72, big({ fontSize: 120, box: 'highlight', tilt: -3, early: 0.05 }));
    title('MINIMAX H3 · LOCAL · SAME PERFORMANCE', 68.2, 71.9, kicker());
    shot('bridgeSrc', 72, 73, { in: 2.0, framing: cover });
    title('BEFORE', 72, 73, kicker({ position: 'top', fontSize: 30, color: CREAM, early: 0.02 }));
    shot('dancer', 73, 75, { in: 0.2, framing: push(1.0, 1.04), dissolve: D, transition: 'flash' });
    title('ONE PERFORMANCE.', 73, 75, big({ position: 'top', fontSize: 92, animation: 'reveal', color: INK, stroke: false, early: 0.05 }));
    shot('ensemble', 75, 78, { in: 0.6, framing: push(1.0, 1.04) });
    title('FIVE DANCERS.', 75, 78, big({ position: 'top', fontSize: 104, color: INK, stroke: false, early: 0.05 }));
    shot('echoes', 78, 81, { in: 0.6, framing: push(1.0, 1.04), dissolve: D, transition: 'glitch' });
    title('OR ECHOES.', 78, 81, big({ position: 'top', fontSize: 104, animation: 'glitch', color: PINK, early: 0.05 }));
    title('NO REGENERATION · ORIGINAL PIXELS · CPU', 75.2, 80.9, kicker());
    shot('robot', 81, 83, { in: 0.6 });
    title('THEIR\nGESTURE.', 81, 83, big({ align: 'left', fontSize: 44, animation: 'reveal', early: 0.05 }));
    shot('teddy', 83, 87, { in: 0.6, dissolve: D, transition: 'zoom' });
    title('YOUR\nCHARACTER.', 83, 87, big({ align: 'left', fontSize: 44, color: LIME, delay: 0.1, early: 0.05 }));
    title('WAN ANIMATE 2 · MOTION TRANSFER', 83.2, 86.9, kicker());
    const looks = [['warm', 'WARM', HOT], ['cool', 'COOL', '#7cc7ff'], ['noir', 'NOIR', CREAM], ['vintage', 'VINTAGE', INK]];
    looks.forEach(([key, label, color], index) => {
      shot(key, 87 + index, 88 + index, { in: 1.0 + index * 0.4, framing: push(1.0, 1.03) });
      title(label, 87 + index, 88 + index, big({ fontSize: 150, color, animation: index % 2 ? 'glitch' : 'slam', early: 0.02 }));
    });
    title('COLOR & FINISH · LOOKS · CURVES · LUTS', 87.1, 90.95, kicker());
    shot('uiFinish', 91, 93, { in: 2.0, framing: ui(0.5, 0.42, 1.25, 1.32), dissolve: D, transition: 'flash' });
    shot('depthSrc', 93, 94, { framing: cover });
    shot('depthMap', 94, 95, { framing: cover });
    shot('depth', 95, 96, { framing: cover });
    title('DEPTH → LENS BLUR', 93, 96, big({ position: 'bottom', align: 'left', fontSize: 80, animation: 'pop', early: 0.03 }));
    shot('layers', 96, 97, { framing: cover });
    title('LAYERS & MASKS', 96, 97, big({ position: 'bottom', align: 'left', fontSize: 80, color: INK, stroke: false, early: 0.03 }));
  }),
);

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

scenes.push(
  // 6 · Agents and the editor that cut this film.
  scene('06 Agents and Film', 97, 113, ({ shot, title }) => {
    shot('dark', 97, 101);
    title('AN AGENT CAN CUT IT TOO.', 97, 101, big({ position: 'top', fontSize: 58, animation: 'reveal', early: 0.05 }));
    const lines = [
      ['› aftertake_detect_beats      103 BPM in 1.2 s', 97.5],
      ['› aftertake_save_film_edit    aftertake-film/5', 98.3],
      ['› aftertake_export_plan       native render', 99.1],
      ['› aftertake_review_film       decoded frames', 99.9],
    ];
    lines.forEach(([text, from], index) => title(text, from, 101, { style: 'caption', font: 'mono', fontSize: 34, animation: 'typewriter', motionDuration: 0.6,
      align: 'left', color: index ? CREAM : LIME, stroke: false, box: undefined, motion: still(0, -0.06 + index * 0.085), early: 0.05 }));
    title('44 MCP TOOLS · SAME LOCAL STUDIO', 97.2, 100.95, kicker());
    shot('agentAd', 101, 104, { in: 2.2, dissolve: D, transition: 'flash' });
    title('44 MCP\nTOOLS.', 101, 104, big({ align: 'left', fontSize: 68, color: LIME, early: 0.05 }));
    title('THIS AD WAS\nASSEMBLED\nTHROUGH MCP', 101.2, 103.95, kicker());
    shot('uiFilm', 104, 108, { in: 1.2, framing: ui(0.38, 0.5, 2.1, 2.2), dissolve: D, transition: 'zoom' });
    [['SLAM.', 'slam'], ['GLITCH.', 'glitch'], ['SCRAMBLE.', 'scramble'], ['POP.', 'pop']].forEach(([text, animation], index) =>
      title(text, 104 + index, 105 + index, big({ position: 'top', fontSize: 110, animation, color: index % 2 ? LIME : CREAM, motionDuration: 0.45, early: 0.02 })));
    shot('uiFilm', 108, 110, { in: 9.5, framing: ui(0.36, 0.56, 2.2, 2.3), dissolve: D, transition: 'whip' });
    title('WHIP · ZOOM · FLASH', 108.1, 110, big({ position: 'top', fontSize: 92, animation: 'pop', motionDuration: 0.5, early: 0.02 }));
    shot('uiFilm', 110, 113, { in: 13.4, framing: ui(0.46, 0.5, 2.2, 2.35), dissolve: D, transition: 'glitch' });
    title('CUT TO THE BEAT.', 110, 113, big({ position: 'top', fontSize: 100, box: 'highlight', color: LIME, tilt: -3, early: 0.04 }));
    title('THIS FILM WAS CUT IN AFTERTAKE', 110.2, 112.95, kicker({ color: CREAM }));
  }),
  // 7 · Finale and credits.
  scene('07 Your call', 113, 133, ({ shot, title, graphic }) => {
    const finale = [['portal', 1.4], ['bridge', 0.6], ['echoes', 1.0], ['crystal', 1.8], ['noir', 1.6], ['teddy', 1.6], ['falls', 1.8], ['winter', 2.2]];
    finale.forEach(([key, start], index) => shot(key, 113 + index, 114 + index, { in: start, framing: key === 'teddy' ? push(1.2, 1.28, 0.5, 0.4) : push(1.03, 1.1),
      ...(index && index % 2 === 0 ? { dissolve: D, transition: index % 4 ? 'glitch' : 'flash' } : {}) }));
    title('YOUR CLIP.', 113, 115, big({ fontSize: 140, early: 0.02 }));
    title('YOUR MODELS.', 115, 117, big({ fontSize: 140, color: LIME, animation: 'glitch', early: 0.02 }));
    title('YOUR CALL.', 117, 121, big({ fontSize: 150, box: 'highlight', tilt: -4, color: CREAM, early: 0.04 }));
    shot('black', 121, 133, { dissolve: D, transition: 'flash' });
    graphic({ kind: 'image', assetKey: 'logo', x: 0.5, y: 0.27, width: 0.56, height: 0.17, fit: 'contain', opacity: 1,
      motion: { keys: [{ at: 0, x: 0, y: 0, scale: 2.2, opacity: 0 }, { at: 0.04, x: 0, y: 0, scale: 1, opacity: 1, easing: 'ease-in' },
        { at: 0.94, x: 0, y: 0, scale: 1.04, opacity: 1 }, { at: 1, x: 0, y: 0, scale: 1.04, opacity: 0 }] } }, 121, 133);
    title('OPEN SOURCE · MIT', 122.5, 133, big({ fontSize: 52, box: 'stamp', tilt: -4, color: LIME, stroke: false, motion: still(0, -0.04), early: 0.15 }));
    title('BUILT ON THE COMFY SDK · OPEN WEIGHTS · YOUR GPU', 123.5, 133, { style: 'kicker', font: 'mono', animation: 'scramble', fontSize: 26, color: CREAM, stroke: false, motion: still(0, 0.06), early: 0.15 });
    title('github.com/ItsSNOWMOBILE/aftertake', 124.5, 133, { style: 'caption', font: 'mono', animation: 'typewriter', fontSize: 34, color: LIME, stroke: false, motion: still(0, 0.14), early: 0.15 });
    [
      'Music: “Big Boi Pants” by Shane Ivers · silvermansound.com · CC BY 4.0',
      'Footage: Curtis Adams, Mikhail Nilov, Dean Diemert, Florian Delée,',
      'Antoni Shkraba, Michael Burrows / Pexels · Tears of Steel © Blender Foundation, CC BY 3.0',
      'Every effect rendered locally in Aftertake with open-weight models.',
      'Edited, titled and cut to the beat in Aftertake Film.',
    ].forEach((line, index) => title(line, 127, 133, { style: 'kicker', position: 'bottom', font: 'mono', animation: 'fade', fontSize: 16, color: '#9aa58d',
      stroke: false, motion: still(0, -0.05 + index * 0.026), early: 0.15 }));
  }),
);

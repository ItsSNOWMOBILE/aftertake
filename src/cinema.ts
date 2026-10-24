import { z } from 'zod';

export const cameraMovements = [
  'locked',
  'push',
  'pull',
  'pan',
  'pan-right',
  'tilt-up',
  'tilt-down',
  'crane-up',
  'truck',
  'orbit',
  'crash-zoom',
  'whip-pan',
  'handheld',
  'dolly-zoom',
  'zoom-in',
  'zoom-out',
  'truck-right',
  'boom-down',
  'barrel-roll',
  'impact-shake',
  'orbit-360',
  'arc',
  'bullet-time',
  'fpv-drone',
  'drone-reveal',
  'snorricam',
  'rack-focus',
] as const;
/** Moves that change perspective in depth, which flat screen-space tracks cannot describe. */
export const promptOnlyMovements = new Set<string>([
  'orbit',
  'dolly-zoom',
  'orbit-360',
  'arc',
  'bullet-time',
  'fpv-drone',
  'drone-reveal',
  'snorricam',
  'rack-focus',
]);
export const cinemaSchema = z
  .object({
    movement: z.enum(cameraMovements),
    lens: z.enum(['natural', 'wide', 'portrait', 'anamorphic']),
    lighting: z.enum(['source', 'daylight', 'tungsten', 'moonlight', 'neon']),
    palette: z.enum(['source', 'warm', 'cool', 'monochrome']),
    guidance: z.enum(['prompt', 'tracks']).optional(),
  })
  .refine(
    (look) => !(look.guidance === 'tracks' && promptOnlyMovements.has(look.movement)),
    'This move changes perspective in depth, so it uses prompt guidance only.',
  );
export type Cinema = z.infer<typeof cinemaSchema>;
export const defaultCinema: Cinema = {
  movement: 'push',
  lens: 'natural',
  lighting: 'source',
  palette: 'source',
};
/** One line per move for the moves gallery. */
export const movementNotes: Record<Cinema['movement'], string> = {
  locked: 'The frame holds still; only the subject moves.',
  push: 'Moves gently closer to the subject.',
  pull: 'Backs away to reveal the place.',
  pan: 'Turns to the left from one spot.',
  'pan-right': 'Turns to the right from one spot.',
  'tilt-up': 'Looks up from the subject.',
  'tilt-down': 'Looks down from the subject.',
  'crane-up': 'Rises above the scene.',
  truck: 'Slides sideways; near things pass faster.',
  orbit: 'Arcs around the subject.',
  'crash-zoom': 'Holds, then snaps in close.',
  'whip-pan': 'A fast blur to the side, for a cut or a reveal.',
  handheld: 'A subtle sway, like a camera on the shoulder.',
  'dolly-zoom': 'The subject stays put while the world stretches behind.',
  'zoom-in': 'The lens zooms closer; nothing shifts in depth.',
  'zoom-out': 'The lens widens to show more; nothing shifts in depth.',
  'truck-right': 'Slides to the right; near things pass faster.',
  'boom-down': 'Lowers from above down to the subject.',
  'barrel-roll': 'Rolls all the way over around the lens.',
  'impact-shake': 'A hard jolt, then the frame settles.',
  'orbit-360': 'Circles all the way around the subject.',
  arc: 'A wide half circle that swings past the subject.',
  'bullet-time': 'Time freezes while the camera circles.',
  'fpv-drone': 'A fast, banking drone dive through the scene.',
  'drone-reveal': 'Lifts and pulls away to show the place from the air.',
  snorricam: 'Rigged to the subject while the world sways behind.',
  'rack-focus': 'Focus pulls from the background onto the subject.',
};
export const cinemaOptions = {
  movement: [
    ['locked', 'Locked camera'],
    ['push', 'Slow push in'],
    ['pull', 'Slow pull back'],
    ['pan', 'Pan left'],
    ['pan-right', 'Pan right'],
    ['tilt-up', 'Tilt up'],
    ['tilt-down', 'Tilt down'],
    ['crane-up', 'Crane up'],
    ['truck', 'Truck left'],
    ['orbit', 'Gentle orbit'],
    ['crash-zoom', 'Crash zoom'],
    ['whip-pan', 'Whip pan'],
    ['handheld', 'Handheld'],
    ['dolly-zoom', 'Dolly zoom'],
    ['zoom-in', 'Zoom in'],
    ['zoom-out', 'Zoom out'],
    ['truck-right', 'Truck right'],
    ['boom-down', 'Boom down'],
    ['barrel-roll', 'Barrel roll'],
    ['impact-shake', 'Impact shake'],
    ['orbit-360', '360° orbit'],
    ['arc', 'Arc shot'],
    ['bullet-time', 'Bullet time'],
    ['fpv-drone', 'FPV drone'],
    ['drone-reveal', 'Drone reveal'],
    ['snorricam', 'Snorricam'],
    ['rack-focus', 'Rack focus'],
  ],
  lens: [
    ['natural', 'Natural perspective'],
    ['wide', 'Wide and expansive'],
    ['portrait', 'Shallow focus'],
    ['anamorphic', 'Anamorphic character'],
  ],
  lighting: [
    ['source', 'Follow the reference'],
    ['daylight', 'Soft daylight'],
    ['tungsten', 'Warm practical light'],
    ['moonlight', 'Moonlit'],
    ['neon', 'Neon glow'],
  ],
  palette: [
    ['source', 'Follow the reference'],
    ['warm', 'Warm amber'],
    ['cool', 'Cool blue'],
    ['monochrome', 'Black and white'],
  ],
} as const;
const language: { [K in Exclude<keyof Cinema, 'guidance'>]: Record<Cinema[K], string> } = {
  movement: {
    locked:
      'A stationary locked-off shot. The camera does not translate, rotate or zoom. Framing and perspective remain unchanged; any subject motion happens inside this fixed composition.',
    push: 'The camera moves slowly forward in one smooth continuous dolly, gently approaching the subject with visible parallax.',
    pull: 'The camera slowly tracks backward in one steady continuous move, gradually revealing more of the environment.',
    pan: 'A stationary camera rotates slowly to the left with a level horizon and an even, unhurried speed.',
    'pan-right':
      'A stationary camera rotates slowly to the right with a level horizon and an even, unhurried speed.',
    'tilt-up':
      'A stationary camera tilts slowly upward in one smooth move, revealing what is above the subject.',
    'tilt-down':
      'A stationary camera tilts slowly downward in one smooth move, settling on what is below.',
    'crane-up':
      'The camera rises smoothly on a crane, lifting above the subject and gradually revealing the scene from higher up.',
    truck:
      'The camera dollies sideways to the left in one steady move, parallel to the scene; nearby objects pass faster than the background, with strong parallax.',
    orbit:
      'The camera makes a small smooth arc around the subject at a constant height, keeping the subject near the center.',
    'crash-zoom':
      'The camera holds, then zooms in fast and hard on the subject in a sudden energetic crash zoom that lands close.',
    'whip-pan':
      'The camera whips quickly sideways in a fast pan with strong horizontal motion blur, then settles.',
    handheld:
      'A handheld camera with subtle natural sway and breathing movement, slightly imperfect but steady, documentary feel.',
    'dolly-zoom':
      'A dolly zoom: the camera moves backward while zooming in, so the subject stays the same size while the background appears to stretch and grow behind them.',
    'zoom-in':
      'A smooth optical zoom in from a fixed camera position: the framing tightens on the subject with no change in perspective or parallax.',
    'zoom-out':
      'A smooth optical zoom out from a fixed camera position: the framing widens to show more of the scene with no change in perspective or parallax.',
    'truck-right':
      'The camera dollies sideways to the right in one steady move, parallel to the scene; nearby objects pass faster than the background, with strong parallax.',
    'boom-down':
      'The camera lowers smoothly on a crane from a high angle down to the subject, the view settling at eye level.',
    'barrel-roll':
      'The camera rolls around its lens axis in one continuous barrel roll, the horizon tipping diagonally, then sideways, upside down and back upright.',
    'impact-shake':
      'A sudden hard impact jolts the camera with a violent shake that quickly settles back to a steady frame.',
    'orbit-360':
      'The camera travels a complete 360-degree orbit around the subject at a constant distance and height, showing it from every side and returning to the front, the subject staying centered throughout.',
    arc: 'The camera sweeps a wide half-circle arc around the subject from one side to the other, with strong parallax between the subject and the background.',
    'bullet-time':
      'Bullet time: the moment freezes in a single suspended instant while the camera glides around the motionless subject in a smooth arc; hair, particles and droplets hang still in the air.',
    'fpv-drone':
      'A fast first-person drone flight: the camera dives forward through the scene, banking and weaving close past objects with exhilarating speed.',
    'drone-reveal':
      'An aerial drone shot rises and pulls back smoothly, lifting high above the subject to reveal the whole landscape around it from the air.',
    snorricam:
      'A snorricam shot: the camera is strapped to the subject, so the subject stays large and locked in the center of the frame while the world behind them bobs, sways and swings with every movement.',
    'rack-focus':
      'A rack focus: the shot begins focused on the background with the subject soft, then the focus pulls smoothly onto the subject while the background melts into soft bokeh. The camera does not move.',
  },
  lens: {
    natural: 'Natural perspective, crisp believable detail and moderate depth of field.',
    wide: 'Wide-angle perspective with deep focus and an expansive sense of space.',
    portrait:
      'Long-lens character with a gently blurred background, soft bokeh and shallow depth of field.',
    anamorphic:
      'Anamorphic lens character, soft oval bokeh, restrained horizontal highlights and gentle edge falloff.',
  },
  lighting: {
    source: 'Lighting direction and exposure remain consistent with the reference frame.',
    daylight: 'Soft diffused daylight, gently modeled shadows and a natural range of brightness.',
    tungsten:
      'Warm practical lamps illuminate the scene with amber highlights and rich soft shadows.',
    moonlight: 'Cool moonlight, delicate silvery edges and restrained atmospheric darkness.',
    neon: 'Cyan and magenta practical neon light, reflected color and atmospheric glow.',
  },
  palette: {
    source: 'Keep the reference color relationships coherent throughout the shot.',
    warm: 'A restrained warm amber color grade with soft, earthy shadows.',
    cool: 'A cool blue color grade with quiet neutral highlights.',
    monochrome: 'Black-and-white cinematography with nuanced grayscale and deep tonal separation.',
  },
};
export function cinemaPrompt(prompt: string, settings: Cinema = defaultCinema, reference = true) {
  return [
    settings.guidance === 'tracks'
      ? 'One coherent continuous shot. Follow the supplied motion tracks while preserving scene geometry.'
      : language.movement[settings.movement],
    prompt.trim(),
    reference
      ? 'One continuous cinematic shot, beginning from the supplied reference frame.'
      : 'One continuous cinematic shot.',
    language.lens[settings.lens],
    !reference && settings.lighting === 'source'
      ? 'Keep lighting direction and exposure consistent throughout the shot.'
      : language.lighting[settings.lighting],
    !reference && settings.palette === 'source'
      ? 'Keep natural color relationships coherent throughout the shot.'
      : language.palette[settings.palette],
    'The scene remains coherent over time.',
  ].join(' ');
}
export const savedLookSchema = z.object({
  name: z.string().trim().min(1).max(40),
  settings: cinemaSchema,
});
export type SavedLook = z.infer<typeof savedLookSchema>;
export const cinemaLooks: SavedLook[] = [
  {
    name: 'Daybreak',
    settings: { movement: 'push', lens: 'natural', lighting: 'daylight', palette: 'warm' },
  },
  {
    name: 'After hours',
    settings: { movement: 'orbit', lens: 'anamorphic', lighting: 'neon', palette: 'cool' },
  },
  {
    name: 'Silver screen',
    settings: { movement: 'locked', lens: 'portrait', lighting: 'source', palette: 'monochrome' },
  },
];

/** Where scene content moves on screen for each move; the camera moves the opposite way. */
function trackOffset(
  movement: Cinema['movement'],
  fraction: number,
  ease: number,
  row: number,
): { scale: number; dx: number; dy: number; roll?: number } {
  switch (movement) {
    case 'push':
      return { scale: 1 + 0.18 * ease, dx: 0, dy: 0 };
    case 'pull':
      return { scale: 1 - 0.18 * ease, dx: 0, dy: 0 };
    case 'pan':
      return { scale: 1, dx: 0.12 * ease, dy: 0 };
    case 'pan-right':
      return { scale: 1, dx: -0.12 * ease, dy: 0 };
    case 'tilt-up':
      return { scale: 1, dx: 0, dy: 0.1 * ease };
    case 'tilt-down':
      return { scale: 1, dx: 0, dy: -0.1 * ease };
    case 'crane-up':
      return { scale: 1 - 0.06 * ease, dx: 0, dy: 0.14 * ease };
    case 'truck':
      // Lower rows stand in for nearer objects, which pass faster.
      return { scale: 1, dx: (0.04 + 0.16 * row) * ease, dy: 0 };
    case 'crash-zoom': {
      const late = Math.min(1, Math.max(0, (fraction - 0.35) / 0.4));
      return { scale: 1 + 0.45 * late * late * (3 - 2 * late), dx: 0, dy: 0 };
    }
    case 'whip-pan': {
      const fast = Math.min(1, Math.max(0, (fraction - 0.3) / 0.25));
      return { scale: 1, dx: 0.35 * fast * fast * (3 - 2 * fast), dy: 0 };
    }
    case 'zoom-in':
      return { scale: 1 + 0.3 * ease, dx: 0, dy: 0 };
    case 'zoom-out':
      return { scale: 1 - 0.22 * ease, dx: 0, dy: 0 };
    case 'truck-right':
      return { scale: 1, dx: -(0.04 + 0.16 * row) * ease, dy: 0 };
    case 'boom-down':
      return { scale: 1 + 0.06 * ease, dx: 0, dy: -0.14 * ease };
    case 'barrel-roll':
      return { scale: 1.04, dx: 0, dy: 0, roll: -2 * Math.PI * ease };
    case 'impact-shake': {
      // A jolt at a fifth of the shot that dies away over the next half.
      const after = Math.max(0, fraction - 0.2),
        decay = fraction > 0.2 ? Math.exp(-after * 7) : 0;
      return {
        scale: 1 + 0.03 * decay,
        dx: 0.035 * decay * Math.sin(after * 95),
        dy: 0.03 * decay * Math.sin(after * 71 + 1),
      };
    }
    case 'handheld':
      return {
        scale: 1,
        dx: 0.012 * Math.sin(fraction * 7.1) + 0.006 * Math.sin(fraction * 17.3 + 1),
        dy: 0.01 * Math.sin(fraction * 5.3 + 2) + 0.004 * Math.sin(fraction * 13.7),
      };
    default:
      return { scale: 1, dx: 0, dy: 0 };
  }
}

// Screen-space framing hints, not a reconstruction of the scene's 3D camera.
// These exact trajectories feed the model and the source-view overlay.
export function cameraTracks(
  width: number,
  height: number,
  frames: number,
  movement: Cinema['movement'],
) {
  if (promptOnlyMovements.has(movement)) return [];
  return [0.25, 0.5, 0.75].flatMap((y) =>
    [0.2, 0.4, 0.6, 0.8].map((x) =>
      Array.from({ length: frames }, (_, frame) => {
        const fraction = frame / Math.max(1, frames - 1);
        const ease = fraction * fraction * (3 - 2 * fraction);
        const { scale, dx, dy, roll = 0 } = trackOffset(movement, fraction, ease, y);
        // A roll turns content about the frame centre in pixels, so it stays square.
        const px = (x - 0.5) * scale * width,
          py = (y - 0.5) * scale * height,
          rx = px * Math.cos(roll) - py * Math.sin(roll),
          ry = px * Math.sin(roll) + py * Math.cos(roll);
        // Points stay on the canvas; content that would leave it waits at the edge.
        return {
          x: Math.min(1, Math.max(0, rx / width + 0.5 + dx)) * width,
          y: Math.min(1, Math.max(0, ry / height + 0.5 + dy)) * height,
        };
      }),
    ),
  );
}

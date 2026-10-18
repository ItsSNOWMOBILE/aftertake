import type { Cue } from './domain';
/** Pixel-center distances and short-edge units match the Comfy node. */
export function spatialMask(width: number, height: number, cue: Cue): Uint8ClampedArray {
  const alpha = new Float32Array(width * height);
  const short = Math.min(width, height),
    feather = Math.max(0.001, cue.feather) * short;
  for (const stroke of cue.strokes) {
    const strokeAlpha = new Float32Array(width * height);
    const points = stroke.points;
    const radius = stroke.radius * short;
    for (let segment = 0; segment < Math.max(1, points.length - 1); segment++) {
      const a = points[segment],
        b = points[Math.min(segment + 1, points.length - 1)];
      const ax = a.x * width,
        ay = a.y * height,
        bx = b.x * width,
        by = b.y * height;
      const dx = bx - ax,
        dy = by - ay,
        length2 = Math.max(dx * dx + dy * dy, 1e-12);
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - radius)),
        x1 = Math.min(width, Math.ceil(Math.max(ax, bx) + radius));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by) - radius)),
        y1 = Math.min(height, Math.ceil(Math.max(ay, by) + radius));
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          const t = Math.max(0, Math.min(1, ((x + 0.5 - ax) * dx + (y + 0.5 - ay) * dy) / length2));
          const distance = Math.hypot(x + 0.5 - ax - t * dx, y + 0.5 - ay - t * dy);
          const v = Math.max(0, Math.min(1, (distance - radius + feather) / feather));
          const i = y * width + x;
          strokeAlpha[i] = Math.max(strokeAlpha[i], 1 - v * v * (3 - 2 * v));
        }
    }
    for (let i = 0; i < alpha.length; i++)
      alpha[i] =
        stroke.mode === 'erase'
          ? alpha[i] * (1 - strokeAlpha[i])
          : Math.max(alpha[i], strokeAlpha[i]);
  }
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < alpha.length; i++) {
    pixels[i * 4] = 215;
    pixels[i * 4 + 1] = 232;
    pixels[i * 4 + 2] = 145;
    pixels[i * 4 + 3] = Math.round(alpha[i] * 255);
  }
  return pixels;
}

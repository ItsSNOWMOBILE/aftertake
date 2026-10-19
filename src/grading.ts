import { z } from 'zod';

export const colorChannels = [
  'red',
  'orange',
  'yellow',
  'green',
  'aqua',
  'blue',
  'purple',
  'magenta',
] as const;
export const curveChannels = ['master', 'red', 'green', 'blue'] as const;
const adjustment = z
  .object({
    hueDegrees: z.number().min(-30).max(30),
    saturation: z.number().min(-1).max(1),
    lightness: z.number().min(-1).max(1),
  })
  .strict();
export const selectiveColorSchema = z
  .object(
    Object.fromEntries(colorChannels.map((name) => [name, adjustment])) as Record<
      (typeof colorChannels)[number],
      typeof adjustment
    >,
  )
  .strict();
export type SelectiveColor = z.infer<typeof selectiveColorSchema>;
export const defaultSelectiveColor = Object.fromEntries(
  colorChannels.map((name) => [name, { hueDegrees: 0, saturation: 0, lightness: 0 }]),
) as SelectiveColor;
export const curveSchema = z
  .array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).strict())
  .min(2)
  .max(16)
  .refine(
    (points) =>
      points.length >= 2 &&
      points[0].x === 0 &&
      points.at(-1)!.x === 1 &&
      points.every(
        (point, index) =>
          index === 0 || (point.x - points[index - 1].x >= 1e-6 && point.y >= points[index - 1].y),
      ),
    'Curves need endpoints at input0/1, increasing inputs and nondecreasing outputs.',
  );
export const curvesSchema = z
  .object({ master: curveSchema, red: curveSchema, green: curveSchema, blue: curveSchema })
  .strict();
export type GradingCurves = z.infer<typeof curvesSchema>;
export const defaultCurves: GradingCurves = Object.fromEntries(
  curveChannels.map((name) => [
    name,
    [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ],
  ]),
) as GradingCurves;
export function sampleCurve(points: GradingCurves['master'], count = 129) {
  const widths = points.slice(1).map((point, index) => point.x - points[index].x);
  const changes = points
    .slice(1)
    .map((point, index) => (point.y - points[index].y) / widths[index]);
  const slopes = points.map(() => 0);
  if (points.length === 2) slopes.fill(changes[0]);
  else {
    for (let index = 1; index < points.length - 1; index++) {
      if (changes[index - 1] > 0 && changes[index] > 0) {
        const left = 2 * widths[index] + widths[index - 1],
          right = widths[index] + 2 * widths[index - 1];
        slopes[index] = (left + right) / (left / changes[index - 1] + right / changes[index]);
      }
    }
    for (const [index, first, second] of [
      [0, 0, 1],
      [points.length - 1, widths.length - 1, widths.length - 2],
    ]) {
      const value =
        ((2 * widths[first] + widths[second]) * changes[first] - widths[first] * changes[second]) /
        (widths[first] + widths[second]);
      slopes[index] = Math.min(3 * changes[first], Math.max(0, value));
    }
  }
  return Array.from({ length: count }, (_, index) => {
    const x = index / (count - 1);
    let at = 0;
    while (at < points.length - 2 && x > points[at + 1].x) at++;
    const t = (x - points[at].x) / widths[at];
    const y =
      (2 * t ** 3 - 3 * t * t + 1) * points[at].y +
      (t ** 3 - 2 * t * t + t) * widths[at] * slopes[at] +
      (-2 * t ** 3 + 3 * t * t) * points[at + 1].y +
      (t ** 3 - t * t) * widths[at] * slopes[at + 1];
    return { x, y };
  });
}
const domainNumber = z.number().min(-1e30).max(1e30);
const triple = z.tuple([domainNumber, domainNumber, domainNumber]);
export const lutDescriptorSchema = z
  .object({
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    title: z.string().max(160),
    size: z.number().int().min(2).max(64),
    domainMin: triple,
    domainMax: triple,
    interpolation: z.literal('trilinear'),
    colorSpace: z.literal('srgb'),
  })
  .strict()
  .refine(
    (lut) =>
      lut.domainMax.every(
        (value, index) =>
          Number.isFinite(value - lut.domainMin[index]) && value > lut.domainMin[index],
      ),
    'Each LUT input-domain maximum must exceed its minimum.',
  );
export type LutDescriptor = z.infer<typeof lutDescriptorSchema>;
export function gradingIsIdentity(settings: {
  selectiveColor?: SelectiveColor;
  curves?: GradingCurves;
  lutStrength?: number;
}) {
  return (
    !settings.lutStrength &&
    (!settings.selectiveColor ||
      colorChannels.every((name) =>
        Object.values(settings.selectiveColor![name]).every((value) => value === 0),
      )) &&
    (!settings.curves ||
      curveChannels.every((name) => settings.curves![name].every((point) => point.x === point.y)))
  );
}

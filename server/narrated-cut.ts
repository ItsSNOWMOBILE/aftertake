import { narratedCutSchema } from '../src/narrated-cut.js';
import type { FilmAsset } from '../src/film.js';
import { compileEditPlan, type PlanPicture } from './edit-plan.js';

export function prepareNarratedCut(
  input: unknown,
  pictures: Map<string, PlanPicture>,
  voices: Map<string, FilmAsset>,
) {
  const request = narratedCutSchema.parse(input),
    lead = 3 / 24,
    tail = request.pace === 'quick' ? 6 / 24 : 12 / 24;
  const beats = request.beats.map((beat, index) => {
    const name = `Line ${index + 1}`,
      picture = pictures.get(beat.shot.assetId || beat.shot.renderId!);
    if (!picture || picture.sha256 !== beat.pictureSHA256)
      throw Error(`${name}: the picture changed. Prepare the cut again with the current media.`);
    if (beat.shot.end > picture.duration + 0.001)
      throw Error(`${name}: the Out trim exceeds its source.`);
    const voice = voices.get(beat.voice.assetId);
    if (
      !voice ||
      voice.kind !== 'audio' ||
      voice.sha256 !== beat.voice.sha256 ||
      voice.narration?.text.trim() !== beat.text
    )
      throw Error(`${name}: choose the complete local voice generated from this exact line.`);
    const start = Math.round(beat.shot.start * 24),
      limit = Math.min(Math.round(beat.shot.end * 24), Math.floor((picture.duration + 0.001) * 24));
    const count = Math.max(6, Math.ceil((lead + voice.duration + tail) * 24));
    if (start + count > limit)
      throw Error(
        `${name} needs ${(count / 24).toFixed(2)}s of picture; the selected trim has ${((limit - start) / 24).toFixed(2)}s. Extend its Out trim or shorten the line.`,
      );
    const spoken = request.look === 'spoken',
      headline =
        request.look === 'bold' &&
        (index === 0 || index === request.beats.length - 1) &&
        beat.text.length <= 65 &&
        beat.text.split(/\s+/).length <= 8;
    return {
      name,
      visuals: [
        {
          ...beat.shot,
          start: start / 24,
          end: (start + count) / 24,
          dissolve: index ? request.dissolve : 0,
          sha256: picture.sha256,
        },
      ],
      voice: beat.voice,
      voiceLead: lead,
      tail,
      caption: voice.narration!.text.trim(),
      captionTail: 0.08,
      style: headline || spoken ? ('headline' as const) : ('caption' as const),
      position: headline || spoken ? ('center' as const) : ('bottom' as const),
      animation: spoken ? ('spoken' as const) : headline ? ('impact' as const) : ('fade' as const),
      fontSize:
        headline || spoken
          ? 132
          : request.look === 'bold' && request.aspect !== 'landscape'
            ? 72
            : 48,
      color: headline || spoken ? '#d5e991' : '#ffffff',
    };
  });
  return compileEditPlan(
    { name: request.name, aspect: request.aspect, sourceVolume: 0, normalizeAudio: true, beats },
    pictures,
    voices,
  );
}

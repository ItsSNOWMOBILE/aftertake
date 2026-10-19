import { ArrowUpRight, Play } from 'lucide-react';
import { findImportedClip, type Clip } from './domain';
import type { CharacterJob, CharacterRequest, CharacterSelectionRequest } from './character';
import type { VideoGeneration } from './video-generation';
import { mediaUrl } from './transport';

export type RecordedWork = {
  character?: CharacterJob;
  video?: VideoGeneration;
};
export type RecordedWorkKind = 'character' | 'video';

export function selectRecordedWork(
  clips: Clip[],
  characters: CharacterJob[],
  videos: VideoGeneration[],
): RecordedWork {
  const character = characters
    .filter((job) => {
      if (job.kind !== 'replacement' || job.state !== 'succeeded' || !job.clip) return false;
      const request = job.request as CharacterRequest;
      const selection = characters.find((item) => item.id === request.selectionId);
      if (
        selection?.kind !== 'selection' ||
        selection.state !== 'succeeded' ||
        !selection.selection
      )
        return false;
      return Boolean(
        findImportedClip(clips, (selection.request as CharacterSelectionRequest).clip) &&
        findImportedClip(clips, request.reference) &&
        (request.identityReferences || []).every((entry) =>
          findImportedClip(clips, entry.reference),
        ),
      );
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const video = videos
    .filter(
      (item) =>
        item.state === 'succeeded' &&
        item.clip &&
        item.request.aspect === 'portrait' &&
        item.request.quality === 'final',
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  return { character, video };
}

/** Keep the selected recorded take first for the dedicated studio's initial preview. */
export function recordedFirst<T extends { id: string }>(items: T[], id: string): T[] {
  const selected = items.find((item) => item.id === id);
  return selected ? [selected, ...items.filter((item) => item.id !== id)] : items;
}

export default function RecordedHighlights({
  work,
  busy,
  onOpen,
}: {
  work: RecordedWork;
  busy: boolean;
  onOpen: (kind: RecordedWorkKind, id: string) => void;
}) {
  const cards = [
    ...(work.character?.clip
      ? [
          {
            kind: 'character' as const,
            id: work.character.id,
            clip: work.character.clip,
            title: 'H3 character replacement',
            description:
              'Watch the source, tracked person and replacement in the character studio.',
            action: 'Watch character replacement',
          },
        ]
      : []),
    ...(work.video?.clip
      ? [
          {
            kind: 'video' as const,
            id: work.video.id,
            clip: work.video.clip,
            title: 'Text into a vertical video',
            description:
              'Review a scene generated from words, with its prompt and executed LTX graph.',
            action: 'Watch text-to-video',
          },
        ]
      : []),
  ];
  if (!cards.length) return null;
  return (
    <section className="recorded-highlights" aria-label="Featured recorded work">
      <div className="recipe-section-heading">
        <h3>Featured recorded work</h3>
        <span>Open the actual take and its workflow</span>
      </div>
      <div className="recorded-highlight-grid">
        {cards.map((item) => (
          <button
            key={item.kind}
            type="button"
            className="recorded-highlight-card"
            disabled={busy}
            onClick={() => onOpen(item.kind, item.id)}
          >
            <div className={`recorded-highlight-poster ${item.kind}`}>
              <img src={mediaUrl(`/api/thumbnails/${item.clip.id}?time=0`)} alt="" />
              <span>
                <Play size={13} /> Recorded result
              </span>
            </div>
            <div className="recorded-highlight-copy">
              <strong>{item.title}</strong>
              <p>{item.description}</p>
              <small>
                {item.clip.width} × {item.clip.height} · {item.clip.duration.toFixed(2)}s ·{' '}
                {item.clip.hasAudio ? 'With audio' : 'Silent output'}
              </small>
              <span className="recorded-highlight-action">
                {item.action} <ArrowUpRight size={14} />
              </span>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

import { useEffect, useRef, useState } from 'react';
import { Check, Pause, Play } from 'lucide-react';
import type { TakeSet } from './take-sets';
import { mediaUrl } from './transport';
import './job-progress.css';
import './take-set.css';

export type TakeMedia = { kind: 'image' | 'video'; url: string };

/**
 * A set of takes side by side. Videos play, pause and scrub together so the same
 * moment of every take is on screen; the person keeps the one they want.
 */
export default function TakeSetView({
  set,
  media,
  busy,
  onKeep,
  onCancel,
}: {
  set: TakeSet;
  media: (id: string) => TakeMedia | undefined;
  busy?: boolean;
  onKeep: (id: string) => void;
  onCancel?: () => void;
}) {
  const videos = useRef<(HTMLVideoElement | null)[]>([]);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const tiles = set.takes.map((take) => ({ ...take, media: take.id ? media(take.id) : undefined }));
  const playable = tiles.some((tile) => tile.state === 'succeeded' && tile.media?.kind === 'video');
  const present = () => videos.current.filter((video): video is HTMLVideoElement => !!video);

  // The first playing video sets the clock; the others follow it within a frame.
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const follow = () => {
      const [lead, ...rest] = present();
      if (lead) {
        setTime(lead.currentTime);
        for (const video of rest)
          if (Math.abs(video.currentTime - lead.currentTime) > 1 / 24)
            video.currentTime = Math.min(lead.currentTime, video.duration || lead.currentTime);
      }
      frame = requestAnimationFrame(follow);
    };
    frame = requestAnimationFrame(follow);
    return () => cancelAnimationFrame(frame);
  }, [playing]);
  function toggle() {
    const all = present();
    if (playing) {
      all.forEach((video) => video.pause());
      setPlaying(false);
      return;
    }
    const start = all[0]?.ended ? 0 : time;
    all.forEach((video) => {
      video.currentTime = start;
      void video.play().catch(() => {});
    });
    setPlaying(true);
  }
  function seek(value: number) {
    setTime(value);
    present().forEach((video) => (video.currentTime = value));
  }

  return (
    <section className="take-set" aria-label="Takes to compare">
      <header>
        <strong>
          {set.kept
            ? `Kept take ${set.takes.findIndex((take) => take.id === set.kept) + 1} of ${set.count}`
            : set.state === 'running'
              ? `${set.count} takes · ${set.stage}`
              : `${set.count} takes · pick the one to keep`}
        </strong>
        {set.state === 'running' && onCancel && (
          <button type="button" className="button" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
        )}
      </header>
      <div className={`take-set-grid takes-${set.count}`}>
        {tiles.map((tile, index) => (
          <figure key={index} className={set.kept && set.kept === tile.id ? 'kept' : ''}>
            <div className="take-set-picture">
              {tile.state === 'succeeded' && tile.media ? (
                tile.media.kind === 'video' ? (
                  <video
                    ref={(element) => {
                      videos.current[index] = element;
                    }}
                    src={mediaUrl(tile.media.url)}
                    muted
                    playsInline
                    preload="auto"
                    aria-label={`Take ${index + 1}`}
                    onLoadedMetadata={(event) => {
                      // Read it now: the updater runs after React has released the event.
                      const length = event.currentTarget.duration || 0;
                      setDuration((current) => Math.max(current, length));
                    }}
                    onEnded={() => index === 0 && setPlaying(false)}
                  />
                ) : (
                  <img src={mediaUrl(tile.media.url)} alt={`Take ${index + 1}`} />
                )
              ) : (
                <span role="status">
                  {tile.error ? (
                    tile.error
                  ) : (
                    <>
                      {tile.id && <span className="job-progress-ring small" aria-hidden="true" />}
                      {tile.id ? 'Rendering' : 'Up next'}
                    </>
                  )}
                </span>
              )}
            </div>
            <figcaption>
              <span title={`Seed ${tile.seed}`}>Take {index + 1}</span>
              {set.kept && set.kept === tile.id ? (
                <span className="take-set-kept">
                  <Check size={13} aria-hidden="true" /> Kept
                </span>
              ) : (
                <button
                  type="button"
                  className="button"
                  disabled={busy || tile.state !== 'succeeded'}
                  onClick={() => onKeep(tile.id!)}
                >
                  Keep this take
                </button>
              )}
            </figcaption>
          </figure>
        ))}
      </div>
      {playable && (
        <div className="take-set-transport">
          <button
            type="button"
            className="icon-button"
            aria-label={playing ? 'Pause all takes' : 'Play all takes together'}
            onClick={toggle}
          >
            {playing ? <Pause size={15} /> : <Play size={15} />}
          </button>
          <input
            type="range"
            aria-label="Position in every take"
            min={0}
            max={duration || 1}
            step={1 / 24}
            value={Math.min(time, duration || 1)}
            onChange={(event) => seek(Number(event.target.value))}
          />
          <small>
            {time.toFixed(2)} / {duration.toFixed(2)} s
          </small>
        </div>
      )}
    </section>
  );
}

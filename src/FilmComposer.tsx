import { useEffect, useRef, useState, type SetStateAction } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Clapperboard,
  Download,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Mic,
  Pause,
  Play,
  Plus,
  Type,
  Upload,
  X,
} from 'lucide-react';
import { renderDimensions, type Render } from './domain';
import {
  filmDraftSchema,
  filmTimeline,
  filmDimensions,
  type Film,
  type FilmDraft,
  type FilmAsset,
} from './film';
import { motionAt, motionProgress } from './film-motion';
import { GraphicPreview, MotionGraphicsEditor, MotionTrackEditor } from './MotionGraphics';
import { MotionSceneEditor, MotionScenePreview, reconcileMotionScene } from './MotionScene';
import {
  titleMotion,
  titleTypography,
  wordMotion,
  spokenTitleState,
  retimeSpokenWord,
} from './title-motion';
import { apiFetch, browserDemo, mediaUrl } from './transport';
import PreviewVideo from './PreviewVideo';
import './film.css';
import NarratedCut from './NarratedCut';
import { filmExportKey, exportAttemptKey } from './narrated-cut';
import { cameraAt, type CameraKeyframe, type FilmFraming } from './film-camera';
import { audioGain } from './film-audio';
import { FilmRecorder } from './FilmRecorder';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(url, init),
    body = await response.json();
  if (!response.ok) throw Error(body.error || 'Film request failed.');
  return body;
}
const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
const rounded = (number: number) => Math.round(number * 24) / 24;
const display = (number: number) => Number(number.toFixed(3));
type Title = NonNullable<FilmDraft['titles']>[number];

const defaultFraming: FilmFraming = { zoom: 1, endZoom: 1, x: 0.5, y: 0.5 };

function ShotCameraEditor({
  framing,
  duration,
  shotNumber,
  onChange,
  onSeek,
}: {
  framing?: FilmFraming;
  duration: number;
  shotNumber: number;
  onChange: (framing: FilmFraming) => void;
  onSeek: (seconds: number) => void;
}) {
  const current = framing || defaultFraming;
  const keys = current.keyframes;
  // Export samples first through last displayed frame, rather than the following cut boundary.
  const cameraDuration = Math.max(1 / 24, rounded(duration) - 1 / 24);
  function simpleChange(key: 'zoom' | 'endZoom' | 'x' | 'y', value: number) {
    if (!Number.isFinite(value)) return;
    const { keyframes: _keys, ...simple } = current;
    onChange({
      ...simple,
      [key]: Math.max(
        key === 'zoom' || key === 'endZoom' ? 1 : 0,
        Math.min(key === 'zoom' || key === 'endZoom' ? 3 : 1, value),
      ),
    });
  }
  function writeKeys(next: CameraKeyframe[]) {
    const first = next[0],
      last = next[next.length - 1];
    onChange({
      ...current,
      zoom: first.zoom,
      endZoom: last.zoom,
      x: first.x,
      y: first.y,
      keyframes: next,
    });
  }
  function changeMode(mode: string) {
    if (mode === 'keyframes') {
      writeKeys([
        { at: 0, ...cameraAt(current, 0) },
        { at: 1, ...cameraAt(current, 1), easing: 'linear' },
      ]);
    } else if (keys) {
      const first = keys[0],
        last = keys[keys.length - 1];
      const { keyframes: _keys, ...simple } = current;
      onChange({ ...simple, zoom: first.zoom, endZoom: last.zoom, x: first.x, y: first.y });
    }
  }
  let widestGap = 0;
  for (let index = 1; keys && index < keys.length; index++) {
    if (keys[index].at - keys[index - 1].at > (keys[widestGap + 1]?.at ?? 0) - keys[widestGap].at)
      widestGap = index - 1;
  }
  const canAdd =
    !!keys &&
    keys.length < 8 &&
    (keys[widestGap + 1].at - keys[widestGap].at) * cameraDuration >= 2 / 24 - 1e-6;
  function addKey() {
    if (!keys || !canAdd) return;
    const at = (keys[widestGap].at + keys[widestGap + 1].at) / 2;
    writeKeys([
      ...keys.slice(0, widestGap + 1),
      { at, ...cameraAt(current, at), easing: 'ease-in-out' },
      ...keys.slice(widestGap + 1),
    ]);
    onSeek(at * cameraDuration);
  }
  function updateKey(index: number, change: Partial<CameraKeyframe>) {
    if (!keys) return;
    writeKeys(keys.map((key, keyIndex) => (keyIndex === index ? { ...key, ...change } : key)));
  }
  function moveKey(index: number, seconds: number) {
    if (!keys || !Number.isFinite(seconds) || index === 0 || index === keys.length - 1) return;
    const gap = keys[index + 1].at - keys[index - 1].at;
    const margin = Math.min(1 / 24 / cameraDuration, gap / 3);
    const at = Math.max(
      keys[index - 1].at + margin,
      Math.min(keys[index + 1].at - margin, seconds / cameraDuration),
    );
    updateKey(index, { at });
    onSeek(at * cameraDuration);
  }
  return (
    <details className="film-framing">
      <summary>Camera & framing{keys ? ` · ${keys.length} keyframes` : ''}</summary>
      <label className="film-camera-mode">
        Fit to canvas
        <select
          aria-label={`Shot ${shotNumber} fit`}
          value={current.fit || 'contain'}
          onChange={(event) =>
            onChange({ ...current, fit: event.target.value as 'contain' | 'cover' })
          }
        >
          <option value="contain">Fit · show the whole image</option>
          <option value="cover">Fill · crop centrally to the canvas</option>
        </select>
      </label>
      <label className="film-camera-mode">
        Camera motion
        <select
          aria-label={`Shot ${shotNumber} camera mode`}
          value={keys ? 'keyframes' : 'simple'}
          onChange={(event) => changeMode(event.target.value)}
        >
          <option value="simple">Simple zoom</option>
          <option value="keyframes">Keyframe path</option>
        </select>
      </label>
      {keys ? (
        <div className="film-camera-path">
          <p>
            Set the camera at each moment. Focus 0 is left/top; 1 is right/bottom. Easing controls
            the move into that keyframe. At 1× zoom the full canvas stays visible.
          </p>
          <ol className="film-camera-keys">
            {keys.map((key, index) => (
              <li key={index}>
                <div className="film-camera-key-heading">
                  <button
                    type="button"
                    onClick={() => onSeek(key.at * cameraDuration)}
                    aria-label={`Preview shot ${shotNumber} keyframe ${index + 1}`}
                  >
                    <Play size={13} />
                    {index === 0
                      ? 'Start'
                      : index === keys.length - 1
                        ? 'End'
                        : `Keyframe ${index + 1}`}
                  </button>
                  {index > 0 && index < keys.length - 1 && (
                    <button
                      type="button"
                      className="film-camera-remove"
                      aria-label={`Remove shot ${shotNumber} keyframe ${index + 1}`}
                      onClick={() => writeKeys(keys.filter((_, keyIndex) => keyIndex !== index))}
                    >
                      <X size={14} /> Remove
                    </button>
                  )}
                </div>
                <div className="film-camera-fields">
                  <label>
                    Time in cut (s)
                    <input
                      type="number"
                      step={1 / 24}
                      min={0}
                      max={cameraDuration}
                      aria-label={`Shot ${shotNumber} keyframe ${index + 1} time`}
                      value={display(key.at * cameraDuration)}
                      readOnly={index === 0 || index === keys.length - 1}
                      onChange={(event) => moveKey(index, event.target.valueAsNumber)}
                    />
                  </label>
                  <label>
                    Zoom
                    <input
                      type="number"
                      min={1}
                      max={3}
                      step={0.05}
                      aria-label={`Shot ${shotNumber} keyframe ${index + 1} zoom`}
                      value={key.zoom}
                      onChange={(event) => {
                        const value = event.target.valueAsNumber;
                        if (Number.isFinite(value))
                          updateKey(index, { zoom: Math.max(1, Math.min(3, value)) });
                      }}
                    />
                  </label>
                  <label>
                    Horizontal focus
                    <input
                      type="number"
                      min={0}
                      max={1}
                      step={0.05}
                      aria-label={`Shot ${shotNumber} keyframe ${index + 1} horizontal focus`}
                      value={key.x}
                      onChange={(event) => {
                        const value = event.target.valueAsNumber;
                        if (Number.isFinite(value))
                          updateKey(index, { x: Math.max(0, Math.min(1, value)) });
                      }}
                    />
                  </label>
                  <label>
                    Vertical focus
                    <input
                      type="number"
                      min={0}
                      max={1}
                      step={0.05}
                      aria-label={`Shot ${shotNumber} keyframe ${index + 1} vertical focus`}
                      value={key.y}
                      onChange={(event) => {
                        const value = event.target.valueAsNumber;
                        if (Number.isFinite(value))
                          updateKey(index, { y: Math.max(0, Math.min(1, value)) });
                      }}
                    />
                  </label>
                  {index > 0 && (
                    <label className="film-camera-easing">
                      Move into keyframe
                      <select
                        aria-label={`Shot ${shotNumber} keyframe ${index + 1} easing`}
                        value={key.easing || 'ease-in-out'}
                        onChange={(event) =>
                          updateKey(index, {
                            easing: event.target.value as CameraKeyframe['easing'],
                          })
                        }
                      >
                        <option value="ease-in-out">Smooth start & stop</option>
                        <option value="ease-out">Fast start, soft stop</option>
                        <option value="linear">Constant speed</option>
                        <option value="hold">Hold, then jump</option>
                      </select>
                    </label>
                  )}
                </div>
              </li>
            ))}
          </ol>
          <button type="button" className="button" disabled={!canAdd} onClick={addKey}>
            <Plus size={14} /> Add keyframe
          </button>
          <small>
            Up to 8 keyframes. Start and end stay fixed to the first and last displayed frames.
            Switching to Simple zoom removes intermediate moves and keeps the starting focus.
          </small>
        </div>
      ) : (
        <>
          <div className="film-layer-settings">
            {(
              [
                ['zoom', 'Start zoom', 1, 3],
                ['endZoom', 'End zoom', 1, 3],
                ['x', 'Horizontal focus', 0, 1],
                ['y', 'Vertical focus', 0, 1],
              ] as const
            ).map(([key, label, min, max]) => (
              <label key={key}>
                {label}
                <input
                  aria-label={`Shot ${shotNumber} ${label.toLowerCase()}`}
                  type="number"
                  min={min}
                  max={max}
                  step={0.05}
                  value={current[key]}
                  onChange={(event) => simpleChange(key, event.target.valueAsNumber)}
                />
              </label>
            ))}
          </div>
          <p>
            Focus 0 is left/top; 1 is right/bottom. Use keyframes to pan, pause or change direction.
          </p>
        </>
      )}
    </details>
  );
}

function ShotPicture({
  shot,
  asset,
  take,
  elapsed,
  duration,
  opacity,
  playing,
  volume,
  onReadiness,
}: {
  shot: FilmDraft['shots'][number];
  asset?: FilmAsset;
  take?: Render;
  elapsed: number;
  duration: number;
  opacity: number;
  playing: boolean;
  volume: number;
  onReadiness: (ready: boolean, failed?: boolean) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const source = asset?.url || take?.output;
  const sourceTime = rounded(shot.start) + Math.max(0, Math.min(elapsed, duration - 1 / 24));
  const progress = Math.max(0, Math.min(1, elapsed / Math.max(1 / 24, duration - 1 / 24)));
  const framing = shot.framing;
  const camera = framing ? cameraAt(framing, progress) : undefined;
  const style = {
    opacity,
    ...(framing?.fit === 'cover' ? { objectFit: 'cover' as const, objectPosition: 'center' } : {}),
    ...(camera
      ? {
          transform: `scale(${camera.zoom})`,
          transformOrigin: `${camera.x * 100}% ${camera.y * 100}%`,
        }
      : {}),
  };
  useEffect(() => {
    onReadiness(false);
    if (
      (video.current && video.current.readyState >= 3 && !video.current.seeking) ||
      (image.current?.complete && image.current.naturalWidth > 0)
    )
      onReadiness(true);
    return () => onReadiness(false);
    // Each keyed picture owns its readiness, including when a prior shot is remounted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    if (
      element.readyState >= 1 &&
      !element.seeking &&
      Math.abs(element.currentTime - sourceTime) > 0.15
    )
      element.currentTime = sourceTime;
    element.volume = Math.max(0, Math.min(1, volume));
    if (playing) void element.play().catch(() => {});
    else element.pause();
  }, [sourceTime, playing, volume]);
  if (!source) return null;
  function frameReady() {
    const element = video.current;
    if (
      element &&
      !element.seeking &&
      element.readyState >= 3 &&
      Math.abs(element.currentTime - sourceTime) < 0.2
    )
      onReadiness(true);
  }
  return asset?.kind === 'image' ? (
    <img
      style={style}
      ref={image}
      src={mediaUrl(source)}
      alt={asset.name}
      onLoad={() => onReadiness(true)}
      onError={() => onReadiness(false, true)}
    />
  ) : (
    <PreviewVideo
      style={style}
      ref={video}
      mediaSrc={source}
      playsInline
      preload="auto"
      onLoadedMetadata={() => {
        onReadiness(false);
        if (video.current) video.current.currentTime = sourceTime;
      }}
      onCanPlay={frameReady}
      onSeeked={frameReady}
      onWaiting={() => onReadiness(false)}
      onError={() => onReadiness(false, true)}
    />
  );
}

function TitlePreview({ title, time: visualTime }: { title: Title; time: number }) {
  if (visualTime < title.start || visualTime >= title.end) return null;
  const motion = titleMotion(title, visualTime),
    typography = titleTypography(title),
    words = title.text.trim().split(/\s+/);
  let wordIndex = 0,
    characterIndex = 0;
  const spoken = spokenTitleState(title, visualTime);
  const transform = motionAt(title.motion, motionProgress(title.start, title.end, visualTime));
  const content =
    title.animation === 'spoken' ? (
      <span className="spoken-words">
        {spoken.words.map((word, index) => {
          const active = title.words!.indexOf(word) === spoken.active;
          return (
            <span key={index}>
              {index > 0 ? ' ' : ''}
              <span
                className="spoken-word"
                style={{
                  color: active ? '#17210f' : '#ffffff',
                  backgroundColor: active ? title.color : 'transparent',
                  boxShadow: active ? `0 0 0 .08em ${title.color}` : undefined,
                  textShadow: active ? 'none' : undefined,
                  WebkitTextStroke: active ? '0 transparent' : undefined,
                }}
              >
                {word.text}
              </span>
            </span>
          );
        })}
      </span>
    ) : title.animation === 'build' ? (
      title.text.split(/(\s+)/).map((word, index) => {
        if (/^\s+$/.test(word) || !word) return word;
        const part = wordMotion(
          wordIndex++,
          words.length,
          visualTime - title.start,
          motion.duration,
        );
        return (
          <span className="kinetic-word" key={index}>
            <i style={{ opacity: part.opacity, transform: `translateY(${part.y}em)` }}>{word}</i>
          </span>
        );
      })
    ) : title.animation === 'typewriter' ? (
      title.text.split(/(\s+)/).map((word, index) => {
        if (/^\s+$/.test(word) || !word) {
          characterIndex += Array.from(word).length;
          return word;
        }
        return (
          <span className="type-word" key={index}>
            {Array.from(word).map((character) => {
              const at = characterIndex++;
              return (
                <span
                  className="type-letter"
                  key={at}
                  style={{
                    visibility: at < motion.visibleCharacters ? 'visible' : 'hidden',
                  }}
                >
                  {character}
                  {motion.caret && at === motion.visibleCharacters - 1 && (
                    <i className="type-caret" />
                  )}
                </span>
              );
            })}
          </span>
        );
      })
    ) : (
      title.text
    );
  return (
    <div
      key={title.id}
      className="draft-title-transform"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        opacity: transform.opacity,
        transform: title.motion
          ? `translate(${transform.x * 100}%, ${transform.y * 100}%) rotate(${transform.rotation}deg) scale(${transform.scale * transform.scaleX}, ${transform.scale * transform.scaleY})`
          : undefined,
        transformOrigin: '50% 50%',
      }}
    >
      <div
        className={`draft-title ${title.style} ${title.position} motion-${title.animation}`}
        style={{
          color: title.color,
          opacity: motion.opacity,
          fontSize: title.fontSize ? `${title.fontSize / 12.8}cqw` : undefined,
          fontWeight: typography.fontWeight,
          textAlign: typography.align,
          WebkitTextStroke: typography.stroke ? `${2 / 12.8}cqw #080c09be` : '0 transparent',
          paintOrder: 'stroke fill',
          translate:
            title.animation === 'rise'
              ? `0 ${-18 * (1 - Math.min(1, (visualTime - title.start) / 0.35))}px`
              : undefined,
        }}
      >
        <span
          className="title-content"
          style={{
            transform: title.animation === 'impact' ? `scale(${motion.scale})` : undefined,
            clipPath:
              title.animation === 'wipe' ? `inset(0 ${(1 - motion.ease) * 100}% 0 0)` : undefined,
          }}
        >
          {content}
        </span>
      </div>
    </div>
  );
}

function DraftPlayer({
  draft,
  assets,
  renders,
  titles,
  time,
  setTime,
  playRequest,
  pauseRequest,
}: {
  draft: FilmDraft;
  assets: FilmAsset[];
  renders: Render[];
  titles: Record<string, string>;
  time: number;
  setTime: (time: number) => void;
  playRequest: number;
  pauseRequest: number;
}) {
  const [playing, setPlaying] = useState(false);
  const [pictures, setPictures] = useState<Record<string, { ready: boolean; failed: boolean }>>({});
  const audio = useRef<(HTMLAudioElement | null)[]>([]);
  const timeline = filmTimeline(draft.shots),
    duration = timeline.at(-1)?.end || 0;
  // At the end marker, retain the last displayed frame instead of removing its titles.
  const visualTime = Math.min(time, Math.max(0, duration - 1 / 24));
  let current = 0;
  timeline.forEach((cut, index) => {
    if (time >= cut.start) current = index;
  });
  const incoming = timeline[current];
  const dissolve = incoming?.overlap && time < incoming.start + incoming.overlap;
  const opacity = dissolve ? Math.max(0, (time - incoming.start) / incoming.overlap) : 1;
  const visible = draft.shots.length ? (dissolve ? [current - 1, current] : [current]) : [];
  const mounted = [...visible, ...(current + 1 < draft.shots.length ? [current + 1] : [])];
  const pictureKey = (index: number) => {
    const shot = draft.shots[index];
    return `${index}:${shot.assetId || shot.renderId}:${assets.find((asset) => asset.id === shot.assetId)?.sha256 || ''}:${shot.start}:${shot.end}`;
  };
  const currentPicture = draft.shots.length ? pictures[pictureKey(current)] : undefined;
  const ready = !!currentPicture?.ready;
  useEffect(() => {
    if (playRequest) setPlaying(true);
  }, [playRequest]);
  useEffect(() => {
    setPlaying(false);
  }, [pauseRequest]);
  useEffect(() => {
    if (!playing || !ready) return;
    const start = performance.now(),
      origin = time;
    let frame = 0;
    const tick = (now: number) => {
      const next = Math.min(duration, origin + (now - start) / 1000);
      setTime(next);
      if (next >= duration) setPlaying(false);
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // The clock owns playback time until paused; scrubbing pauses it first.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, ready, duration, playRequest]);
  useEffect(() => {
    (draft.audio || []).forEach((track, index) => {
      const element = audio.current[index];
      if (!element) return;
      const local = time - track.start,
        active = local >= 0 && local < track.sourceEnd - track.sourceStart;
      element.volume = Math.max(0, Math.min(1, audioGain(track, local)));
      if (active && Math.abs(element.currentTime - (track.sourceStart + local)) > 0.15)
        element.currentTime = track.sourceStart + local;
      if (playing && ready && active) void element.play().catch(() => {});
      else element.pause();
    });
  }, [time, playing, ready, draft.audio]);
  return (
    <div className="draft-preview">
      <div className={`draft-picture ${draft.aspect}`}>
        {mounted.map((index) => (
          <ShotPicture
            key={pictureKey(index)}
            shot={draft.shots[index]}
            asset={assets.find((asset) => asset.id === draft.shots[index].assetId)}
            take={renders.find((take) => take.id === draft.shots[index].renderId)}
            elapsed={time - timeline[index].start}
            duration={timeline[index].duration}
            opacity={index === current ? opacity : index < current ? 1 : 0}
            playing={playing && ready && visible.includes(index)}
            volume={
              visible.includes(index)
                ? (draft.sourceVolume ?? 1) * (index === current ? opacity : 1 - opacity)
                : 0
            }
            onReadiness={(ready, failed = false) => {
              const key = pictureKey(index);
              setPictures((previous) =>
                previous[key]?.ready === ready && previous[key]?.failed === failed
                  ? previous
                  : { ...previous, [key]: { ready, failed } },
              );
            }}
          />
        ))}
        {!visible.length && <span>Your film starts here.</span>}
        {draft.motionScene ? (
          <MotionScenePreview
            scene={draft.motionScene}
            time={visualTime}
            renderLayer={(layer, frameTime) => {
              if (layer.kind === 'title') {
                const title = draft.titles?.find((item) => item.id === layer.id);
                return title ? <TitlePreview title={title} time={frameTime} /> : null;
              }
              const graphic = draft.graphics?.find((item) => item.id === layer.id);
              return graphic ? (
                <GraphicPreview
                  graphics={[graphic]}
                  assets={assets}
                  time={frameTime}
                  width={filmDimensions(draft)[0]}
                  height={filmDimensions(draft)[1]}
                />
              ) : null;
            }}
          />
        ) : (
          <>
            <GraphicPreview
              graphics={draft.graphics || []}
              assets={assets}
              time={visualTime}
              width={filmDimensions(draft)[0]}
              height={filmDimensions(draft)[1]}
            />
            {(draft.titles || []).map((title) => (
              <TitlePreview key={title.id} title={title} time={visualTime} />
            ))}
          </>
        )}
      </div>
      {draft.motionScene?.groups.some((group) => (group.shutter?.exposure || 0) > 0) && (
        <p className="motion-scene-preview-note">
          Shutter blur appears in the exported video. Preview shows the central pose.
        </p>
      )}
      {(draft.audio || []).map((track, index) => {
        const asset = assets.find((asset) => asset.id === track.assetId);
        return (
          asset && (
            <audio
              key={`${track.assetId}-${index}`}
              ref={(element) => {
                audio.current[index] = element;
              }}
              src={mediaUrl(asset.url)}
              preload="auto"
            />
          )
        );
      })}
      <div className="draft-transport">
        <button
          aria-label={playing ? 'Pause film draft' : 'Play film draft'}
          disabled={!duration}
          onClick={() => {
            if (time >= duration) setTime(0);
            setPlaying(!playing);
          }}
        >
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <input
          aria-label="Film playhead"
          type="range"
          min={0}
          max={Math.max(duration, 0.001)}
          step={1 / 24}
          value={Math.min(time, duration)}
          onChange={(event) => {
            setPlaying(false);
            setTime(Number(event.target.value));
          }}
        />
        <output>
          {time.toFixed(1)} / {duration.toFixed(1)}s
        </output>
      </div>
      <div className="film-mini-timeline" aria-label="Film shot timeline">
        {draft.shots.map((shot, index) => {
          const cut = timeline[index],
            asset = assets.find((asset) => asset.id === shot.assetId),
            take = renders.find((take) => take.id === shot.renderId),
            name =
              asset?.name || (take && (titles[take.id] || take.recipe.name)) || `Shot ${index + 1}`;
          return (
            <button
              type="button"
              key={index}
              className={index === current ? 'active' : ''}
              style={{ width: Math.min(180, 144 + Math.sqrt(cut.duration) * 8) }}
              onClick={() => {
                setPlaying(false);
                setTime(cut.start);
              }}
              aria-label={`Preview shot ${index + 1}`}
              aria-current={index === current ? 'true' : undefined}
              title={`Shot ${index + 1} · ${name} · ${cut.duration.toFixed(2)}s${cut.overlap ? ` · ${cut.overlap.toFixed(2)}s dissolve` : ''}`}
            >
              <span className="film-mini-thumbnail" aria-hidden="true">
                <Clapperboard size={18} />
                {asset?.kind === 'image' && (
                  <img
                    key={asset.id}
                    src={mediaUrl(asset.url)}
                    alt=""
                    width={42}
                    height={42}
                    loading="lazy"
                    decoding="async"
                    draggable={false}
                    onError={(event) => {
                      event.currentTarget.hidden = true;
                    }}
                  />
                )}
              </span>
              <span className="film-mini-shot-info">
                <span className="film-mini-shot-meta">
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <span>{cut.duration.toFixed(2)}s</span>
                </span>
                <span className="film-mini-shot-name">{name}</span>
              </span>
            </button>
          );
        })}
      </div>
      {currentPicture?.failed ? (
        <small role="alert">
          This picture could not load. Reimport its media or choose another shot.
        </small>
      ) : playing && !ready ? (
        <small role="status">Preparing picture… Playback waits for the media.</small>
      ) : (
        <small>Draft preview · Export for final typography and audio mix.</small>
      )}
    </div>
  );
}

export default function FilmComposer({
  renders,
  titles,
  mediaRevision = 0,
}: {
  renders: Render[];
  titles: Record<string, string>;
  mediaRevision?: number;
}) {
  const [draft, setDraftState] = useState<FilmDraft>(() => {
    try {
      return filmDraftSchema.parse(
        JSON.parse(localStorage.getItem('aftertake-film-draft') || 'null'),
      );
    } catch {
      return {
        name: 'An ordinary place, otherwise',
        aspect: 'landscape',
        shots: [],
        titles: [],
        audio: [],
        sourceVolume: 1,
        normalizeAudio: true,
      };
    }
  });
  function setDraft(next: SetStateAction<FilmDraft>) {
    setDraftState((current) =>
      reconcileMotionScene(typeof next === 'function' ? next(current) : next),
    );
  }
  const [films, setFilms] = useState<Film[]>([]),
    [assets, setAssets] = useState<FilmAsset[]>([]);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(''),
    [selected, setSelected] = useState('');
  const [choice, setChoice] = useState(''),
    [audioChoice, setAudioChoice] = useState(''),
    [time, setTime] = useState(0);
  const [text, setText] = useState(''),
    [voice, setVoice] = useState('af_heart'),
    [speed, setSpeed] = useState(1);
  const [trimAudio, setTrimAudio] = useState(false);
  const [focused, setFocused] = useState(false);
  const [playRequest, setPlayRequest] = useState(0);
  const [pauseRequest, setPauseRequest] = useState(0);
  const pendingCameraSeek = useRef<number | null>(null);
  const [preparedPreview, setPreparedPreview] = useState<{
    draft: FilmDraft;
    identity: string;
  } | null>(null);
  const upload = useRef<HTMLInputElement>(null),
    manifestInput = useRef<HTMLInputElement>(null);
  const finished = renders.filter((take) => take.state === 'succeeded' && take.output);
  const visualAssets = assets.filter((asset) => asset.kind !== 'audio'),
    audioAssets = assets.filter((asset) => asset.kind === 'audio');
  const cuts = filmTimeline(draft.shots);
  const duration = cuts.at(-1)?.end || 0,
    pending = films.some((film) => film.state === 'assembling');
  const viewing = preparedPreview?.draft || draft,
    viewingDuration = filmTimeline(viewing.shots).at(-1)?.end || 0;
  const preview =
    films.find((film) => film.id === selected) || films.find((film) => film.state === 'ready');
  useEffect(() => {
    if (!focused) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFocused(false);
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [focused]);
  useEffect(() => {
    localStorage.setItem('aftertake-film-draft', JSON.stringify(draft));
  }, [draft]);
  useEffect(() => {
    setPreparedPreview(null);
  }, [draft]);
  useEffect(() => {
    setTime(pendingCameraSeek.current ?? 0);
    pendingCameraSeek.current = null;
  }, [preparedPreview?.identity]);
  useEffect(() => {
    let live = true;
    const refresh = () => {
      void request<Film[]>('/api/films')
        .then((found) => {
          if (live) setFilms(found);
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
      if (!browserDemo)
        void request<FilmAsset[]>('/api/films/assets')
          .then((found) => {
            if (live) setAssets(found);
          })
          .catch((e) => {
            if (live) setError(e.message);
          });
    };
    refresh();
    const interval = setInterval(refresh, pending ? 1500 : 10000);
    return () => {
      live = false;
      clearInterval(interval);
    };
  }, [pending, mediaRevision]);
  function addShot(value: string) {
    const [kind, id] = value.split(':');
    const take = finished.find((take) => take.id === id),
      asset = visualAssets.find((asset) => asset.id === id);
    const end =
      kind === 'take' && take
        ? Math.floor(renderDimensions(take.recipe).duration * 24) / 24
        : asset?.kind === 'image'
          ? 5
          : Math.floor((asset?.duration || 0) * 24) / 24;
    if (end >= 0.25)
      setDraft({
        ...draft,
        shots: [
          ...draft.shots,
          { ...(kind === 'take' ? { renderId: id } : { assetId: id }), start: 0, end },
        ],
      });
  }
  function addAudio(asset: FilmAsset, allowTrim = false) {
    const start = rounded(Math.min(time, Math.max(0, duration - 0.25))),
      available = Math.max(0, duration - start);
    if (available < 0.1 || (asset.duration > available + 0.001 && !allowTrim)) {
      setError(
        `This audio needs ${asset.duration.toFixed(2)}s of picture; ${available.toFixed(2)}s remains here. Add footage or move the playhead earlier. Imported audio can be trimmed explicitly.`,
      );
      return;
    }
    setError('');
    const length = allowTrim ? Math.min(asset.duration, available) : asset.duration;
    setDraft((current) => ({
      ...current,
      audio: [
        ...(current.audio || []),
        { assetId: asset.id, start, sourceStart: 0, sourceEnd: length, volume: 1 },
      ],
    }));
  }
  async function importAsset(file?: File): Promise<boolean> {
    if (!file) return false;
    setBusy('Importing media…');
    setError('');
    try {
      if (file.size > 100 * 1024 * 1024) throw Error('Use a media file under 100 MB.');
      const asset = await request<FilmAsset>(
        `/api/films/assets?name=${encodeURIComponent(file.name)}`,
        { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file },
      );
      setAssets((all) => [asset, ...all.filter((item) => item.id !== asset.id)]);
      if (asset.kind === 'audio') setAudioChoice(asset.id);
      else setChoice(`asset:${asset.id}`);
      return true;
    } catch (error) {
      setError((error as Error).message);
      return false;
    } finally {
      setBusy('');
    }
  }
  async function narrate() {
    setBusy('Voicing locally…');
    setError('');
    try {
      const asset = await request<FilmAsset>('/api/films/narration', json({ text, voice, speed }));
      setAssets((all) => [asset, ...all.filter((item) => item.id !== asset.id)]);
      setAudioChoice(asset.id);
      addAudio(asset);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function assemble() {
    setBusy('Sending film…');
    setError('');
    try {
      const key = exportAttemptKey(await filmExportKey(draft), films);
      const film = await request<Film>('/api/films', {
        ...json(draft),
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
      });
      setFilms((all) => [film, ...all.filter((item) => item.id !== film.id)]);
      setSelected(film.id);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function importManifest(file?: File) {
    if (!file) return;
    setError('');
    try {
      if (file.size > 2 * 1024 * 1024) throw Error('Use a film manifest under 2 MB.');
      const project = await file.text();
      const submitted = filmDraftSchema.parse(JSON.parse(project));
      const resolved = filmDraftSchema.parse(
        await request<FilmDraft>('/api/films/resolve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: project,
        }),
      );
      // Resolution may rebind media IDs by hash, but must retain the complete edit.
      const editingSettings = (value: FilmDraft) =>
        JSON.stringify({
          ...value,
          shots: value.shots.map(({ assetId: _asset, renderId: _render, ...edit }) => edit),
          audio: value.audio?.map(({ assetId: _asset, ...edit }) => edit),
          graphics: value.graphics?.map(({ assetId: _asset, ...edit }) => edit),
        });
      if (editingSettings(submitted) !== editingSettings(resolved))
        throw Error(
          'The studio did not retain every edit setting. Restart it with the matching app version before importing this project. Your current film has been kept.',
        );
      if (!browserDemo) setAssets(await request<FilmAsset[]>('/api/films/assets'));
      setDraft(resolved);
      setTime(0);
    } catch (error) {
      setError((error as Error).message);
    }
  }
  function titleChange(id: string, change: Partial<Title>) {
    setDraft({
      ...draft,
      titles: draft.titles?.map((title) =>
        title.id === id
          ? {
              ...title,
              ...change,
              ...(change.text !== undefined && change.text !== title.text && title.words
                ? {
                    words: undefined,
                    ...(title.animation === 'spoken' ? { animation: 'fade' as const } : {}),
                  }
                : {}),
            }
          : title,
      ),
    });
  }
  return (
    <section className={`film-desk${focused ? ' film-focused' : ''}`} aria-label="Film assembly">
      <div className="film-heading">
        <div>
          <div className="eyebrow">02 / ASSEMBLE</div>
          <h2>Cut. Title. Tell the story.</h2>
        </div>
        <button
          className="film-focus-toggle"
          aria-label={focused ? 'Exit expanded film editor' : 'Expand film editor'}
          aria-pressed={focused}
          onClick={() => setFocused(!focused)}
        >
          {focused ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
        </button>
      </div>
      <p>
        Bring your takes, footage and stills. Add timed typography and a local voiceover. Export a
        finished film with its editable project.
      </p>
      <div className="film-tools">
        <button
          className="button"
          disabled={browserDemo || !!busy}
          onClick={() => upload.current?.click()}
        >
          <Upload size={14} />
          Import media
        </button>
        <FilmRecorder
          disabled={browserDemo || !!busy || pending}
          onRecorded={async (file) => {
            if (!(await importAsset(file)))
              throw Error(
                'Film could not import this recording. The recording is still available to retry.',
              );
          }}
        />
        <button
          className="film-import"
          disabled={browserDemo || !!busy}
          onClick={() => manifestInput.current?.click()}
        >
          Import film project ↗
        </button>
        <input
          hidden
          type="file"
          accept="video/*,image/*,audio/*,.mkv,.flac,.m4a"
          ref={upload}
          onChange={(event) => {
            void importAsset(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
        <input
          hidden
          type="file"
          accept="application/json,.json"
          ref={manifestInput}
          onChange={(event) => {
            void importManifest(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
      </div>
      <div className="film-settings">
        <label>
          Film name
          <input
            aria-label="Film name"
            maxLength={100}
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
        </label>
        <label>
          Canvas
          <select
            aria-label="Film canvas"
            value={draft.aspect}
            onChange={(event) =>
              setDraft({ ...draft, aspect: event.target.value as FilmDraft['aspect'] })
            }
          >
            <option value="landscape">Landscape · 16:9</option>
            <option value="portrait">Portrait · 9:16</option>
            <option value="square">Square · 1:1</option>
          </select>
        </label>
        <label>
          Export size
          <select
            aria-label="Film export resolution"
            value={draft.resolution || '720p'}
            onChange={(event) =>
              setDraft({ ...draft, resolution: event.target.value as FilmDraft['resolution'] })
            }
          >
            <option value="720p">720p · quick export</option>
            <option value="1080p">1080p · full HD</option>
            <option value="2160p">2160p · 4K canvas</option>
          </select>
        </label>
      </div>
      <div className="film-overview" aria-label="Film project summary">
        <span>
          <strong>{viewing.shots.length}</strong> cuts
        </span>
        <span>
          <strong>{viewing.titles?.length || 0}</strong> titles
        </span>
        <span>
          <strong>{viewing.graphics?.length || 0}</strong> graphics
        </span>
        <span>
          <strong>{viewing.audio?.length || 0}</strong> sound clips
        </span>
        <span>
          <strong>{viewingDuration.toFixed(1)}s</strong> duration
        </span>
      </div>
      {preparedPreview && (
        <div className="narrated-preview-note">
          <strong>Previewing prepared narrated cut</strong>
          <button className="film-import" onClick={() => setPreparedPreview(null)}>
            Return to current film
          </button>
        </div>
      )}
      <NarratedCut
        draft={draft}
        assets={assets}
        pictureNames={Object.fromEntries([
          ...finished.map((take) => [take.id, titles[take.id] || take.recipe.name]),
          ...visualAssets.map((asset) => [asset.id, asset.name]),
        ])}
        disabled={!!busy || pending}
        onBusy={setBusy}
        onAssets={(found) =>
          setAssets((all) => [
            ...found,
            ...all.filter((item) => !found.some((next) => next.id === item.id)),
          ])
        }
        onApply={(next) => {
          setDraft(next);
          setTime(0);
          setPreparedPreview(null);
        }}
        onPreview={setPreparedPreview}
      />
      <DraftPlayer
        key={preparedPreview?.identity || 'current-film'}
        draft={viewing}
        assets={assets}
        renders={renders}
        titles={titles}
        time={time}
        setTime={setTime}
        playRequest={playRequest}
        pauseRequest={pauseRequest}
      />
      <details className="film-editor-section" open>
        <summary>
          01 / Picture <span>{draft.shots.length} cuts</span>
        </summary>
        <div className="film-add">
          <select
            aria-label="Take to add"
            value={choice || (finished[0] ? `take:${finished[0].id}` : '')}
            onChange={(event) => setChoice(event.target.value)}
          >
            <option disabled value="">
              Choose footage
            </option>
            <optgroup label="Finished takes">
              {finished.map((take) => (
                <option key={take.id} value={`take:${take.id}`}>
                  {titles[take.id] || take.recipe.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Imported footage and stills">
              {visualAssets.map((asset) => (
                <option key={asset.id} value={`asset:${asset.id}`}>
                  {asset.name}
                </option>
              ))}
            </optgroup>
          </select>
          <button
            className="button"
            disabled={draft.shots.length >= 48 || (!choice && !finished.length)}
            onClick={() => addShot(choice || `take:${finished[0]?.id}`)}
          >
            <Plus size={14} />
            Add shot
          </button>
        </div>
        <ol className="film-shots">
          {draft.shots.map((shot, index) => {
            const take = renders.find((take) => take.id === shot.renderId),
              asset = assets.find((asset) => asset.id === shot.assetId);
            const max = take ? renderDimensions(take.recipe).duration : asset?.duration || shot.end;
            function change(key: 'start' | 'end', value: number) {
              if (!Number.isFinite(value)) return;
              const next = {
                ...shot,
                [key]:
                  key === 'start'
                    ? Math.max(0, Math.min(shot.end - 0.25, value))
                    : Math.max(shot.start + 0.25, Math.min(max, value)),
              };
              setDraft({
                ...draft,
                shots: draft.shots.map((shot, i) => (i === index ? next : shot)),
              });
            }
            function move(delta: number) {
              const shots = [...draft.shots];
              [shots[index], shots[index + delta]] = [shots[index + delta], shots[index]];
              setDraft({ ...draft, shots });
            }
            return (
              <li key={index}>
                <span className="film-shot-number">{String(index + 1).padStart(2, '0')}</span>
                <div className="film-shot-body">
                  <strong>
                    {take
                      ? titles[take.id] || take.recipe.name
                      : asset?.name || 'Import the original media'}
                  </strong>
                  <div className="film-trims">
                    <label>
                      In
                      <input
                        aria-label={`Shot ${index + 1} in`}
                        type="number"
                        min={0}
                        max={shot.end - 0.25}
                        step={1 / 24}
                        value={display(shot.start)}
                        onChange={(event) => change('start', Number(event.target.value))}
                      />
                    </label>
                    <label>
                      Out
                      <input
                        aria-label={`Shot ${index + 1} out`}
                        type="number"
                        min={shot.start + 0.25}
                        max={max}
                        step={1 / 24}
                        value={display(shot.end)}
                        onChange={(event) => change('end', Number(event.target.value))}
                      />
                    </label>
                    <span>{(shot.end - shot.start).toFixed(2)}s</span>
                  </div>
                  {index > 0 && (
                    <label className="film-dissolve">
                      Dissolve in
                      <input
                        aria-label={`Shot ${index + 1} dissolve`}
                        type="number"
                        min={0}
                        max={1}
                        step={1 / 24}
                        value={display(shot.dissolve ?? 0)}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          if (!Number.isFinite(value)) return;
                          setDraft({
                            ...draft,
                            shots: draft.shots.map((item, i) =>
                              i === index
                                ? { ...item, dissolve: rounded(Math.max(0, Math.min(1, value))) }
                                : item,
                            ),
                          });
                        }}
                      />
                      <span>seconds · overlaps trims; 0 = cut</span>
                    </label>
                  )}
                  <ShotCameraEditor
                    framing={shot.framing}
                    duration={cuts[index].duration}
                    shotNumber={index + 1}
                    onChange={(framing) =>
                      setDraft({
                        ...draft,
                        shots: draft.shots.map((item, i) =>
                          i === index ? { ...item, framing } : item,
                        ),
                      })
                    }
                    onSeek={(seconds) => {
                      const target = cuts[index].start + seconds;
                      setPauseRequest((request) => request + 1);
                      if (preparedPreview) {
                        pendingCameraSeek.current = target;
                        setPreparedPreview(null);
                      } else setTime(target);
                    }}
                  />
                </div>
                <div className="film-order">
                  <button
                    title={`Move shot ${index + 1} up`}
                    disabled={!index}
                    onClick={() => move(-1)}
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    title={`Move shot ${index + 1} down`}
                    disabled={index === draft.shots.length - 1}
                    onClick={() => move(1)}
                  >
                    <ArrowDown size={14} />
                  </button>
                  <button
                    title={`Remove shot ${index + 1}`}
                    onClick={() =>
                      setDraft({ ...draft, shots: draft.shots.filter((_, i) => i !== index) })
                    }
                  >
                    <X size={14} />
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      </details>
      <details className="film-editor-section" open>
        <summary>
          02 / Typography <span>{draft.titles?.length || 0} layers</span>
        </summary>
        <button
          className="button"
          disabled={duration < 0.25 || (draft.titles?.length || 0) >= 80}
          onClick={() => {
            const start = rounded(Math.min(time, Math.max(0, duration - 1)));
            setDraft({
              ...draft,
              titles: [
                ...(draft.titles || []),
                {
                  id: crypto.randomUUID(),
                  text: 'Make it your own.',
                  start,
                  end: Math.min(duration, start + 3),
                  style: 'headline',
                  position: 'center',
                  animation: 'build',
                  motionDuration: 0.8,
                  fontSize: 112,
                  color: '#d5e991',
                },
              ],
            });
          }}
        >
          <Type size={14} />
          Add title at playhead
        </button>
        {(draft.titles || []).map((title, index) => (
          <div className="film-layer" key={title.id}>
            <div className="film-layer-heading">
              <strong>Title {index + 1}</strong>
              <button
                className="replay-title"
                aria-label={`Preview title ${index + 1}`}
                onClick={() => {
                  setTime(title.start);
                  setPlayRequest((value) => value + 1);
                }}
              >
                <Play size={12} />
                Replay motion
              </button>
              <button
                aria-label={`Remove title ${index + 1}`}
                onClick={() =>
                  setDraft({
                    ...draft,
                    titles: draft.titles?.filter((item) => item.id !== title.id),
                  })
                }
              >
                <X size={14} />
              </button>
            </div>
            <textarea
              aria-label={`Title ${index + 1} text`}
              value={title.text}
              maxLength={240}
              rows={2}
              onChange={(event) => titleChange(title.id, { text: event.target.value })}
            />
            <div className="film-layer-settings">
              <label>
                From
                <input
                  aria-label={`Title ${index + 1} start`}
                  type="number"
                  min={0}
                  max={duration}
                  step={1 / 24}
                  value={display(title.start)}
                  onChange={(event) => titleChange(title.id, { start: Number(event.target.value) })}
                />
              </label>
              <label>
                Until
                <input
                  aria-label={`Title ${index + 1} end`}
                  type="number"
                  min={0}
                  max={duration}
                  step={1 / 24}
                  value={display(title.end)}
                  onChange={(event) => titleChange(title.id, { end: Number(event.target.value) })}
                />
              </label>
              <label>
                Style
                <select
                  aria-label={`Title ${index + 1} style`}
                  value={title.style}
                  onChange={(event) =>
                    titleChange(title.id, { style: event.target.value as Title['style'] })
                  }
                >
                  <option value="headline">Headline</option>
                  <option value="caption">Caption</option>
                  <option value="kicker">Kicker</option>
                </select>
              </label>
              <label>
                Position
                <select
                  aria-label={`Title ${index + 1} position`}
                  value={title.position}
                  onChange={(event) =>
                    titleChange(title.id, { position: event.target.value as Title['position'] })
                  }
                >
                  <option value="top">Top</option>
                  <option value="center">Center</option>
                  <option value="bottom">Bottom</option>
                </select>
              </label>
              <label>
                Motion
                <select
                  aria-label={`Title ${index + 1} animation`}
                  value={title.animation}
                  onChange={(event) => {
                    titleChange(title.id, { animation: event.target.value as Title['animation'] });
                    setTime(title.start);
                  }}
                >
                  <option value="spoken" disabled={!title.words}>
                    Follow voice
                  </option>
                  <option value="build">Word build</option>
                  <option value="typewriter">Typewriter</option>
                  <option value="impact">Impact</option>
                  <option value="wipe">Wipe</option>
                  <option value="rise">Rise</option>
                  <option value="fade">Fade</option>
                  <option value="none">Still</option>
                </select>
              </label>
              {['build', 'typewriter', 'impact', 'wipe'].includes(title.animation) && (
                <label>
                  Entrance seconds
                  <input
                    aria-label={`Title ${index + 1} motion duration`}
                    type="number"
                    min={0.15}
                    max={4}
                    step={0.05}
                    value={title.motionDuration ?? 0.8}
                    onChange={(event) =>
                      titleChange(title.id, { motionDuration: Number(event.target.value) })
                    }
                  />
                </label>
              )}
              <label>
                Type size
                <input
                  aria-label={`Title ${index + 1} font size`}
                  type="number"
                  min={16}
                  max={180}
                  step={2}
                  value={title.fontSize ?? { headline: 72, caption: 48, kicker: 28 }[title.style]}
                  onChange={(event) =>
                    titleChange(title.id, { fontSize: Number(event.target.value) })
                  }
                />
              </label>
              <label>
                Weight
                <select
                  aria-label={`Title ${index + 1} font weight`}
                  value={titleTypography(title).fontWeight}
                  onChange={(event) =>
                    titleChange(title.id, {
                      fontWeight: Number(event.target.value) as Title['fontWeight'],
                    })
                  }
                >
                  <option value={400}>Regular</option>
                  <option value={500}>Medium</option>
                  <option value={600}>Semibold</option>
                  <option value={700}>Bold</option>
                </select>
              </label>
              <label>
                Alignment
                <select
                  aria-label={`Title ${index + 1} alignment`}
                  value={titleTypography(title).align}
                  onChange={(event) =>
                    titleChange(title.id, { align: event.target.value as Title['align'] })
                  }
                >
                  <option value="left">Left</option>
                  <option value="center">Center</option>
                  <option value="right">Right</option>
                </select>
              </label>
              <label>
                Outline
                <select
                  aria-label={`Title ${index + 1} outline`}
                  value={titleTypography(title).stroke ? 'on' : 'off'}
                  onChange={(event) =>
                    titleChange(title.id, { stroke: event.target.value === 'on' })
                  }
                >
                  <option value="on">On</option>
                  <option value="off">Off</option>
                </select>
              </label>
              <label>
                Color
                <input
                  aria-label={`Title ${index + 1} color`}
                  type="color"
                  value={title.color}
                  onChange={(event) => titleChange(title.id, { color: event.target.value })}
                />
              </label>
            </div>
            <MotionTrackEditor
              motion={title.motion}
              onChange={(motion) => titleChange(title.id, { motion })}
              onPreview={(progress) => {
                setPauseRequest((request) => request + 1);
                const first = Math.ceil(title.start * 24 - 1e-7);
                const last = Math.ceil(title.end * 24 - 1e-7) - 1;
                setTime((first + Math.round(progress * (last - first))) / 24);
              }}
            />
            {title.words && (
              <details className="film-speech-timing">
                <summary>Speech timing · {title.words.length} words</summary>
                <p>
                  Model estimates, in seconds from this title's start. Review against the voice.
                  Changing the title wording clears these timings.
                </p>
                {title.words.map((word, at) => (
                  <div className="speech-word-row" key={at}>
                    <strong>{word.text}</strong>
                    <label>
                      From
                      <input
                        aria-label={`Title ${index + 1} word ${at + 1} start`}
                        type="number"
                        min={0}
                        max={title.end - title.start}
                        step={1 / 24}
                        value={display(word.start)}
                        onChange={(event) =>
                          titleChange(title.id, {
                            words: retimeSpokenWord(title, at, 'start', Number(event.target.value)),
                          })
                        }
                      />
                    </label>
                    <label>
                      Until
                      <input
                        aria-label={`Title ${index + 1} word ${at + 1} end`}
                        type="number"
                        min={0}
                        max={title.end - title.start}
                        step={1 / 24}
                        value={display(word.end)}
                        onChange={(event) =>
                          titleChange(title.id, {
                            words: retimeSpokenWord(title, at, 'end', Number(event.target.value)),
                          })
                        }
                      />
                    </label>
                  </div>
                ))}
              </details>
            )}
          </div>
        ))}
      </details>
      <MotionGraphicsEditor
        graphics={draft.graphics || []}
        orderingManagedByScene={!!draft.motionScene}
        assets={assets}
        duration={duration}
        time={time}
        onChange={(graphics) => setDraft({ ...draft, graphics })}
        onSeek={(value) => {
          setPauseRequest((request) => request + 1);
          setTime(value);
        }}
      />
      <MotionSceneEditor
        draft={draft}
        duration={duration}
        disabled={!!busy || pending}
        onChange={(motionScene) => setDraft({ ...draft, motionScene })}
        onSeek={(value) => {
          setPauseRequest((request) => request + 1);
          setTime(value);
        }}
        onReplay={(value) => {
          setTime(value);
          setPlayRequest((request) => request + 1);
        }}
      />
      <details className="film-editor-section" open>
        <summary>
          03 / Voice & sound <span>{draft.audio?.length || 0} clips</span>
        </summary>
        <label className="film-source-volume">
          Original sound{' '}
          <input
            aria-label="Film original sound volume"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={draft.sourceVolume ?? 1}
            onChange={(event) => setDraft({ ...draft, sourceVolume: Number(event.target.value) })}
          />
          <output>{Math.round((draft.sourceVolume ?? 1) * 100)}%</output>
        </label>
        <label className="film-source-volume">
          <input
            type="checkbox"
            aria-label="Normalize final film audio"
            checked={draft.normalizeAudio ?? false}
            onChange={(event) => setDraft({ ...draft, normalizeAudio: event.target.checked })}
          />
          Normalize final mix · consistent web playback volume
        </label>
        <label className="film-narration-label">
          Narration script
          <textarea
            aria-label="Narration script"
            placeholder="Tell the story. Your voiceover runs locally with open weights."
            rows={4}
            maxLength={3000}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </label>
        <div className="film-voice-controls">
          <label>
            Voice
            <select
              aria-label="Narration voice"
              value={voice}
              onChange={(event) => setVoice(event.target.value)}
            >
              <option value="af_heart">Heart · US</option>
              <option value="af_sarah">Sarah · US</option>
              <option value="am_michael">Michael · US</option>
              <option value="bm_george">George · UK</option>
            </select>
          </label>
          <label>
            Speed
            <input
              aria-label="Narration speed"
              type="number"
              min={0.8}
              max={1.3}
              step={0.05}
              value={speed}
              onChange={(event) => setSpeed(Number(event.target.value))}
            />
          </label>
          <button
            className="button"
            disabled={
              browserDemo || !!busy || !text.trim() || !duration || (draft.audio?.length || 0) >= 32
            }
            onClick={() => void narrate()}
          >
            <Mic size={14} />
            Voice script
          </button>
        </div>
        <small>
          Local Kokoro · open weights · generic preset voices. Generated clips remain available
          below.
        </small>
        <div className="film-add">
          <select
            aria-label="Audio to add"
            value={audioChoice || audioAssets[0]?.id || ''}
            onChange={(event) => {
              setAudioChoice(event.target.value);
              setTrimAudio(false);
            }}
          >
            <option disabled value="">
              Import audio or voice a script
            </option>
            {audioAssets.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.name} · {asset.duration.toFixed(1)}s
              </option>
            ))}
          </select>
          <button
            className="button"
            disabled={!duration || !audioAssets.length || (draft.audio?.length || 0) >= 32}
            onClick={() => {
              const asset = audioAssets.find(
                (asset) => asset.id === (audioChoice || audioAssets[0]?.id),
              );
              if (asset) addAudio(asset, trimAudio && !asset.narration);
            }}
          >
            <Plus size={14} />
            Add audio
          </button>
        </div>
        {audioAssets.find(
          (asset) => asset.id === (audioChoice || audioAssets[0]?.id) && !asset.narration,
        ) && (
          <label className="film-source-volume">
            <input
              type="checkbox"
              aria-label="Trim imported audio to remaining picture"
              checked={trimAudio}
              onChange={(event) => setTrimAudio(event.target.checked)}
            />
            Trim this imported audio to the remaining picture
          </label>
        )}
        {(draft.audio || []).map((track, index) => {
          const asset = assets.find((asset) => asset.id === track.assetId);
          function change(change: Partial<typeof track>) {
            const next = { ...track, ...change };
            const fadeLimit = Math.min(10, Math.max(0, next.sourceEnd - next.sourceStart));
            if (next.fadeIn !== undefined) next.fadeIn = Math.min(fadeLimit, next.fadeIn);
            if (next.fadeOut !== undefined) next.fadeOut = Math.min(fadeLimit, next.fadeOut);
            setDraft({
              ...draft,
              audio: draft.audio?.map((item, i) => (i === index ? next : item)),
            });
          }
          return (
            <div className="film-layer" key={`${track.assetId}-${index}`}>
              <div className="film-layer-heading">
                <strong>{asset?.name || 'Import the original audio'}</strong>
                <button
                  aria-label={`Remove audio ${index + 1}`}
                  onClick={() =>
                    setDraft({ ...draft, audio: draft.audio?.filter((_, i) => i !== index) })
                  }
                >
                  <X size={14} />
                </button>
              </div>
              {asset && (
                <audio
                  src={mediaUrl(asset.url)}
                  controls
                  preload="metadata"
                  aria-label={`Audio ${index + 1} preview`}
                />
              )}
              <div className="film-layer-settings">
                <label>
                  At
                  <input
                    aria-label={`Audio ${index + 1} start`}
                    type="number"
                    min={0}
                    max={duration}
                    step={1 / 24}
                    value={display(track.start)}
                    onChange={(event) => change({ start: Number(event.target.value) })}
                  />
                </label>
                <label>
                  In
                  <input
                    aria-label={`Audio ${index + 1} in`}
                    type="number"
                    min={0}
                    max={asset?.duration}
                    step={0.01}
                    value={display(track.sourceStart)}
                    onChange={(event) => change({ sourceStart: Number(event.target.value) })}
                  />
                </label>
                <label>
                  Out
                  <input
                    aria-label={`Audio ${index + 1} out`}
                    type="number"
                    min={0.1}
                    max={asset?.duration}
                    step={0.01}
                    value={display(track.sourceEnd)}
                    onChange={(event) => change({ sourceEnd: Number(event.target.value) })}
                  />
                </label>
                <label>
                  Level
                  <input
                    aria-label={`Audio ${index + 1} volume`}
                    type="number"
                    min={0}
                    max={2}
                    step={0.05}
                    value={track.volume}
                    onChange={(event) => change({ volume: Number(event.target.value) })}
                  />
                </label>
                {(['fadeIn', 'fadeOut'] as const).map((key) => (
                  <label key={key}>
                    {key === 'fadeIn' ? 'Fade in (s)' : 'Fade out (s)'}
                    <input
                      aria-label={`Audio ${index + 1} ${key === 'fadeIn' ? 'fade in' : 'fade out'}`}
                      type="number"
                      min={0}
                      max={Math.min(10, Math.max(0, track.sourceEnd - track.sourceStart))}
                      step={0.05}
                      value={display(track[key] ?? 0)}
                      onChange={(event) => {
                        const value = event.target.valueAsNumber;
                        if (Number.isFinite(value)) change({ [key]: Math.max(0, value) });
                      }}
                    />
                  </label>
                ))}
              </div>
              {asset?.narration && (
                <details className="narration-receipt">
                  <summary>Voice script & receipt</summary>
                  <p>{asset.narration.text}</p>
                  <small>
                    {asset.narration.model} · {asset.narration.voice} · {asset.narration.speed}×
                    {asset.narrationOrigin === 'imported' && (
                      <>
                        <br />
                        Imported project receipt · audio hash matched.
                      </>
                    )}
                  </small>
                </details>
              )}
            </div>
          );
        })}
      </details>
      <div className="film-export">
        <span>
          {draft.shots.length} shots · {duration.toFixed(2)}s · 24 fps
        </span>
        <button
          className="button"
          disabled={
            browserDemo ||
            !!busy ||
            pending ||
            !!preparedPreview ||
            !draft.shots.length ||
            !draft.name.trim()
          }
          onClick={() => void assemble()}
        >
          {busy || pending ? (
            <LoaderCircle className="spin" size={14} />
          ) : (
            <Clapperboard size={14} />
          )}{' '}
          {busy ||
            (pending
              ? 'Exporting film…'
              : preparedPreview
                ? 'Use prepared cut above'
                : 'Export film')}
        </button>
      </div>
      {browserDemo && (
        <p className="browser-film-note">
          Arrange recorded takes and titles here. Import, narration and export run in your local
          studio.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {films[0]?.state === 'failed' && <p role="alert">{films[0].error}</p>}
      {preview?.state === 'ready' && (
        <div className="film-preview">
          <p className="changed-note">
            Last exported film · Export again to apply your latest edits.
          </p>
          <PreviewVideo
            key={preview.id}
            mediaSrc={preview.output!}
            controls
            playsInline
            preload="metadata"
            aria-label="Exported film preview"
          />
          <div>
            <strong>{preview.name}</strong>
            <a className="button" href={mediaUrl(preview.output!)} download={`${preview.name}.mp4`}>
              <Download size={13} />
              Film
            </a>
            <a href={mediaUrl(`/api/films/${preview.id}/manifest`)} download>
              Editable film project ↗
            </a>
          </div>
        </div>
      )}
      {films.filter((film) => film.state === 'ready').length > 1 && (
        <div className="film-history">
          {films
            .filter((film) => film.state === 'ready')
            .map((film) => (
              <button key={film.id} onClick={() => setSelected(film.id)}>
                {film.name} · {film.duration.toFixed(1)}s
              </button>
            ))}
        </div>
      )}
    </section>
  );
}

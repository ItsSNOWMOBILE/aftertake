import { useEffect, useRef, useState } from 'react';
import { Download, Film, LoaderCircle, Music, Sparkles, Wand2, X } from 'lucide-react';
import { apiFetch, browserDemo, mediaUrl } from './transport';
import type { Clip, Engine } from './domain';
import {
  describeEnhancement,
  enhanceMaxSeconds,
  enhanceOutput,
  enhanceRequestSchema,
  enhancementBusy,
  songKeys,
  songRequestSchema,
  type EnhanceRequest,
  type Enhancement,
  type SongRequest,
} from './enhance';
import RenderEstimate from './RenderEstimate';
import './image-studio.css';
import './enhance-studio.css';

type Operation = 'upscale' | 'smooth' | 'slow2' | 'slow4';
const operations: { id: Operation; title: string; line: (clip?: Clip) => string }[] = [
  {
    id: 'upscale',
    title: 'Upscale ×2',
    line: (clip) =>
      `SeedVR2 restores detail at twice the size${clip ? `: ${clip.width} × ${clip.height} → ${clip.width * 2} × ${clip.height * 2}` : ''}.`,
  },
  {
    id: 'smooth',
    title: 'Smooth motion',
    line: () => 'RIFE adds an in-between frame: 24 → 48 fps, same length, sound kept.',
  },
  { id: 'slow2', title: 'Slow motion ×2', line: () => 'Twice as long at 24 fps, silent.' },
  { id: 'slow4', title: 'Slow motion ×4', line: () => 'Four times as long at 24 fps, silent.' },
];
const songStarters: { label: string; tags: string; bpm: number; keyscale: string }[] = [
  {
    label: 'Cinematic score',
    tags: 'cinematic orchestral score, soaring strings, warm brass, deep percussion, hopeful and grand',
    bpm: 90,
    keyscale: 'D minor',
  },
  {
    label: 'Lo-fi beat',
    tags: 'lo-fi hip hop, dusty drums, mellow electric piano, vinyl crackle, relaxed',
    bpm: 82,
    keyscale: 'F major',
  },
  {
    label: 'Upbeat pop',
    tags: 'upbeat electro pop, bright synths, punchy drums, catchy female vocals',
    bpm: 118,
    keyscale: 'C major',
  },
  {
    label: 'Ambient',
    tags: 'ambient soundscape, soft pads, gentle piano, airy textures, calm',
    bpm: 70,
    keyscale: 'E minor',
  },
  {
    label: 'Trailer hit',
    tags: 'epic trailer music, pounding drums, deep braams, rising tension, cinematic hits',
    bpm: 100,
    keyscale: 'C minor',
  },
];
const languages = [
  ['en', 'English'],
  ['es', 'Spanish'],
  ['fr', 'French'],
  ['de', 'German'],
  ['it', 'Italian'],
  ['pt', 'Portuguese'],
  ['ja', 'Japanese'],
  ['ko', 'Korean'],
  ['zh', 'Chinese'],
] as const;
const initialSong: SongRequest = {
  format: 'aftertake-song/1',
  name: 'My soundtrack',
  tags: songStarters[0].tags,
  lyrics: '',
  seconds: 30,
  bpm: songStarters[0].bpm,
  keyscale: songStarters[0].keyscale,
  timesignature: '4',
  language: 'en',
  seed: 5090,
};

function enhanceRequest(clip: Clip, operation: Operation): EnhanceRequest {
  const base = {
    format: 'aftertake-enhance/1' as const,
    clip: { ...clip, kind: 'video' as const },
  };
  if (operation === 'upscale')
    return {
      ...base,
      operation: 'upscale',
      name: `${clip.name} · upscaled`.slice(0, 100),
      seed: 5090,
    };
  return {
    ...base,
    operation: 'interpolate',
    name: `${clip.name} · ${operation === 'smooth' ? 'smooth' : 'slow motion'}`.slice(0, 100),
    multiplier: operation === 'slow4' ? 4 : 2,
    timing: operation === 'smooth' ? 'smooth' : 'slow-motion',
  } as EnhanceRequest;
}
async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(url, init),
    value = await response.json();
  if (!response.ok)
    throw Object.assign(Error(value.error || 'The request failed.'), {
      enhancement: value.enhancement,
    });
  return value;
}

export default function EnhanceStudio({
  clips,
  jobs,
  initialClip,
  otherBusy,
  onUpdate,
  onUse,
  onClose,
  onFilmAdded,
}: {
  clips: Clip[];
  jobs: Enhancement[];
  initialClip?: Clip;
  otherBusy: boolean;
  onUpdate: (job: Enhancement) => void;
  onUse: (clip: Clip) => void;
  onClose: () => void;
  onFilmAdded?: () => void;
}) {
  const videos = clips.filter((clip) => clip.kind !== 'image');
  const [tab, setTab] = useState<'video' | 'song'>('video'),
    [clipId, setClipId] = useState(
      initialClip && initialClip.kind !== 'image' ? initialClip.id : videos[0]?.id || '',
    ),
    [operation, setOperation] = useState<Operation>('upscale'),
    [song, setSong] = useState(initialSong),
    [engine, setEngine] = useState<Engine | null>(null),
    [selected, setSelected] = useState(''),
    [sending, setSending] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const dialog = useRef<HTMLElement>(null);
  const clip = videos.find((item) => item.id === clipId);
  const request: EnhanceRequest | SongRequest | undefined =
    tab === 'song' ? song : clip && enhanceRequest(clip, operation);
  const validation = request
    ? request.format === 'aftertake-song/1'
      ? songRequestSchema.safeParse(request)
      : enhanceRequestSchema.safeParse(request)
    : undefined;
  const feature = tab === 'song' ? 'song' : operation === 'upscale' ? 'upscale' : 'interpolate';
  const pending = jobs.find(enhancementBusy),
    viewed = jobs.find((job) => job.id === selected) || jobs[0];
  useEffect(() => {
    let live = true;
    setEngine(null);
    const check = () =>
      api<Engine>(`/api/engine?pipeline=${feature}`)
        .then((value) => live && setEngine(value))
        .catch(() => {});
    void check();
    const timer = setInterval(check, 5000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [feature]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLButtonElement>('.modal-close')?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  async function create() {
    if (!request || !validation?.success) return;
    setSending(true);
    setError('');
    setNotice('');
    try {
      const job = await api<Enhancement>('/api/enhancements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify(validation.data),
      });
      onUpdate(job);
      setSelected(job.id);
    } catch (e) {
      const failure = e as Error & { enhancement?: Enhancement };
      if (failure.enhancement) onUpdate(failure.enhancement);
      setError(failure.message);
    } finally {
      setSending(false);
    }
  }
  async function act(job: Enhancement, action: 'cancel' | 'reconcile') {
    setSending(true);
    setError('');
    try {
      onUpdate(await api<Enhancement>(`/api/enhancements/${job.id}/${action}`, { method: 'POST' }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }
  async function addToFilm(job: Enhancement) {
    setSending(true);
    setError('');
    try {
      const song = job.request.format === 'aftertake-song/1';
      const response = await apiFetch(song ? `/api/enhancements/${job.id}/audio` : job.clip!.url);
      if (!response.ok) throw Error('The result is unavailable.');
      await api(
        `/api/films/assets?name=${encodeURIComponent(job.request.name + (song ? '.flac' : '.mp4'))}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: await response.blob(),
        },
      );
      onFilmAdded?.();
      setNotice('Added to film media. Open Film editing to place it in your cut.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }
  const locked = sending || Boolean(pending) || otherBusy;
  const output = request?.format === 'aftertake-enhance/1' ? enhanceOutput(request) : undefined;
  return (
    <div className="modal-backdrop image-studio-backdrop" onClick={onClose}>
      <section
        ref={dialog}
        className="modal image-studio enhance-studio"
        role="dialog"
        aria-modal="true"
        aria-label="Enhance and score"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <button className="modal-close" aria-label="Close enhance studio" onClick={onClose}>
          <X size={19} />
        </button>
        <div className="eyebrow">ENHANCE / SEEDVR2 · RIFE · ACE-STEP 1.5</div>
        <h2>Sharper, smoother, scored.</h2>
        <p className="image-intro">
          Upscale a clip, add in-between frames for smooth or slow motion, or compose a song for
          your cut. Each runs as a native ComfyUI workflow on your GPU and makes a new clip or song;
          the source is never changed.
        </p>
        <div className="enhance-tabs" role="tablist" aria-label="Enhance">
          <button role="tab" aria-selected={tab === 'video'} onClick={() => setTab('video')}>
            <Wand2 size={14} /> Upscale &amp; motion
          </button>
          <button role="tab" aria-selected={tab === 'song'} onClick={() => setTab('song')}>
            <Music size={14} /> Make a song
          </button>
        </div>
        <div className="image-studio-grid">
          <div className="image-picture-column">
            <div className="image-picture enhance-picture">
              {viewed?.clip ? (
                <video src={mediaUrl(viewed.clip.url)} controls playsInline />
              ) : viewed?.audio ? (
                <div className="enhance-song">
                  <Music size={30} aria-hidden="true" />
                  <strong>{viewed.request.name}</strong>
                  <audio src={mediaUrl(`/api/enhancements/${viewed.id}/audio`)} controls />
                </div>
              ) : tab === 'video' && clip ? (
                <video src={mediaUrl(clip.url)} controls playsInline muted />
              ) : (
                <div>
                  <p>
                    {tab === 'song'
                      ? 'Your song appears here, ready to add to Film.'
                      : 'Choose a clip to enhance.'}
                  </p>
                </div>
              )}
            </div>
            {viewed && (
              <div className="enhance-result">
                <strong>{viewed.request.name}</strong>
                <small>
                  {describeEnhancement(viewed.request)} ·{' '}
                  {viewed.stage || viewed.state.replaceAll('_', ' ')}
                  {viewed.progress !== null && enhancementBusy(viewed)
                    ? ` · ${Math.round(viewed.progress * 100)}%`
                    : ''}
                </small>
                {viewed.error && <p className="enhance-error">{viewed.error}</p>}
                <div className="image-actions">
                  {viewed.clip && (
                    <button
                      className="button"
                      disabled={locked}
                      onClick={() => onUse(viewed.clip!)}
                    >
                      <Sparkles size={13} /> Use as source
                    </button>
                  )}
                  {(viewed.clip || viewed.audio) && (
                    <button
                      className="button"
                      disabled={sending || browserDemo}
                      onClick={() => void addToFilm(viewed)}
                    >
                      <Film size={13} /> Add to film
                    </button>
                  )}
                  {viewed.audio && (
                    <a
                      className="button"
                      href={mediaUrl(`/api/enhancements/${viewed.id}/audio`)}
                      download={`${viewed.request.name}.flac`}
                    >
                      <Download size={13} /> FLAC
                    </a>
                  )}
                  {viewed.jobId && enhancementBusy(viewed) && viewed.state !== 'finalizing' && (
                    <button
                      className="button"
                      disabled={sending}
                      onClick={() => void act(viewed, 'cancel')}
                    >
                      Cancel
                    </button>
                  )}
                  {['connection_lost', 'submission_unknown', 'output_error'].includes(
                    viewed.state,
                  ) && (
                    <button
                      className="button"
                      disabled={sending}
                      onClick={() => void act(viewed, 'reconcile')}
                    >
                      Check this job
                    </button>
                  )}
                </div>
              </div>
            )}
            {jobs.length > 1 && (
              <div className="enhance-history" aria-label="Earlier results">
                {jobs.slice(0, 12).map((job) => (
                  <button
                    key={job.id}
                    aria-pressed={job.id === viewed?.id}
                    onClick={() => setSelected(job.id)}
                  >
                    {job.request.format === 'aftertake-song/1' ? (
                      <Music size={13} />
                    ) : (
                      <Wand2 size={13} />
                    )}
                    <span>{job.request.name}</span>
                    <small>{job.state.replaceAll('_', ' ')}</small>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="image-controls">
            {tab === 'video' ? (
              <>
                <label>
                  CLIP
                  <select
                    aria-label="Clip to enhance"
                    value={clipId}
                    disabled={locked}
                    onChange={(event) => setClipId(event.target.value)}
                  >
                    {!videos.length && <option value="">Import or create a video first</option>}
                    {videos.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} · {item.width} × {item.height} · {item.duration.toFixed(1)} s
                      </option>
                    ))}
                  </select>
                </label>
                <div className="enhance-operations" role="radiogroup" aria-label="Enhancement">
                  {operations.map((item) => (
                    <button
                      key={item.id}
                      role="radio"
                      aria-checked={operation === item.id}
                      disabled={locked}
                      onClick={() => setOperation(item.id)}
                    >
                      <strong>{item.title}</strong>
                      <small>{item.line(clip)}</small>
                    </button>
                  ))}
                </div>
                {output && (
                  <small>
                    Result: {output.width} × {output.height} · {output.frames} frames at{' '}
                    {output.fps} fps · {output.sound ? 'source sound kept' : 'silent'}. Clips up to{' '}
                    {Math.floor(enhanceMaxSeconds)} seconds.
                  </small>
                )}
              </>
            ) : (
              <>
                <label>
                  NAME
                  <input
                    value={song.name}
                    disabled={locked}
                    onChange={(event) => setSong({ ...song, name: event.target.value })}
                  />
                </label>
                <div className="enhance-starters" aria-label="Song starters">
                  {songStarters.map((starter) => (
                    <button
                      key={starter.label}
                      aria-pressed={song.tags === starter.tags}
                      disabled={locked}
                      onClick={() =>
                        setSong({
                          ...song,
                          tags: starter.tags,
                          bpm: starter.bpm,
                          keyscale: starter.keyscale,
                        })
                      }
                    >
                      {starter.label}
                    </button>
                  ))}
                </div>
                <label>
                  STYLE
                  <textarea
                    rows={3}
                    value={song.tags}
                    disabled={locked}
                    onChange={(event) => setSong({ ...song, tags: event.target.value })}
                  />
                </label>
                <label>
                  LYRICS · OPTIONAL
                  <textarea
                    rows={5}
                    value={song.lyrics}
                    disabled={locked}
                    placeholder={
                      '[Verse]\nYour words here\n\n[Chorus]\nLeave empty for an instrumental'
                    }
                    onChange={(event) => setSong({ ...song, lyrics: event.target.value })}
                  />
                </label>
                <div className="image-settings">
                  <label>
                    LENGTH · SECONDS
                    <input
                      type="number"
                      min={10}
                      max={240}
                      value={song.seconds}
                      disabled={locked}
                      onChange={(event) =>
                        setSong({ ...song, seconds: Number(event.target.value) })
                      }
                    />
                  </label>
                  <label>
                    BPM
                    <input
                      type="number"
                      min={40}
                      max={220}
                      value={song.bpm}
                      disabled={locked}
                      onChange={(event) => setSong({ ...song, bpm: Number(event.target.value) })}
                    />
                  </label>
                  <label>
                    KEY
                    <select
                      value={song.keyscale}
                      disabled={locked}
                      onChange={(event) => setSong({ ...song, keyscale: event.target.value })}
                    >
                      {songKeys.map((key) => (
                        <option key={key}>{key}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    LANGUAGE
                    <select
                      value={song.language}
                      disabled={locked}
                      onChange={(event) => setSong({ ...song, language: event.target.value })}
                    >
                      {languages.map(([code, label]) => (
                        <option key={code} value={code}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </>
            )}
            <button
              className="button image-generate"
              disabled={browserDemo || locked || !engine?.ready || !validation?.success}
              onClick={() => void create()}
            >
              {pending || sending ? (
                <LoaderCircle size={15} className="spin" />
              ) : (
                <Sparkles size={15} />
              )}{' '}
              {pending
                ? 'Working…'
                : tab === 'song'
                  ? 'Create song'
                  : operations.find((item) => item.id === operation)!.title}
            </button>
            {request && <RenderEstimate job={{ request }} history={jobs} gpu={engine?.gpu} />}
            {validation && !validation.success && (
              <p className="enhance-error">{validation.error.issues[0].message}</p>
            )}
            {engine && !engine.ready && !browserDemo && (
              <p className="image-install">
                Install this tool's models once, then restart the engine:{' '}
                <code>node scripts/aftertake.mjs setup-gpu --{feature}</code>
              </p>
            )}
            {otherBusy && !pending && (
              <p className="image-install">
                Another generation is running. Start this when it finishes.
              </p>
            )}
            {error && (
              <p role="alert" className="enhance-error">
                {error}
              </p>
            )}
            {notice && <p className="image-install">{notice}</p>}
          </div>
        </div>
      </section>
    </div>
  );
}

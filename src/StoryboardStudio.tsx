import { useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Clapperboard,
  Download,
  Film,
  LoaderCircle,
  Sparkles,
  X,
} from 'lucide-react';
import { cinemaOptions } from './cinema';
import type { FilmDraft } from './film';
import {
  storyboardBusy,
  storyboardRenders,
  storyboardSongStarters,
  type StoryboardJob,
  type StoryboardPlan,
  type StoryboardShot,
} from './storyboard';
import { apiFetch, browserDemo, mediaUrl, saveMedia } from './transport';
import PreviewVideo from './PreviewVideo';
import './image-studio.css';
import './video-studio.css';
import './storyboard-studio.css';

async function api<T>(url: string, body?: unknown, key?: string): Promise<T> {
  const response = await apiFetch(
    url,
    body === undefined
      ? undefined
      : {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(key ? { 'Idempotency-Key': key } : {}),
          },
          body: JSON.stringify(body),
        },
  );
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(value.error || 'The storyboard request failed.');
  return value;
}

export default function StoryboardStudio({
  onOpenFilm,
  onClose,
}: {
  onOpenFilm: (draft: FilmDraft) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLElement>(null);
  const [idea, setIdea] = useState(
    'A barista opens a tiny seaside café at dawn and pours the first coffee of the day',
  );
  const [count, setCount] = useState(4);
  const [aspect, setAspect] = useState<'landscape' | 'portrait' | 'square'>('landscape');
  const [variation, setVariation] = useState(0);
  const [plan, setPlan] = useState<StoryboardPlan>();
  const [song, setSong] = useState<string>(storyboardSongStarters[0].id);
  const [jobs, setJobs] = useState<StoryboardJob[]>([]);
  const [selected, setSelected] = useState('');
  const [planning, setPlanning] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const viewed = jobs.find((job) => job.id === selected) || jobs[0];

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLElement>('textarea')?.focus();
    let live = true;
    const refresh = () =>
      api<StoryboardJob[]>('/api/storyboards')
        .then((value) => live && setJobs(value))
        .catch(() => {});
    void refresh();
    const timer = setInterval(refresh, 2500);
    return () => {
      live = false;
      clearInterval(timer);
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  async function planShots(next = variation) {
    setError('');
    setPlanning(true);
    try {
      setPlan(
        await api<StoryboardPlan>('/api/storyboards/plan', { idea, shots: count, variation: next }),
      );
      setVariation(next);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setPlanning(false);
    }
  }
  function changeShot(index: number, change: Partial<StoryboardShot>) {
    setPlan(
      (current) =>
        current && {
          ...current,
          shots: current.shots.map((shot, at) => (at === index ? { ...shot, ...change } : shot)),
        },
    );
  }
  function moveShot(index: number, by: -1 | 1) {
    setPlan((current) => {
      if (!current) return current;
      const shots = [...current.shots],
        [shot] = shots.splice(index, 1);
      shots.splice(index + by, 0, shot);
      return { ...current, shots };
    });
  }
  async function make() {
    if (!plan) return;
    const starter = storyboardSongStarters.find((item) => item.id === song)!;
    setError('');
    setSending(true);
    try {
      const job = await api<StoryboardJob>(
        '/api/storyboards',
        {
          idea,
          title: plan.title,
          look: plan.look,
          aspect,
          shots: plan.shots,
          song: { tags: starter.tags, bpm: starter.bpm },
          seed: Math.floor(Math.random() * 2 ** 32),
        },
        crypto.randomUUID(),
      );
      setJobs((all) => [job, ...all.filter((item) => item.id !== job.id)]);
      setSelected(job.id);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setSending(false);
    }
  }
  const video = (job: StoryboardJob) => `/api/storyboards/${job.id}/video`;
  const minutes = plan ? Math.max(2, Math.round((plan.shots.length * 90 + 60) / 60)) : 0;

  return (
    <div className="modal-backdrop image-studio-backdrop" onClick={onClose}>
      <section
        ref={dialog}
        className="modal image-studio storyboard-studio"
        role="dialog"
        aria-modal="true"
        aria-label="Storyboard"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <button className="modal-close" aria-label="Close storyboard" onClick={onClose}>
          <X size={19} />
        </button>
        <div className="eyebrow">STORYBOARD / CREATE VIDEO + SONG + FILM</div>
        <h2>One idea. A film cut to music.</h2>
        <p className="image-intro">
          Describe an idea and Aftertake plans 3 to 5 shots with a local language model. Edit the
          shots, then each one renders with LTX-2.5, ACE-Step composes the score, and the shots are
          cut on its beats in Film with titles and transitions, ready to keep editing.
        </p>
        <div className="storyboard-grid">
          <div className="storyboard-result">
            <div className={`storyboard-picture ${viewed?.request.aspect || aspect}`}>
              {viewed?.state === 'ready' ? (
                <PreviewVideo
                  key={viewed.id}
                  controls
                  playsInline
                  preload="metadata"
                  mediaSrc={video(viewed)}
                  aria-label={`${viewed.request.title} storyboard film`}
                />
              ) : viewed && storyboardBusy(viewed) ? (
                <div role="status">
                  <LoaderCircle className="spin" size={28} aria-hidden="true" />
                  <p>{viewed.stage}</p>
                  {viewed.progress !== null && (
                    <progress max={1} value={viewed.progress} aria-label="Shot progress" />
                  )}
                </div>
              ) : (
                <div>
                  <Clapperboard size={30} aria-hidden="true" />
                  <p>{viewed?.error || 'Your film appears here, cut and scored.'}</p>
                </div>
              )}
            </div>
            {viewed?.state === 'ready' && viewed.draft && (
              <div className="image-actions">
                {/* The browser trial has no Film media library to open the project into. */}
                {!browserDemo && (
                  <button
                    className="button image-generate"
                    onClick={() => {
                      onOpenFilm(viewed.draft!);
                      onClose();
                    }}
                  >
                    <Film size={14} />
                    Open in Film
                  </button>
                )}
                <a
                  className="button"
                  href={mediaUrl(`${video(viewed)}?download=1`)}
                  download={`aftertake-${viewed.request.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.mp4`}
                  onClick={
                    browserDemo
                      ? (event) => {
                          event.preventDefault();
                          void saveMedia(video(viewed), 'aftertake-storyboard.mp4').catch(
                            (failure) => setError(failure.message),
                          );
                        }
                      : undefined
                  }
                >
                  <Download size={14} />
                  Download
                </a>
              </div>
            )}
            {viewed && storyboardBusy(viewed) && (
              <button
                className="button"
                disabled={sending}
                onClick={() =>
                  void api<StoryboardJob>(`/api/storyboards/${viewed.id}/cancel`, {})
                    .then((job) =>
                      setJobs((all) => all.map((item) => (item.id === job.id ? job : item))),
                    )
                    .catch((failure) => setError(failure.message))
                }
              >
                Cancel
              </button>
            )}
            {viewed && (
              <ol className="storyboard-receipt">
                {viewed.request.shots.map((shot, index) => (
                  <li key={index}>
                    <strong>
                      {cinemaOptions.movement.find(([value]) => value === shot.movement)?.[1]} ·{' '}
                      {shot.seconds} s
                    </strong>{' '}
                    {shot.prompt}
                    {viewed.shots[index]?.clip ? ' ✓' : ''}
                  </li>
                ))}
              </ol>
            )}
            {jobs.length > 1 && (
              <div className="video-history" aria-label="Storyboard history">
                {jobs.map((job) => (
                  <button
                    key={job.id}
                    className={viewed?.id === job.id ? 'active' : ''}
                    onClick={() => setSelected(job.id)}
                  >
                    <strong>{job.request.title}</strong>
                    <small>
                      {job.state === 'running' ? job.stage : job.state} · {job.request.shots.length}{' '}
                      shots · {job.request.aspect}
                    </small>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="storyboard-controls">
            <label>
              YOUR IDEA
              <textarea
                aria-label="Storyboard idea"
                rows={3}
                maxLength={600}
                value={idea}
                onChange={(event) => setIdea(event.target.value)}
              />
            </label>
            <div className="image-settings">
              <label>
                SHOTS
                <select
                  aria-label="Number of shots"
                  value={count}
                  onChange={(event) => setCount(Number(event.target.value))}
                >
                  {[3, 4, 5].map((value) => (
                    <option key={value} value={value}>
                      {value} shots
                    </option>
                  ))}
                </select>
              </label>
              <label>
                FRAME
                <select
                  aria-label="Storyboard aspect ratio"
                  value={aspect}
                  onChange={(event) => setAspect(event.target.value as typeof aspect)}
                >
                  <option value="landscape">Landscape · 16:9</option>
                  <option value="portrait">Portrait · 9:16</option>
                  <option value="square">Square · 1:1</option>
                </select>
              </label>
            </div>
            <button
              className="button"
              disabled={planning || idea.trim().length < 10 || browserDemo}
              title={browserDemo ? 'Plan storyboards in the local studio.' : undefined}
              onClick={() => void planShots(plan ? variation + 1 : variation)}
            >
              {planning ? <LoaderCircle className="spin" size={14} /> : <Sparkles size={14} />}
              {planning ? 'Planning on your CPU…' : plan ? 'Plan again' : 'Plan shots'}
            </button>
            {plan && (
              <>
                <small>{plan.note}</small>
                <label>
                  TITLE
                  <input
                    aria-label="Film title"
                    maxLength={60}
                    value={plan.title}
                    onChange={(event) => setPlan({ ...plan, title: event.target.value })}
                  />
                </label>
                <label>
                  WHO AND HOW IT LOOKS · ADDED TO EVERY SHOT
                  <textarea
                    aria-label="Shared character and look"
                    rows={2}
                    maxLength={300}
                    value={plan.look}
                    onChange={(event) => setPlan({ ...plan, look: event.target.value })}
                  />
                </label>
                <ol className="storyboard-shots" aria-label="Shot list">
                  {plan.shots.map((shot, index) => (
                    <li key={index}>
                      <div className="storyboard-shot-head">
                        <strong>Shot {index + 1}</strong>
                        <select
                          aria-label={`Shot ${index + 1} camera move`}
                          value={shot.movement}
                          onChange={(event) =>
                            changeShot(index, {
                              movement: event.target.value as StoryboardShot['movement'],
                            })
                          }
                        >
                          {cinemaOptions.movement.map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                        <select
                          aria-label={`Shot ${index + 1} length`}
                          value={shot.seconds}
                          onChange={(event) =>
                            changeShot(index, { seconds: Number(event.target.value) })
                          }
                        >
                          {[3, 4, 5].map((value) => (
                            <option key={value} value={value}>
                              {value} s
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="icon-button"
                          aria-label={`Move shot ${index + 1} earlier`}
                          disabled={index === 0}
                          onClick={() => moveShot(index, -1)}
                        >
                          <ArrowUp size={14} />
                        </button>
                        <button
                          type="button"
                          className="icon-button"
                          aria-label={`Move shot ${index + 1} later`}
                          disabled={index === plan.shots.length - 1}
                          onClick={() => moveShot(index, 1)}
                        >
                          <ArrowDown size={14} />
                        </button>
                      </div>
                      <textarea
                        aria-label={`Shot ${index + 1} description`}
                        rows={3}
                        maxLength={600}
                        value={shot.prompt}
                        onChange={(event) => changeShot(index, { prompt: event.target.value })}
                      />
                    </li>
                  ))}
                </ol>
                <label>
                  MUSIC
                  <select
                    aria-label="Song style"
                    value={song}
                    onChange={(event) => setSong(event.target.value)}
                  >
                    {storyboardSongStarters.map((starter) => (
                      <option key={starter.id} value={starter.id}>
                        {starter.label} · {starter.bpm} BPM
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="button image-generate"
                  disabled={
                    sending ||
                    browserDemo ||
                    plan.shots.some((shot) => shot.prompt.trim().length < 10)
                  }
                  title={browserDemo ? 'Render storyboards in the local studio.' : undefined}
                  onClick={() => void make()}
                >
                  {sending ? <LoaderCircle className="spin" size={15} /> : <Film size={15} />}
                  Make the film
                </button>
                <small>
                  {storyboardRenders(plan)} renders: one per shot with LTX-2.5 and one ACE-Step
                  song, about {minutes} minutes on an RTX 5080. The cut runs on the CPU.
                </small>
              </>
            )}
            {browserDemo && (
              <small>
                The browser version shows recorded storyboards. Run Aftertake locally to make your
                own.
              </small>
            )}
            {error && (
              <p className="storyboard-error" role="alert">
                {error}
              </p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

import { apiFetch, browserDemo, mediaUrl } from './transport';
import PreviewVideo from './PreviewVideo';
import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Clapperboard, Download, LoaderCircle, Plus, X } from 'lucide-react';
import { renderDimensions, type Render } from './domain';
import { filmDraftSchema, type Film, type FilmDraft } from './film';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(url, init),
    body = await response.json();
  if (!response.ok) throw Error(body.error || 'Film request failed.');
  return body;
}

export default function FilmDesk({
  renders,
  titles,
}: {
  renders: Render[];
  titles: Record<string, string>;
}) {
  const [draft, setDraft] = useState<FilmDraft>(() => {
    try {
      return filmDraftSchema.parse(
        JSON.parse(localStorage.getItem('aftertake-film-draft') || 'null'),
      );
    } catch {
      return { name: 'An ordinary place, otherwise', aspect: 'landscape', shots: [] };
    }
  });
  const [films, setFilms] = useState<Film[]>([]),
    [error, setError] = useState(''),
    [sending, setSending] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const finished = renders.filter((render) => render.state === 'succeeded' && render.output);
  const [choice, setChoice] = useState('');
  const manifestInput = useRef<HTMLInputElement>(null);
  const pending = films.some((film) => film.state === 'assembling');
  useEffect(() => {
    localStorage.setItem('aftertake-film-draft', JSON.stringify(draft));
  }, [draft]);
  useEffect(() => {
    let live = true;
    const refresh = () =>
      request<Film[]>('/api/films')
        .then((found) => {
          if (live) setFilms(found);
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    void refresh();
    const interval = setInterval(refresh, pending ? 1500 : 10000);
    return () => {
      live = false;
      clearInterval(interval);
    };
  }, [pending]);
  const preview =
    films.find((film) => film.id === selected) || films.find((film) => film.state === 'ready');
  const changed =
    preview &&
    (preview.name !== draft.name ||
      preview.aspect !== draft.aspect ||
      preview.shots.length !== draft.shots.length ||
      draft.shots.some((shot, index) => {
        const previous = preview.shots[index];
        return (
          !previous ||
          previous.renderId !== shot.renderId ||
          Math.abs(previous.start - shot.start) >= 1 / 48 ||
          Math.abs(previous.end - shot.end) >= 1 / 48
        );
      }));
  const duration = draft.shots.reduce((sum, shot) => sum + shot.end - shot.start, 0);
  function move(index: number, direction: number) {
    const shots = [...draft.shots],
      target = index + direction;
    [shots[index], shots[target]] = [shots[target], shots[index]];
    setDraft({ ...draft, shots });
  }
  async function assemble() {
    setSending(true);
    setError('');
    try {
      const film = await request<Film>('/api/films', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      setFilms((all) => [film, ...all]);
      setSelected(film.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }
  async function importManifest(file?: File) {
    if (!file) return;
    setError('');
    try {
      if (file.size > 2 * 1024 * 1024) throw Error('Use a shot manifest under 2 MB.');
      const draft = await request<FilmDraft>('/api/films/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: await file.text(),
      });
      setDraft(filmDraftSchema.parse(draft));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section className="film-desk" aria-label="Film assembly">
      <div className="film-heading">
        <div>
          <div className="eyebrow">02 / ASSEMBLE</div>
          <h2>A few takes. One film.</h2>
        </div>
        <Clapperboard size={24} />
      </div>
      <p>
        Choose finished takes, arrange the cuts, and export a film with its editable shot manifest.
        Original sound carries through where available.
      </p>
      <button
        className="film-import"
        disabled={browserDemo}
        onClick={() => manifestInput.current?.click()}
      >
        Import shot manifest ↗
      </button>
      <input
        hidden
        type="file"
        accept="application/json,.json"
        ref={manifestInput}
        onChange={(e) => {
          void importManifest(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <div className="film-settings">
        <label>
          Film name
          <input
            aria-label="Film name"
            maxLength={100}
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </label>
        <label>
          Canvas
          <select
            aria-label="Film canvas"
            value={draft.aspect}
            onChange={(e) => setDraft({ ...draft, aspect: e.target.value as FilmDraft['aspect'] })}
          >
            <option value="landscape">16:9 · 720p</option>
            <option value="portrait">9:16 · 720p</option>
            <option value="square">1:1 · 720p</option>
          </select>
        </label>
      </div>
      <div className="film-add">
        <select
          aria-label="Take to add"
          value={choice || finished[0]?.id || ''}
          onChange={(e) => setChoice(e.target.value)}
          disabled={!finished.length}
        >
          <option disabled value="">
            Render your first take
          </option>
          {finished.map((take) => (
            <option key={take.id} value={take.id}>
              {titles[take.id] || take.recipe.name}
            </option>
          ))}
        </select>
        <button
          className="button"
          disabled={!finished.length || draft.shots.length >= 8}
          onClick={() => {
            const take = finished.find((take) => take.id === (choice || finished[0]?.id));
            if (take)
              setDraft({
                ...draft,
                shots: [
                  ...draft.shots,
                  {
                    renderId: take.id,
                    start: 0,
                    end: Math.floor(renderDimensions(take.recipe).duration * 24) / 24,
                  },
                ],
              });
          }}
        >
          <Plus size={14} />
          Add shot
        </button>
      </div>
      <ol className="film-shots">
        {draft.shots.map((shot, index) => {
          const take = renders.find((take) => take.id === shot.renderId),
            max = take ? renderDimensions(take.recipe).duration : 0;
          function trim(key: 'start' | 'end', value: number) {
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
          return (
            <li key={index}>
              <span className="film-shot-number">{String(index + 1).padStart(2, '0')}</span>
              <div className="film-shot-body">
                <strong>
                  {take
                    ? titles[take.id] || take.recipe.name
                    : 'Take unavailable in this workspace'}
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
                      value={Number(shot.start.toFixed(3))}
                      onChange={(e) => trim('start', Number(e.target.value))}
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
                      value={Number(shot.end.toFixed(3))}
                      onChange={(e) => trim('end', Number(e.target.value))}
                    />
                  </label>
                  <span>{(shot.end - shot.start).toFixed(2)}s</span>
                </div>
              </div>
              <div className="film-order">
                <button
                  title={`Move shot ${index + 1} up`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp size={14} />
                </button>
                <button
                  title={`Move shot ${index + 1} down`}
                  disabled={index === draft.shots.length - 1}
                  onClick={() => move(index, 1)}
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
      {!draft.shots.length && (
        <div className="film-empty">
          Your first cut starts with a finished take. Add up to eight shots.
        </div>
      )}
      <div className="film-export">
        <span>
          {draft.shots.length} shots · {duration.toFixed(2)}s · 24 fps
        </span>
        <button
          className="button"
          disabled={
            browserDemo ||
            !draft.shots.length ||
            !draft.name.trim() ||
            sending ||
            pending ||
            draft.shots.some((shot) => !finished.some((take) => take.id === shot.renderId))
          }
          onClick={() => void assemble()}
        >
          {sending || pending ? (
            <LoaderCircle size={14} className="spin" />
          ) : (
            <Clapperboard size={14} />
          )}{' '}
          {sending || pending ? 'Assembling film…' : 'Export film'}
        </button>
      </div>
      {browserDemo && (
        <p className="browser-film-note">
          Arrange recorded takes here. The local studio exports the finished film.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {films[0]?.state === 'failed' && <p role="alert">{films[0].error}</p>}
      {preview?.state === 'ready' && (
        <div className="film-preview">
          {changed && (
            <p className="changed-note">
              Preview shows the last exported film. Export again to apply these cuts.
            </p>
          )}
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
              Shot manifest ↗
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
                {film.name} · {film.duration.toFixed(1)}s ·{' '}
                {new Date(film.createdAt).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </button>
            ))}
        </div>
      )}
    </section>
  );
}

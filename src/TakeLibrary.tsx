import { useEffect, useState } from 'react';
import { Clapperboard, Search, Star, X } from 'lucide-react';
import type { Render } from './domain';
import { takeBusy } from './take-client';
import './take-library.css';

const pipelineLabel = (take: Render) =>
  take.recipe.pipeline === 'cinema'
    ? 'Camera · LTX-2.5'
    : take.recipe.pipeline === 'motion-transfer'
      ? 'Motion · Wan Animate 2'
      : 'Transform · LTX';

export default function TakeLibrary({
  renders,
  titles,
  selected,
  onSelect,
}: {
  renders: Render[];
  titles: Record<string, string>;
  selected?: string;
  onSelect: (take: Render) => void;
}) {
  const [query, setQuery] = useState(''),
    [kind, setKind] = useState('all'),
    [status, setStatus] = useState('all');
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem('aftertake-favorite-takes') || '[]');
      return Array.isArray(saved)
        ? saved.filter((id): id is string => typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id))
        : [];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('aftertake-favorite-takes', JSON.stringify(favorites));
    } catch {
      /* Browsers may disable persistent storage. */
    }
  }, [favorites]);
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const found = renders
    .map((take, index) => ({ take, number: renders.length - index }))
    .filter(({ take }) => {
      const pipeline =
        take.recipe.pipeline === 'cinema'
          ? 'camera'
          : take.recipe.pipeline === 'motion-transfer'
            ? 'motion'
            : 'transform';
      const text = [
        titles[take.id],
        take.recipe.name,
        take.recipe.prompt,
        take.recipe.clip.name,
        take.recipe.seed,
        pipelineLabel(take),
      ]
        .join(' ')
        .toLocaleLowerCase();
      return (
        (kind === 'all' || kind === pipeline) &&
        (!onlyFavorites || favorites.includes(take.id)) &&
        words.every((word) => text.includes(word)) &&
        (status === 'all' ||
          (status === 'ready' && take.state === 'succeeded') ||
          (status === 'active' && takeBusy(take)) ||
          (status === 'failed' && ['failed', 'expired', 'output_error'].includes(take.state)))
      );
    });
  return (
    <section className="takes" aria-label="Take library">
      <div className="takes-title">
        <span>
          TAKES <b>{renders.length.toString().padStart(2, '0')}</b>
        </span>
        <span>Every experiment belongs here.</span>
      </div>
      {renders.length > 0 && (
        <div className="take-tools">
          <label className="take-search">
            <Search size={14} />
            <input
              aria-label="Search takes"
              placeholder="Search names, prompts, sources…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query && (
              <button aria-label="Clear take search" onClick={() => setQuery('')}>
                <X size={14} />
              </button>
            )}
          </label>
          <select
            aria-label="Take type"
            value={kind}
            onChange={(event) => setKind(event.target.value)}
          >
            <option value="all">All types</option>
            <option value="transform">Transform</option>
            <option value="camera">Camera</option>
            <option value="motion">Motion</option>
          </select>
          <select
            aria-label="Take status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="all">All states</option>
            <option value="ready">Ready</option>
            <option value="active">In progress</option>
            <option value="failed">Needs attention</option>
          </select>
          <button
            className="take-favorites"
            aria-pressed={onlyFavorites}
            onClick={() => setOnlyFavorites(!onlyFavorites)}
          >
            <Star size={13} fill={onlyFavorites ? 'currentColor' : 'none'} />
            Favorites
          </button>
          <output className="take-count" aria-live="polite">
            {found.length} of {renders.length}
          </output>
        </div>
      )}
      {found.length ? (
        <div className="take-list">
          {found.map(({ take, number }) => {
            const name = titles[take.id] || take.recipe.name,
              favorite = favorites.includes(take.id);
            return (
              <div className="take-row" key={take.id}>
                <button
                  className={selected === take.id ? 'take active' : 'take'}
                  aria-pressed={selected === take.id}
                  onClick={() => onSelect(take)}
                >
                  <span className="take-index">{String(number).padStart(2, '0')}</span>
                  <div>
                    <strong>{name}</strong>
                    <small>
                      {pipelineLabel(take)} · {take.recipe.quality} · seed {take.recipe.seed}
                    </small>
                  </div>
                  <span className={`take-state ${take.state}`}>
                    {take.state.replaceAll('_', ' ')}
                  </span>
                </button>
                <button
                  className="take-star"
                  aria-label={`${favorite ? 'Unfavorite' : 'Favorite'} ${name}`}
                  aria-pressed={favorite}
                  title="Favorites are saved in this browser"
                  onClick={() =>
                    setFavorites((all) =>
                      favorite ? all.filter((id) => id !== take.id) : [...all, take.id],
                    )
                  }
                >
                  <Star size={16} fill={favorite ? 'currentColor' : 'none'} />
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="no-takes">
          <Clapperboard size={19} />
          <span>
            {renders.length
              ? 'No takes match these filters.'
              : 'Your first take is waiting to happen.'}
          </span>
          {renders.length ? (
            <button
              onClick={() => {
                setQuery('');
                setKind('all');
                setStatus('all');
                setOnlyFavorites(false);
              }}
            >
              Show all takes
            </button>
          ) : (
            <span>Paint → Direct → Render</span>
          )}
        </div>
      )}
    </section>
  );
}

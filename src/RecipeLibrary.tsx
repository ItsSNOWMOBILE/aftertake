import { apiFetch, browserDemo, mediaUrl, saveMedia } from './transport';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  Download,
  LoaderCircle,
  Play,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import { renderDimensions, type Clip, type Recipe, type Render } from './domain';
import { filterTemplates, type Template } from './templates';

export default function RecipeLibrary({
  current,
  busy,
  onClose,
  onApply,
  onOpen,
}: {
  current: Recipe | null;
  busy: boolean;
  onClose: () => void;
  onApply: (item: Template) => void;
  onOpen: (render: Render, clip: Clip) => void;
}) {
  const [templates, setTemplates] = useState<Template[]>([]),
    [selected, setSelected] = useState<Template | null>(null);
  const [query, setQuery] = useState(''),
    [category, setCategory] = useState<'all' | Template['category']>('all');
  const [error, setError] = useState(''),
    [opening, setOpening] = useState(false),
    [source, setSource] = useState(false),
    [reference, setReference] = useState(false);
  const preview = useRef<HTMLVideoElement>(null),
    search = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLElement>(null),
    back = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  useEffect(() => {
    if (dialog.current) dialog.current.scrollTop = 0;
    (selected ? back : search).current?.focus();
  }, [selected]);
  useEffect(() => {
    let live = true;
    apiFetch('/api/templates')
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw Error(body.error || 'Could not load the library.');
        return body;
      })
      .then((items) => {
        if (live) setTemplates(items);
      })
      .catch((error) => {
        if (live) setError(error.message);
      });
    search.current?.focus();
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !opening) {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [opening, onClose]);
  const filtered = filterTemplates(templates, category, query);
  async function openExample() {
    if (!selected) return;
    setOpening(true);
    setError('');
    try {
      const response = await apiFetch(`/api/templates/${selected.slug}/open`, { method: 'POST' }),
        result = await response.json();
      if (!response.ok) throw Error(result.error || 'Could not open this example.');
      onOpen(result.render, result.clip);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setOpening(false);
    }
  }
  const d = selected ? renderDimensions(selected.recipe) : null;
  const incompatible = current?.clip.kind === 'image' && selected?.recipe.pipeline !== 'cinema';
  const categories = {
    effects: 'REGION EFFECT',
    camera: 'CAMERA RECIPE',
    motion: 'MOTION TRANSFER',
  };
  const referenceLabel =
    selected?.recipe.pipeline === 'motion-transfer'
      ? 'Appearance image'
      : selected?.recipe.endFrame
        ? 'Ending image'
        : 'Edited frame';
  return (
    <div
      className="modal-backdrop"
      onClick={() => {
        if (!opening) onClose();
      }}
    >
      <section
        ref={dialog}
        className="recipe-library"
        role="dialog"
        aria-modal="true"
        aria-label="Effects, motion and camera recipes"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return;
          const items = [
            ...(dialog.current?.querySelectorAll<HTMLElement>(
              'button:not(:disabled),a[href],input:not(:disabled),summary,video[controls]',
            ) || []),
          ].filter((item) => item.getClientRects().length);
          const first = items[0],
            last = items.at(-1);
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        <button
          className="modal-close"
          title="Close recipe library"
          disabled={opening}
          onClick={onClose}
        >
          <X size={20} />
        </button>
        {selected ? (
          <>
            <button
              ref={back}
              className="recipe-back"
              disabled={opening}
              onClick={() => {
                setSelected(null);
                setSource(false);
                setReference(false);
                setError('');
              }}
            >
              <ArrowLeft size={14} />
              All recipes
            </button>
            <div className="eyebrow">{categories[selected.category]} / REAL LOCAL EXAMPLE</div>
            <h2>{selected.title}</h2>
            <div className="recipe-detail">
              <div className="recipe-preview">
                <div className="recipe-preview-tabs">
                  <button
                    className={!source && !reference ? 'active' : ''}
                    onClick={() => {
                      preview.current?.pause();
                      setSource(false);
                      setReference(false);
                    }}
                  >
                    Result
                  </button>
                  <button
                    className={source ? 'active' : ''}
                    onClick={() => {
                      preview.current?.pause();
                      setSource(true);
                      setReference(false);
                    }}
                  >
                    Source
                  </button>
                  {selected.reference && (
                    <button
                      className={reference ? 'active' : ''}
                      onClick={() => {
                        preview.current?.pause();
                        setSource(false);
                        setReference(true);
                      }}
                    >
                      {referenceLabel}
                    </button>
                  )}
                  <span>PRE-RENDERED EXAMPLE</span>
                </div>
                {reference || (source && selected.recipe.clip.kind === 'image') ? (
                  <img
                    src={mediaUrl((reference ? selected.reference : selected.source)!)}
                    alt={
                      reference
                        ? `${referenceLabel} used for this example`
                        : 'Still reference used for this example'
                    }
                  />
                ) : (
                  <video
                    key={`${selected.slug}-${source}`}
                    ref={preview}
                    src={mediaUrl(source ? selected.source : selected.result)}
                    poster={source ? undefined : mediaUrl(selected.poster)}
                    controls
                    muted
                    playsInline
                    preload="metadata"
                    aria-label={source ? 'Example source preview' : 'Example result preview'}
                  />
                )}
                <p>
                  {selected.credit}
                  {selected.sourceUrl && (
                    <>
                      {' '}
                      ·{' '}
                      <a href={selected.sourceUrl} target="_blank" rel="noreferrer">
                        Source ↗
                      </a>
                    </>
                  )}
                  <br />
                  {selected.license}
                  {selected.frameRecipe && (
                    <>
                      <br />
                      <a
                        href={mediaUrl(selected.frameRecipe)}
                        onClick={
                          browserDemo
                            ? (event) => {
                                event.preventDefault();
                                void saveMedia(
                                  selected.frameRecipe!,
                                  'aftertake-frame-recipe.json',
                                ).catch((error) => setError(error.message));
                              }
                            : undefined
                        }
                        download="aftertake-frame-recipe.json"
                      >
                        How this frame was made ↗
                      </a>
                    </>
                  )}
                </p>
                {selected.imageRecipe && (
                  <p>
                    <a
                      href={mediaUrl(selected.imageRecipe)}
                      onClick={
                        browserDemo
                          ? (event) => {
                              event.preventDefault();
                              void saveMedia(
                                selected.imageRecipe!,
                                'aftertake-image-recipe.json',
                              ).catch((error) => setError(error.message));
                            }
                          : undefined
                      }
                      download="aftertake-image-recipe.json"
                    >
                      How this image was generated ↗
                    </a>
                  </p>
                )}
              </div>
              <div className="recipe-details">
                <p>{selected.description}</p>
                <div className="recipe-tags">
                  {selected.tags.map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </div>
                <dl>
                  <div>
                    <dt>RENDER</dt>
                    <dd>
                      {d?.width} × {d?.height} · {d?.fps} fps
                    </dd>
                  </div>
                  <div>
                    <dt>DURATION</dt>
                    <dd>{d?.duration.toFixed(2)} seconds</dd>
                  </div>
                  <div>
                    <dt>MODEL</dt>
                    <dd>
                      {selected.recipe.pipeline === 'motion-transfer' ? 'Wan Animate 2' : 'LTX-2.5'}{' '}
                      · local open weights
                    </dd>
                  </div>
                  <div>
                    <dt>RECIPE</dt>
                    <dd>
                      <Check size={12} />
                      Inputs, settings and actual graph included
                    </dd>
                  </div>
                </dl>
                <button
                  className="button recipe-primary"
                  disabled={opening || busy}
                  onClick={() => void openExample()}
                >
                  {opening ? <LoaderCircle size={15} className="spin" /> : <Play size={15} />}{' '}
                  {opening ? 'Opening example…' : 'Explore this example'}
                </button>
                <small>Opens the recorded source and result. No generation needed.</small>
                <button
                  className="button"
                  disabled={!current || opening || busy || incompatible}
                  onClick={() => onApply(selected)}
                >
                  <Sparkles size={15} />
                  Use on my source
                  <ArrowUpRight size={14} />
                </button>
                <small>
                  {incompatible
                    ? 'Choose a video source for this recipe.'
                    : current
                      ? selected.category === 'motion'
                        ? 'Keeps your driving video. Review the appearance image and motion caption.'
                        : selected.recipe.endFrame
                          ? 'Keeps your starting source. Choose an ending image for your own shot.'
                          : selected.category === 'camera'
                            ? 'Keeps your source and scene direction. Applies this camera and look.'
                            : selected.reference
                              ? 'Keeps your source and cue. Add an edited frame of your own shot to guide appearance.'
                              : 'Keeps your source, painted region and timing. Applies this visual direction.'
                      : 'Import a source to apply a recipe.'}
                </small>
                <details className="recipe-direction">
                  <summary>Read the example direction</summary>
                  <p>{selected.recipe.prompt}</p>
                </details>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="eyebrow">
              THE RECIPE LIBRARY / {templates.length.toString().padStart(2, '0')} REAL EXAMPLES
            </div>
            <h2>Find your next impossible.</h2>
            <p className="recipe-intro">
              Explore actual local renders, inspect their recipes, then make the direction your own.
            </p>
            <div className="recipe-filters">
              <label>
                <Search size={15} />
                <input
                  ref={search}
                  aria-label="Search recipes"
                  placeholder="Portal, nature, camera, gold…"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                {query && (
                  <button title="Clear recipe search" onClick={() => setQuery('')}>
                    <X size={13} />
                  </button>
                )}
              </label>
              <div aria-label="Recipe category">
                {(['all', 'effects', 'camera', 'motion'] as const).map((value) => (
                  <button
                    key={value}
                    aria-pressed={category === value}
                    className={category === value ? 'active' : ''}
                    onClick={() => setCategory(value)}
                  >
                    {value === 'all'
                      ? 'All recipes'
                      : value === 'effects'
                        ? 'Effects'
                        : value === 'motion'
                          ? 'Motion'
                          : 'Camera'}
                  </button>
                ))}
              </div>
            </div>
            <div className="recipe-grid">
              {filtered.map((item) => (
                <button
                  className="recipe-card"
                  key={item.slug}
                  onClick={() => {
                    setSelected(item);
                    setSource(false);
                    setReference(false);
                  }}
                >
                  <div>
                    <img src={mediaUrl(item.poster)} alt="" />
                    <span>{categories[item.category]}</span>
                    <Play size={18} />
                  </div>
                  <strong>
                    {item.title}
                    <ArrowUpRight size={16} />
                  </strong>
                  <p>{item.description}</p>
                  <small>{item.tags.slice(0, 2).join(' · ')}</small>
                </button>
              ))}
            </div>
            {!error && !templates.length && (
              <p className="recipe-empty">
                <LoaderCircle size={16} className="spin" />
                Loading reviewed examples…
              </p>
            )}
            {templates.length > 0 && !filtered.length && (
              <p className="recipe-empty">
                No recipes match this search. Try “portal”, “gold” or “camera”.
              </p>
            )}
            <p className="recipe-footnote">
              <Download size={13} />
              Every preview is a real example. New results depend on your footage and need a
              connected local engine.
            </p>
          </>
        )}
        {error && (
          <p className="error-note" role="alert">
            {error}
          </p>
        )}
      </section>
    </div>
  );
}

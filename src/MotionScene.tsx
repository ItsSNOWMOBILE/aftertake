import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Layers, Play, Ungroup } from 'lucide-react';
import { filmDraftSchema, type FilmDraft } from './film';
import { motionAt } from './film-motion';
import {
  filmMotionGroupSchema,
  sceneGroupMatrix,
  type FilmMotionGroup,
  type FilmMotionScene,
} from './film-scene';
import { MotionTrackEditor } from './MotionGraphics';
import './motion-scene.css';

type Layer = FilmMotionGroup['children'][number];
type Root = FilmMotionScene['order'][number];
const identity = (item: Root) => `${item.kind}:${item.id}`;
const display = (value: number) => Number(value.toFixed(4));
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const layersFor = (draft: FilmDraft): Layer[] => [
  ...(draft.graphics || []).map(({ id }) => ({ kind: 'graphic' as const, id })),
  ...(draft.titles || []).map(({ id }) => ({ kind: 'title' as const, id })),
];
function layerFor(draft: FilmDraft, layer: Layer) {
  return layer.kind === 'graphic'
    ? draft.graphics?.find((item) => item.id === layer.id)
    : draft.titles?.find((item) => item.id === layer.id);
}
function labelFor(draft: FilmDraft, item: Root) {
  if (item.kind === 'group')
    return draft.motionScene?.groups.find((group) => group.id === item.id)?.name || 'Group';
  const layer = layerFor(draft, { kind: item.kind, id: item.id });
  return layer && 'text' in layer ? `Title · ${layer.text}` : layer?.name || 'Graphic';
}

/** Keep existing layer editors usable when they add, remove or retime scene members. */
export function reconcileMotionScene(draft: FilmDraft): FilmDraft {
  if (!draft.motionScene) return draft;
  const layers = layersFor(draft),
    valid = new Set(layers.map(identity));
  const assigned = new Set<string>();
  const groups = draft.motionScene.groups.flatMap((group) => {
    const children = group.children.filter((child) => {
      const id = identity(child);
      if (!valid.has(id) || assigned.has(id)) return false;
      assigned.add(id);
      return true;
    });
    if (!children.length) return [];
    const members = children.map((child) => layerFor(draft, child)!);
    return [
      {
        ...group,
        children,
        start: Math.min(group.start, ...members.map((item) => item.start)),
        end: Math.max(group.end, ...members.map((item) => item.end)),
      },
    ];
  });
  const roots: Root[] = [
    ...layers.filter((layer) => !assigned.has(identity(layer))),
    ...groups.map(({ id }) => ({ kind: 'group' as const, id })),
  ];
  const allowed = new Set(roots.map(identity)),
    seen = new Set<string>();
  const order = [...draft.motionScene.order, ...roots].filter((root) => {
    const id = identity(root);
    if (!allowed.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  const motionScene = { groups, order };
  return JSON.stringify(motionScene) === JSON.stringify(draft.motionScene)
    ? draft
    : { ...draft, motionScene };
}

function NumberControl({
  label,
  value,
  min,
  max,
  step = 0.01,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label>
      {label}
      <input
        type="number"
        aria-label={label}
        value={display(value)}
        min={min}
        max={max}
        step={step}
        onChange={(event) => {
          const number = event.target.valueAsNumber;
          if (Number.isFinite(number)) onChange(clamp(number, min, max));
        }}
      />
    </label>
  );
}

function DepthEditor({
  group,
  onChange,
}: {
  group: FilmMotionGroup;
  onChange: (group: FilmMotionGroup) => void;
}) {
  const [text, setText] = useState(''),
    [error, setError] = useState('');
  const serialized = JSON.stringify(
    group.depth || {
      perspective: 3,
      keys: [
        { at: 0, yaw: 0, pitch: 0, z: 0 },
        { at: 1, yaw: 0, pitch: 0, z: 0 },
      ],
    },
    null,
    2,
  );
  useEffect(() => {
    setText(serialized);
    setError('');
  }, [serialized]);
  const depth = group.depth;
  return (
    <div className="motion-scene-depth">
      <label>
        Depth motion
        <select
          aria-label={`${group.name} depth preset`}
          value={depth ? 'custom' : 'flat'}
          onChange={(event) => {
            if (event.target.value === 'flat') {
              onChange({ ...group, depth: undefined });
              return;
            }
            onChange({
              ...group,
              depth: {
                perspective: depth?.perspective ?? 3,
                keys: [
                  { at: 0, yaw: 0, pitch: 0, z: 0 },
                  { at: 0.4, yaw: 8, pitch: -4, z: 0.015, easing: 'ease-in-out' },
                  { at: 1, yaw: 0, pitch: 0, z: 0, easing: 'ease-in-out' },
                ],
              },
            });
          }}
        >
          <option value="flat">Flat · no depth track</option>
          <option value="tilt">Gentle tilt · return front-on</option>
          {depth && <option value="custom">Edited depth track</option>}
        </select>
      </label>
      {depth && (
        <>
          <NumberControl
            label={`${group.name} perspective distance`}
            value={depth.perspective}
            min={1.5}
            max={6}
            step={0.1}
            onChange={(perspective) => onChange({ ...group, depth: { ...depth, perspective } })}
          />
          <p>
            Yaw turns left/right; pitch tips up/down. Depth is a fraction of the canvas width. The
            final key can return the card front-on.
          </p>
          <div className="motion-scene-depth-keys">
            {depth.keys.map((key, index) => (
              <fieldset key={index}>
                <legend>
                  {index === 0
                    ? 'Start'
                    : index === depth.keys.length - 1
                      ? 'End'
                      : `Key ${index + 1}`}{' '}
                  · {display(key.at * 100)}%
                </legend>
                {(['yaw', 'pitch', 'z'] as const).map((axis) => (
                  <NumberControl
                    key={axis}
                    label={`${group.name} key ${index + 1} ${axis === 'z' ? 'depth' : axis}`}
                    value={key[axis]}
                    min={axis === 'z' ? -0.2 : -35}
                    max={axis === 'z' ? 0.2 : 35}
                    step={axis === 'z' ? 0.005 : 1}
                    onChange={(value) =>
                      onChange({
                        ...group,
                        depth: {
                          ...depth,
                          keys: depth.keys.map((part, at) =>
                            at === index ? { ...part, [axis]: value } : part,
                          ),
                        },
                      })
                    }
                  />
                ))}
              </fieldset>
            ))}
          </div>
        </>
      )}
      <details>
        <summary>Advanced depth keys</summary>
        <p>
          Use 0–1 key times, yaw/pitch in degrees, and depth between −0.2 and 0.2. Apply validates
          the entire scene.
        </p>
        <textarea
          aria-label={`${group.name} depth JSON`}
          spellCheck={false}
          rows={8}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <button
          type="button"
          onClick={() => {
            try {
              const parsed = JSON.parse(text);
              if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.keys))
                throw Error('Provide a depth object with perspective and keys.');
              const candidate = filmMotionGroupSchema.safeParse({ ...group, depth: parsed });
              if (!candidate.success)
                throw Error(candidate.error.issues.map((issue) => issue.message).join(' '));
              onChange(candidate.data);
              setError('');
            } catch (failure) {
              setError((failure as Error).message);
            }
          }}
        >
          Apply depth keys
        </button>
        {error && <p role="alert">{error}</p>}
      </details>
    </div>
  );
}

export function MotionSceneEditor({
  draft,
  duration,
  disabled = false,
  onChange,
  onSeek,
  onReplay,
}: {
  draft: FilmDraft;
  duration: number;
  disabled?: boolean;
  onChange: (scene: FilmMotionScene | undefined) => void;
  onSeek: (time: number) => void;
  onReplay: (time: number) => void;
}) {
  const [selection, setSelection] = useState<string[]>([]),
    [error, setError] = useState('');
  const scene = draft.motionScene;
  const layers = layersFor(draft);
  const members = new Set(scene?.groups.flatMap((group) => group.children.map(identity)) || []);
  const available = layers.filter((layer) => !members.has(identity(layer)));
  const order = scene?.order || layers;
  function commit(next: FilmMotionScene | undefined) {
    const parsed = filmDraftSchema.safeParse({ ...draft, motionScene: next });
    if (!parsed.success) {
      setError(parsed.error.issues.map((issue) => issue.message).join(' '));
      return;
    }
    setError('');
    onChange(parsed.data.motionScene);
  }
  function changeGroup(next: FilmMotionGroup) {
    if (!scene) return;
    commit({
      ...scene,
      groups: scene.groups.map((group) => (group.id === next.id ? next : group)),
    });
  }
  function ungroup(group: FilmMotionGroup) {
    if (!scene) return;
    commit({
      groups: scene.groups.filter((item) => item.id !== group.id),
      order: scene.order.flatMap((item) =>
        item.kind === 'group' && item.id === group.id ? group.children : [item],
      ),
    });
  }
  function groupSelected() {
    const children = order.filter(
      (item): item is Layer => item.kind !== 'group' && selection.includes(identity(item)),
    );
    if (!children.length || (scene?.groups.length || 0) >= 8) return;
    const firstGraphic = children.find((child) => child.kind === 'graphic');
    const anchor = firstGraphic
      ? draft.graphics?.find((graphic) => graphic.id === firstGraphic.id)
      : undefined;
    const bounds = children.map((child) => layerFor(draft, child)!);
    const group: FilmMotionGroup = {
      id: crypto.randomUUID(),
      name: `Group ${(scene?.groups.length || 0) + 1}`,
      start: Math.min(...bounds.map((item) => item.start)),
      end: Math.max(...bounds.map((item) => item.end)),
      pivot: { x: clamp(anchor?.x ?? 0.5, 0, 1), y: clamp(anchor?.y ?? 0.5, 0, 1) },
      children,
    };
    const lastSelected = order.findLastIndex((item) =>
      children.some((child) => identity(child) === identity(item)),
    );
    const nextOrder: Root[] = order.flatMap((item, index) =>
      index === lastSelected
        ? [{ kind: 'group' as const, id: group.id }]
        : children.some((child) => identity(child) === identity(item))
          ? []
          : [item],
    );
    commit({ groups: [...(scene?.groups || []), group], order: nextOrder });
    setSelection([]);
  }
  function changeChildren(group: FilmMotionGroup, child: Layer, checked: boolean) {
    if (!scene) return;
    const children = checked
      ? [...group.children, child]
      : group.children.filter((item) => identity(item) !== identity(child));
    if (!children.length) {
      ungroup(group);
      return;
    }
    const bounds = children.map((item) => layerFor(draft, item)!);
    const nextGroup = {
      ...group,
      children,
      start: Math.min(group.start, ...bounds.map((item) => item.start)),
      end: Math.max(group.end, ...bounds.map((item) => item.end)),
    };
    const nextOrder = checked
      ? scene.order.filter((item) => identity(item) !== identity(child))
      : scene.order.flatMap((item) =>
          item.kind === 'group' && item.id === group.id ? [child, item] : [item],
        );
    commit({
      ...scene,
      groups: scene.groups.map((item) => (item.id === group.id ? nextGroup : item)),
      order: nextOrder,
    });
  }
  return (
    <details className="film-editor-section motion-scene-editor" open={!!scene}>
      <summary>
        <Layers size={15} /> Shared groups & depth <span>{scene?.groups.length || 0} groups</span>
      </summary>
      <p>
        Move a card, photo and caption together. Each child stays editable in its own layer editor.
      </p>
      {scene && (
        <p>
          This panel controls overlay stacking. Ungroup removes the shared transform and keeps each
          child’s own settings.
        </p>
      )}
      <fieldset disabled={disabled}>
        <div className="motion-scene-selection">
          {available.map((layer) => (
            <label key={identity(layer)}>
              <input
                type="checkbox"
                checked={selection.includes(identity(layer))}
                aria-label={`Select ${labelFor(draft, layer)} for grouping`}
                onChange={(event) =>
                  setSelection((current) =>
                    event.target.checked
                      ? [...current, identity(layer)]
                      : current.filter((id) => id !== identity(layer)),
                  )
                }
              />
              <span>{labelFor(draft, layer)}</span>
            </label>
          ))}
          {!available.length && (
            <p>
              {layers.length
                ? 'All overlays belong to groups.'
                : 'Add a graphic or title to create a group.'}
            </p>
          )}
        </div>
        <button
          type="button"
          disabled={
            !available.some((layer) => selection.includes(identity(layer))) ||
            (scene?.groups.length || 0) >= 8
          }
          onClick={groupSelected}
        >
          <Layers size={14} /> Group selected layers
        </button>
        {scene && (
          <div className="motion-scene-order">
            <h4>Overlay order · back to front</h4>
            <ol>
              {order.map((item, index) => (
                <li key={identity(item)}>
                  <span>{labelFor(draft, item)}</span>
                  {([-1, 1] as const).map((delta) => (
                    <button
                      key={delta}
                      type="button"
                      aria-label={`Move ${labelFor(draft, item)} ${delta < 0 ? 'back' : 'forward'}`}
                      disabled={index + delta < 0 || index + delta >= order.length}
                      onClick={() => {
                        const next = [...order];
                        [next[index], next[index + delta]] = [next[index + delta], next[index]];
                        commit({ ...scene, order: next });
                      }}
                    >
                      {delta < 0 ? <ArrowDown size={13} /> : <ArrowUp size={13} />}
                    </button>
                  ))}
                </li>
              ))}
            </ol>
          </div>
        )}
        {scene?.groups.map((group) => {
          const children = group.children.map((child) => layerFor(draft, child)!);
          const childStart = Math.min(...children.map((child) => child.start)),
            childEnd = Math.max(...children.map((child) => child.end));
          return (
            <details className="motion-scene-group" key={group.id} open>
              <summary>
                {group.name}{' '}
                <small>
                  {group.children.length} layers · {display(group.start)}–{display(group.end)}s
                </small>
              </summary>
              <div className="motion-scene-group-body">
                <div className="motion-scene-actions">
                  <button type="button" onClick={() => onReplay(group.start)}>
                    <Play size={13} /> Replay group
                  </button>
                  <button type="button" onClick={() => ungroup(group)}>
                    <Ungroup size={13} /> Ungroup
                  </button>
                </div>
                <label>
                  Group name
                  <input
                    aria-label={`${group.name} name`}
                    maxLength={80}
                    value={group.name}
                    onChange={(event) => {
                      if (event.target.value.trim())
                        changeGroup({ ...group, name: event.target.value });
                    }}
                  />
                </label>
                <div className="motion-scene-fields">
                  <NumberControl
                    label={`${group.name} from (s)`}
                    value={group.start}
                    min={0}
                    max={childStart}
                    step={1 / 24}
                    onChange={(start) => changeGroup({ ...group, start })}
                  />
                  <NumberControl
                    label={`${group.name} until (s)`}
                    value={group.end}
                    min={childEnd}
                    max={Math.max(duration, childEnd)}
                    step={1 / 24}
                    onChange={(end) => changeGroup({ ...group, end })}
                  />
                  <NumberControl
                    label={`${group.name} pivot X (%)`}
                    value={group.pivot.x * 100}
                    min={0}
                    max={100}
                    step={1}
                    onChange={(x) =>
                      changeGroup({ ...group, pivot: { ...group.pivot, x: x / 100 } })
                    }
                  />
                  <NumberControl
                    label={`${group.name} pivot Y (%)`}
                    value={group.pivot.y * 100}
                    min={0}
                    max={100}
                    step={1}
                    onChange={(y) =>
                      changeGroup({ ...group, pivot: { ...group.pivot, y: y / 100 } })
                    }
                  />
                </div>
                <details>
                  <summary>Group members & order</summary>
                  <div className="motion-scene-selection">
                    {[...group.children, ...available].map((child) => (
                      <label key={identity(child)}>
                        <input
                          type="checkbox"
                          aria-label={`${group.name} includes ${labelFor(draft, child)}`}
                          checked={group.children.some(
                            (item) => identity(item) === identity(child),
                          )}
                          onChange={(event) => changeChildren(group, child, event.target.checked)}
                        />
                        <span>{labelFor(draft, child)}</span>
                      </label>
                    ))}
                  </div>
                  <ol className="motion-scene-child-order">
                    {group.children.map((child, index) => (
                      <li key={identity(child)}>
                        <span>{labelFor(draft, child)}</span>
                        {([-1, 1] as const).map((delta) => (
                          <button
                            type="button"
                            key={delta}
                            disabled={index + delta < 0 || index + delta >= group.children.length}
                            aria-label={`Move ${labelFor(draft, child)} ${delta < 0 ? 'back' : 'forward'} inside ${group.name}`}
                            onClick={() => {
                              const next = [...group.children];
                              [next[index], next[index + delta]] = [
                                next[index + delta],
                                next[index],
                              ];
                              changeGroup({ ...group, children: next });
                            }}
                          >
                            {delta < 0 ? <ArrowDown size={13} /> : <ArrowUp size={13} />}
                          </button>
                        ))}
                      </li>
                    ))}
                  </ol>
                </details>
                <MotionTrackEditor
                  motion={group.motion}
                  onChange={(motion) => changeGroup({ ...group, motion })}
                  disabled={disabled}
                  onPreview={(progress) => {
                    const first = Math.ceil(group.start * 24 - 1e-7),
                      last = Math.ceil(group.end * 24 - 1e-7) - 1;
                    onSeek((first + Math.round((last - first) * progress)) / 24);
                  }}
                />
                <DepthEditor group={group} onChange={changeGroup} />
                <label>
                  Motion blur
                  <select
                    aria-label={`${group.name} shutter samples`}
                    value={group.shutter?.samples || 0}
                    onChange={(event) => {
                      const samples = Number(event.target.value);
                      changeGroup({
                        ...group,
                        shutter: samples
                          ? { samples: samples as 3 | 5, exposure: group.shutter?.exposure ?? 0.4 }
                          : undefined,
                      });
                    }}
                  >
                    <option value={0}>Off</option>
                    <option value={3}>3 samples</option>
                    <option value={5}>5 samples</option>
                  </select>
                </label>
                {group.shutter && (
                  <NumberControl
                    label={`${group.name} shutter exposure`}
                    value={group.shutter.exposure}
                    min={0}
                    max={1}
                    step={0.05}
                    onChange={(exposure) =>
                      changeGroup({ ...group, shutter: { ...group.shutter!, exposure } })
                    }
                  />
                )}
                {group.shutter && (
                  <p>Shutter blur appears in the exported video. Preview shows the central pose.</p>
                )}
              </div>
            </details>
          );
        })}
      </fieldset>
      {error && (
        <p className="motion-scene-error" role="alert">
          {error}
        </p>
      )}
    </details>
  );
}

export function MotionScenePreview({
  scene,
  time,
  renderLayer,
}: {
  scene: FilmMotionScene;
  time: number;
  renderLayer: (layer: Layer, time: number) => ReactNode;
}) {
  const element = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const node = element.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize((old) => (old.width === width && old.height === height ? old : { width, height }));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const frameTime = Math.floor(time * 24 + 1e-7) / 24;
  return (
    <div ref={element} className="motion-scene-preview" aria-hidden="true">
      {size.width > 0 &&
        scene.order.map((root) => {
          if (root.kind !== 'group')
            return (
              <div className="motion-scene-root" key={identity(root)}>
                {renderLayer({ kind: root.kind, id: root.id }, frameTime)}
              </div>
            );
          const group = scene.groups.find((item) => item.id === root.id);
          if (!group || frameTime < group.start || frameTime >= group.end) return null;
          const h = sceneGroupMatrix(group, size.width, size.height, frameTime);
          const matrix = [
            h[0],
            h[3],
            0,
            h[6],
            h[1],
            h[4],
            0,
            h[7],
            0,
            0,
            1,
            0,
            h[2],
            h[5],
            0,
            h[8],
          ];
          const first = Math.ceil(group.start * 24 - 1e-7),
            last = Math.ceil(group.end * 24 - 1e-7) - 1;
          const progress = (clamp(frameTime * 24, first, last) - first) / Math.max(1, last - first);
          return (
            <div
              key={identity(root)}
              className="motion-scene-group-plane"
              style={{
                transform: `matrix3d(${matrix.join(',')})`,
                opacity: motionAt(group.motion, progress).opacity,
              }}
            >
              <div className="motion-scene-surface">
                {group.children.map((child) => (
                  <div className="motion-scene-root" key={identity(child)}>
                    {renderLayer(child, frameTime)}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
    </div>
  );
}

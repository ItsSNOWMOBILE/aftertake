import { useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Check,
  Download,
  LoaderCircle,
  Play,
  Plus,
  RotateCcw,
  ScanFace,
  Shield,
  Upload,
  UserPlus,
  Wand2,
  X,
} from 'lucide-react';
import { apiFetch, browserDemo, mediaUrl, saveMedia } from './transport';
import { findImportedClip, type Clip, type Engine } from './domain';
import {
  characterBusy,
  characterChain,
  characterMaxIdentityReferences,
  characterRequestSchema,
  characterSelectionKey,
  characterSelectionSchema,
  type CharacterJob,
  type CharacterIdentityReference,
  type CharacterProtection,
  type CharacterRepair,
  type CharacterRequest,
  type CharacterSelectionRequest,
} from './character';
import CharacterReferenceEditor, { CharacterReferencePreview } from './CharacterReferenceEditor';
import PreviewVideo from './PreviewVideo';
import RenderEstimate from './RenderEstimate';
import SubjectEffects, { reviewedSubjectSelection } from './SubjectEffects';
import './character-studio.css';
import './subject-effects.css';

async function api<T>(url: string, init?: RequestInit) {
  const response = await apiFetch(url, init),
    body = await response.json();
  if (!response.ok)
    throw Object.assign(Error(body.error || 'Character request failed.'), {
      character: body.character,
    });
  return body as T;
}
function repairSummary(repair: CharacterRepair) {
  const frames = repair.framesRecovered.length;
  return [
    frames ? `${frames} lost ${frames === 1 ? 'frame' : 'frames'} filled` : '',
    repair.restoredPixels ? 'brief dropouts restored' : '',
  ]
    .filter(Boolean)
    .join(', ');
}
function protectionSummary(protection: CharacterProtection) {
  return `objects in front of the person came back from the source in ${protection.protectedFrames} of ${protection.frames} frames, with depth from ${protection.accelerator}`;
}
type DepthStatus = {
  runtime: string | null;
  model: boolean;
  accelerator: string | null;
  fix: string | null;
};
function download(value: unknown, filename = 'aftertake-character-recipe.json') {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
type Point = { x: number; y: number };
type FaceBox = NonNullable<CharacterRequest['faceBox']>;
function faceNeedsFocus(photo: Clip, box?: FaceBox) {
  const ratio = ((box?.width ?? 1) * photo.width) / ((box?.height ?? 1) * photo.height);
  return ratio < 0.5 || ratio > 2;
}
export function restoreTrackedSelection(job: CharacterJob, clips: Clip[]) {
  const saved = reviewedSubjectSelection(job);
  if (!saved) return;
  const request = characterSelectionSchema.safeParse(saved.request);
  if (!request.success) return;
  const clip = findImportedClip(clips, request.data.clip);
  if (!clip || clip.kind === 'image') return;
  return { ...request.data, clip };
}
export default function CharacterStudio({
  clips,
  jobs,
  initialSource,
  otherBusy,
  onUpdate,
  onImport,
  onUse,
  onClose,
  onFilmAdded,
}: {
  clips: Clip[];
  jobs: CharacterJob[];
  initialSource?: Clip;
  otherBusy: boolean;
  onUpdate: (job: CharacterJob) => void;
  onImport: (clip: Clip) => void;
  onUse: (clip: Clip) => void;
  onClose: () => void;
  onFilmAdded?: () => void;
}) {
  const videos = clips.filter((c) => c.kind !== 'image'),
    photos = clips.filter((c) => c.kind === 'image');
  const recordedExample = browserDemo
    ? jobs.find((job) => {
        if (job.kind !== 'replacement' || job.state !== 'succeeded' || !job.clip) return false;
        const request = job.request as CharacterRequest;
        const selected = jobs.find((item) => item.id === request.selectionId);
        if (selected?.kind !== 'selection') return false;
        return Boolean(
          findImportedClip(clips, (selected.request as CharacterSelectionRequest).clip) &&
          findImportedClip(clips, request.reference) &&
          (request.identityReferences || []).every((entry) =>
            findImportedClip(clips, entry.reference),
          ),
        );
      })
    : undefined;
  const openedRecordedExample = useRef(false);
  const [sourceId, setSourceId] = useState(
    initialSource?.kind !== 'image'
      ? initialSource?.id || videos[0]?.id || ''
      : videos[0]?.id || '',
  );
  const source = videos.find((c) => c.id === sourceId);
  const [referenceId, setReferenceId] = useState(''),
    [trimStart, setTrimStart] = useState(0);
  const reference = photos.find((c) => c.id === referenceId);
  const [duration, setDuration] = useState(Math.min(5, source?.duration || 5)),
    [positive, setPositive] = useState<Point[]>([]),
    [negative, setNegative] = useState<Point[]>([]);
  const [pointMode, setPointMode] = useState<'positive' | 'negative'>('positive'),
    [cursor, setCursor] = useState<Point>({ x: 0.5, y: 0.5 });
  const [selectionId, setSelectionId] = useState(''),
    [resultId, setResultId] = useState('');
  const [sourceReviewId, setSourceReviewId] = useState('');
  const [subjectEffectsOpen, setSubjectEffectsOpen] = useState(false);
  const [name, setName] = useState('A new character, the same moment'),
    [prompt, setPrompt] = useState(''),
    [seed, setSeed] = useState(509101);
  const [faceBox, setFaceBox] = useState<FaceBox>();
  const [identityReferences, setIdentityReferences] = useState<CharacterIdentityReference[]>([]);
  const [wardrobe, setWardrobe] = useState<'reference' | 'source'>('reference');
  const [resolution, setResolution] = useState<'480' | '768'>('480');
  const [view, setView] = useState<'frame' | 'source' | 'selection' | 'result'>('frame');
  const [sending, setSending] = useState(false),
    [uploading, setUploading] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [engine, setEngine] = useState<Engine | null>(null),
    [selectionEngine, setSelectionEngine] = useState<Engine | null>(null),
    [depth, setDepth] = useState<DepthStatus | null>(null);
  const dialog = useRef<HTMLElement>(null),
    fileInput = useRef<HTMLInputElement>(null),
    identityFileInput = useRef<HTMLInputElement>(null),
    recipeInput = useRef<HTMLInputElement>(null);
  const sourceStep = useRef<HTMLDivElement>(null),
    identityStep = useRef<HTMLDivElement>(null),
    generateStep = useRef<HTMLDivElement>(null),
    preview = useRef<HTMLDivElement>(null);
  const uploadRole = useRef<'source' | 'reference'>('source');
  const pending = jobs.find(characterBusy),
    locked = sending || uploading || Boolean(pending) || otherBusy;
  const selectionRequest: CharacterSelectionRequest | undefined = source
    ? {
        format: 'aftertake-character-selection/1',
        clip: source,
        trimStart,
        duration,
        positive,
        negative,
        ...(resolution === '768' ? { resolution } : {}),
      }
    : undefined;
  const key = selectionRequest ? characterSelectionKey(selectionRequest) : '';
  const matching = jobs.filter(
    (j) =>
      j.kind === 'selection' &&
      characterSelectionKey(j.request as CharacterSelectionRequest) === key,
  );
  const selection = matching.find((j) => j.id === selectionId) || matching[0];
  const selectionReady =
    selection?.state === 'succeeded' &&
    selection.selection &&
    !selection.selection.emptyFrames.length;
  const savedSelections = jobs.filter((job) => restoreTrackedSelection(job, clips));
  const replacements = jobs.filter(
    (j) =>
      j.kind === 'replacement' &&
      jobs.some(
        (s) =>
          s.id === (j.request as CharacterRequest).selectionId &&
          s.kind === 'selection' &&
          (s.request as CharacterSelectionRequest).clip.sha256 === source?.sha256,
      ),
  );
  const viewed = replacements.find((j) => j.id === resultId) || replacements[0];
  const resultSelection = viewed
    ? jobs.find((j) => j.id === (viewed.request as CharacterRequest).selectionId)
    : undefined;
  const chain = viewed ? characterChain(viewed, jobs) : [];
  const sourceReview = jobs.find((j) => j.id === sourceReviewId) || selection;
  const sourceRange = sourceReview?.request as CharacterSelectionRequest | undefined;
  const request: CharacterRequest | undefined =
    reference && selection
      ? {
          format: 'aftertake-character/1',
          name,
          selectionId: selection.id,
          reference: { ...reference, kind: 'image' },
          faceBox,
          ...(identityReferences.length ? { identityReferences } : {}),
          wardrobe,
          prompt,
          seed,
        }
      : undefined;
  const previewSelection = view === 'source' ? sourceReview : selection;
  const aspect =
    view === 'result' && viewed?.clip
      ? viewed.clip.width / viewed.clip.height
      : (view === 'selection' || view === 'source') && previewSelection?.selection
        ? previewSelection.selection.width / previewSelection.selection.height
        : source
          ? source.width / source.height
          : 16 / 9;
  useEffect(() => {
    const old = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLButtonElement>('.modal-close')?.focus();
    return () => {
      if (old?.isConnected) old.focus();
    };
  }, []);
  useEffect(() => {
    let live = true;
    const check = () =>
      Promise.all([
        api<Engine>('/api/engine?pipeline=character-swap'),
        api<Engine>('/api/engine?pipeline=character-selection'),
      ])
        .then(([all, selection]) => {
          if (live) {
            setEngine(all);
            setSelectionEngine(selection);
          }
        })
        .catch(() => {});
    void check();
    const id = setInterval(check, 5000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, []);
  function changeSource(id: string) {
    const clip = videos.find((c) => c.id === id);
    setSourceId(id);
    setTrimStart(0);
    setDuration(Math.min(5, clip?.duration || 5));
    setPositive([]);
    setNegative([]);
    setSelectionId('');
    setResultId('');
    setView('frame');
    setError('');
  }
  /** Make a finished take the source, so the next person can be tracked and replaced in it. */
  function swapAnother(job: CharacterJob) {
    const clip = job.clip!,
      earlier = jobs.find((item) => item.id === (job.request as CharacterRequest).selectionId),
      people = characterChain(job, jobs).length;
    onImport(clip);
    setSourceId(clip.id);
    setTrimStart(0);
    setDuration(Math.min(15, clip.duration));
    setPositive([]);
    setNegative([]);
    setResolution((earlier?.request as CharacterSelectionRequest | undefined)?.resolution || '480');
    setSelectionId('');
    setSourceReviewId('');
    setResultId('');
    setReferenceId('');
    setFaceBox(undefined);
    setIdentityReferences([]);
    setName(`${(job.request as CharacterRequest).name}, person ${people + 1}`.slice(0, 100));
    setView('frame');
    setError('');
    setNotice(
      `Person ${people + 1}: this take is now the source. Mark the next person, track them, then choose their photo. Everything outside the new person's mask stays as it is, including the ${people === 1 ? 'person' : `${people} people`} you already swapped.`,
    );
    sourceStep.current?.scrollIntoView({ block: 'start' });
  }
  function useTrackedSelection(job: CharacterJob) {
    const saved = restoreTrackedSelection(job, clips);
    if (!saved) {
      setError('Import the matching source video before reusing this complete tracked selection.');
      return;
    }
    setSourceId(saved.clip.id);
    setTrimStart(saved.trimStart);
    setDuration(saved.duration);
    setPositive(saved.positive);
    setNegative(saved.negative);
    setResolution(saved.resolution || '480');
    setSelectionId(job.id);
    setSourceReviewId(job.id);
    setResultId('');
    setView('selection');
    setError('');
    setNotice(
      'Saved tracking restored, including its range and points. Review the existing mask; no new tracking was started.',
    );
  }
  function showPreview(next: typeof view) {
    setView(next);
    preview.current?.scrollIntoView({ block: 'start' });
    preview.current?.focus({ preventScroll: true });
  }
  function range(start: number, length: number) {
    if (!source) return;
    setTrimStart(Math.max(0, Math.min(source.duration - 1, start)));
    setDuration(Math.max(1, Math.min(15, source.duration - start, length)));
    setPositive([]);
    setNegative([]);
    setSelectionId('');
    setView('frame');
  }
  function point(event: React.PointerEvent<HTMLElement>): Point {
    const b = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - b.left) / b.width)),
      y: Math.max(0, Math.min(1, (event.clientY - b.top) / b.height)),
    };
  }
  function addPoint(p: Point) {
    if (locked || !source) return;
    const list = pointMode === 'positive' ? positive : negative;
    if (list.length >= 12) {
      setError('Use up to 12 points of each kind. Clear a point before adding another.');
      return;
    }
    (pointMode === 'positive' ? setPositive : setNegative)([...list, p]);
    setSelectionId('');
    setView('frame');
    setError('');
  }
  function changeReference(photo: Clip) {
    setReferenceId(photo.id);
    setFaceBox(undefined);
    setIdentityReferences((current) =>
      current.filter(
        (entry) => entry.reference.id !== photo.id && entry.reference.sha256 !== photo.sha256,
      ),
    );
    setError('');
  }
  function addIdentityPhoto(photo: Clip) {
    if (photo.kind !== 'image') return setError('Choose a still photo of the same person.');
    if (identityReferences.length >= characterMaxIdentityReferences)
      return setError(`Use up to ${characterMaxIdentityReferences} supporting photos.`);
    if (
      photo.id === reference?.id ||
      photo.sha256 === reference?.sha256 ||
      identityReferences.some(
        (entry) => entry.reference.id === photo.id || entry.reference.sha256 === photo.sha256,
      )
    )
      return setError('That photo is already a reference. Choose a different view.');
    setIdentityReferences((current) => [...current, { reference: { ...photo, kind: 'image' } }]);
    setError('');
  }
  function resolveIdentityPhotos(entries: CharacterIdentityReference[] = []) {
    return entries.map((entry) => {
      const photo = findImportedClip(clips, entry.reference);
      if (!photo || photo.kind !== 'image')
        throw Error(`Import the matching supporting photo first: ${entry.reference.name}`);
      return {
        reference: { ...photo, kind: 'image' as const },
        ...(entry.faceBox ? { faceBox: entry.faceBox } : {}),
      };
    });
  }
  async function uploadIdentityPhotos(files: File[]) {
    if (!files.length) return;
    if (files.length + identityReferences.length > characterMaxIdentityReferences)
      return setError(
        `Choose no more than ${characterMaxIdentityReferences - identityReferences.length} additional photos.`,
      );
    setUploading(true);
    setError('');
    const added: CharacterIdentityReference[] = [];
    try {
      for (const file of files) {
        const photo = await api<Clip>(`/api/clips?name=${encodeURIComponent(file.name)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: file,
        });
        onImport(photo);
        if (photo.kind !== 'image') throw Error(`Choose a still photo: ${file.name}`);
        if (
          photo.sha256 === reference?.sha256 ||
          [...identityReferences, ...added].some((entry) => entry.reference.sha256 === photo.sha256)
        )
          throw Error(`${file.name} is already a reference. Choose a different view.`);
        added.push({ reference: { ...photo, kind: 'image' } });
      }
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setIdentityReferences((current) => [...current, ...added]);
      setUploading(false);
    }
  }
  async function upload(file?: File) {
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const clip = await api<Clip>(`/api/clips?name=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: file,
      });
      onImport(clip);
      if (uploadRole.current === 'reference') {
        if (clip.kind !== 'image') throw Error('Choose a still photo for the character reference.');
        changeReference(clip);
      } else {
        if (clip.kind === 'image') throw Error('Choose a video for the source performance.');
        setSourceId(clip.id);
        setTrimStart(0);
        setDuration(Math.min(5, clip.duration));
        setPositive([]);
        setNegative([]);
        setSelectionId('');
        setView('frame');
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }
  async function submit(kind: 'selection' | 'replacement') {
    setSending(true);
    setError('');
    setNotice('');
    try {
      const body =
        kind === 'selection'
          ? characterSelectionSchema.parse(selectionRequest)
          : characterRequestSchema.parse(request);
      const job = await api<CharacterJob>(
        `/api/characters/${kind === 'selection' ? 'selections' : 'replacements'}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
          body: JSON.stringify(body),
        },
      );
      onUpdate(job);
      if (kind === 'selection') {
        setSelectionId(job.id);
        setView('selection');
      } else {
        setResultId(job.id);
        setView('result');
      }
    } catch (e) {
      const failure = e as Error & { character?: CharacterJob };
      if (failure.character) {
        onUpdate(failure.character);
        if (failure.character.kind === 'selection') {
          setSelectionId(failure.character.id);
          setView('selection');
        } else {
          setResultId(failure.character.id);
          setView('result');
        }
      }
      setError(failure.message);
    } finally {
      setSending(false);
    }
  }
  useEffect(() => {
    if (browserDemo) return;
    api<DepthStatus>('/api/characters/depth/status')
      .then(setDepth)
      .catch(() => {});
  }, []);
  /** Put objects in front of the person back from the source, as a new take. */
  async function protectForeground(job: CharacterJob) {
    setSending(true);
    setError('');
    try {
      const started = await api<CharacterJob>(`/api/characters/${job.id}/protect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ margin: 0.1 }),
      });
      onUpdate(started);
      setResultId(started.id);
      setView('result');
      setNotice(
        'Keeping objects in front of the person. Depth is estimated for every frame on this computer; the new take appears here when it finishes.',
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }
  /** Fill lost frames and brief dropouts on the CPU, then review the repaired selection. */
  async function repairSelection(job: CharacterJob) {
    setSending(true);
    setError('');
    setNotice('Repairing the tracked mask on this computer…');
    try {
      const repaired = await api<CharacterJob>(`/api/characters/${job.id}/repair`, {
        method: 'POST',
      });
      onUpdate(repaired);
      setSelectionId(repaired.id);
      setView('selection');
      setNotice(`Repaired: ${repairSummary(repaired.repair!)}. Review the tracked selection.`);
    } catch (e) {
      setNotice('');
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }
  async function act(job: CharacterJob, action: 'cancel' | 'reconcile') {
    setSending(true);
    setError('');
    try {
      onUpdate(await api<CharacterJob>(`/api/characters/${job.id}/${action}`, { method: 'POST' }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }
  function reuse(job: CharacterJob, nextView: 'selection' | 'result' = 'selection') {
    const r = job.request as CharacterRequest,
      s = jobs.find((j) => j.id === r.selectionId);
    if (!s) {
      setError('This result is missing its original person selection.');
      return false;
    }
    const selected = s.request as CharacterSelectionRequest,
      clip = findImportedClip(clips, selected.clip),
      photo = findImportedClip(clips, r.reference);
    if (!clip || !photo) {
      setError('Import the matching source video and character photo before reusing this recipe.');
      return false;
    }
    let supporting: CharacterIdentityReference[];
    try {
      supporting = resolveIdentityPhotos(r.identityReferences);
    } catch (failure) {
      setError((failure as Error).message);
      return false;
    }
    setSourceId(clip.id);
    setReferenceId(photo.id);
    setTrimStart(selected.trimStart);
    setDuration(selected.duration);
    setPositive(selected.positive);
    setNegative(selected.negative);
    setResolution(selected.resolution || '480');
    setSelectionId(s.id);
    setResultId(job.id);
    setSourceReviewId(s.id);
    setName(r.name);
    setPrompt(r.prompt);
    setSeed(r.seed);
    setFaceBox(r.faceBox);
    setIdentityReferences(supporting);
    setWardrobe(r.wardrobe || 'reference');
    setView(nextView);
    setError('');
    setNotice(
      browserDemo
        ? 'Recorded take loaded. Compare the source, tracked person and result; download its original recipe or workflow.'
        : 'Settings restored. Review the selection before creating a new take.',
    );
    return true;
  }
  useEffect(() => {
    if (!recordedExample || openedRecordedExample.current) return;
    if (reuse(recordedExample, 'result')) openedRecordedExample.current = true;
  }, [recordedExample?.id]);
  async function importRecipe(file?: File) {
    if (!file) return;
    try {
      if (file.size > 2 * 1024 * 1024) throw Error('Use a character recipe under 2 MB.');
      const value = JSON.parse(await file.text());
      if (value.format !== 'aftertake-character-recipe/1')
        throw Error('Choose an Aftertake character recipe.');
      const s = characterSelectionSchema.parse(value.selection),
        clip = findImportedClip(clips, s.clip);
      if (!clip) throw Error(`Import the matching source video first: ${s.clip.name}`);
      const replacement = value.replacement
        ? characterRequestSchema.parse(value.replacement)
        : undefined;
      const photo = replacement ? findImportedClip(clips, replacement.reference) : undefined;
      const supporting = replacement ? resolveIdentityPhotos(replacement.identityReferences) : [];
      if (replacement && (!photo || photo.kind !== 'image'))
        throw Error(`Import the matching character photo first: ${replacement.reference.name}`);
      setSourceId(clip.id);
      setTrimStart(s.trimStart);
      setDuration(s.duration);
      setPositive(s.positive);
      setNegative(s.negative);
      setSelectionId('');
      setView('frame');
      setResolution(s.resolution || '480');
      if (replacement) {
        const r = replacement;
        setName(r.name);
        setPrompt(r.prompt);
        setSeed(r.seed);
        setFaceBox(r.faceBox);
        setIdentityReferences(supporting);
        setWardrobe(r.wardrobe || 'reference');
        setReferenceId(photo?.id || '');
      } else {
        setReferenceId('');
        setFaceBox(undefined);
        setIdentityReferences([]);
        setWardrobe('reference');
        setName('A new character, the same moment');
        setPrompt('');
        setSeed(509101);
      }
      setResultId('');
      setError('');
      setNotice(
        replacement
          ? 'Recipe restored with its matching source and reference photos. Review the selection before generating.'
          : 'Source selection restored. Choose your character photos, then review the selection before generating.',
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function addToFilm(clip: Clip) {
    setSending(true);
    setError('');
    try {
      const response = await apiFetch(clip.url);
      if (!response.ok) throw Error('The character video is unavailable.');
      await api(`/api/films/assets?name=${encodeURIComponent(clip.name + '.mp4')}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: await response.blob(),
      });
      onFilmAdded?.();
      setNotice('Added to film media. Open Film editing to place it in your cut.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }
  async function downloadRecordedMedia(url: string, filename: string) {
    try {
      await saveMedia(url, filename);
    } catch {
      setError('This recorded file could not be downloaded. Check your connection and try again.');
    }
  }
  const status = view === 'result' ? viewed : view === 'selection' ? selection : pending;
  const selectionValidation = characterSelectionSchema.safeParse(selectionRequest);
  const requestValidation = characterRequestSchema.safeParse(request);
  const identityNeedsFocus = identityReferences.some((entry) =>
    faceNeedsFocus(entry.reference, entry.faceBox),
  );
  const primaryNeedsFocus = Boolean(reference && faceBox && faceNeedsFocus(reference, faceBox));
  const identityReady = Boolean(reference && !primaryNeedsFocus && !identityNeedsFocus);
  const canGenerate =
    !browserDemo &&
    !locked &&
    Boolean(engine?.ready) &&
    Boolean(selectionReady) &&
    requestValidation.success;
  const trackHint = !source
    ? 'Import a video, then mark the person in its first frame.'
    : !positive.length
      ? 'Place at least one green point inside the person to enable tracking.'
      : !selectionValidation.success
        ? selectionValidation.error.issues[0].message
        : selectionReady
          ? 'Selection tracked. Watch the overlay to check hair, hands and nearby people.'
          : pending?.kind === 'selection'
            ? 'Your tracking job appears beside the preview. Review its overlay when it finishes.'
            : locked
              ? 'Wait for the current import or job before starting tracking.'
              : browserDemo
                ? 'Open the local studio to track your own source video.'
                : !selectionEngine
                  ? 'Checking the local tracking engine…'
                  : !selectionEngine.ready
                    ? 'The tracking engine is not ready. See the setup details below.'
                    : 'Track this range, then review the overlay before generating.';
  const generateHint = !selectionReady
    ? 'First track the person and review the selection preview.'
    : !reference
      ? 'Choose a primary photo of the replacement character.'
      : primaryNeedsFocus || identityNeedsFocus
        ? 'Adjust the marked face focus before generating.'
        : !name.trim()
          ? 'Give this take a name before generating.'
          : !requestValidation.success
            ? 'Check the photo and take settings above.'
            : uploading
              ? 'Importing your media. Generation will be available when the import finishes.'
              : sending
                ? 'Sending your request to the local studio…'
                : browserDemo
                  ? 'Open the local studio to generate your own take.'
                  : !engine
                    ? 'Checking the local character engine…'
                    : !engine.ready
                      ? 'The character engine is not ready. See the setup details below.'
                      : otherBusy && !pending
                        ? 'Another generation is running. Review your settings while it finishes.'
                        : pending
                          ? 'Your submitted job is shown beside the preview. Check its status before starting another.'
                          : 'Ready. Review the tracked selection, then generate your take.';
  const uncertainJob = pending && ['connection_lost', 'submission_unknown'].includes(pending.state);
  const workflowSteps = [
    {
      label: 'Source & tracking',
      detail:
        pending?.kind === 'selection'
          ? uncertainJob
            ? 'Check submitted job'
            : 'Tracking person…'
          : selectionReady
            ? 'Tracked · review overlay'
            : source
              ? positive.length
                ? 'Person marked'
                : 'Mark the person'
              : 'Choose a video',
      ready: Boolean(selectionReady),
      ref: sourceStep,
    },
    {
      label: 'Identity photos',
      detail: reference
        ? identityReady
          ? `${identityReferences.length + 1} photo${identityReferences.length ? 's' : ''} selected`
          : 'Adjust face focus'
        : 'Choose a primary photo',
      ready: identityReady,
      ref: identityStep,
    },
    {
      label: 'Generate take',
      detail:
        pending?.kind === 'replacement'
          ? uncertainJob
            ? 'Check submitted job'
            : 'Generating…'
          : canGenerate
            ? 'Ready to generate'
            : !selectionReady || !identityReady
              ? 'Complete the earlier steps'
              : browserDemo
                ? 'Use the local studio'
                : locked
                  ? 'Waiting for the studio'
                  : !engine?.ready
                    ? 'Engine not ready'
                    : 'Check take settings',
      ready: false,
      ref: generateStep,
    },
  ];
  const currentStep =
    pending?.kind === 'replacement' ? 2 : !selectionReady ? 0 : !identityReady ? 1 : 2;
  const reportedProgress =
    pending?.progress != null && Number.isFinite(pending.progress)
      ? Math.max(0, Math.min(1, pending.progress))
      : undefined;
  return (
    <div className="modal-backdrop character-backdrop" onClick={onClose}>
      <section
        ref={dialog}
        className="modal character-studio"
        role="dialog"
        aria-modal="true"
        aria-label="Replace a character"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
          }
          if (event.key === 'Tab') {
            const nodes = [
              ...(dialog.current?.querySelectorAll<HTMLElement>(
                'button:not(:disabled),input:not(:disabled):not([hidden]),textarea:not(:disabled),select:not(:disabled),a[href],[tabindex="0"],summary',
              ) || []),
            ].filter((n) => n.getClientRects().length);
            if (event.shiftKey && document.activeElement === nodes[0]) {
              event.preventDefault();
              nodes.at(-1)?.focus();
            } else if (!event.shiftKey && document.activeElement === nodes.at(-1)) {
              event.preventDefault();
              nodes[0]?.focus();
            }
          }
        }}
      >
        <button className="modal-close" aria-label="Close character studio" onClick={onClose}>
          <X size={19} />
        </button>
        <div className="eyebrow">CHARACTER REPLACEMENT</div>
        <h2>New character. Same scene.</h2>
        <p className="character-intro">
          Track one person in a continuous shot. Add their replacement’s photos, then generate a new
          take with the source scene and audio.
        </p>
        <button
          className="button"
          onClick={() => setSubjectEffectsOpen((open) => !open)}
          aria-expanded={subjectEffectsOpen}
        >
          <Plus size={14} /> Duplicate a tracked person
        </button>
        {subjectEffectsOpen && (
          <SubjectEffects
            selection={selection}
            selections={savedSelections}
            onSelectionChange={useTrackedSelection}
            onImport={onImport}
            onUse={(clip) => {
              onUse(clip);
              onClose();
            }}
            onFilmAdded={onFilmAdded}
            onClose={() => setSubjectEffectsOpen(false)}
          />
        )}
        {browserDemo && (
          <aside className="character-recorded-intro" aria-label="Recorded character example">
            <div>
              <strong>Explore a real character swap.</strong>
              <p>
                Watch the source, inspect the tracked person and review the H3 result. These are
                recorded outputs; creating your own take runs in the local studio.
              </p>
            </div>
            {recordedExample ? (
              <button className="button" onClick={() => reuse(recordedExample, 'result')}>
                <Play size={14} /> Open recorded take
              </button>
            ) : (
              <a className="button" href="../cast/h3.html" target="_blank" rel="noreferrer">
                Watch the H3 example <ArrowUpRight size={14} />
              </a>
            )}
          </aside>
        )}
        <ol className="character-workflow" aria-label="Character workflow steps">
          {workflowSteps.map((step, index) => (
            <li
              key={step.label}
              data-state={step.ready ? 'ready' : index === currentStep ? 'current' : 'waiting'}
            >
              <button
                aria-current={index === currentStep ? 'step' : undefined}
                onClick={() => {
                  step.ref.current?.scrollIntoView({ block: 'start' });
                  step.ref.current?.focus({ preventScroll: true });
                }}
              >
                <span className="character-workflow-number" aria-hidden="true">
                  {step.ready ? <Check size={14} /> : index + 1}
                </span>
                <span>
                  <strong>{step.label}</strong>
                  <small>{step.detail}</small>
                </span>
              </button>
            </li>
          ))}
        </ol>
        <div className="character-grid">
          <div
            className="character-view-column"
            ref={preview}
            role="region"
            aria-label="Character preview"
            tabIndex={-1}
          >
            <div className="character-view-tabs" role="group" aria-label="Character preview">
              <button
                aria-pressed={view === 'frame'}
                className={view === 'frame' ? 'active' : ''}
                onClick={() => setView('frame')}
              >
                Select person
              </button>
              <button
                disabled={!source}
                aria-pressed={view === 'source'}
                className={view === 'source' ? 'active' : ''}
                onClick={() => {
                  setSourceReviewId(view === 'result' ? resultSelection?.id || '' : '');
                  setView('source');
                }}
              >
                Watch source
              </button>
              <button
                disabled={!selection?.selection}
                aria-pressed={view === 'selection'}
                className={view === 'selection' ? 'active' : ''}
                onClick={() => setView('selection')}
              >
                Tracked selection
              </button>
              <button
                disabled={!viewed}
                aria-pressed={view === 'result'}
                className={view === 'result' ? 'active' : ''}
                onClick={() => setView('result')}
              >
                Result
              </button>
            </div>
            {pending && (
              <div className="character-progress" role="status" aria-live="polite">
                <div className="character-progress-heading">
                  <LoaderCircle size={17} className="spin" aria-hidden="true" />
                  <strong>
                    {uncertainJob
                      ? 'Check the submitted job'
                      : pending.kind === 'selection'
                        ? 'Tracking the selected person'
                        : pending.protection
                          ? 'Keeping objects in front'
                          : 'Generating your character take'}
                  </strong>
                  {reportedProgress !== undefined && (
                    <span>{Math.round(reportedProgress * 100)}%</span>
                  )}
                </div>
                <p>{pending.stage || pending.state.replaceAll('_', ' ')}</p>
                <progress
                  max={1}
                  value={reportedProgress}
                  aria-label="Engine-reported job progress"
                />
                <div className="character-progress-footer">
                  <span>
                    {uncertainJob
                      ? 'Connection uncertain. Progress may be out of date.'
                      : reportedProgress === undefined
                        ? 'Waiting for engine progress.'
                        : pending.protection
                          ? 'Progress reported by depth on this computer.'
                          : 'Progress reported by the engine.'}
                  </span>
                  {uncertainJob ? (
                    <button disabled={sending} onClick={() => void act(pending, 'reconcile')}>
                      Check status
                    </button>
                  ) : pending.jobId && pending.state !== 'finalizing' ? (
                    <button disabled={sending} onClick={() => void act(pending, 'cancel')}>
                      Cancel job
                    </button>
                  ) : null}
                </div>
              </div>
            )}
            <div
              className={`character-stage ${view === 'frame' ? 'character-pick' : ''}`}
              style={{ aspectRatio: String(aspect) }}
              role={view === 'frame' && source ? 'button' : undefined}
              tabIndex={view === 'frame' && source ? 0 : undefined}
              aria-disabled={view === 'frame' && source ? locked : undefined}
              aria-label={
                view === 'frame'
                  ? 'Choose the person: click the image, or use arrow keys then Enter to add a point'
                  : undefined
              }
              onPointerDown={(e) => {
                if (view === 'frame') {
                  const p = point(e);
                  setCursor(p);
                  addPoint(p);
                }
              }}
              onKeyDown={(e) => {
                if (view !== 'frame') return;
                if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
                  e.preventDefault();
                  const step = e.shiftKey ? 0.001 : 0.01;
                  setCursor((p) => ({
                    x: Math.max(
                      0,
                      Math.min(
                        1,
                        p.x + (e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0),
                      ),
                    ),
                    y: Math.max(
                      0,
                      Math.min(
                        1,
                        p.y + (e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0),
                      ),
                    ),
                  }));
                }
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  addPoint(cursor);
                }
              }}
            >
              {view === 'frame' && source ? (
                <>
                  <img
                    draggable={false}
                    src={mediaUrl(
                      browserDemo
                        ? `/api/thumbnails/${source.id}?time=${trimStart}`
                        : `/api/clips/${source.id}/frame?time=${trimStart}`,
                    )}
                    alt={
                      browserDemo
                        ? 'Recorded source preview near the selected start'
                        : 'First frame of your selected source range'
                    }
                  />
                  {[
                    ...positive.map((p, i) => ({ ...p, kind: 'positive', label: `+${i + 1}` })),
                    ...negative.map((p, i) => ({ ...p, kind: 'negative', label: `−${i + 1}` })),
                  ].map((p) => (
                    <span
                      key={p.label}
                      className={`character-point ${p.kind}`}
                      style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
                    >
                      {p.label}
                    </span>
                  ))}
                  <span
                    className="character-keyboard-cursor"
                    style={{ left: `${cursor.x * 100}%`, top: `${cursor.y * 100}%` }}
                  >
                    +
                  </span>
                </>
              ) : view === 'source' && source ? (
                <PreviewVideo
                  key={(sourceReview?.selection ? sourceReview.id : source.id) + trimStart}
                  mediaSrc={
                    sourceReview?.selection
                      ? `/api/characters/${sourceReview.id}/source`
                      : source.url
                  }
                  controls
                  playsInline
                  onLoadedMetadata={(e) => {
                    e.currentTarget.currentTime = sourceReview?.selection ? 0 : trimStart;
                  }}
                  onTimeUpdate={(e) => {
                    const start = sourceReview?.selection ? 0 : trimStart;
                    if (e.currentTarget.currentTime > start + (sourceRange?.duration || duration))
                      e.currentTarget.currentTime = start;
                  }}
                />
              ) : view === 'selection' && selection?.selection ? (
                <PreviewVideo
                  key={selection.id}
                  mediaSrc={`/api/characters/${selection.id}/preview`}
                  controls
                  playsInline
                  loop
                />
              ) : view === 'result' && viewed?.clip ? (
                <PreviewVideo
                  key={viewed.id}
                  mediaSrc={viewed.clip.url}
                  poster={mediaUrl(`/api/thumbnails/${viewed.clip.id}?time=0`)}
                  controls
                  playsInline
                />
              ) : (
                <div className="character-empty">
                  {status && characterBusy(status) ? (
                    <LoaderCircle className="spin" size={28} />
                  ) : (
                    <ScanFace size={32} />
                  )}
                  <p>
                    {status && characterBusy(status)
                      ? status.stage || 'Preparing your character job…'
                      : source
                        ? 'Click the person to begin.'
                        : 'Import a source video to begin.'}
                  </p>
                  {!source && (
                    <>
                      <small>
                        Use a continuous 1–15 second shot. You’ll mark the person to replace in its
                        first frame.
                      </small>
                      <button
                        className="button"
                        disabled={locked || browserDemo}
                        onClick={() => {
                          uploadRole.current = 'source';
                          fileInput.current?.click();
                        }}
                      >
                        <Upload size={14} /> Import source video
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
            {view === 'frame' && (
              <>
                <div className="character-point-tools">
                  <button
                    disabled={locked}
                    aria-pressed={pointMode === 'positive'}
                    className={pointMode === 'positive' ? 'active' : ''}
                    onClick={() => setPointMode('positive')}
                  >
                    + Select person
                  </button>
                  <button
                    disabled={locked}
                    aria-pressed={pointMode === 'negative'}
                    className={pointMode === 'negative' ? 'active' : ''}
                    onClick={() => setPointMode('negative')}
                  >
                    − Exclude person
                  </button>
                  <button
                    disabled={locked || !(pointMode === 'positive' ? positive : negative).length}
                    onClick={() => {
                      (pointMode === 'positive' ? setPositive : setNegative)((all) =>
                        all.slice(0, -1),
                      );
                      setSelectionId('');
                    }}
                  >
                    Undo point
                  </button>
                  <button
                    disabled={locked || (!positive.length && !negative.length)}
                    onClick={() => {
                      setPositive([]);
                      setNegative([]);
                      setSelectionId('');
                    }}
                  >
                    Clear
                  </button>
                </div>
                <p className="character-hint">
                  Click inside the person you want. Add an exclusion on another person if they
                  overlap. Arrow keys move the keyboard cursor; Enter places a point.
                </p>
              </>
            )}
            {matching.length > 0 && (
              <label className="character-selection-version">
                TRACKED SELECTION
                <select
                  aria-label="Tracked selection version"
                  value={selection?.id || ''}
                  onChange={(e) => {
                    setSelectionId(e.target.value);
                    setView('selection');
                  }}
                >
                  {matching.map((j) => (
                    <option key={j.id} value={j.id}>
                      {new Date(j.createdAt).toLocaleTimeString()} · {j.state.replaceAll('_', ' ')}
                      {j.repair ? ' · repaired' : ''}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {selection?.selection && (
              <p className={`character-selection-status ${selectionReady ? 'ready' : ''}`}>
                {selectionReady ? <Check size={14} /> : null}
                {selection.selection.emptyFrames.length
                  ? `Tracking lost the person in ${selection.selection.emptyFrames.length} frames. ${selection.repair ? 'These gaps are longer than half a second' : 'Repair mask fills gaps up to half a second'}; otherwise choose a clearer or shorter range before replacing them.`
                  : `${selection.selection.width} × ${selection.selection.height} · ${selection.selection.frames} tracked frames · ${(selection.selection.frames / 24).toFixed(2)}s. Check hands, hair and overlapping people in the preview.`}
              </p>
            )}
            {selection?.repair && (
              <p className="character-hint">
                Repaired mask: {repairSummary(selection.repair)}. Amber in the tracked selection
                marks what repair added; it never removes tracked pixels.
              </p>
            )}
            {selection?.state === 'succeeded' && selection.selection && !selection.repair && (
              <button
                className="button character-repair"
                disabled={locked || browserDemo}
                onClick={() => void repairSelection(selection)}
              >
                <Wand2 size={13} />
                {jobs.some((job) => job.repair?.from === selection.id)
                  ? 'Use the repaired mask'
                  : 'Repair mask'}
              </button>
            )}
            {status?.error && (
              <p role="alert" className="character-error">
                {status.error}
              </p>
            )}
            {status &&
              status.id !== (uncertainJob ? pending.id : undefined) &&
              ['connection_lost', 'submission_unknown', 'output_error'].includes(status.state) && (
                <button
                  className="button"
                  disabled={sending}
                  onClick={() => void act(status, 'reconcile')}
                >
                  Check this submitted job
                </button>
              )}
            {view === 'result' && viewed?.clip && (
              <>
                <button
                  className="button character-swap-another"
                  disabled={locked || browserDemo}
                  onClick={() => swapAnother(viewed)}
                >
                  <UserPlus size={14} />
                  Swap another person in this shot
                </button>
                <div className="character-output-actions">
                  <button
                    className="button"
                    disabled={locked}
                    onClick={() => {
                      onUse(viewed.clip!);
                      onClose();
                    }}
                  >
                    Use as source
                    <ArrowUpRight size={13} />
                  </button>
                  <button
                    className="button"
                    disabled={sending || browserDemo}
                    onClick={() => void addToFilm(viewed.clip!)}
                  >
                    Add to film
                  </button>
                  <a
                    className="button"
                    href={mediaUrl(viewed.clip.url)}
                    download="aftertake-character.mp4"
                    onClick={(event) => {
                      if (!browserDemo) return;
                      event.preventDefault();
                      void downloadRecordedMedia(viewed.clip!.url, 'aftertake-character.mp4');
                    }}
                  >
                    <Download size={13} />
                    MP4
                  </a>
                  <button
                    className="button"
                    onClick={() => {
                      const s = jobs.find(
                        (j) => j.id === (viewed.request as CharacterRequest).selectionId,
                      );
                      download({
                        format: 'aftertake-character-recipe/1',
                        selection: s?.request,
                        selectionInfo: s?.selection,
                        replacement: viewed.request,
                        workflow: viewed.workflow,
                        jobId: viewed.jobId,
                        output: viewed.clip,
                      });
                    }}
                  >
                    Recipe ↗
                  </button>
                </div>
                {viewed.protection?.frames ? (
                  <p className="character-hint">
                    Foreground kept: {protectionSummary(viewed.protection)}.
                  </p>
                ) : (
                  <>
                    <button
                      className="button character-repair"
                      disabled={locked || browserDemo || !depth?.runtime || !depth.model}
                      onClick={() => void protectForeground(viewed)}
                    >
                      <Shield size={13} />
                      Keep objects in front
                    </button>
                    <p className="character-hint">
                      Puts back anything clearly in front of the person, like a cup, a microphone or
                      a railing, from the original shot.{' '}
                      {!depth
                        ? ''
                        : depth.runtime && depth.model
                          ? `Depth runs on the ${depth.accelerator}.`
                          : `Install local depth first: ${depth.fix || 'node scripts/aftertake.mjs setup-npu'}`}
                    </p>
                  </>
                )}
                <p className="character-hint">
                  {viewed.clip.width} × {viewed.clip.height} · 24 fps · seed{' '}
                  {(viewed.request as CharacterRequest).seed}.{' '}
                  {chain.length > 1 &&
                    `${chain.length} people swapped in this shot, one pass each, starting from “${(chain[0].request as CharacterRequest).name}”. `}
                  Review identity, hands and motion before using this take.
                </p>
                <button className="button" disabled={locked} onClick={() => reuse(viewed)}>
                  <RotateCcw size={13} />
                  Reuse these settings
                </button>
              </>
            )}
            {view === 'result' && viewed?.clip && resultSelection && (
              <details className="character-native-workflow">
                <summary>Continue in ComfyUI</summary>
                <p className="character-hint">
                  Export the executed API workflow and tracked mask. On this engine, its uploaded
                  source and reference files are already available. On another engine, load the
                  matching original photo, prepared source, mask and original audio source into
                  their loader nodes.
                </p>
                <div className="character-output-actions">
                  <button
                    className="button"
                    onClick={() =>
                      download(viewed.workflow, 'aftertake-character-workflow-api.json')
                    }
                  >
                    ComfyUI workflow ↗
                  </button>
                  <a
                    className="button"
                    href={mediaUrl(`/api/characters/${resultSelection.id}/mask`)}
                    download="aftertake-person-mask.mkv"
                    onClick={(event) => {
                      if (!browserDemo) return;
                      event.preventDefault();
                      void downloadRecordedMedia(
                        `/api/characters/${resultSelection.id}/mask`,
                        'aftertake-person-mask.mkv',
                      );
                    }}
                  >
                    Tracked mask
                  </a>
                  <a
                    className="button"
                    href={mediaUrl(`/api/characters/${resultSelection.id}/source`)}
                    download="aftertake-prepared-source.mp4"
                    onClick={(event) => {
                      if (!browserDemo) return;
                      event.preventDefault();
                      void downloadRecordedMedia(
                        `/api/characters/${resultSelection.id}/source`,
                        'aftertake-prepared-source.mp4',
                      );
                    }}
                  >
                    Prepared source
                  </a>
                </div>
              </details>
            )}
            {replacements.length > 0 && (
              <div className="character-history" aria-label="Character take history">
                {replacements.map((job) => (
                  <button
                    key={job.id}
                    className={viewed?.id === job.id ? 'active' : ''}
                    onClick={() => {
                      setResultId(job.id);
                      setView('result');
                    }}
                  >
                    {job.clip ? (
                      <img
                        src={mediaUrl(`/api/thumbnails/${job.clip.id}?time=0`)}
                        alt={(job.request as CharacterRequest).name}
                      />
                    ) : (
                      <ScanFace size={21} />
                    )}
                    <span>
                      {(job.request as CharacterRequest).name}
                      <small>{job.state.replaceAll('_', ' ')}</small>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="character-controls">
            <button
              className="character-recipe-import"
              disabled={locked}
              onClick={() => recipeInput.current?.click()}
            >
              <Upload size={12} />
              Import character recipe
            </button>
            <div className="character-step" ref={sourceStep} tabIndex={-1}>
              <span>01</span>
              <div>
                <h3>Source & tracking</h3>
                <small>
                  {selectionReady
                    ? 'Tracked selection ready for review'
                    : 'Choose the shot and mark one person'}
                </small>
              </div>
            </div>
            <label>
              SOURCE VIDEO
              <select
                aria-label="Character source video"
                value={sourceId}
                disabled={locked}
                onChange={(e) => changeSource(e.target.value)}
              >
                <option value="">Choose a video</option>
                {videos.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            {savedSelections.length > 0 && (
              <label>
                SAVED TRACKED SELECTION
                <select
                  aria-label="Saved tracked selection"
                  value={selectionReady ? selection.id : ''}
                  disabled={sending || uploading}
                  onChange={(event) => {
                    const saved = savedSelections.find((job) => job.id === event.target.value);
                    if (saved) useTrackedSelection(saved);
                  }}
                >
                  <option value="">Restore a completed selection</option>
                  {savedSelections.map((job) => {
                    const saved = job.request as CharacterSelectionRequest;
                    return (
                      <option key={job.id} value={job.id}>
                        {saved.clip.name} · {saved.trimStart.toFixed(2)}–
                        {(saved.trimStart + saved.duration).toFixed(2)}s ·{' '}
                        {saved.resolution === '768' ? 'High' : 'Standard'}
                      </option>
                    );
                  })}
                </select>
              </label>
            )}
            <button
              className="button"
              disabled={locked || browserDemo}
              onClick={() => {
                uploadRole.current = 'source';
                fileInput.current?.click();
              }}
            >
              <Plus size={13} />
              Import video
            </button>
            <div className="character-range">
              <label>
                START · SECONDS
                <input
                  aria-label="Character source start"
                  type="number"
                  min={0}
                  max={Math.max(0, (source?.duration || 1) - 1)}
                  step=".1"
                  value={Number(trimStart.toFixed(3))}
                  disabled={locked || !source}
                  onChange={(e) => range(Number(e.target.value), duration)}
                />
              </label>
              <label>
                LENGTH · SECONDS
                <input
                  aria-label="Character source duration"
                  type="number"
                  min={1}
                  max={Math.min(15, (source?.duration || 15) - trimStart)}
                  step=".1"
                  value={Number(duration.toFixed(3))}
                  disabled={locked || !source}
                  onChange={(e) => range(trimStart, Number(e.target.value))}
                />
              </label>
            </div>
            <p className="character-hint">
              Use one continuous shot, 1–15 seconds. Changing the range clears the selection points.
            </p>
            <label>
              WORKING RESOLUTION
              <select
                aria-label="Character working resolution"
                value={resolution}
                disabled={locked}
                onChange={(e) => {
                  setResolution(e.target.value as '480' | '768');
                  setSelectionId('');
                  setView('frame');
                }}
              >
                <option value="480">Standard · up to 0.5 MP</option>
                <option value="768">High · up to 1 MP</option>
              </select>
            </label>
            <p className="character-hint">
              High uses a larger canvas and more memory. Choose before tracking; changing resolution
              requires a new selection. The preview reports the actual size.
            </p>
            <button
              className="button character-track"
              disabled={
                browserDemo || locked || !selectionEngine?.ready || !selectionValidation.success
              }
              onClick={() => void submit('selection')}
            >
              {pending?.kind === 'selection' ? (
                <LoaderCircle size={14} className="spin" />
              ) : (
                <ScanFace size={14} />
              )}
              Track selected person
            </button>
            <RenderEstimate
              job={{ request: { format: 'aftertake-character-selection/1' } }}
              history={jobs}
              gpu={selectionEngine?.gpu}
            />
            <p className="character-action-hint">{trackHint}</p>
            {source && !positive.length && (
              <button
                className="button character-review-selection"
                onClick={() => showPreview('frame')}
              >
                Mark the person in the preview <ArrowUpRight size={13} />
              </button>
            )}
            {selectionReady && (
              <>
                <button
                  className="button character-review-selection"
                  onClick={() => showPreview('selection')}
                >
                  Review tracked selection <ArrowUpRight size={13} />
                </button>
                <button
                  className="button character-review-selection"
                  onClick={() => {
                    setSubjectEffectsOpen(true);
                    dialog.current?.scrollTo({ top: 0 });
                  }}
                >
                  <Plus size={13} /> Duplicate this person
                </button>
              </>
            )}
            <div className="character-step" ref={identityStep} tabIndex={-1}>
              <span>02</span>
              <div>
                <h3>Identity photos</h3>
                <small>One primary photo, plus optional other views</small>
              </div>
            </div>
            <label>
              PRIMARY PHOTO
              <select
                aria-label="Character reference photo"
                value={referenceId}
                disabled={locked}
                onChange={(e) => {
                  const photo = photos.find((entry) => entry.id === e.target.value);
                  if (photo) changeReference(photo);
                  else {
                    setReferenceId('');
                    setFaceBox(undefined);
                  }
                }}
              >
                <option value="">Choose a photo</option>
                {photos.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="button"
              disabled={locked || browserDemo}
              onClick={() => {
                uploadRole.current = 'reference';
                fileInput.current?.click();
              }}
            >
              <Upload size={13} />
              Import photo
            </button>
            {!reference && (
              <div className="character-photo-empty">
                <ScanFace size={21} aria-hidden="true" />
                <div>
                  <strong>Who should replace them?</strong>
                  <p>
                    Start with a clear photo of one person. Include the outfit if you want to use
                    it.
                  </p>
                </div>
              </div>
            )}
            {reference && (
              <CharacterReferenceEditor
                key={reference.id}
                photo={reference}
                value={faceBox}
                onChange={setFaceBox}
                disabled={locked}
                label="Primary reference"
                suppliesOutfit
              />
            )}
            <section
              className="character-identity-references"
              aria-label="Supporting identity photos"
            >
              <div className="character-reference-heading">
                <h4>
                  Other views <small>optional</small>
                </h4>
                <span>
                  {identityReferences.length}/{characterMaxIdentityReferences}
                </span>
              </div>
              <p className="character-hint">
                Add other views of the same person to guide facial identity. The primary photo
                controls the reference outfit. For group photos, focus only on their head.
              </p>
              <label>
                ADD FROM YOUR PHOTOS
                <select
                  aria-label="Add supporting reference photo"
                  value=""
                  disabled={locked || identityReferences.length >= characterMaxIdentityReferences}
                  onChange={(event) => {
                    const photo = photos.find((entry) => entry.id === event.target.value);
                    if (photo) addIdentityPhoto(photo);
                  }}
                >
                  <option value="">Choose another view</option>
                  {photos
                    .filter(
                      (photo) =>
                        photo.sha256 !== reference?.sha256 &&
                        !identityReferences.some(
                          (entry) => entry.reference.sha256 === photo.sha256,
                        ),
                    )
                    .map((photo) => (
                      <option key={photo.id} value={photo.id}>
                        {photo.name}
                      </option>
                    ))}
                </select>
              </label>
              <button
                className="button"
                disabled={
                  locked ||
                  browserDemo ||
                  identityReferences.length >= characterMaxIdentityReferences
                }
                onClick={() => identityFileInput.current?.click()}
              >
                <Upload size={13} /> Import supporting photos
              </button>
              {identityReferences.map((entry, index) => (
                <article className="character-identity-card" key={entry.reference.id}>
                  <div className="character-identity-summary">
                    <CharacterReferencePreview
                      photo={entry.reference}
                      box={entry.faceBox}
                      label={`Supporting photo ${index + 1}: ${entry.faceBox ? 'selected face focus' : 'full photo'}`}
                    />
                    <div>
                      <strong>{entry.reference.name}</strong>
                      <span>{entry.faceBox ? 'Face focus' : 'Full photo'} · identity only</span>
                    </div>
                    <button
                      className="button"
                      aria-label={`Remove supporting photo ${index + 1}: ${entry.reference.name}`}
                      disabled={locked}
                      onClick={() =>
                        setIdentityReferences((current) =>
                          current.filter((_, item) => item !== index),
                        )
                      }
                    >
                      <X size={13} />
                    </button>
                  </div>
                  {faceNeedsFocus(entry.reference, entry.faceBox) && (
                    <p className="character-reference-error" role="status">
                      {entry.faceBox ? 'Adjust' : 'Add'} the face focus around the full head before
                      generating. Use a roughly square crop.
                    </p>
                  )}
                  <details>
                    <summary>
                      {entry.faceBox ? 'Edit face focus' : 'Add face focus'}
                      {faceNeedsFocus(entry.reference, entry.faceBox) ? ' · needs attention' : ''}
                    </summary>
                    <CharacterReferenceEditor
                      photo={entry.reference}
                      value={entry.faceBox}
                      onChange={(box) =>
                        setIdentityReferences((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index
                              ? { reference: item.reference, ...(box ? { faceBox: box } : {}) }
                              : item,
                          ),
                        )
                      }
                      disabled={locked}
                      label={`Supporting photo ${index + 1}`}
                    />
                  </details>
                </article>
              ))}
            </section>
            <div className="character-step" ref={generateStep} tabIndex={-1}>
              <span>03</span>
              <div>
                <h3>Generate your take</h3>
                <small>Set the outfit and add any final direction</small>
              </div>
            </div>
            <label>
              OUTFIT
              <select
                aria-label="Character outfit"
                value={wardrobe}
                disabled={locked}
                onChange={(e) => setWardrobe(e.target.value as 'reference' | 'source')}
              >
                <option value="reference">Use the reference photo outfit</option>
                <option value="source">Keep the source outfit</option>
              </select>
            </label>
            <label>
              TAKE NAME
              <input
                aria-label="Character take name"
                value={name}
                maxLength={100}
                disabled={locked}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              EXTRA DIRECTION · OPTIONAL
              <textarea
                aria-label="Character extra direction"
                aria-describedby="character-direction-hint"
                rows={3}
                value={prompt}
                maxLength={2000}
                disabled={locked}
                placeholder="The woman holding the mug: silver hair, freckles, a green sweater. Keep her gesture."
                onChange={(e) => setPrompt(e.target.value)}
              />
            </label>
            <p className="character-hint" id="character-direction-hint">
              Describe the target's position and the replacement's face, hair and outfit. Specific
              direction can help the model follow your photos.
            </p>
            <label>
              SEED
              <div className="character-seed">
                <input
                  aria-label="Character seed"
                  type="number"
                  min={0}
                  max={2 ** 32 - 1}
                  step={1}
                  value={seed}
                  disabled={locked}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isInteger(n)) setSeed(Math.max(0, Math.min(2 ** 32 - 1, n)));
                  }}
                />
                <button
                  className="button"
                  aria-label="New character seed"
                  disabled={locked}
                  onClick={() => setSeed(crypto.getRandomValues(new Uint32Array(1))[0])}
                >
                  <RotateCcw size={13} />
                </button>
              </div>
            </label>
            <button
              className="button character-generate"
              disabled={!canGenerate}
              aria-describedby="character-generate-hint"
              onClick={() => void submit('replacement')}
            >
              <ScanFace size={15} />
              Replace selected person
            </button>
            <RenderEstimate
              job={{ request: { format: 'aftertake-character/1' } }}
              history={jobs}
              gpu={engine?.gpu}
            />
            <p className="character-action-hint" id="character-generate-hint">
              {generateHint}
            </p>
            <p className="character-hint">
              H3 Character Swap V1.5 · 24 fps · source audio retained. This is generative editing:
              review the finished likeness and motion.
            </p>
            {otherBusy && !pending && (
              <p className="character-hint">
                Another generation is active. You can review character takes while it finishes.
              </p>
            )}
            {browserDemo ? (
              <p className="character-install">
                Character replacement runs in the local studio.{' '}
                <a href="../cast/h3.html" target="_blank" rel="noreferrer">
                  Review the recorded H3 take and workflow ↗
                </a>
                , or install the optional character profile to generate your own take.
              </p>
            ) : (
              engine &&
              !engine.ready && (
                <details className="character-install" open>
                  <summary>
                    {engine.connected ? 'Install the character profile' : 'Start the local engine'}
                  </summary>
                  <pre>python scripts/setup.py --character-swap</pre>
                  <p>
                    The full profile is 43.9 GB, including SAM3. Models keep their publishers’
                    licenses.
                  </p>
                  <pre>python scripts/engine.py --safe-weight-copies --no-node-cache</pre>
                  <p>
                    FFmpeg and FFprobe must be on the engine PATH. Use <code>--ffmpeg-bin</code> if
                    they are installed in another folder.
                  </p>
                  {engine.missing.map((item) => (
                    <small key={item}>
                      {item}
                      <br />
                    </small>
                  ))}
                </details>
              )
            )}
            <a
              className="character-model-link"
              href="https://huggingface.co/akatz-ai/MiniMax-H3-Character-Swap-LoRA"
              target="_blank"
              rel="noreferrer"
            >
              Model details and usage terms ↗
            </a>
            {notice && (
              <p className="character-notice" role="status">
                {notice}
              </p>
            )}
            {error && (
              <p className="character-error" role="alert">
                {error}
              </p>
            )}
            <input
              ref={fileInput}
              type="file"
              hidden
              accept="video/*,image/png,image/jpeg,image/webp,.mkv"
              onChange={(e) => {
                void upload(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <input
              ref={identityFileInput}
              type="file"
              hidden
              multiple
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => {
                void uploadIdentityPhotos(Array.from(event.target.files || []));
                event.target.value = '';
              }}
            />
            <input
              ref={recipeInput}
              type="file"
              hidden
              accept="application/json,.json"
              onChange={(e) => {
                void importRecipe(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>
        </div>
      </section>
    </div>
  );
}

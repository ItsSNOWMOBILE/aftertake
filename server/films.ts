import { Router, raw } from 'express';
import { mkdir, readFile, readdir, writeFile, rename, stat, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { filmGeometry, filmTimeline, filmRequestSchema, filmManifestSchema, narrationSchema, narrationReceiptSchema, type Film, type FilmAsset } from '../src/film.js';
import { renderDimensions, type Render } from '../src/domain.js';
import { contentDigest,type PlanPicture } from './edit-plan.js';
import {narratedCutSchema,narratedSourcesSchema} from '../src/narrated-cut.js';
import {prepareNarratedCut} from './narrated-cut.js';

export async function filmRouter(root: string, data: string, python: string, renders: Map<string, Render>) {
  const router = Router(), folder = path.join(data, 'films'), assetFolder = path.join(folder, 'assets');
  await mkdir(folder, { recursive: true });
  await mkdir(assetFolder, { recursive: true });
  const films = new Map<string, Film>();
  const assets = new Map<string, FilmAsset>();
  const exec = promisify(execFile);
  const narratedFolder=path.join(folder,'narrated-cuts');await mkdir(narratedFolder,{recursive:true});
  const cutLocks=new Map<string,Promise<ReturnType<typeof prepareNarratedCut>>>();
  const receiptLocks=new Map<string,Promise<FilmAsset>>();
  let admitting = false, narrating = false;
  for (const name of await readdir(assetFolder)) {
    if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
    const asset = JSON.parse(await readFile(path.join(assetFolder, name), 'utf8')) as FilmAsset;
    assets.set(asset.id, asset);
  }
  const assetPath = (asset: FilmAsset) => path.join(assetFolder, `${asset.id}${asset.extension}`);
  async function admitAsset(id: string, name: string, extension: string, meta: Partial<FilmAsset>) {
    const bytes = await readFile(path.join(assetFolder, `${id}${extension}`));
    const asset = { ...meta, id, name, extension, sha256: createHash('sha256').update(bytes).digest('hex'),
      url: `/api/films/assets/${id}/media`, createdAt: new Date().toISOString() } as FilmAsset;
    await writeFile(path.join(assetFolder, `${id}.json`), JSON.stringify(asset, null, 2));
    assets.set(id, asset); return asset;
  }
  async function checkedAsset(id: string, kind?: FilmAsset['kind']) {
    const asset = assets.get(id);
    if (!asset || kind && asset.kind !== kind) throw Error('Import the original film asset into this workspace first.');
    if (createHash('sha256').update(await readFile(assetPath(asset))).digest('hex') !== asset.sha256) throw Error('A film asset has changed on disk. Import it again.');
    return asset;
  }
  async function restoreVoiceReceipt(source:FilmAsset,narration:NonNullable<FilmAsset['narration']>){
    const key=source.sha256,prior=receiptLocks.get(key);
    const saving=(prior||Promise.resolve()).catch(()=>{}).then(async()=>{
      const candidates=[...assets.values()].filter(asset=>asset.kind==='audio'&&asset.sha256===key);
      const exact=candidates.find(asset=>asset.narration&&contentDigest(narrationReceiptSchema.parse(asset.narration))===contentDigest(narration));
      if(exact)return checkedAsset(exact.id,'audio');
      const bare=candidates.find(asset=>!asset.narration);
      if(!bare){
        // Identical waveforms can legitimately have timed/untimed receipts or
        // different written casing. Preserve the existing asset's provenance.
        const current=await checkedAsset(source.id,'audio'),bytes=await readFile(assetPath(current));
        if(createHash('sha256').update(bytes).digest('hex')!==key)throw Error('The imported audio changed on disk.');
        const id=randomUUID(),file=path.join(assetFolder,id+current.extension);
        await writeFile(file,bytes);
        try{return await admitAsset(id,current.name,current.extension,{kind:'audio',duration:current.duration,narration,narrationOrigin:'imported'});}
        catch(error){await unlink(file).catch(()=>{});throw error;}
      }
      const current=await checkedAsset(bare.id,'audio'),id=current.id;
      const restored={...current,narration,narrationOrigin:'imported' as const};
      const target=path.join(assetFolder,id+'.json'),temporary=target+'.'+randomUUID()+'.tmp';
      try{await writeFile(temporary,JSON.stringify(restored,null,2));await rename(temporary,target);assets.set(id,restored);}
      finally{await unlink(temporary).catch(()=>{});}
      return restored;
    });
    receiptLocks.set(key,saving);
    try{return await saving;}finally{if(receiptLocks.get(key)===saving)receiptLocks.delete(key);}
  }
  async function save(film: Film) {
    const target = path.join(folder, `${film.id}.json`), temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(film, null, 2)); await rename(temporary, target);
  }
  for (const name of await readdir(folder)) {
    if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
    const film = JSON.parse(await readFile(path.join(folder, name), 'utf8')) as Film;
    if (film.state === 'assembling') {
      film.state = 'failed'; film.error = 'Assembly was interrupted. Your shot list is saved; export it again.'; await save(film);
    }
    films.set(film.id, film);
  }
  router.get('/', (_req, res) => { res.json([...films.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))); });
  router.get('/assets', (_req, res) => { res.json([...assets.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))); });
  router.get('/assets/:id/media', (req, res) => {
    const asset = assets.get(req.params.id);
    if (!asset) return void res.sendStatus(404);
    res.sendFile(`${asset.id}${asset.extension}`, { root: assetFolder });
  });
  router.post('/assets', raw({ type: 'application/octet-stream', limit: '100mb' }), async (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) return void res.status(400).json({ error: 'Choose footage, a still or an audio file.' });
    const name = path.basename(String(req.query.name || 'footage.mp4')).slice(0, 200), extension = path.extname(name).toLowerCase();
    if (!['.mp4', '.mov', '.webm', '.mkv', '.m4v', '.png', '.jpg', '.jpeg', '.webp', '.wav', '.mp3', '.m4a', '.flac', '.ogg'].includes(extension))
      return void res.status(400).json({ error: 'Use a video, image, WAV, MP3, M4A, FLAC or OGG file.' });
    const id = randomUUID(), dest = path.join(assetFolder, `${id}${extension}`);
    await writeFile(dest, req.body);
    try {
      const { stdout } = await exec(python, [path.join(root, 'scripts/probe-film-asset.py'), dest], { timeout: 30000, windowsHide: true });
      res.status(201).json(await admitAsset(id, name, extension, JSON.parse(stdout)));
    } catch {
      await unlink(dest).catch(() => {});
      res.status(422).json({ error: 'Could not read this media. Use a valid file up to 100 MB, ten minutes and 4K.' });
    }
  });
  router.post('/narration', async (req, res) => {
    const input = narrationSchema.parse(req.body);
    const {timedWords,...spokenInput}=input;
    const cached = [...assets.values()].reverse().filter(asset => {
      if(!asset.narration)return false;
      const {timedWords:hasTimings,...spoken}=narrationSchema.parse(asset.narration);
      return (!timedWords||hasTimings===true&&!!(asset.narration.wordTiming||asset.narration.wordTimingMapper==='phoneme-boundaries/2'))&&contentDigest(spoken)===contentDigest(spokenInput);
    });
    for (const asset of cached) {
      try { return void res.json(await checkedAsset(asset.id, 'audio')); }
      catch { /* Changed or missing cached bytes are never reused. */ }
    }
    if (narrating) return void res.status(409).json({ error: 'A narration clip is already being voiced.' });
    const voicePython = process.env.AFTERTAKE_NARRATION_PYTHON || path.join(root, '.runtime/voice-venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    const models = process.env.AFTERTAKE_NARRATION_MODELS || path.join(root, '.runtime/narration-models');
    if (!(await stat(voicePython).catch(() => null)) || !(await stat(path.join(models, 'kokoro-v1.0.onnx')).catch(() => null)))
      return void res.status(409).json({ error: 'Install local narration with scripts/setup-narration.py. You can also import a recorded voiceover.' });
    narrating = true;
    const id = randomUUID(), output = path.join(assetFolder, `${id}.wav`), work = path.join(assetFolder, `${id}.work.json`);
    try {
      await writeFile(work, JSON.stringify({ ...input, models, output }));
      const { stdout } = await exec(voicePython, [path.join(root, 'scripts/narrate.py'), work], { timeout: 240000, maxBuffer: 1024 * 1024, windowsHide: true });
      const { duration, ...provenance } = JSON.parse(stdout);
      res.status(201).json(await admitAsset(id, `Narration · ${input.text.slice(0, 60)}`, '.wav', { kind: 'audio', duration, narration: { ...input, ...provenance } }));
    } catch (error) {
      console.error('Local narration failed:', error);
      await unlink(output).catch(() => {});
      res.status(422).json({ error: 'Local narration failed. Check the voice runtime and pinned model files, then try a shorter passage.' });
    } finally { narrating = false; await unlink(work).catch(() => {}); }
  });
  async function checkedPictures(shots:{assetId?:string;renderId?:string;end:number}[]){
    const pictures=new Map<string,PlanPicture>();
    for(const shot of shots){
      const id=shot.assetId||shot.renderId!;
      if(!pictures.has(id)){
        if(shot.assetId){
          const asset=await checkedAsset(id);
          if(asset.kind==='audio')throw Error('Choose footage or a still for every spoken line.');
          pictures.set(id,{id,kind:asset.kind,sha256:asset.sha256,duration:asset.duration});
        }else{
          const take=renders.get(id);
          if(take?.state!=='succeeded'||!take.output)throw Error('Choose a finished local take for every spoken line.');
          const sha256=createHash('sha256').update(await readFile(path.join(data,'outputs',id+'.mp4'))).digest('hex');
          pictures.set(id,{id,kind:'video',sha256,duration:renderDimensions(take.recipe).duration});
        }
      }
      if(shot.end>pictures.get(id)!.duration+.001)throw Error('A selected Out trim exceeds its source.');
    }
    return pictures;
  }
  router.post('/narrated-cuts/sources',async(req,res)=>{
    const input=narratedSourcesSchema.parse(req.body);
    res.json([...await checkedPictures(input.shots)].map(([,picture])=>picture));
  });
  router.post('/narrated-cuts',async(req,res)=>{
    const input=narratedCutSchema.parse(req.body),pictures=await checkedPictures(input.beats.map(beat=>beat.shot));
    const voices=new Map<string,FilmAsset>();
    for(const beat of input.beats){if(!voices.has(beat.voice.assetId))voices.set(beat.voice.assetId,await checkedAsset(beat.voice.assetId,'audio'));}
    const compiled=prepareNarratedCut(input,pictures,voices),id=compiled.identity;
    let saving=cutLocks.get(id);
    if(!saving){
      saving=(async()=>{
        const file=path.join(narratedFolder,id+'.json');
        try{
          const saved=JSON.parse(await readFile(file,'utf8'));
          if(saved.identity!==id||contentDigest(saved.plan)!==contentDigest(compiled.plan))throw Error('The saved narrated cut differs from its inputs.');
          return saved as typeof compiled;
        }catch(error:any){if(error.code!=='ENOENT')throw error;}
        const temporary=file+'.'+randomUUID()+'.tmp';
        await writeFile(temporary,JSON.stringify(compiled,null,2));await rename(temporary,file);return compiled;
      })();
      cutLocks.set(id,saving);
    }
    try{res.json(await saving);}finally{if(cutLocks.get(id)===saving)cutLocks.delete(id);}
  });
  router.post('/resolve', async (req, res) => {
    const manifest = filmManifestSchema.parse(req.body), shots = [];
    const candidates = [...renders.values()].filter(take => take.state === 'succeeded' && take.output);
    const hashes = new Map<string, string>();
    for (const shot of manifest.shots) {
      if (shot.assetId) {
        const asset = [...assets.values()].find(asset => asset.sha256 === shot.sha256 && asset.kind !== 'audio');
        if (!asset) throw Error('Import the original footage or still before restoring this film.');
        await checkedAsset(asset.id);
        if (shot.end > asset.duration + .001) throw Error('A trim ends after its film asset.');
        shots.push({ assetId: asset.id, start: shot.start, end: shot.end, ...(shot.dissolve !== undefined ? { dissolve:shot.dissolve } : {}), ...(shot.framing ? { framing: shot.framing } : {}) }); continue;
      }
      let match: Render | undefined;
      for (const take of [...candidates].sort((a, b) => Number(b.id === shot.renderId) - Number(a.id === shot.renderId))) {
        let hash = hashes.get(take.id);
        if (!hash) {
          const bytes = await readFile(path.join(data, 'outputs', `${take.id}.mp4`)).catch(() => null);
          if (!bytes) continue;
          hash = createHash('sha256').update(bytes).digest('hex');
          hashes.set(take.id, hash);
        }
        if (hash === shot.sha256) { match = take; break; }
      }
      if (!match) throw new Error('This manifest needs its original finished takes in this workspace. Its recipes are included for regeneration.');
      if (shot.end > renderDimensions(match.recipe).duration + .001) throw new Error('A manifest trim ends after its matching take.');
      shots.push({ renderId: match.id, start: shot.start, end: shot.end, ...(shot.dissolve !== undefined ? { dissolve:shot.dissolve } : {}), ...(shot.framing ? { framing: shot.framing } : {}) });
    }
    const checkedAudio=[];
    for (const track of manifest.audio || []) {
      const asset = [...assets.values()].find(asset => asset.sha256 === track.sha256 && asset.kind === 'audio');
      if (!asset) throw Error('Import the original narration or audio before restoring this film.');
      await checkedAsset(asset.id, 'audio');
      if (track.sourceEnd > asset.duration + .001) throw Error('An audio trim ends after its source.');
      if(track.asset?.narration){
        if(Math.abs(track.asset.duration-asset.duration)>.001)throw Error('The voice receipt duration differs from its imported audio.');
      }
      const { sha256: _hash,asset:_receipt, ...cut } = track;
      checkedAudio.push({asset,narration:track.asset?.narration,cut});
    }
    // Validate every source and trim before restoring any metadata. Cached
    // speech can then be reused without running the narration model again.
    const audio=[];
    for(const{asset,narration,cut}of checkedAudio){
      const bound=narration?await restoreVoiceReceipt(asset,narration):asset;
      audio.push({...cut,assetId:bound.id});
    }
    res.json({ name: manifest.name, aspect: manifest.aspect, shots,
      ...(manifest.titles ? { titles: manifest.titles } : {}), ...(manifest.audio ? { audio } : {}),
      ...(manifest.sourceVolume !== undefined ? { sourceVolume: manifest.sourceVolume } : {}),
      ...(manifest.normalizeAudio !== undefined ? { normalizeAudio: manifest.normalizeAudio } : {}) });
  });
  router.get('/:id/video', (req, res) => {
    const film = films.get(req.params.id);
    if (film?.state !== 'ready') return void res.sendStatus(404);
    res.sendFile(`${film.id}.mp4`, { root: folder });
  });
  router.get('/:id/manifest', (req, res) => {
    const film = films.get(req.params.id);
    if (!film) return void res.sendStatus(404);
    res.attachment('aftertake-film.json').json({ format: film.titles?.length || film.audio?.length || film.shots.some(shot => shot.assetId) ? 'aftertake-film/2' : 'aftertake-film/1', ...film });
  });
  router.post('/', async (req, res) => {
    const draft = filmRequestSchema.parse(req.body);
    const requestKey = req.get('Idempotency-Key'), requestDigest = contentDigest(draft);
    if (requestKey && !/^[a-zA-Z0-9_-]{1,128}$/.test(requestKey)) return void res.status(400).json({error:'Use an idempotency key of 1–128 letters, digits, underscores or hyphens.'});
    const existing = requestKey ? [...films.values()].find(film => film.requestKey === requestKey) : undefined;
    if (existing) {
      if (existing.requestDigest !== requestDigest) return void res.status(409).json({error:'That export key belongs to a different edit. Save a new plan or use a new key.'});
      return void res.status(existing.state === 'assembling' ? 202 : 200).json(existing);
    }
    if (admitting || [...films.values()].some(film => film.state === 'assembling')) return void res.status(409).json({ error: 'A film is already being assembled.' });
    admitting = true;
    try {
      if (!(await stat(python).catch(() => null))) return void res.status(409).json({ error: 'Install the local Python runtime to assemble films.' });
      const shots: Film['shots'] = [], inputs = [];
      for (const shot of draft.shots) {
        if (shot.assetId) {
          const asset = await checkedAsset(shot.assetId);
          if (asset.kind === 'audio') throw Error('Use audio on the voiceover track.');
          if (shot.end > asset.duration + .001) throw Error('Trim ends after its footage.');
          const start = Math.round(shot.start * 24) / 24, end = Math.round(shot.end * 24) / 24;
          shots.push({ ...shot, start, end, title: asset.name, sha256: asset.sha256, asset });
          inputs.push({ source: assetPath(asset), kind: asset.kind, start, end, framing: shot.framing, dissolve:shot.dissolve }); continue;
        }
        const take = renders.get(shot.renderId!);
        if (!take?.output || take.state !== 'succeeded') throw new Error('Every film shot must be a finished local take.');
        if (shot.end > renderDimensions(take.recipe).duration + .001) throw new Error('Trim ends after its take.');
        const source = path.join(data, 'outputs', `${take.id}.mp4`);
        const sha256 = createHash('sha256').update(await readFile(source)).digest('hex');
        const start = Math.round(shot.start * 24) / 24, end = Math.min(Math.round(shot.end * 24), Math.floor(renderDimensions(take.recipe).duration * 24)) / 24;
        shots.push({ ...shot, start, end, title: take.recipe.name, sha256, recipe: take.recipe, workflow: take.workflow });
        inputs.push({ source, start, end, framing: shot.framing, dissolve:shot.dissolve });
      }
      const duration = filmTimeline(shots).at(-1)!.end;
      if (draft.titles?.some(title => title.end > duration + .001)) throw Error('A title ends after the film.');
      const audio: NonNullable<Film['audio']> = [], audioInputs = [];
      for (const track of draft.audio || []) {
        const asset = await checkedAsset(track.assetId, 'audio');
        if (track.sourceEnd > asset.duration + .001 || track.start + track.sourceEnd - track.sourceStart > duration + 1 / 24) throw Error('Trim the voiceover to fit its source and film.');
        audio.push({ ...track, sha256: asset.sha256, asset });
        audioInputs.push({ ...track, source: assetPath(asset) });
      }
      const film: Film = { id: randomUUID(), name: draft.name, aspect: draft.aspect, shots,
        ...(requestKey ? {requestKey,requestDigest} : {}),
        titles: draft.titles || [], audio, sourceVolume: draft.sourceVolume ?? 1, normalizeAudio: draft.normalizeAudio ?? false,
        state: 'assembling', duration, createdAt: new Date().toISOString() };
      films.set(film.id, film); await save(film);
      const workfile = path.join(folder, `${film.id}.work.json`);
      const [width, height] = filmGeometry[film.aspect];
      await writeFile(workfile, JSON.stringify({ output: path.join(folder, `${film.id}.mp4`), width, height, shots: inputs,
        titles: film.titles, audio: audioInputs, sourceVolume: film.sourceVolume, normalizeAudio: film.normalizeAudio, fonts: path.join(root, 'public/fonts'),
        manifest: { format: 'aftertake-film/2', name: film.name, aspect: film.aspect, shots: film.shots,
          titles: film.titles, audio: film.audio, sourceVolume: film.sourceVolume, normalizeAudio: film.normalizeAudio } }));
      void exec(python, [path.join(root, 'scripts/render-film.py'), workfile], { timeout: 600000, maxBuffer: 1024 * 1024, windowsHide: true })
        .then(async () => { film.state = 'ready'; film.output = `/api/films/${film.id}/video`; await save(film); })
        .catch(async error => { console.error('Film assembly failed:', error); film.state = 'failed'; film.error = 'Film assembly failed. Check the runtime and the source takes, then export again.'; await save(film); })
        .finally(() => unlink(workfile).catch(() => {}));
      res.status(202).json(film);
    } finally { admitting = false; }
  });
  return router;
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createFilmRecordingSession,
  filmCaptureOptions,
  filmRecordingMimeType,
  type FilmRecordingState,
} from '../src/film-recorder';

class FakeTrack extends EventTarget {
  readyState: MediaStreamTrackState = 'live';
  stops = 0;
  constructor(readonly kind: 'video' | 'audio') {
    super();
  }
  stop() {
    this.stops++;
    this.readyState = 'ended';
  }
  endSharing() {
    this.readyState = 'ended';
    this.dispatchEvent(new Event('ended'));
  }
}

class FakeStream {
  tracks: FakeTrack[];
  constructor(audio = false) {
    this.tracks = [new FakeTrack('video'), ...(audio ? [new FakeTrack('audio')] : [])];
  }
  getTracks() {
    return this.tracks;
  }
  getVideoTracks() {
    return this.tracks.filter((track) => track.kind === 'video');
  }
  getAudioTracks() {
    return this.tracks.filter((track) => track.kind === 'audio');
  }
  removeTrack(track: FakeTrack) {
    this.tracks = this.tracks.filter((item) => item !== track);
  }
}

class FakeRecorder extends EventTarget {
  static supported = ['video/webm;codecs=vp8,opus'];
  static created: FakeRecorder[] = [];
  static isTypeSupported(type: string) {
    return this.supported.includes(type);
  }
  state: RecordingState = 'inactive';
  readonly mimeType: string;
  timeslice?: number;
  stops = 0;
  finishOnStop = true;
  constructor(
    readonly stream: MediaStream,
    options: MediaRecorderOptions = {},
  ) {
    super();
    this.mimeType = options.mimeType!;
    FakeRecorder.created.push(this);
  }
  start(timeslice: number) {
    this.state = 'recording';
    this.timeslice = timeslice;
  }
  stop() {
    this.stops++;
    this.state = 'inactive';
    if (this.finishOnStop) this.dispatchEvent(new Event('stop'));
  }
  data(bytes: string) {
    const event = new Event('dataavailable');
    Object.defineProperty(event, 'data', { value: new Blob([bytes], { type: this.mimeType }) });
    this.dispatchEvent(event);
  }
}

function fixture(
  options: { stream?: FakeStream; choose?: () => Promise<MediaStream>; maxBytes?: number } = {},
) {
  FakeRecorder.created = [];
  FakeRecorder.supported = ['video/webm;codecs=vp8,opus'];
  const stream = options.stream || new FakeStream();
  const states: FilmRecordingState[] = [];
  const requests: DisplayMediaStreamOptions[] = [];
  let time = Date.UTC(2026, 9, 19);
  let tick: (() => void) | undefined;
  let cleared = 0;
  const session = createFilmRecordingSession({
    Recorder: FakeRecorder as unknown as typeof MediaRecorder,
    mediaDevices: {
      getDisplayMedia: (request) => {
        requests.push(request!);
        return options.choose
          ? options.choose()
          : Promise.resolve(stream as unknown as MediaStream);
      },
    },
    onChange: (state) => states.push(state),
    now: () => time,
    every: (callback) => {
      tick = callback;
      return () => {
        cleared++;
        tick = undefined;
      };
    },
    limits: { durationMs: 120_000, maxBytes: options.maxBytes ?? 1024 },
  });
  return {
    session,
    stream,
    states,
    requests,
    advance: (milliseconds: number) => {
      time += milliseconds;
      tick?.();
    },
    get cleared() {
      return cleared;
    },
    get recorder() {
      return FakeRecorder.created.at(-1)!;
    },
  };
}

test('capture is user-initiated, requests cursor/30fps and never a microphone', async () => {
  const f = fixture();
  assert.equal(f.requests.length, 0, 'Constructing a session does not open the chooser.');
  const started = f.session.start(false);
  assert.equal(f.requests.length, 1, 'Chooser is called synchronously inside the click path.');
  assert.deepEqual(f.requests[0], {
    video: { frameRate: { ideal: 30, max: 30 }, cursor: 'always' },
    audio: false,
    systemAudio: 'exclude',
  });
  await started;
  assert.equal(f.session.getState().phase, 'recording');
  assert.equal(f.recorder.timeslice, 1000);
  assert.equal(f.recorder.mimeType, 'video/webm;codecs=vp8,opus');
  f.session.dispose();
  assert.equal(f.stream.getTracks()[0].stops, 1);
});

test('codec negotiation prefers actual supported WebM and refuses unsupported recording', async () => {
  assert.equal(
    filmRecordingMimeType({ isTypeSupported: (type) => type.includes('vp9') }),
    'video/webm;codecs=vp9,opus',
  );
  assert.equal(
    filmRecordingMimeType({ isTypeSupported: (type) => type === 'video/webm' }),
    'video/webm',
  );
  const f = fixture();
  FakeRecorder.supported = [];
  await f.session.start(false);
  assert.equal(f.requests.length, 0);
  assert.equal(f.session.getState().phase, 'error');
  assert.match(f.session.getState().error!, /cannot record WebM/);
});

test('stop finalizes original bytes and actual audio into a local WebM, then releases all capture resources', async () => {
  const f = fixture({ stream: new FakeStream(true) });
  await f.session.start(true);
  assert.deepEqual(filmCaptureOptions(true).audio, true);
  f.recorder.data('webm-initial');
  f.advance(1234);
  f.recorder.data('-webm-final');
  f.session.stop();
  const state = f.session.getState();
  assert.equal(state.phase, 'ready');
  assert.equal(state.audio, true);
  assert.equal(state.elapsedMs, 1234);
  assert.equal(state.file?.type, 'video/webm;codecs=vp8,opus');
  assert.match(state.file!.name, /\.webm$/);
  assert.equal(await state.file!.text(), 'webm-initial-webm-final');
  assert.equal(f.cleared, 1);
  assert.ok(f.stream.getTracks().every((track) => track.stops === 1));
  f.recorder.data('late-bytes');
  f.stream.getVideoTracks()[0].endSharing();
  assert.equal(f.session.getState(), state, 'Detached listeners cannot mutate a finished result.');
  f.session.discard();
  assert.equal(f.session.getState().file, undefined);
});

test('requested but unavailable surface audio is reported honestly; unrequested audio is stopped', async () => {
  const silent = fixture();
  await silent.session.start(true);
  assert.equal(silent.session.getState().audio, false);
  assert.match(silent.session.getState().note!, /supplied no audio/);
  silent.session.dispose();
  const stream = new FakeStream(true);
  const audio = stream.getAudioTracks()[0];
  const f = fixture({ stream });
  await f.session.start(false);
  assert.equal(stream.getAudioTracks().length, 0);
  assert.equal(audio.stops, 1);
  f.session.dispose();
});

test('ending screen sharing finalizes the recording without continuing to retain tracks', async () => {
  const f = fixture();
  await f.session.start(false);
  f.recorder.data('native-encoded-frames');
  f.advance(3000);
  f.stream.getVideoTracks()[0].endSharing();
  assert.equal(f.session.getState().phase, 'ready');
  assert.match(f.session.getState().note!, /Screen sharing ended/);
  assert.equal(f.recorder.stops, 1);
  assert.equal(f.cleared, 1);
});

test('duration limit finalizes a valid recording; oversized chunks are discarded, never truncated into an asset', async () => {
  const bounded = fixture();
  await bounded.session.start(false);
  bounded.recorder.data('complete-frames');
  bounded.advance(120_000);
  assert.equal(bounded.session.getState().phase, 'ready');
  assert.match(bounded.session.getState().note!, /two-minute limit/);
  const oversized = fixture({ maxBytes: 4 });
  await oversized.session.start(false);
  oversized.recorder.data('123');
  oversized.recorder.data('45');
  assert.equal(oversized.session.getState().phase, 'error');
  assert.equal(oversized.session.getState().file, undefined);
  assert.equal(oversized.session.getState().bytes, 0);
  assert.equal(oversized.stream.getTracks()[0].stops, 1);
  assert.equal(oversized.cleared, 1);
});

test('unmount and discard release a late chooser stream and suppress stale results', async () => {
  let resolve!: (stream: MediaStream) => void;
  const f = fixture({
    choose: () =>
      new Promise((done) => {
        resolve = done;
      }),
  });
  const started = f.session.start(false);
  f.session.dispose();
  const count = f.states.length;
  resolve(f.stream as unknown as MediaStream);
  await started;
  assert.equal(f.stream.getTracks()[0].stops, 1);
  assert.equal(FakeRecorder.created.length, 0);
  assert.equal(f.states.length, count);

  let resolveAgain!: (stream: MediaStream) => void;
  const canceled = fixture({
    choose: () =>
      new Promise((done) => {
        resolveAgain = done;
      }),
  });
  const pending = canceled.session.start(false);
  canceled.session.discard();
  resolveAgain(canceled.stream as unknown as MediaStream);
  await pending;
  assert.equal(canceled.session.getState().phase, 'idle');
  assert.equal(canceled.stream.getTracks()[0].stops, 1);
});

test('permission refusal is readable and retry does not open a second concurrent chooser', async () => {
  const denied = fixture({
    choose: async () => {
      throw new DOMException('private-native-detail', 'NotAllowedError');
    },
  });
  const first = denied.session.start(false);
  await denied.session.start(false);
  await first;
  assert.equal(denied.requests.length, 1);
  assert.match(denied.session.getState().error!, /canceled or denied/);
  assert.doesNotMatch(denied.session.getState().error!, /private-native-detail/);
  await denied.session.start(false);
  assert.equal(denied.requests.length, 2);
});

test('encoder failure and missing final data both stop sharing and retain no invalid file', async () => {
  const failed = fixture();
  await failed.session.start(false);
  failed.recorder.data('partial');
  failed.recorder.dispatchEvent(new Event('error'));
  assert.equal(failed.session.getState().phase, 'error');
  assert.equal(failed.session.getState().file, undefined);
  assert.equal(failed.stream.getTracks()[0].stops, 1);
  const empty = fixture();
  await empty.session.start(false);
  empty.session.stop();
  assert.equal(empty.session.getState().phase, 'error');
  assert.match(empty.session.getState().error!, /no video data/);
});

test('a stuck recorder is stopped and released after bounded finalization time', async () => {
  const f = fixture();
  await f.session.start(false);
  f.recorder.finishOnStop = false;
  f.recorder.data('unfinalized');
  f.session.stop();
  assert.equal(f.session.getState().phase, 'stopping');
  f.advance(5250);
  assert.equal(f.session.getState().phase, 'error');
  assert.equal(f.session.getState().file, undefined);
  assert.equal(f.stream.getTracks()[0].stops, 1);
});

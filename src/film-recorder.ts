export const FILM_RECORDING_LIMITS = Object.freeze({
  durationMs: 120_000,
  maxBytes: 96 * 1024 * 1024,
});

export type FilmRecordingState = Readonly<{
  phase: 'idle' | 'choosing' | 'recording' | 'stopping' | 'ready' | 'error';
  elapsedMs: number;
  bytes: number;
  audio: boolean;
  file?: File;
  note?: string;
  error?: string;
}>;

export const idleFilmRecording: FilmRecordingState = Object.freeze({
  phase: 'idle',
  elapsedMs: 0,
  bytes: 0,
  audio: false,
});

const webmTypes = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
] as const;

export function filmRecordingMimeType(recorder: Pick<typeof MediaRecorder, 'isTypeSupported'>) {
  return webmTypes.find((type) => recorder.isTypeSupported(type));
}

export function filmRecordingAvailability(): string | undefined {
  if (typeof window === 'undefined' || !window.isSecureContext)
    return 'Screen recording needs HTTPS or a local studio at localhost.';
  if (!navigator.mediaDevices?.getDisplayMedia || typeof MediaRecorder === 'undefined')
    return 'Screen recording is unavailable in this browser. Use a desktop browser with screen sharing, or import a recording.';
  if (!filmRecordingMimeType(MediaRecorder))
    return 'This browser cannot record WebM for Film. Use a compatible desktop browser or import a recording.';
}

export function filmCaptureOptions(includeAudio: boolean): DisplayMediaStreamOptions {
  // These are capture preferences, never permission grants or a preselected surface.
  const video: MediaTrackConstraints & { cursor: string } = {
    frameRate: { ideal: 30, max: 30 },
    cursor: 'always',
  };
  return {
    video,
    audio: includeAudio,
    systemAudio: includeAudio ? 'include' : 'exclude',
  } as DisplayMediaStreamOptions;
}

function captureError(error: unknown) {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'AbortError')
    return 'Screen sharing was canceled or denied. Choose Record screen to try again.';
  if (name === 'InvalidStateError')
    return 'Choose Record screen from the focused studio window to open the sharing chooser.';
  if (name === 'NotReadableError')
    return 'The browser could not read that screen or window. Check operating-system screen-recording access and try again.';
  if (name === 'NotFoundError') return 'No screen or window is available to share.';
  return 'Screen recording could not start or continue. Choose another surface or import a recording.';
}

type RecordingDependencies = {
  mediaDevices: Pick<MediaDevices, 'getDisplayMedia'>;
  Recorder: typeof MediaRecorder;
  onChange: (state: FilmRecordingState) => void;
  now?: () => number;
  every?: (callback: () => void, milliseconds: number) => () => void;
  limits?: typeof FILM_RECORDING_LIMITS;
};

type ActiveRecording = {
  stream: MediaStream;
  recorder: MediaRecorder;
  chunks: Blob[];
  bytes: number;
  startedAt: number;
  stoppedAt?: number;
  note?: string;
  removeListeners: () => void;
  clearTimer: () => void;
};

/** Owns one user-selected display stream. It never requests a microphone or uploads media. */
export function createFilmRecordingSession({
  mediaDevices,
  Recorder,
  onChange,
  now = Date.now,
  every = (callback, milliseconds) => {
    const timer = setInterval(callback, milliseconds);
    return () => clearInterval(timer);
  },
  limits = FILM_RECORDING_LIMITS,
}: RecordingDependencies) {
  let state = idleFilmRecording;
  let active: ActiveRecording | undefined;
  let revision = 0;
  let disposed = false;

  function publish(next: FilmRecordingState) {
    state = next;
    if (!disposed) onChange(next);
  }

  function release(run: ActiveRecording) {
    run.removeListeners();
    run.clearTimer();
    if (run.recorder.state !== 'inactive') {
      try {
        run.recorder.stop();
      } catch {
        // The native recorder may already have stopped after a device error.
      }
    }
    for (const track of run.stream.getTracks()) track.stop();
    run.chunks.length = 0;
    if (active === run) active = undefined;
  }

  function fail(message: string) {
    if (active) release(active);
    publish({ ...idleFilmRecording, phase: 'error', error: message });
  }

  function stop(note?: string) {
    const run = active;
    if (!run || state.phase !== 'recording') return;
    run.note = note || run.note;
    run.stoppedAt = now();
    publish({ ...state, phase: 'stopping', note: run.note });
    try {
      run.recorder.stop();
    } catch {
      fail('The recording could not be finalized. Please record a shorter clip and try again.');
    }
  }

  async function start(includeAudio: boolean) {
    if (disposed || ['choosing', 'recording', 'stopping'].includes(state.phase)) return;
    const currentRevision = ++revision;
    const mimeType = filmRecordingMimeType(Recorder);
    if (!mimeType) {
      fail('This browser cannot record WebM for Film. Import a recording instead.');
      return;
    }
    publish({ ...idleFilmRecording, phase: 'choosing' });
    let stream: MediaStream | undefined;
    try {
      // Called synchronously from the click handler, before the first await.
      stream = await mediaDevices.getDisplayMedia(filmCaptureOptions(includeAudio));
      if (disposed || revision !== currentRevision) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      const videoTracks = stream.getVideoTracks();
      if (!videoTracks.some((track) => track.readyState === 'live'))
        throw new Error('No live display video track.');
      if (!includeAudio)
        for (const track of stream.getAudioTracks()) {
          stream.removeTrack(track);
          track.stop();
        }
      const recorder = new Recorder(stream, {
        mimeType,
        videoBitsPerSecond: 6_000_000,
        audioBitsPerSecond: 128_000,
      });
      if (!/^video\/webm(?:;|$)/i.test(recorder.mimeType))
        throw new Error('The browser did not select WebM.');
      const audio = stream.getAudioTracks().some((track) => track.readyState === 'live');
      const run: ActiveRecording = {
        stream,
        recorder,
        chunks: [],
        bytes: 0,
        startedAt: now(),
        removeListeners: () => {},
        clearTimer: () => {},
        note:
          includeAudio && !audio
            ? 'The selected surface supplied no audio. This recording is silent.'
            : undefined,
      };
      active = run;
      const onData = (event: BlobEvent) => {
        if (active !== run || !event.data.size) return;
        if (run.bytes + event.data.size > limits.maxBytes) {
          fail('The recording exceeded 96 MB and was discarded. Record a shorter clip.');
          return;
        }
        run.chunks.push(event.data);
        run.bytes += event.data.size;
        publish({ ...state, bytes: run.bytes });
      };
      const onStop = () => {
        if (active !== run) return;
        const elapsedMs = Math.max(0, (run.stoppedAt ?? now()) - run.startedAt);
        if (!run.bytes) {
          fail('The recording contained no video data. Record a longer clip and try again.');
          return;
        }
        const file = new File(
          run.chunks,
          `aftertake-recording-${new Date(now()).toISOString().replace(/[:.]/g, '-')}.webm`,
          { type: recorder.mimeType, lastModified: now() },
        );
        const note = run.note;
        release(run);
        publish({ phase: 'ready', file, bytes: file.size, elapsedMs, audio, note });
      };
      const onError = () =>
        fail(
          'The browser stopped recording because of a capture or encoding error. Please try again.',
        );
      const onEnded = () =>
        stop('Screen sharing ended. The captured recording is ready to review.');
      recorder.addEventListener('dataavailable', onData);
      recorder.addEventListener('stop', onStop);
      recorder.addEventListener('error', onError);
      for (const track of videoTracks) track.addEventListener('ended', onEnded);
      run.removeListeners = () => {
        recorder.removeEventListener('dataavailable', onData);
        recorder.removeEventListener('stop', onStop);
        recorder.removeEventListener('error', onError);
        for (const track of videoTracks) track.removeEventListener('ended', onEnded);
      };
      publish({ ...idleFilmRecording, phase: 'recording', audio, note: run.note });
      recorder.start(1000);
      if (active !== run) return;
      run.clearTimer = every(() => {
        if (active !== run) return;
        if (state.phase === 'stopping') {
          if (now() - (run.stoppedAt ?? now()) > 5000)
            fail('The browser did not finish the recording. Please try a shorter capture.');
          return;
        }
        const elapsedMs = Math.max(0, now() - run.startedAt);
        publish({ ...state, elapsedMs });
        if (elapsedMs >= limits.durationMs)
          stop('The two-minute limit was reached. Review or import your recording.');
      }, 250);
    } catch (error) {
      if (stream) for (const track of stream.getTracks()) track.stop();
      if (!disposed && revision === currentRevision) fail(captureError(error));
    }
  }

  function discard() {
    revision++;
    if (active) release(active);
    publish(idleFilmRecording);
  }

  return {
    start,
    stop: () => stop(),
    discard,
    getState: () => state,
    dispose() {
      disposed = true;
      discard();
    },
  };
}

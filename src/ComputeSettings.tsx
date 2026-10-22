import { useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Check,
  Cloud,
  Cpu,
  LoaderCircle,
  LockKeyhole,
  Server,
  X,
} from 'lucide-react';
import { apiFetch, browserDemo } from './transport';
import { comfyCloudEngine, type ComputeProvider, type ComputeStatus } from './compute';
import type { Engine } from './domain';
import './compute-settings.css';

const destinations = [
  { id: 'local', label: 'Local GPU', icon: Cpu },
  { id: 'comfy-cloud', label: 'Comfy Cloud', icon: Cloud },
  { id: 'managed-deployment', label: 'Deployment', icon: Server },
] as const;
const featureNames: Record<string, string> = {
  structure: 'Structure-guided edits',
  inpaint: 'Painted video edits',
  cinema: 'Animate a frame',
  'motion-transfer': 'Motion transfer',
  motion: 'Camera guidance',
  'frame-edit': 'Reference image editing',
  'image-gen': 'Create images',
  'text-video': 'Create video',
  'character-selection': 'Track a person',
  'character-swap': 'Replace a character',
  depth: 'Still-image depth effects',
  upscale: 'Upscale video',
  interpolate: 'Smooth and slow motion',
  song: 'Make a song',
};

// The launcher flag that installs each tool's local model profile.
const setupFlags: Record<string, string> = {
  'text-video': '--video',
  'image-gen': '--image',
  'frame-edit': '--frame-edit',
  'motion-transfer': '--motion-transfer',
  motion: '--camera',
  inpaint: '--region-edit',
  cinema: '--region-edit',
  'character-selection': '--character-swap',
  'character-swap': '--character-swap',
  depth: '--depth',
  upscale: '--upscale',
  interpolate: '--interpolate',
  song: '--song',
};
const cloudSteps = [
  [
    'Your account',
    "Use a key from a paid Comfy Cloud plan. Free accounts can render only on Comfy Cloud's website.",
  ],
  [
    'What runs there',
    "Images, text to video, upscaling, smooth and slow motion, and songs. Character, region and depth tools need Aftertake's own nodes, so they stay on your GPU.",
  ],
  [
    'Your credits',
    "Cloud renders use your account's credits. Aftertake adds the sound and color grade on your computer.",
  ],
] as const;
const deploymentSteps = [
  ['Your account', "Add your own key when you're ready."],
  [
    'A compatible workflow',
    "Aftertake's models and custom nodes must be available on the deployment.",
  ],
  ['Verified billing', 'Confirm whose credits pay for the run before enabling it.'],
] as const;
const setupCommand = (feature: string) =>
  setupFlags[feature]
    ? `node scripts/aftertake.mjs setup-gpu ${setupFlags[feature]}`
    : 'python scripts/setup.py';

async function computeRequest(path = '', init?: RequestInit): Promise<ComputeStatus> {
  const response = await apiFetch('/api/compute' + path, init);
  const value = await response.json();
  if (!response.ok) throw Error(value.error || 'The connection could not be updated.');
  return value;
}

export default function ComputeSettings({
  engine,
  setupProfile,
  onClose,
}: {
  engine: Engine;
  setupProfile: string;
  onClose: () => void;
}) {
  const [destination, setDestination] = useState<ComputeProvider>('local');
  const [status, setStatus] = useState<ComputeStatus>();
  const [apiKey, setApiKey] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(!browserDemo);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const dialog = useRef<HTMLElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    close.current?.focus();
    if (browserDemo) return () => previousFocus?.focus();
    let canceled = false;
    void computeRequest()
      .then((value) => {
        if (canceled) return;
        setStatus(value);
        if (value.configured?.provider && value.configured.provider !== 'local') {
          setDestination(value.configured.provider);
          setEndpoint(value.configured.endpoint || '');
        } else if (!value.checkedAt) {
          // Check each local tool as the dialog opens, so readiness needs no extra click.
          void computeRequest('/probe', { method: 'POST' })
            .then((checked) => {
              if (!canceled) setStatus(checked);
            })
            .catch(() => {});
        }
      })
      .catch(() => {
        if (!canceled)
          setError('Connection settings could not be loaded. Your local engine is unchanged.');
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
      previousFocus?.focus();
    };
  }, []);

  async function act(action: 'save' | 'probe' | 'remove') {
    if (browserDemo || busy || loading || (action === 'save' && !canSave)) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const value =
        action === 'save'
          ? await computeRequest('/connection', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                provider: destination,
                ...(destination !== 'local' && apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
                ...(destination === 'managed-deployment' ? { endpoint: endpoint.trim() } : {}),
              }),
            })
          : action === 'probe'
            ? await computeRequest('/probe', { method: 'POST' })
            : await computeRequest('/connection', { method: 'DELETE' });
      setStatus(value);
      if (action !== 'probe') setApiKey('');
      if (action === 'remove') {
        setEndpoint('');
        setNotice('Saved cloud credentials removed. Your local engine selection is unchanged.');
      } else if (action === 'save') {
        setNotice(
          !value.configured?.hasApiKey
            ? 'Cloud setup saved for this server session. Add your key when your account is ready.'
            : destination === 'comfy-cloud'
              ? 'Key saved for this server session. Check it to turn on Comfy Cloud.'
              : 'Connection saved for this server session. Cloud generation remains unavailable.',
        );
      } else
        setNotice(
          value.state === 'cloud'
            ? 'Comfy Cloud is on. New images, videos, upscales, smooth or slow motion and songs render there.'
            : 'Connection check finished. No generation was started.',
        );
    } catch (failure) {
      // The API supplies sanitized error text. Never reflect the submitted key.
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const selectedConnection = status?.configured?.provider === destination;
  const cloudOn = status?.state === 'cloud';
  const remote = destination !== 'local';
  const connectionDraftChanged =
    apiKey.length > 0 ||
    (destination === 'managed-deployment' &&
      endpoint.trim() !== (status?.configured?.endpoint || ''));
  const showChecks = status && (selectedConnection || (!remote && !status.configured));
  const canSave =
    remote &&
    (!selectedConnection || !status?.configured?.hasApiKey || apiKey.trim().length > 0) &&
    (destination !== 'managed-deployment' || endpoint.trim().length > 0);

  return (
    <div className="modal-backdrop compute-backdrop" onClick={onClose}>
      <section
        className="modal compute-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Render setup"
        ref={dialog}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
          }
          if (event.key !== 'Tab') return;
          const items = Array.from(
            dialog.current?.querySelectorAll<HTMLElement>(
              'button:not(:disabled),a[href],input:not(:disabled),summary,[tabindex="0"]',
            ) || [],
          ).filter((element) => element.getClientRects().length);
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
          ref={close}
          className="modal-close"
          aria-label="Close render setup"
          onClick={onClose}
        >
          <X size={19} />
        </button>
        <div className="eyebrow">YOUR RENDER SETUP</div>
        <h2>A place for every take.</h2>
        <p className="compute-intro">
          Use your own GPU, or render images, video, upscales, motion and songs on Comfy Cloud with
          your own key.
        </p>
        <div className={`compute-active-strip ${!browserDemo && !engine.ready ? 'not-ready' : ''}`}>
          <span className="compute-status-dot" aria-hidden="true" />
          <span>
            {browserDemo
              ? 'Recorded examples'
              : engine.gpu === comfyCloudEngine
                ? engine.ready
                  ? 'Comfy Cloud is ready for this workflow'
                  : 'Comfy Cloud is not ready for this workflow'
                : engine.ready
                  ? 'Local engine is ready for this workflow'
                  : engine.connected
                    ? 'Local engine connected · generation blocked'
                    : 'Local engine is offline'}
          </span>
          <span>
            {browserDemo
              ? 'No credits used'
              : cloudOn
                ? 'Comfy Cloud is on for supported studios'
                : 'Comfy Cloud is off'}
          </span>
        </div>
        <div className="compute-tabs" role="tablist" aria-label="Render destinations">
          {destinations.map(({ id, label, icon: Icon }, index) => (
            <button
              key={id}
              ref={(element) => {
                tabs.current[index] = element;
              }}
              id={`compute-tab-${id}`}
              role="tab"
              aria-selected={destination === id}
              aria-controls={`compute-panel-${id}`}
              tabIndex={destination === id ? 0 : -1}
              disabled={busy || loading}
              onClick={() => {
                setDestination(id);
                setError('');
                setNotice('');
                setApiKey('');
              }}
              onKeyDown={(event) => {
                let next = index;
                if (event.key === 'ArrowRight') next = (index + 1) % destinations.length;
                else if (event.key === 'ArrowLeft')
                  next = (index + destinations.length - 1) % destinations.length;
                else if (event.key === 'Home') next = 0;
                else if (event.key === 'End') next = destinations.length - 1;
                else return;
                event.preventDefault();
                setDestination(destinations[next].id);
                setApiKey('');
                setError('');
                setNotice('');
                tabs.current[next]?.focus();
              }}
            >
              <Icon size={17} /> {label}
            </button>
          ))}
        </div>
        <div
          role="tabpanel"
          id={`compute-panel-${destination}`}
          aria-labelledby={`compute-tab-${destination}`}
        >
          {!remote ? (
            <>
              <div className="compute-local-card">
                <Cpu size={24} />
                <div>
                  <strong>
                    {browserDemo
                      ? 'Explore before you install.'
                      : engine.gpu === comfyCloudEngine
                        ? 'This workflow renders on Comfy Cloud'
                        : engine.gpu
                            ?.replace(/^cuda:\d+\s+/, '')
                            .replace(/\s*:\s*cudaMallocAsync$/, '') || 'Your local ComfyUI engine'}
                  </strong>
                  <p>
                    {browserDemo
                      ? 'Compare recorded results, adjust cues and save recipes. New generation runs in the local studio.'
                      : engine.ready
                        ? 'Ready for this workflow. Models and files stay on your computer.'
                        : engine.message}
                  </p>
                </div>
                {!browserDemo && (
                  <span className={`compute-badge ${engine.ready ? 'ready' : ''}`}>
                    {engine.ready ? 'Ready' : 'Not ready'}
                  </span>
                )}
              </div>
              {!browserDemo && (
                <ol className="compute-checklist" aria-label="Local generation checklist">
                  <li className={engine.connected ? 'ready' : ''}>
                    <strong>Engine running</strong>
                    <span>
                      {engine.connected
                        ? 'Connected'
                        : 'Start it with node scripts/aftertake.mjs, which launches the installed engine'}
                    </span>
                  </li>
                  <li className={engine.gpu ? 'ready' : ''}>
                    <strong>GPU found</strong>
                    <span>
                      {engine.gpu
                        ? engine.gpu
                            .replace(/^cuda:\d+\s+/, '')
                            .replace(/\s*:\s*cudaMallocAsync$/, '')
                        : 'Shown once the engine runs; generation needs an NVIDIA GPU on Windows or Linux'}
                    </span>
                  </li>
                  <li
                    className={
                      status?.checkedAt && status.capabilities.every((item) => item.ready)
                        ? 'ready'
                        : ''
                    }
                  >
                    <strong>Tools installed</strong>
                    <span>
                      {status?.checkedAt
                        ? `${status.capabilities.filter((item) => item.ready).length} of ${status.capabilities.length} ready · details below`
                        : 'Checking…'}
                    </span>
                  </li>
                </ol>
              )}
              {browserDemo ? (
                <a
                  className="button compute-link"
                  href="https://github.com/ItsSNOWMOBILE/aftertake#run-locally"
                  target="_blank"
                  rel="noreferrer"
                >
                  Open local setup guide <ArrowUpRight size={14} />
                </a>
              ) : (
                <>
                  {engine.missing.length > 0 && (
                    <section
                      className="compute-attention"
                      aria-labelledby="compute-attention-title"
                    >
                      <h3 id="compute-attention-title">Before you can generate</h3>
                      <ul>
                        {engine.missing.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </section>
                  )}
                  <div className="compute-actions">
                    <button
                      className="button"
                      disabled={
                        busy ||
                        loading ||
                        Boolean(status?.configured && status.configured.provider !== 'local')
                      }
                      onClick={() => void act('probe')}
                    >
                      {busy ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />}{' '}
                      Check local workflows
                    </button>
                  </div>
                  {status?.configured && status.configured.provider !== 'local' && (
                    <p className="compute-hint">
                      A cloud connection is saved below. Remove it to run the full local readiness
                      check; local generation stays active.
                    </p>
                  )}
                  <details className="compute-details">
                    <summary>Install or repair the local engine</summary>
                    <p>
                      Install the engine and this workflow's models, then start Aftertake; the
                      launcher runs the engine with the studio.
                    </p>
                    <pre>
                      node scripts/aftertake.mjs setup-gpu{' '}
                      {setupProfile.trim() === '--inpaint'
                        ? '--region-edit'
                        : setupProfile.trim() || '--video'}
                      {'\n'}node scripts/aftertake.mjs
                    </pre>
                    <a
                      href="https://github.com/ItsSNOWMOBILE/aftertake/blob/aftertake-studio/docs/studio-guide.md"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Model downloads and setup instructions <ArrowUpRight size={12} />
                    </a>
                  </details>
                </>
              )}
            </>
          ) : (
            <>
              <div className="compute-cloud-heading">
                <div>
                  <strong>
                    {destination === 'comfy-cloud'
                      ? 'Render on Comfy Cloud.'
                      : 'Bring a compatible deployment.'}
                  </strong>
                  <p>
                    {destination === 'comfy-cloud'
                      ? 'Images, text to video, upscaling, smooth and slow motion, and songs render on Comfy Cloud with your key and credits. Character, region and depth tools stay on your GPU.'
                      : 'For a Comfy API environment containing the models and nodes your workflow needs.'}
                  </p>
                </div>
                <span
                  className={`compute-badge ${destination === 'comfy-cloud' && cloudOn ? 'ready' : ''}`}
                >
                  {destination === 'comfy-cloud' ? (cloudOn ? 'On' : 'Off') : 'Setup preview'}
                </span>
              </div>
              <div className="compute-cloud-notice">
                <LockKeyhole size={17} />
                <p>
                  {destination === 'comfy-cloud'
                    ? 'Checking a saved key turns on Comfy Cloud for this server session. Its API needs a paid Comfy Cloud plan. Nothing renders until you start a job, and saved local jobs keep their engine.'
                    : 'Managed deployments are not enabled in this release. Saving or checking a connection does not start a render or change the active local engine.'}
                </p>
              </div>
              {browserDemo ? (
                <div className="compute-demo-note">
                  <strong>Account keys belong in your local studio.</strong>
                  <p>
                    This recorded browser demo does not collect credentials or connect to paid
                    services.
                  </p>
                </div>
              ) : (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void act('save');
                  }}
                >
                  {destination === 'managed-deployment' && (
                    <label className="compute-field">
                      Deployment URL
                      <input
                        aria-label="Comfy deployment URL"
                        type="url"
                        value={endpoint}
                        onChange={(event) => setEndpoint(event.target.value)}
                        placeholder="https://your-deployment.run.comfy.app"
                        disabled={busy || loading}
                        autoComplete="off"
                      />
                      <span>
                        Use the endpoint from your own Comfy Developer Platform workspace.
                      </span>
                    </label>
                  )}
                  <label className="compute-field">
                    Comfy API key
                    <input
                      aria-label="Comfy API key"
                      type="password"
                      value={apiKey}
                      onChange={(event) => setApiKey(event.target.value)}
                      placeholder={
                        selectedConnection && status?.configured?.hasApiKey
                          ? 'A key is saved for this server session'
                          : 'Add a key when your account is ready'
                      }
                      autoComplete="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      disabled={busy || loading}
                      maxLength={4096}
                    />
                    <span>
                      The submitted key is kept in server memory until removed or the server
                      restarts. It is never included in recipes.
                    </span>
                  </label>
                  <div className="compute-actions">
                    <button
                      className="button compute-primary"
                      type="submit"
                      disabled={busy || loading || !canSave}
                    >
                      {busy ? (
                        <LoaderCircle size={15} className="spin" />
                      ) : (
                        <LockKeyhole size={15} />
                      )}{' '}
                      {apiKey.trim()
                        ? selectedConnection
                          ? 'Replace saved connection'
                          : 'Save connection'
                        : 'Save cloud setup'}
                    </button>
                    {selectedConnection && (
                      <button
                        className="button"
                        type="button"
                        disabled={busy || loading || connectionDraftChanged}
                        onClick={() => void act('probe')}
                      >
                        Check saved connection
                      </button>
                    )}
                    {status?.configured && status.configured.provider !== 'local' && (
                      <button
                        className="button compute-remove"
                        type="button"
                        disabled={busy || loading}
                        onClick={() => void act('remove')}
                      >
                        {status.configured.hasApiKey ? 'Remove saved key' : 'Remove saved setup'}
                      </button>
                    )}
                  </div>
                </form>
              )}
              <ol className="compute-roadmap">
                {(destination === 'comfy-cloud' ? cloudSteps : deploymentSteps).map(
                  ([title, text], index) => (
                    <li key={title}>
                      <span>{String(index + 1).padStart(2, '0')}</span>
                      <div>
                        <strong>{title}</strong>
                        <p>{text}</p>
                      </div>
                    </li>
                  ),
                )}
              </ol>
              <a
                className="compute-doc-link"
                href="https://github.com/ItsSNOWMOBILE/aftertake/blob/aftertake-studio/docs/cloud-setup.md"
                target="_blank"
                rel="noreferrer"
              >
                Comfy Cloud rendering guide <ArrowUpRight size={13} />
              </a>
            </>
          )}
          {showChecks && status.checkedAt && (
            <details className="compute-details compute-verification" open={remote}>
              <summary>{remote ? 'Connection checks' : 'Workflow availability'}</summary>
              <ul>
                {remote
                  ? status.checks.map((item) => (
                      <li className={`compute-check ${item.state}`} key={item.id}>
                        <span>
                          {item.state === 'pass'
                            ? 'Checked'
                            : item.state === 'blocked'
                              ? 'Blocked'
                              : 'Needs verification'}
                        </span>
                        <p>{item.message}</p>
                      </li>
                    ))
                  : status.capabilities.map((item) => (
                      <li
                        className={`compute-capability ${item.ready ? 'ready' : ''}`}
                        key={item.feature}
                      >
                        <span>{featureNames[item.feature] || item.feature}</span>
                        <span>{item.ready ? 'Ready' : 'Needs setup'}</span>
                        {!item.ready && <code>{setupCommand(item.feature)}</code>}
                      </li>
                    ))}
              </ul>
              {remote && cloudOn && (
                <ul aria-label="Where each studio renders">
                  {status.capabilities.map((item) => (
                    <li
                      className={`compute-capability ${item.ready ? 'ready' : ''}`}
                      key={item.feature}
                    >
                      <span>{featureNames[item.feature] || item.feature}</span>
                      <span>
                        {item.renders === 'comfy-cloud' ? 'Comfy Cloud' : 'Your GPU'} ·{' '}
                        {item.ready ? 'Ready' : 'Needs setup'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </details>
          )}
        </div>
        {loading && (
          <p className="compute-message" role="status">
            Loading saved connection settings…
          </p>
        )}
        {error && (
          <p className="compute-message error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="compute-message" role="status">
            {notice}
          </p>
        )}
        <footer className="compute-footer">
          <span>Local control. Your next take.</span>
          <button className="button" onClick={onClose}>
            Back to studio
          </button>
        </footer>
      </section>
    </div>
  );
}

import { recipeSchema, renderSettingsKey, type Recipe, type Render } from './domain';

const terminalStates = new Set(['succeeded', 'failed', 'canceled', 'expired', 'output_error']);
const recoverableStates = new Set(['submission_unknown', 'connection_lost', 'output_error']);
const states = new Set([
  ...terminalStates,
  ...recoverableStates,
  'submitting',
  'queued',
  'running',
  'finalizing',
  'canceling',
]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const operationStorageKey = 'aftertake-take-admission';

export const takeBusy = (take: Pick<Render, 'state'>) => !terminalStates.has(take.state);
export const takeRecoverable = (take: Pick<Render, 'state'>) => recoverableStates.has(take.state);
export const takeCancelable = (take: Pick<Render, 'state' | 'jobId'>) =>
  Boolean(take.jobId) &&
  takeBusy(take) &&
  take.state !== 'finalizing' &&
  take.state !== 'canceling';
export const takeUncertain = (take: Pick<Render, 'state'>) =>
  take.state === 'submission_unknown' || take.state === 'connection_lost';

export type TakeOperation = {
  format: 'aftertake-take-admission/1';
  key: string;
  recipe: Recipe;
  admissionScope?: string;
};
type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type FetchPort = (url: string, init?: RequestInit) => Promise<Response>;
export type TakeResult =
  | { kind: 'record'; render: Render; error?: string }
  | { kind: 'pending'; error: string }
  | { kind: 'rejected'; error: string };

export function parseTakeOperation(value: unknown): TakeOperation {
  const saved = value as Partial<TakeOperation> | null;
  if (
    saved?.format !== 'aftertake-take-admission/1' ||
    typeof saved.key !== 'string' ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(saved.key) ||
    (saved.admissionScope !== undefined && !uuid.test(saved.admissionScope))
  )
    throw Error('Invalid saved take request.');
  return {
    format: saved.format,
    key: saved.key,
    recipe: recipeSchema.parse(saved.recipe),
    ...(saved.admissionScope ? { admissionScope: saved.admissionScope } : {}),
  };
}

function validRender(value: unknown): value is Render {
  const take = value as Render | null;
  return Boolean(
    take &&
    typeof take.id === 'string' &&
    uuid.test(take.id) &&
    (take.jobId === undefined || (typeof take.jobId === 'string' && uuid.test(take.jobId))) &&
    (take.requestKey === undefined ||
      (typeof take.requestKey === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(take.requestKey))) &&
    states.has(take.state) &&
    recipeSchema.safeParse(take.recipe).success &&
    typeof take.createdAt === 'string' &&
    typeof take.updatedAt === 'string' &&
    (take.progress === null ||
      (typeof take.progress === 'number' &&
        Number.isFinite(take.progress) &&
        take.progress >= 0 &&
        take.progress <= 1)),
  );
}

function message(error: unknown) {
  return error instanceof Error ? error.message : 'The take response could not be confirmed.';
}

function matchesOperation(value: unknown, operation: TakeOperation): value is Render {
  return (
    validRender(value) &&
    value.requestKey === operation.key &&
    renderSettingsKey(value.recipe) === renderSettingsKey(operation.recipe)
  );
}

/** Keeps one browser operation until a matching app record can be observed. */
export class TakeClient {
  private operation?: TakeOperation;
  private sending = false;
  private storageAvailable: boolean;
  private readonly storage?: StoragePort;
  private readonly readonly: boolean;
  private readonly newKey: () => string;

  constructor(
    private readonly fetch: FetchPort,
    options: { storage?: StoragePort; readonly?: boolean; newKey?: () => string } = {},
  ) {
    this.storage = options.storage;
    this.storageAvailable = Boolean(options.storage);
    this.readonly = options.readonly || false;
    this.newKey = options.newKey || (() => crypto.randomUUID());
    if (this.readonly) return;
    try {
      const saved = this.storage?.getItem(operationStorageKey);
      if (saved) this.operation = parseTakeOperation(JSON.parse(saved));
    } catch {
      this.storageAvailable = false;
      // Storage restrictions must not prevent a deliberate first request.
    }
  }

  get pending() {
    return this.operation ? structuredClone(this.operation) : undefined;
  }

  get sessionOnly() {
    return Boolean(this.operation) && !this.storageAvailable;
  }

  dismiss() {
    if (this.sending) throw Error('Wait for the current take request before dismissing it.');
    const original = this.pending;
    this.save();
    return original;
  }

  private save(operation?: TakeOperation) {
    this.operation = operation ? structuredClone(operation) : undefined;
    try {
      if (operation) this.storage?.setItem(operationStorageKey, JSON.stringify(operation));
      else this.storage?.removeItem(operationStorageKey);
    } catch {
      this.storageAvailable = false;
      // The in-memory operation remains stable when browser storage is disabled.
    }
  }

  observe(renders: Render[]) {
    const found = this.operation
      ? renders.find((take) => matchesOperation(take, this.operation!))
      : undefined;
    if (found) this.save();
    return found;
  }

  private async history() {
    const response = await this.fetch('/api/renders');
    if (!response.ok)
      throw Error('The saved take list is unavailable. Keep this request and check again.');
    const value: unknown = await response.json();
    if (!Array.isArray(value) || value.some((take) => !validRender(take)))
      throw Error('The saved take list could not be verified. Keep this request and check again.');
    return value as Render[];
  }

  private async scope() {
    const response = await this.fetch('/api/workspace');
    if (!response.ok) throw Error('The studio could not confirm where this take would run.');
    const value = await response.json();
    if (typeof value.admissionScope !== 'string' || !uuid.test(value.admissionScope))
      throw Error('The studio could not confirm where this take would run.');
    return value.admissionScope as string;
  }

  async submit(recipe?: Recipe): Promise<TakeResult> {
    if (this.readonly)
      throw Error('Recorded examples are read-only. Open a local studio to render.');
    if (this.sending) throw Error('A take request is already being checked.');
    this.sending = true;
    const wasPending = Boolean(this.operation);
    try {
      const originalRecipe = !this.operation && recipe ? recipeSchema.parse(recipe) : undefined;
      if (this.operation) {
        const found = this.observe(await this.history());
        if (found) return { kind: 'record', render: found };
      }
      const scope = await this.scope();
      if (this.operation && this.operation.admissionScope !== scope)
        return {
          kind: 'pending',
          error:
            'This studio restarted or changed before the original take could be confirmed. Your request is retained for review; it will not be sent to another studio session.',
        };
      if (!this.operation) {
        if (!originalRecipe) throw Error('Choose a recipe before rendering.');
        this.save({
          format: 'aftertake-take-admission/1',
          key: this.newKey(),
          recipe: originalRecipe,
          admissionScope: scope,
        });
      }
      const operation = this.operation!;
      let status: number | undefined;
      let scopeChanged = false;
      let parsedResponse = false;
      try {
        const response = await this.fetch('/api/renders', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': operation.key,
            'X-Aftertake-Admission-Scope': scope,
          },
          body: JSON.stringify(operation.recipe),
        });
        status = response.status;
        const body = await response.json();
        parsedResponse = true;
        scopeChanged = body.code === 'admission_scope_changed';
        const take: unknown = response.ok ? body : body.render;
        if (matchesOperation(take, operation)) {
          this.save();
          return {
            kind: 'record',
            render: take,
            ...(!response.ok ? { error: body.error || 'This take needs checking.' } : {}),
          };
        }
        throw Error(
          !response.ok
            ? body.error || 'The take request could not be completed.'
            : 'The studio did not confirm the original request key. Keep this request and check its status.',
        );
      } catch (error) {
        try {
          const found = this.observe(await this.history());
          if (found) return { kind: 'record', render: found, error: message(error) };
          if (
            !wasPending &&
            parsedResponse &&
            !scopeChanged &&
            [400, 401, 403, 404, 405, 409, 413, 415, 422].includes(status || 0)
          ) {
            this.save();
            return { kind: 'rejected', error: message(error) };
          }
        } catch {
          // An unavailable or empty history cannot disprove an ambiguous admission.
        }
        return { kind: 'pending', error: message(error) };
      }
    } catch (error) {
      if (this.operation) return { kind: 'pending', error: message(error) };
      return { kind: 'rejected', error: message(error) };
    } finally {
      this.sending = false;
    }
  }

  async act(take: Render, action: 'cancel' | 'reconcile'): Promise<TakeResult> {
    if (this.readonly) throw Error('Recorded examples are read-only.');
    if (this.sending) throw Error('A take request is already being checked.');
    if (!validRender(take)) throw Error('The selected take record could not be verified.');
    if (action === 'cancel' ? !takeCancelable(take) : !takeRecoverable(take))
      throw Error('This action is unavailable for the selected take.');
    this.sending = true;
    try {
      const response = await this.fetch(`/api/renders/${take.id}/${action}`, { method: 'POST' });
      const body = await response.json();
      const updated: unknown = response.ok ? body : body.render;
      if (
        validRender(updated) &&
        updated.id === take.id &&
        updated.requestKey === take.requestKey &&
        (!take.jobId || updated.jobId === take.jobId) &&
        renderSettingsKey(updated.recipe) === renderSettingsKey(take.recipe)
      )
        return {
          kind: 'record',
          render: updated,
          ...(!response.ok ? { error: body.error || 'This take still needs checking.' } : {}),
        };
      return { kind: 'rejected', error: body.error || 'The take status could not be confirmed.' };
    } catch (error) {
      return { kind: 'rejected', error: message(error) };
    } finally {
      this.sending = false;
    }
  }
}

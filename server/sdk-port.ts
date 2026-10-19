/** The SDK surface used by Aftertake's generation routes. */
export type EngineProgress = {
  kind: 'progress';
  value: number;
  currentNode: string | null;
};

export interface EngineWorkflow {
  setInput(nodeId: string, input: string, value: unknown): unknown;
}

export interface EngineOutput {
  toFile(filename: string): Promise<unknown>;
}

export interface EngineJob {
  readonly id: string;
  readonly status: string;
  readonly error: { code?: string; message: string } | null;
  refresh(signal?: AbortSignal): Promise<unknown>;
  cancel(signal?: AbortSignal): Promise<unknown>;
  events(signal?: AbortSignal): AsyncIterable<EngineProgress>;
  getOutputs(nodeId: string): EngineOutput[];
}

export interface EngineClient {
  readonly assets: { fromFile(filename: string): unknown };
  readonly workflows: { fromJson(graph: Record<string, any>): EngineWorkflow };
  readonly jobs: { get(id: string): Promise<EngineJob> };
  submit(
    workflow: EngineWorkflow,
    options: { idempotencyKey: string; signal?: AbortSignal },
  ): Promise<EngineJob>;
}

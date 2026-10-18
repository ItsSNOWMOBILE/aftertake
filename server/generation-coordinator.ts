/** Shared admission state and live native-job checks for the single GPU engine. */
export class GenerationCoordinator {
  admitting = false;
  private readonly workers = new Map<string, () => boolean>();

  register(name: string, busy: () => boolean) {
    if (this.workers.has(name)) throw Error(`Generation worker already registered: ${name}`);
    this.workers.set(name, busy);
  }

  busy(excludeWorker?: string) {
    return (
      this.admitting || [...this.workers].some(([name, busy]) => name !== excludeWorker && busy())
    );
  }

  forWorker(name: string) {
    return {
      takeBusy: () => this.busy(name),
      setAdmitting: (value: boolean) => {
        this.admitting = value;
      },
    };
  }
}

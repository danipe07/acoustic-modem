import type { SimError, SimRequest, SimResponse } from './protocol.ts';

/** Promise-based wrapper around the simulation worker. */
export class SimulationClient {
  private readonly worker = new Worker(new URL('./sim.worker.ts', import.meta.url), {
    type: 'module',
  });
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (r: SimResponse) => void; reject: (e: Error) => void }
  >();

  constructor() {
    this.worker.onmessage = (event: MessageEvent<SimResponse | SimError>) => {
      const reply = event.data;
      const waiter = this.pending.get(reply.id);
      if (!waiter) return;
      this.pending.delete(reply.id);
      if ('error' in reply) waiter.reject(new Error(reply.error));
      else waiter.resolve(reply);
    };
  }

  run(request: Omit<SimRequest, 'id'>): Promise<SimResponse> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...request, id } satisfies SimRequest);
    });
  }
}

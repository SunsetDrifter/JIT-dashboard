/**
 * Serializes async work per key. Used to make per-user read-merge-write on
 * auto_groups safe against interleaving (manual revoke vs scheduler expiry).
 */
export class KeyedMutex {
  private readonly chains = new Map<string, Promise<unknown>>();

  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(key) ?? Promise.resolve();
    // Run fn after prev regardless of whether prev resolved or rejected.
    const next = prev.then(() => fn(), () => fn());
    // Keep the chain alive but swallowed so one failure doesn't poison the key.
    this.chains.set(
      key,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    return next;
  }
}

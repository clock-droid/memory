export type MutationContext = {
  version: number;
  isLatest: boolean;
};

export type MutationHandlers<T> = {
  onSuccess: (value: T, context: MutationContext) => void;
  onFailure: (error: unknown, context: MutationContext) => void;
};

type QueueEntry = {
  tail: Promise<void>;
  epoch: number;
  nextVersion: number;
  pendingCount: number;
  paused: boolean;
};

export type EnqueuedMutation = {
  accepted: boolean;
  version: number;
  done: Promise<boolean>;
};

/**
 * Serializes writes that target the same subscribed resource. A failed write
 * pauses that resource and invalidates every already-queued write from the old
 * epoch; a fresh subscription must call resume() before new writes are
 * accepted. Version metadata lets the UI ignore an older success when a newer
 * optimistic value is already visible.
 */
export class KeyedMutationQueue {
  private readonly entries = new Map<string, QueueEntry>();

  private entry(key: string) {
    const existing = this.entries.get(key);
    if (existing) return existing;
    const created: QueueEntry = {
      tail: Promise.resolve(),
      epoch: 0,
      nextVersion: 0,
      pendingCount: 0,
      paused: false,
    };
    this.entries.set(key, created);
    return created;
  }

  enqueue<T>(key: string, operation: () => Promise<T>, handlers: MutationHandlers<T>): EnqueuedMutation {
    const entry = this.entry(key);
    if (entry.paused) {
      return { accepted: false, version: entry.nextVersion, done: Promise.resolve(false) };
    }

    const version = ++entry.nextVersion;
    const epoch = entry.epoch;
    entry.pendingCount += 1;

    const execute = async (): Promise<boolean> => {
      try {
        if (entry.paused || entry.epoch !== epoch) return false;
        const value = await operation();
        handlers.onSuccess(value, {
          version,
          isLatest: entry.epoch === epoch && entry.nextVersion === version,
        });
        return true;
      } catch (error) {
        entry.paused = true;
        entry.epoch += 1;
        handlers.onFailure(error, { version, isLatest: entry.nextVersion === version });
        return false;
      } finally {
        entry.pendingCount -= 1;
      }
    };

    const done = entry.tail.then(execute, execute);
    entry.tail = done.then(() => undefined, () => undefined);
    return { accepted: true, version, done };
  }

  hasPending(key: string) {
    return (this.entries.get(key)?.pendingCount ?? 0) > 0;
  }

  isPaused(key: string) {
    return this.entries.get(key)?.paused ?? false;
  }

  resume(key: string) {
    const entry = this.entries.get(key);
    if (entry) entry.paused = false;
  }
}

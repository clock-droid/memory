import { describe, expect, it, vi } from 'vitest';
import { KeyedMutationQueue } from './mutationQueue';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('KeyedMutationQueue', () => {
  it('runs writes to the same resource serially and marks only the newest success as latest', async () => {
    const queue = new KeyedMutationQueue();
    const first = deferred<string>();
    const second = deferred<string>();
    const starts: string[] = [];
    const successes: Array<{ value: string; isLatest: boolean }> = [];

    const one = queue.enqueue('cards:d1', async () => {
      starts.push('first');
      return first.promise;
    }, {
      onSuccess: (value, context) => successes.push({ value, isLatest: context.isLatest }),
      onFailure: vi.fn(),
    });
    const two = queue.enqueue('cards:d1', async () => {
      starts.push('second');
      return second.promise;
    }, {
      onSuccess: (value, context) => successes.push({ value, isLatest: context.isLatest }),
      onFailure: vi.fn(),
    });

    await Promise.resolve();
    expect(starts).toEqual(['first']);
    expect(queue.hasPending('cards:d1')).toBe(true);

    first.resolve('server-v1');
    await expect(one.done).resolves.toBe(true);
    await Promise.resolve();
    expect(starts).toEqual(['first', 'second']);
    expect(successes).toEqual([{ value: 'server-v1', isLatest: false }]);

    second.resolve('server-v2');
    await expect(two.done).resolves.toBe(true);
    expect(successes).toEqual([
      { value: 'server-v1', isLatest: false },
      { value: 'server-v2', isLatest: true },
    ]);
    expect(queue.hasPending('cards:d1')).toBe(false);
  });

  it('pauses after failure and discards writes already queued behind it', async () => {
    const queue = new KeyedMutationQueue();
    const first = deferred<void>();
    const secondOperation = vi.fn().mockResolvedValue(undefined);
    const onFailure = vi.fn();

    const one = queue.enqueue('sections:d1', () => first.promise, {
      onSuccess: vi.fn(),
      onFailure,
    });
    const two = queue.enqueue('sections:d1', secondOperation, {
      onSuccess: vi.fn(),
      onFailure: vi.fn(),
    });

    first.reject(new Error('offline'));
    await expect(one.done).resolves.toBe(false);
    await expect(two.done).resolves.toBe(false);

    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(secondOperation).not.toHaveBeenCalled();
    expect(queue.isPaused('sections:d1')).toBe(true);
    expect(queue.enqueue('sections:d1', vi.fn(), { onSuccess: vi.fn(), onFailure: vi.fn() }).accepted).toBe(false);
  });

  it('accepts only new-epoch writes after a confirmed subscription resumes the resource', async () => {
    const queue = new KeyedMutationQueue();
    const failure = queue.enqueue('cards:d1', () => Promise.reject(new Error('offline')), {
      onSuccess: vi.fn(),
      onFailure: vi.fn(),
    });
    await failure.done;

    queue.resume('cards:d1');
    const onSuccess = vi.fn();
    const recovered = queue.enqueue('cards:d1', () => Promise.resolve('fresh'), {
      onSuccess,
      onFailure: vi.fn(),
    });
    await recovered.done;

    expect(recovered.accepted).toBe(true);
    expect(onSuccess).toHaveBeenCalledWith('fresh', expect.objectContaining({ isLatest: true }));
  });

  it('rolls a failed newer optimistic value back to the latest serialized success', async () => {
    const queue = new KeyedMutationQueue();
    const first = deferred<string>();
    const second = deferred<string>();
    let confirmed = 'server-v0';
    let visible = 'optimistic-v2';
    const handlers = {
      onSuccess: (value: string, context: { isLatest: boolean }) => {
        confirmed = value;
        if (context.isLatest) visible = value;
      },
      onFailure: () => {
        visible = confirmed;
      },
    };
    const one = queue.enqueue('sections:d1', () => first.promise, handlers);
    const two = queue.enqueue('sections:d1', () => second.promise, handlers);

    first.resolve('server-v1');
    await one.done;
    expect(confirmed).toBe('server-v1');
    expect(visible).toBe('optimistic-v2');

    second.reject(new Error('offline'));
    await two.done;
    expect(visible).toBe('server-v1');
    expect(queue.isPaused('sections:d1')).toBe(true);
  });
});

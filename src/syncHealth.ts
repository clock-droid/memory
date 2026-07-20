export type SyncStatus = 'loading' | 'ready' | 'error' | 'stale';

export type SyncResourceState = {
  hasData: boolean;
  pending: boolean;
  failed: boolean;
};

export type SyncHealth = {
  status: SyncStatus;
  pending: boolean;
  failedCount: number;
};

export function isSyncReadOnly(status: SyncStatus) {
  return status !== 'ready';
}

const EMPTY_RESOURCE: SyncResourceState = {
  hasData: false,
  pending: true,
  failed: false,
};

/**
 * Derives one customer-facing sync state from the deck list and every
 * cards/sections subscription it depends on.
 *
 * A failure is only "stale" when every required resource has previously
 * produced data. This prevents a partially loaded room from looking like an
 * empty room, while still keeping a complete in-memory snapshot usable during
 * a reconnect.
 */
export function deriveSyncHealth(
  requiredKeys: string[],
  resources: Record<string, SyncResourceState>,
): SyncHealth {
  const required = requiredKeys.map((key) => resources[key] ?? EMPTY_RESOURCE);
  const pending = required.some((resource) => resource.pending);
  const failedCount = required.filter((resource) => resource.failed).length;
  const hasCompleteSnapshot = required.every((resource) => resource.hasData);

  if (failedCount > 0) {
    return {
      status: hasCompleteSnapshot ? 'stale' : 'error',
      pending,
      failedCount,
    };
  }

  if (pending || !hasCompleteSnapshot) {
    return {
      status: hasCompleteSnapshot ? 'stale' : 'loading',
      pending: true,
      failedCount: 0,
    };
  }

  return { status: 'ready', pending: false, failedCount: 0 };
}

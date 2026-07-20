import type { Card, Deck, NewCard, Repository, Section } from './types';

const SYNC_BASE = import.meta.env.VITE_SYNC_BASE || '';
const REQUEST_TIMEOUT_MS = 15000;

class SyncRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SyncRequestError';
  }
}

function apiPath(roomCode: string, path: string) {
  return `${SYNC_BASE}/.netlify/functions/sync?room=${encodeURIComponent(roomCode)}&path=${encodeURIComponent(path)}`;
}

async function request<T>(roomCode: string, path: string, options: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetch(apiPath(roomCode, path), {
        ...options,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers ?? {}),
        },
      });
    } catch {
      throw new SyncRequestError('인터넷 연결을 확인하고 다시 시도해 주세요.');
    }
    if (!response.ok) {
      if (response.status === 409) {
        throw new SyncRequestError('다른 기기와 동시에 수정되었어요. 잠시 후 다시 시도해 주세요.');
      }
      if (response.status === 401 || response.status === 403) {
        throw new SyncRequestError('동기화 권한을 확인하지 못했어요. 방 코드를 다시 확인해 주세요.');
      }
      if (response.status === 404) {
        throw new SyncRequestError('동기화 서버를 찾지 못했어요. 잠시 후 다시 시도해 주세요.');
      }
      if (response.status >= 500) {
        throw new SyncRequestError('동기화 서버가 잠시 응답하지 않아요. 다시 시도해 주세요.');
      }
      throw new SyncRequestError('요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.');
    }
    try {
      return await response.json() as T;
    } catch {
      throw new SyncRequestError('동기화 응답을 읽지 못했어요. 다시 시도해 주세요.');
    }
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

function toError(error: unknown) {
  return error instanceof SyncRequestError
    ? error
    : new SyncRequestError('동기화 서버에 연결하지 못했어요. 다시 시도해 주세요.');
}

type Subscription<T> = {
  load: () => Promise<boolean>;
  notifyError: (error: unknown) => void;
  refreshAfterWrite: () => void;
  pause: () => void;
  resume: () => void;
  unsubscribe: () => void;
};

const RETRY_INTERVAL_MS = 5000;
const VERSION_POLL_INTERVAL_MS = 10000;

function subscribeWithRetry<T>(
  callback: (items: T[]) => void,
  onError: ((error: Error) => void) | undefined,
  loader: () => Promise<T[]>,
): Subscription<T> {
  let active = true;
  let paused = false;
  let pendingLoad = false;
  let generation = 0;
  let timer: ReturnType<typeof globalThis.setTimeout> | undefined;

  const load = async (): Promise<boolean> => {
    if (!active) return false;
    if (paused) {
      pendingLoad = true;
      return false;
    }
    if (timer !== undefined) {
      globalThis.clearTimeout(timer);
      timer = undefined;
    }
    pendingLoad = false;
    const requestGeneration = ++generation;
    try {
      const items = await loader();
      if (!active || requestGeneration !== generation) return true;
      callback(items);
      return true;
    } catch (error) {
      if (!active || requestGeneration !== generation) return true;
      pendingLoad = true;
      onError?.(toError(error));
      if (!paused) {
        timer = globalThis.setTimeout(() => {
          timer = undefined;
          void load();
        }, RETRY_INTERVAL_MS);
      }
      return false;
    }
  };

  return {
    load,
    notifyError: (error) => {
      if (active) onError?.(toError(error));
    },
    refreshAfterWrite: () => {
      if (!active) return;
      generation += 1;
      if (timer !== undefined) globalThis.clearTimeout(timer);
      timer = undefined;
      pendingLoad = true;
      // Let the caller apply the acknowledged mutation before a refreshed
      // subscription snapshot can supersede it. This also invalidates an
      // older in-flight read immediately.
      if (!paused) {
        timer = globalThis.setTimeout(() => {
          timer = undefined;
          void load();
        }, 0);
      }
    },
    pause: () => {
      if (!active || paused) return;
      paused = true;
      if (timer !== undefined) {
        globalThis.clearTimeout(timer);
        timer = undefined;
        pendingLoad = true;
      }
    },
    resume: () => {
      if (!active || !paused) return;
      paused = false;
      if (pendingLoad) void load();
    },
    unsubscribe: () => {
      active = false;
      generation += 1;
      if (timer !== undefined) globalThis.clearTimeout(timer);
    },
  };
}

function refreshSubscriptions<T>(subscriptions: Set<Subscription<T>> | undefined) {
  subscriptions?.forEach((subscription) => subscription.refreshAfterWrite());
}

export function createServerRepository(roomCode: string): Repository | null {
  const deckSubs = new Set<Subscription<Deck>>();
  const cardSubs = new Map<string, Set<Subscription<Card>>>();
  const sectionSubs = new Map<string, Set<Subscription<Section>>>();
  const cardRevisions = new Map<string, number>();
  const sectionRevisions = new Map<string, number>();
  const cardKey = (deckId: string, cardId: string) => `${deckId}:${cardId}`;
  const sectionKey = (deckId: string, sectionId: string) => `${deckId}:${sectionId}`;
  const rememberCardPatch = (
    deckId: string,
    cardId: string,
    result: { revision: number; sectionId?: string; sectionRevision?: number },
  ) => {
    cardRevisions.set(cardKey(deckId, cardId), result.revision);
    if (
      result.sectionId
      && Number.isInteger(result.sectionRevision)
      && (result.sectionRevision ?? -1) >= 0
    ) {
      sectionRevisions.set(sectionKey(deckId, result.sectionId), result.sectionRevision as number);
      refreshSubscriptions(sectionSubs.get(deckId));
    }
  };
  const rememberCards = (deckId: string, cards: Card[]) => {
    const prefix = `${deckId}:`;
    for (const key of cardRevisions.keys()) {
      if (key.startsWith(prefix)) cardRevisions.delete(key);
    }
    cards.forEach((card) => {
      cardRevisions.set(cardKey(deckId, card.id), card.revision ?? 0);
    });
  };
  const rememberSections = (deckId: string, sections: Section[]) => {
    const prefix = `${deckId}:`;
    for (const key of sectionRevisions.keys()) {
      if (key.startsWith(prefix)) sectionRevisions.delete(key);
    }
    sections.forEach((section) => {
      sectionRevisions.set(sectionKey(deckId, section.id), section.revision ?? 0);
    });
    return sections;
  };
  let versionWatcherActive = false;
  let versionTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
  let lastRoomRevision: number | undefined;
  let versionFailed = false;
  let versionPollRunning = false;
  let versionPollQueued = false;
  let versionEpoch = 0;
  let roomRefreshBarrier: Promise<void> | undefined;

  const allSubscriptions = (): Array<Subscription<Deck | Card | Section>> => [
    ...deckSubs,
    ...[...cardSubs.values()].flatMap((subscriptions) => [...subscriptions]),
    ...[...sectionSubs.values()].flatMap((subscriptions) => [...subscriptions]),
  ] as Array<Subscription<Deck | Card | Section>>;
  const pageIsVisible = () => !globalThis.document || globalThis.document.visibilityState !== 'hidden';
  const clearVersionTimer = () => {
    if (versionTimer !== undefined) globalThis.clearTimeout(versionTimer);
    versionTimer = undefined;
  };
  const scheduleVersionPoll = (delay: number) => {
    clearVersionTimer();
    if (!versionWatcherActive || !pageIsVisible()) return;
    if (versionPollRunning) {
      if (delay === 0) versionPollQueued = true;
      return;
    }
    versionTimer = globalThis.setTimeout(() => {
      versionTimer = undefined;
      void pollVersion();
    }, delay);
  };
  const pollVersion = async () => {
    if (!versionWatcherActive || !pageIsVisible()) return;
    if (versionPollRunning) {
      versionPollQueued = true;
      return;
    }
    versionPollRunning = true;
    versionPollQueued = false;
    const pollEpoch = versionEpoch;
    let nextDelay = VERSION_POLL_INTERVAL_MS;
    let versionReadSucceeded = false;
    try {
      const { revision } = await request<{ revision: number }>(roomCode, '/version');
      if (!versionWatcherActive || !pageIsVisible() || pollEpoch !== versionEpoch) return;
      versionReadSucceeded = true;
      const shouldRefresh = lastRoomRevision === undefined || versionFailed || revision !== lastRoomRevision;
      lastRoomRevision = revision;
      versionFailed = false;
      if (shouldRefresh) {
        const refreshPromise = (async () => {
          const results = await Promise.all(allSubscriptions().map((subscription) => subscription.load()));
          if (results.some((succeeded) => !succeeded)) {
            throw new SyncRequestError('최신 동기화 내용을 불러오지 못했어요. 다시 시도해 주세요.');
          }
        })();
        roomRefreshBarrier = refreshPromise;
        try {
          await refreshPromise;
        } finally {
          if (roomRefreshBarrier === refreshPromise) roomRefreshBarrier = undefined;
        }
      }
    } catch (error) {
      if (!versionWatcherActive || !pageIsVisible() || pollEpoch !== versionEpoch) return;
      versionFailed = true;
      nextDelay = RETRY_INTERVAL_MS;
      // A failed resource refresh already notified its own subscriber. Only a
      // heartbeat failure must fan out so the complete snapshot becomes
      // read-only until the room can be checked again.
      if (!versionReadSucceeded) {
        allSubscriptions().forEach((subscription) => subscription.notifyError(error));
      }
    } finally {
      versionPollRunning = false;
      if (!versionWatcherActive || !pageIsVisible()) return;
      scheduleVersionPoll(versionPollQueued || pollEpoch !== versionEpoch ? 0 : nextDelay);
    }
  };
  const onVisibilityChange = () => {
    versionEpoch += 1;
    if (pageIsVisible()) {
      allSubscriptions().forEach((subscription) => subscription.resume());
      scheduleVersionPoll(0);
    } else {
      clearVersionTimer();
      allSubscriptions().forEach((subscription) => subscription.pause());
    }
  };
  const onOnline = () => scheduleVersionPoll(0);
  const startVersionWatcher = () => {
    if (versionWatcherActive) return;
    versionWatcherActive = true;
    globalThis.document?.addEventListener?.('visibilitychange', onVisibilityChange);
    globalThis.addEventListener?.('online', onOnline);
    if (!pageIsVisible()) allSubscriptions().forEach((subscription) => subscription.pause());
    scheduleVersionPoll(0);
  };
  const stopVersionWatcherIfIdle = () => {
    if (allSubscriptions().length > 0) return;
    versionWatcherActive = false;
    versionEpoch += 1;
    clearVersionTimer();
    globalThis.document?.removeEventListener?.('visibilitychange', onVisibilityChange);
    globalThis.removeEventListener?.('online', onOnline);
  };
  const waitForRoomRefresh = async () => {
    const refresh = roomRefreshBarrier;
    if (refresh) await refresh;
  };
  const withWriteRecovery = async <T>(operation: () => Promise<T>): Promise<T> => {
    try {
      return await operation();
    } catch (error) {
      // A write can fail while /version still reports the same room revision
      // (for example, a dropped response or validation failure). Refresh the
      // complete room snapshot directly so every resource marked stale by a
      // compound mutation can leave read-only mode and every keyed mutation
      // queue can resume without a manual Retry tap.
      allSubscriptions().forEach((subscription) => subscription.refreshAfterWrite());
      scheduleVersionPoll(0);
      throw error;
    }
  };

  return {
    mode: 'cloud',
    ensureDefaultDeck() {
      return Promise.resolve();
    },
    subscribeDecks(callback, onError) {
      const subscription = subscribeWithRetry(
        callback,
        onError,
        () => request<Deck[]>(roomCode, '/decks'),
      );
      deckSubs.add(subscription);
      subscription.load();
      startVersionWatcher();
      return () => {
        subscription.unsubscribe();
        deckSubs.delete(subscription);
        stopVersionWatcherIfIdle();
      };
    },
    subscribeCards(deckId, callback, onError) {
      const subs = cardSubs.get(deckId) ?? new Set<Subscription<Card>>();
      cardSubs.set(deckId, subs);
      const subscription = subscribeWithRetry(
        (cards) => {
          rememberCards(deckId, cards);
          callback(cards);
        },
        onError,
        () => request<Card[]>(roomCode, `/decks/${encodeURIComponent(deckId)}/cards`),
      );
      subs.add(subscription);
      subscription.load();
      startVersionWatcher();
      return () => {
        subscription.unsubscribe();
        subs.delete(subscription);
        if (subs.size === 0) cardSubs.delete(deckId);
        stopVersionWatcherIfIdle();
      };
    },
    subscribeSections(deckId, callback, onError) {
      const subs = sectionSubs.get(deckId) ?? new Set<Subscription<Section>>();
      sectionSubs.set(deckId, subs);
      const subscription = subscribeWithRetry(
        (sections) => {
          rememberSections(deckId, sections);
          callback(sections);
        },
        onError,
        () => request<Section[]>(roomCode, `/decks/${encodeURIComponent(deckId)}/sections`),
      );
      subs.add(subscription);
      subscription.load();
      startVersionWatcher();
      return () => {
        subscription.unsubscribe();
        subs.delete(subscription);
        if (subs.size === 0) sectionSubs.delete(deckId);
        stopVersionWatcherIfIdle();
      };
    },
    async addDeck(name, operationId) {
      return withWriteRecovery(async () => {
        await waitForRoomRefresh();
        const result = await request<{ id: string }>(roomCode, '/decks', {
          method: 'POST',
          body: JSON.stringify({ name, operationId }),
        });
        refreshSubscriptions(deckSubs);
        refreshSubscriptions(sectionSubs.get(result.id));
        refreshSubscriptions(cardSubs.get(result.id));
        return result.id;
      });
    },
    async renameDeck(deckId, name) {
      return withWriteRecovery(async () => {
        await waitForRoomRefresh();
        await request(roomCode, `/decks/${encodeURIComponent(deckId)}`, {
          method: 'PATCH',
          body: JSON.stringify({ name }),
        });
        refreshSubscriptions(deckSubs);
      });
    },
    async deleteDeck(deckId) {
      return withWriteRecovery(async () => {
        await waitForRoomRefresh();
        await request(roomCode, `/decks/${encodeURIComponent(deckId)}`, { method: 'DELETE' });
        const prefix = `${deckId}:`;
        for (const key of cardRevisions.keys()) {
          if (key.startsWith(prefix)) cardRevisions.delete(key);
        }
        for (const key of sectionRevisions.keys()) {
          if (key.startsWith(prefix)) sectionRevisions.delete(key);
        }
        refreshSubscriptions(deckSubs);
      });
    },
    async addSection(deckId, name, operationId) {
      return withWriteRecovery(async () => {
        await waitForRoomRefresh();
        const result = await request<{ id: string }>(roomCode, `/decks/${encodeURIComponent(deckId)}/sections`, {
          method: 'POST',
          body: JSON.stringify({ name, operationId }),
        });
        sectionRevisions.set(sectionKey(deckId, result.id), 0);
        refreshSubscriptions(sectionSubs.get(deckId));
        return result.id;
      });
    },
    async renameSection(deckId, sectionId, name) {
      return withWriteRecovery(async () => {
        await waitForRoomRefresh();
        const key = sectionKey(deckId, sectionId);
        const expectedRevision = sectionRevisions.get(key) ?? 0;
        const result = await request<{ revision: number }>(roomCode, `/decks/${encodeURIComponent(deckId)}/sections/${encodeURIComponent(sectionId)}`, {
          method: 'PATCH',
          body: JSON.stringify({ name, expectedRevision }),
        });
        sectionRevisions.set(key, result.revision);
        refreshSubscriptions(sectionSubs.get(deckId));
      });
    },
    async deleteSection(deckId, sectionId) {
      return withWriteRecovery(async () => {
        await waitForRoomRefresh();
        const key = sectionKey(deckId, sectionId);
        const expectedRevision = sectionRevisions.get(key) ?? 0;
        await request(roomCode, `/decks/${encodeURIComponent(deckId)}/sections/${encodeURIComponent(sectionId)}`, {
          method: 'DELETE',
          body: JSON.stringify({ expectedRevision }),
        });
        sectionRevisions.delete(key);
        refreshSubscriptions(sectionSubs.get(deckId));
        refreshSubscriptions(cardSubs.get(deckId));
      });
    },
    async setSectionContent(deckId, sectionId, sourceText, cards: NewCard[], operationId) {
      return withWriteRecovery(async () => {
        await waitForRoomRefresh();
        const key = sectionKey(deckId, sectionId);
        const expectedRevision = sectionRevisions.get(key) ?? 0;
        const response = await request<Card[] | { cards: Card[]; revision: number }>(roomCode, `/decks/${encodeURIComponent(deckId)}/sections/${encodeURIComponent(sectionId)}/content`, {
          method: 'PUT',
          body: JSON.stringify({ sourceText, cards, expectedRevision, operationId }),
        });
        const created = Array.isArray(response) ? response : response.cards;
        sectionRevisions.set(key, Array.isArray(response) ? expectedRevision + 1 : response.revision);
        created.forEach((card) => cardRevisions.set(cardKey(deckId, card.id), card.revision ?? 0));
        refreshSubscriptions(sectionSubs.get(deckId));
        refreshSubscriptions(cardSubs.get(deckId));
        return created;
      });
    },
    async toggleCardStar(deckId, cardId, starred) {
      return withWriteRecovery(async () => {
        await waitForRoomRefresh();
        const key = cardKey(deckId, cardId);
        const expectedRevision = cardRevisions.get(key) ?? 0;
        const result = await request<{ revision: number; sectionId?: string; sectionRevision?: number }>(roomCode, `/decks/${encodeURIComponent(deckId)}/cards/${encodeURIComponent(cardId)}`, {
          method: 'PATCH',
          body: JSON.stringify({ starred, expectedRevision }),
        });
        rememberCardPatch(deckId, cardId, result);
        refreshSubscriptions(cardSubs.get(deckId));
      });
    },
    async setCardAnswerMastery(deckId, cardId, answerMastery, answerSchedule) {
      return withWriteRecovery(async () => {
        await waitForRoomRefresh();
        const key = cardKey(deckId, cardId);
        const expectedRevision = cardRevisions.get(key) ?? 0;
        const result = await request<{ revision: number; sectionId?: string; sectionRevision?: number }>(roomCode, `/decks/${encodeURIComponent(deckId)}/cards/${encodeURIComponent(cardId)}`, {
          method: 'PATCH',
          body: JSON.stringify({ answerMastery, ...(answerSchedule ? { answerSchedule } : {}), expectedRevision }),
        });
        rememberCardPatch(deckId, cardId, result);
        refreshSubscriptions(cardSubs.get(deckId));
      });
    },
  };
}

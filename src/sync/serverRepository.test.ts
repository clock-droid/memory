import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServerRepository } from './serverRepository';

function response(status: number, value: unknown = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(value),
  } as unknown as Response;
}

async function flushMicrotasks() {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

function controlPage(initialVisibility: 'hidden' | 'visible' = 'hidden') {
  let visibilityState = initialVisibility;
  const listeners = new Set<() => void>();
  vi.stubGlobal('document', {
    get visibilityState() {
      return visibilityState;
    },
    addEventListener: vi.fn((type: string, listener: () => void) => {
      if (type === 'visibilitychange') listeners.add(listener);
    }),
    removeEventListener: vi.fn((type: string, listener: () => void) => {
      if (type === 'visibilitychange') listeners.delete(listener);
    }),
  });
  return {
    setVisibility(next: 'hidden' | 'visible') {
      visibilityState = next;
      listeners.forEach((listener) => listener());
    },
  };
}

function hidePage() {
  return controlPage('hidden');
}

async function nextDeckError() {
  const repository = createServerRepository('test-room');
  if (!repository) throw new Error('repository was not created');
  let unsubscribe = () => {};
  const error = await new Promise<Error>((resolve) => {
    unsubscribe = repository.subscribeDecks(() => {}, resolve);
  });
  unsubscribe();
  return error;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** One hide in the shape the repository projects onto the wire. */
function hide(known: boolean) {
  return { index: 0, text: '답', known, schedule: null, dueAt: 0 };
}

describe('createServerRepository errors', () => {
  it('turns a network failure into a customer-safe Korean message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(nextDeckError()).resolves.toMatchObject({
      message: '인터넷 연결을 확인하고 다시 시도해 주세요.',
    });
  });

  it('times out a permanently pending request so retry and writes cannot deadlock', async () => {
    vi.useFakeTimers();
    hidePage();
    const fetchMock = vi.fn((_input: RequestInfo | URL, options?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    vi.stubGlobal('fetch', fetchMock);
    const repository = createServerRepository('test-room');
    if (!repository) throw new Error('repository was not created');
    const onError = vi.fn();
    const unsubscribe = repository.subscribeDecks(() => {}, onError);

    await vi.advanceTimersByTimeAsync(15000);
    await flushMicrotasks();

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      message: '인터넷 연결을 확인하고 다시 시도해 주세요.',
    }));
    unsubscribe();
  });

  it('keeps the timeout active while a response body is still pending', async () => {
    vi.useFakeTimers();
    hidePage();
    const fetchMock = vi.fn((_input: RequestInfo | URL, options?: RequestInit) => Promise.resolve({
      ok: true,
      status: 200,
      json: () => new Promise<unknown>((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new Error('body aborted')), { once: true });
      }),
    } as Response));
    vi.stubGlobal('fetch', fetchMock);
    const repository = createServerRepository('test-room');
    if (!repository) throw new Error('repository was not created');
    const onError = vi.fn();
    const unsubscribe = repository.subscribeDecks(() => {}, onError);
    await flushMicrotasks();

    await vi.advanceTimersByTimeAsync(15000);
    await flushMicrotasks();

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      message: '동기화 응답을 읽지 못했어요. 다시 시도해 주세요.',
    }));
    unsubscribe();
  });

  it('does not expose an internal HTTP error for a missing sync endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(404)));

    const error = await nextDeckError();
    expect(error.message).toBe('동기화 서버를 찾지 못했어요. 잠시 후 다시 시도해 주세요.');
    expect(error.message).not.toContain('404');
    expect(error.message).not.toContain('Server sync request failed');
  });

  it('pauses a failed subscription while hidden and retries it on return', async () => {
    vi.useFakeTimers();
    const page = hidePage();
    let deckReads = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      if (String(input).includes('path=%2Fversion')) {
        return Promise.resolve(response(200, { revision: 0 }));
      }
      deckReads += 1;
      return deckReads === 1
        ? Promise.reject(new TypeError('Failed to fetch'))
        : Promise.resolve(response(200, []));
    });
    vi.stubGlobal('fetch', fetchMock);
    const repository = createServerRepository('test-room');
    if (!repository) throw new Error('repository was not created');
    const onError = vi.fn();
    const onDecks = vi.fn();
    const unsubscribe = repository.subscribeDecks(onDecks, onError);

    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    page.setVisibility('visible');
    await flushMicrotasks();
    expect(onDecks).toHaveBeenCalledWith([]);

    expect(deckReads).toBe(2);
    unsubscribe();
  });

  it('refreshes active subscriptions only when the room revision changes', async () => {
    vi.useFakeTimers();
    const initialDecks = [{ id: 'deck-1', name: '처음', createdAt: 1, updatedAt: 1 }];
    const updatedDecks = [{ id: 'deck-1', name: '다른 기기 변경', createdAt: 1, updatedAt: 2 }];
    let deckRequests = 0;
    let versionRequests = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      if (String(input).includes('path=%2Fversion')) {
        versionRequests += 1;
        return Promise.resolve(response(200, { revision: versionRequests === 1 ? 0 : 1 }));
      }
      deckRequests += 1;
      return Promise.resolve(response(200, deckRequests < 3 ? initialDecks : updatedDecks));
    });
    vi.stubGlobal('fetch', fetchMock);
    const repository = createServerRepository('test-room');
    if (!repository) throw new Error('repository was not created');
    const onDecks = vi.fn();
    const unsubscribe = repository.subscribeDecks(onDecks);

    await flushMicrotasks();
    expect(onDecks).toHaveBeenCalledWith(initialDecks);
    expect(deckRequests).toBe(1);

    await vi.advanceTimersByTimeAsync(0);
    await flushMicrotasks();
    expect(versionRequests).toBe(1);
    expect(deckRequests).toBe(2);

    await vi.advanceTimersByTimeAsync(10000);
    await flushMicrotasks();
    expect(onDecks).toHaveBeenCalledWith(updatedDecks);

    expect(versionRequests).toBe(2);
    expect(deckRequests).toBe(3);
    unsubscribe();
  });

  it('keeps a successful write successful when only its refresh fails', async () => {
    vi.useFakeTimers();
    let deckReads = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL, options?: RequestInit) => {
      const url = String(input);
      if (url.includes('path=%2Fversion')) return Promise.resolve(response(200, { revision: 0 }));
      if (options?.method === 'PATCH') return Promise.resolve(response(200));
      deckReads += 1;
      if (deckReads <= 2) {
        return Promise.resolve(response(200, [{ id: 'deck-1', name: '기존', createdAt: 1, updatedAt: 1 }]));
      }
      return Promise.reject(new TypeError('Refresh failed'));
    });
    vi.stubGlobal('fetch', fetchMock);
    const repository = createServerRepository('test-room');
    if (!repository) throw new Error('repository was not created');
    const onError = vi.fn();
    const onDecks = vi.fn();
    const unsubscribe = repository.subscribeDecks(onDecks, onError);
    await flushMicrotasks();
    expect(onDecks).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);
    await flushMicrotasks();
    expect(onError).not.toHaveBeenCalled();

    await expect(repository.renameDeck('deck-1', '새 이름')).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));

    expect(onError.mock.calls[0][0]).toMatchObject({
      message: '인터넷 연결을 확인하고 다시 시도해 주세요.',
    });
    unsubscribe();
  });

  it('refreshes the affected snapshot after a failed write even when the room revision is unchanged', async () => {
    vi.useFakeTimers();
    controlPage('visible');
    const initialDecks = [{ id: 'deck-1', name: '기존', createdAt: 1, updatedAt: 1 }];
    const recoveredDecks = [{ id: 'deck-1', name: '서버 최신값', createdAt: 1, updatedAt: 2 }];
    let deckReads = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL, options?: RequestInit) => {
      const url = String(input);
      if (url.includes('path=%2Fversion')) return Promise.resolve(response(200, { revision: 0 }));
      if (options?.method === 'PATCH') return Promise.reject(new TypeError('write response dropped'));
      deckReads += 1;
      return Promise.resolve(response(200, deckReads < 3 ? initialDecks : recoveredDecks));
    });
    vi.stubGlobal('fetch', fetchMock);
    const repository = createServerRepository('test-room');
    if (!repository) throw new Error('repository was not created');
    const onDecks = vi.fn();
    const onError = vi.fn();
    const unsubscribe = repository.subscribeDecks(onDecks, onError);
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(0);
    await flushMicrotasks();
    expect(deckReads).toBe(2);

    await expect(repository.renameDeck('deck-1', '실패할 이름')).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(0);
    await flushMicrotasks();

    expect(onDecks).toHaveBeenLastCalledWith(recoveredDecks);
    expect(deckReads).toBe(3);
    unsubscribe();
  });

  it('ignores an older in-flight read when a write triggers a newer refresh', async () => {
    vi.useFakeTimers();
    let resolveInitial: ((value: Response) => void) | undefined;
    const initial = new Promise<Response>((resolve) => { resolveInitial = resolve; });
    const freshDecks = [{ id: 'deck-1', name: '새 이름', createdAt: 1, updatedAt: 2 }];
    let deckReads = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL, options?: RequestInit) => {
      const url = String(input);
      if (url.includes('path=%2Fversion')) return Promise.resolve(response(200, { revision: 0 }));
      if (options?.method === 'PATCH') return Promise.resolve(response(200));
      deckReads += 1;
      return deckReads === 1 ? initial : Promise.resolve(response(200, freshDecks));
    });
    vi.stubGlobal('fetch', fetchMock);
    const repository = createServerRepository('test-room');
    if (!repository) throw new Error('repository was not created');
    const onDecks = vi.fn();
    const unsubscribe = repository.subscribeDecks(onDecks);

    await expect(repository.renameDeck('deck-1', '새 이름')).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => expect(onDecks).toHaveBeenCalledWith(freshDecks));
    resolveInitial?.(response(200, [{ id: 'deck-1', name: '옛 이름', createdAt: 1, updatedAt: 1 }]));
    await Promise.resolve();

    expect(onDecks).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('sends and advances the latest section revision on whole-section writes', async () => {
    vi.useFakeTimers();
    hidePage();
    const section = { id: 'section-1', name: '암기장', sourceText: '', revision: 4, createdAt: 1, updatedAt: 1 };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(200, [section]))
      .mockResolvedValueOnce(response(200, []))
      .mockResolvedValueOnce(response(200, []));
    vi.stubGlobal('fetch', fetchMock);
    const repository = createServerRepository('test-room');
    if (!repository) throw new Error('repository was not created');
    const onSections = vi.fn();
    const unsubscribe = repository.subscribeSections('deck-1', onSections);
    await vi.waitFor(() => expect(onSections).toHaveBeenCalledWith([section]));

    await repository.setSectionContent('deck-1', 'section-1', '', []);
    await repository.setSectionContent('deck-1', 'section-1', '', []);

    const firstWrite = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    const secondWrite = JSON.parse(String(fetchMock.mock.calls[2][1]?.body));
    expect(firstWrite.expectedRevision).toBe(4);
    expect(secondWrite.expectedRevision).toBe(5);
    unsubscribe();
  });

  it('uses the exact section revision returned by an idempotent content write', async () => {
    vi.useFakeTimers();
    hidePage();
    const section = { id: 'section-1', name: '암기장', sourceText: '', revision: 4, createdAt: 1, updatedAt: 1 };
    const savedCard = {
      id: 'card-1', sectionId: 'section-1', type: 'pair', prompt: '질문', answers: ['답'],
      rawText: '질문:답', revision: 0, createdAt: 2, updatedAt: 2,
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(200, [section]))
      .mockResolvedValueOnce(response(200, { cards: [savedCard], revision: 4 }))
      .mockResolvedValueOnce(response(200, { revision: 5 }));
    vi.stubGlobal('fetch', fetchMock);
    const repository = createServerRepository('test-room');
    if (!repository) throw new Error('repository was not created');
    const unsubscribe = repository.subscribeSections('deck-1', () => {});
    await flushMicrotasks();

    await expect(repository.setSectionContent(
      'deck-1',
      'section-1',
      '질문:답',
      [{ type: 'pair', prompt: '질문', answers: ['답'], rawText: '질문:답' }],
      'append-operation',
    )).resolves.toEqual([savedCard]);
    await repository.renameSection('deck-1', 'section-1', '새 이름');

    const renameBody = JSON.parse(String(fetchMock.mock.calls[2][1]?.body));
    expect(renameBody.expectedRevision).toBe(4);
    unsubscribe();
  });

  it('waits for a detected room refresh before writing with its latest section revision', async () => {
    vi.useFakeTimers();
    let resolveStaleRead: ((value: Response) => void) | undefined;
    const staleRead = new Promise<Response>((resolve) => { resolveStaleRead = resolve; });
    const section = { id: 'section-1', name: '암기장', sourceText: '', revision: 0, createdAt: 1, updatedAt: 1 };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(200, [section]))
      .mockResolvedValueOnce(response(200, { revision: 0 }))
      .mockReturnValueOnce(staleRead)
      .mockResolvedValueOnce(response(200, []))
      .mockResolvedValueOnce(response(200, []));
    vi.stubGlobal('fetch', fetchMock);
    const repository = createServerRepository('test-room');
    if (!repository) throw new Error('repository was not created');
    const unsubscribe = repository.subscribeSections('deck-1', () => {});
    await flushMicrotasks();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(0);
    await flushMicrotasks();
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const firstSave = repository.setSectionContent('deck-1', 'section-1', '첫 저장', []);
    await flushMicrotasks();
    expect(fetchMock).toHaveBeenCalledTimes(3);

    resolveStaleRead?.(response(200, [{ ...section, revision: 4 }]));
    await flushMicrotasks();
    await firstSave;
    await repository.setSectionContent('deck-1', 'section-1', '두 번째 저장', []);

    const firstWrite = JSON.parse(String(fetchMock.mock.calls[3][1]?.body));
    const secondWrite = JSON.parse(String(fetchMock.mock.calls[4][1]?.body));
    expect(firstWrite.expectedRevision).toBe(4);
    expect(secondWrite.expectedRevision).toBe(5);
    unsubscribe();
  });

  it('keeps the room heartbeat single-flight across rapid visibility changes', async () => {
    vi.useFakeTimers();
    const page = controlPage('visible');
    let resolveFirstVersion: ((value: Response) => void) | undefined;
    const firstVersion = new Promise<Response>((resolve) => { resolveFirstVersion = resolve; });
    let versionReads = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      if (String(input).includes('path=%2Fversion')) {
        versionReads += 1;
        return versionReads === 1
          ? firstVersion
          : Promise.resolve(response(200, { revision: 0 }));
      }
      return Promise.resolve(response(200, []));
    });
    vi.stubGlobal('fetch', fetchMock);
    const repository = createServerRepository('test-room');
    if (!repository) throw new Error('repository was not created');
    const unsubscribe = repository.subscribeDecks(() => {});
    await flushMicrotasks();

    await vi.advanceTimersByTimeAsync(0);
    expect(versionReads).toBe(1);
    page.setVisibility('hidden');
    page.setVisibility('visible');
    page.setVisibility('hidden');
    page.setVisibility('visible');
    expect(versionReads).toBe(1);

    resolveFirstVersion?.(response(200, { revision: 0 }));
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(0);
    await flushMicrotasks();
    expect(versionReads).toBe(2);
    unsubscribe();
  });

  it('always sends both per-hide arrays, so a schedule can never be dropped', async () => {
    vi.useFakeTimers();
    hidePage();
    const stored = {
      id: 'card-1', sectionId: 'section-1', sourceText: '가림별 학습', answers: ['가림'],
      answerMastery: [false], starred: false, revision: 3, createdAt: 1, updatedAt: 1,
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(200, [stored]))
      .mockResolvedValueOnce(response(200, { revision: 4 }));
    vi.stubGlobal('fetch', fetchMock);
    const repository = createServerRepository('test-room');
    if (!repository) throw new Error('repository was not created');
    const unsubscribe = repository.subscribeCards('deck-1', () => {});
    await flushMicrotasks();

    const schedule = { due: 9, stability: 2, difficulty: 5, reps: 1, lapses: 0, state: 2, lastReview: 1 };
    await repository.setCardHides('deck-1', 'card-1', [
      { index: 0, text: '가림', known: true, schedule, dueAt: schedule.due },
    ]);

    const body = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(body).toMatchObject({ answerMastery: [true], answerSchedule: [schedule] });
    unsubscribe();
  });

  it('sends and advances the latest card revision on per-hide mastery writes', async () => {
    vi.useFakeTimers();
    hidePage();
    const card = {
      id: 'card-1',
      sectionId: 'section-1',
      sourceText: '가림별 학습',
      answers: ['가림'],
      answerMastery: [false],
      starred: false,
      revision: 3,
      createdAt: 1,
      updatedAt: 1,
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(200, [card]))
      .mockResolvedValueOnce(response(200, { revision: 4 }))
      .mockResolvedValueOnce(response(200, { revision: 5 }));
    vi.stubGlobal('fetch', fetchMock);
    const repository = createServerRepository('test-room');
    if (!repository) throw new Error('repository was not created');
    const unsubscribe = repository.subscribeCards('deck-1', () => {});
    await flushMicrotasks();

    await repository.setCardHides('deck-1', 'card-1', [hide(true)]);
    await repository.setCardHides('deck-1', 'card-1', [hide(false)]);

    const firstWrite = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    const secondWrite = JSON.parse(String(fetchMock.mock.calls[2][1]?.body));
    expect(firstWrite.expectedRevision).toBe(3);
    expect(secondWrite.expectedRevision).toBe(4);
    unsubscribe();
  });

  it('carries a mastery patch parent revision into the next section content write', async () => {
    vi.useFakeTimers();
    hidePage();
    const section = {
      id: 'section-1', name: '암기장', sourceText: '', revision: 7, createdAt: 1, updatedAt: 1,
    };
    const card = {
      id: 'card-1', sectionId: 'section-1', type: 'pair', prompt: '질문', answers: ['답'],
      rawText: '질문:답', answerMastery: [false], revision: 3, createdAt: 1, updatedAt: 1,
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(200, [section]))
      .mockResolvedValueOnce(response(200, [card]))
      .mockResolvedValueOnce(response(200, {
        revision: 4, sectionId: 'section-1', sectionRevision: 8,
      }))
      .mockResolvedValueOnce(response(200, []));
    vi.stubGlobal('fetch', fetchMock);
    const repository = createServerRepository('test-room');
    if (!repository) throw new Error('repository was not created');
    const unsubscribeSections = repository.subscribeSections('deck-1', () => {});
    await flushMicrotasks();
    const unsubscribeCards = repository.subscribeCards('deck-1', () => {});
    await flushMicrotasks();

    await repository.setCardHides('deck-1', 'card-1', [hide(true)]);
    await repository.setSectionContent('deck-1', 'section-1', '질문:답', [{
      type: 'pair', prompt: '질문', answers: ['답'], rawText: '질문:답', answerMastery: [true],
    }]);

    const contentWrite = JSON.parse(String(fetchMock.mock.calls[3][1]?.body));
    expect(contentWrite.expectedRevision).toBe(8);
    unsubscribeCards();
    unsubscribeSections();
  });
});

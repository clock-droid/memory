# Codex 작업 지시서 — 동기화 안정화 (함정 1~5 수정)

## 프로젝트 배경

"시험암기"는 PC와 아이폰이 같은 공유코드로 클라우드 암기장을 공유하는 React 18 + TypeScript PWA다.
빌드는 Vite가 아니라 esbuild 직접 호출(`scripts/build.mjs`)이고, 로컬 서빙은 `scripts/serve.mjs`다.

저장소 계층 (`src/App.tsx`의 `repository` useMemo, 210행 근처):

1. **Firebase** (`src/firebase.ts`) — `.env`에 Firebase 설정이 있을 때만. Firestore 문서 단위 저장 + `onSnapshot` 실시간 구독.
2. **cloud** (`src/serverRepository.ts`) — Firebase 미설정 시 사용(현재 배포 기본). Netlify Function `netlify/functions/sync.mjs`를 호출하고, 데이터는 Netlify Blobs에 **방(room) 전체가 JSON 하나**로 저장된다.
3. **local** (`src/localRepository.ts`) — localStorage. 실제로는 거의 도달하지 않는 폴백.

세 구현 모두 `src/types.ts`의 `Repository` 인터페이스를 따른다.
데이터 모델: Deck(암기장) → Section(세부 암기장, 원문 `sourceText` 보유) → Card. 섹션 저장 시 원문을 파싱해 해당 섹션의 카드를 전부 삭제 후 재생성한다.

## 공통 규칙

- 완료 조건: `npm run build`(= `tsc --noEmit` + esbuild)가 에러 없이 통과해야 한다.
- 새 npm 의존성을 추가하지 않는다.
- 기존 코드 스타일(세미콜론, 작은따옴표, 2칸 들여쓰기)과 한국어 UI 문구 톤을 따른다.
- `dist/`, `public/mockups/`, `ui-concepts/`, `.tmp-*`는 건드리지 않는다.
- 작업 순서는 아래 "권장 순서"를 따른다. 각 작업이 끝날 때마다 빌드를 돌려 확인한다.

## 권장 순서

1. **작업 3 + 작업 4** (서버 계층 리팩터링 — 공통 모듈을 공유하므로 함께 진행)
2. **작업 5** (토스트 인프라 — 이후 작업들이 에러 표시에 사용)
3. **작업 2** (네트워크 오류 상태 표시)
4. **작업 1** (편집 중 원격 덮어쓰기 방지)

---

## 작업 3 — 클라우드 동시 편집 유실 방지 (last-write-wins 제거)

### 문제

`netlify/functions/sync.mjs`는 방 전체 JSON을 읽고 → 메모리에서 수정하고 → 통째로 다시 쓴다.
두 기기(또는 두 요청)가 겹치면 나중에 쓴 쪽이 먼저 쓴 쪽의 변경을 조용히 덮어쓴다.
예: PC가 섹션 저장하는 사이 아이폰이 별표 토글 → 둘 중 하나 유실.

### 수정 방법

설치된 `@netlify/blobs` v10의 ETag 조건부 쓰기를 사용해 낙관적 동시성 제어를 넣는다.
API는 검증되어 있다:

- `store.getWithMetadata(key, { type: 'json', consistency: 'strong' })` → `{ data, etag, metadata } | null` (키 없으면 `null`)
- `store.setJSON(key, data, { onlyIfMatch: etag })` 또는 `{ onlyIfNew: true }` → `{ modified: boolean, etag?: string }`
  - 조건 불일치 시 `modified: false`가 반환된다(예외 아님).

#### 3-1. 공통 모듈 추출

`shared/roomLogic.mjs`(프로젝트 루트에 `shared/` 디렉터리 신설)를 만들고 `sync.mjs`의 라우팅/변경 로직을 옮긴다. 재시도 루프에서 mutation을 신선한 room에 다시 적용할 수 있어야 하므로 "요청 해석"과 "읽기/쓰기"를 분리하는 것이 목적이다.

```js
// shared/roomLogic.mjs
export function emptyRoom() {
  return { decks: [], cardsByDeck: {}, sectionsByDeck: {} };
}

export function ensureRoom(room) {
  room.decks ??= [];
  room.cardsByDeck ??= {};
  room.sectionsByDeck ??= {};
  return room;
}
// 주의: 기존 sync.mjs의 ensureRoom에는 `return room;` 뒤에 도달 불가능한
// 데드 코드(기본 덱 자동 생성)가 있다. 옮기면서 삭제할 것.

// 요청을 room에 적용한다. room을 직접 변형(mutate)한다.
// 반환: { status: number, body: unknown, write: boolean }
//   write === true 이면 호출자가 room을 저장해야 한다.
export function applyRoomRequest({ room, method, parts, body }) {
  // sync.mjs 56~171행의 라우팅 로직을 그대로 이식:
  //   GET  decks / cards / sections            → { status: 200, body: [...], write: false }
  //   POST decks, POST sections                → { status: 200, body: { id }, write: true }
  //   PATCH/DELETE deck·section, PATCH card,
  //   PUT section content                      → { status: 200, body: { ok: true }, write: true }
  //   POST ensure                              → { status: 200, body: { ok: true }, write: false }
  //   그 외                                     → { status: 404, body: { error: 'Not found' }, write: false }
  // id(), defaultSection() 헬퍼도 이 모듈로 옮긴다.
}
```

#### 3-2. sync.mjs를 재시도 래퍼로 교체

```js
import { getStore } from '@netlify/blobs';
import { applyRoomRequest, emptyRoom, ensureRoom } from '../../shared/roomLogic.mjs';

const MAX_ATTEMPTS = 5;

export default async function sync(request) {
  if (request.method === 'OPTIONS') return json({ ok: true });

  // roomCode / path / parts 파싱은 기존 코드 유지
  // 중요: request.json()은 한 번만 소비 가능하므로 body는 루프 밖에서 한 번 읽는다.
  const body = method === 'GET' || method === 'DELETE' ? {} : await request.json().catch(() => ({}));
  const store = getStore('exam-memorizer-rooms');

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const entry = await store.getWithMetadata(roomCode, { type: 'json', consistency: 'strong' });
    const room = ensureRoom(entry?.data ?? emptyRoom());
    const result = applyRoomRequest({ room, method, parts, body });
    if (!result.write) return json(result.body, result.status);

    const write = entry?.etag
      ? await store.setJSON(roomCode, room, { onlyIfMatch: entry.etag })
      : await store.setJSON(roomCode, room, { onlyIfNew: true });
    if (write.modified) return json(result.body, result.status);
    // modified === false → 다른 요청이 먼저 씀 → 다음 루프에서 재읽기 후 mutation 재적용
  }
  return json({ error: 'conflict' }, 409);
}
```

`json()` 헬퍼(CORS 헤더 포함)는 기존 것을 유지한다.

#### 3-3. 클라이언트 409 처리

`src/serverRepository.ts`의 `request()`에서 409 응답이면 사용자용 한국어 메시지를 담아 throw 한다:
`'다른 기기와 동시에 수정되었습니다. 잠시 후 다시 시도하세요.'`
(서버가 이미 5회 재시도하므로 클라이언트 자동 재시도는 넣지 않는다. 이 에러는 작업 5의 토스트로 표시된다.)

### 수용 기준

- 읽기 전용 요청(GET)은 쓰기를 수행하지 않는다.
- 쓰기 요청은 ETag 불일치 시 재읽기 후 mutation을 재적용하며, 5회 실패 시 409를 반환한다.
- 기존 API의 URL 형식·응답 형식은 그대로다(클라이언트 프로토콜 변경 없음).
- `node --input-type=module -e "..."`로 `applyRoomRequest`를 import해 덱 추가/섹션 저장/카드 PATCH/404 케이스를 검증하는 즉석 스모크 테스트가 통과한다.

---

## 작업 4 — 로컬 개발이 프로덕션 데이터를 수정하는 문제 차단

### 문제

`src/serverRepository.ts:3-10` — 호스트가 `exam-memorizer-clockgo.netlify.app`이 아니면 **프로덕션 절대 URL**(`CLOUD_SYNC_BASE`)로 요청을 보낸다. 즉 `npm run dev`로 로컬 개발을 해도 실제 배포된 Netlify Blobs 데이터를 읽고 쓴다. 개발 중 실수로 실사용 데이터를 삭제할 수 있다.

### 수정 방법

#### 4-1. 기본을 same-origin으로 뒤집기

`src/serverRepository.ts`:

```ts
const SYNC_BASE = import.meta.env.VITE_SYNC_BASE || '';

function apiPath(roomCode: string, path: string) {
  return `${SYNC_BASE}/.netlify/functions/sync?room=${encodeURIComponent(roomCode)}&path=${encodeURIComponent(path)}`;
}
```

- 프로덕션(Netlify)에서는 same-origin이므로 기존과 동일하게 동작한다.
- 로컬에서는 아래 4-2의 로컬 핸들러로 요청이 간다.
- 의도적으로 로컬에서 프로덕션 데이터를 보고 싶으면 `.env`에 `VITE_SYNC_BASE=https://exam-memorizer-clockgo.netlify.app`을 넣는다. `.env.example`에 주석과 함께 이 키를 추가한다.

`scripts/build.mjs`: esbuild `define` 목록에 `VITE_FIREBASE_*`만 있으므로 `VITE_SYNC_BASE`를 추가한다(누락 시 번들에서 `import.meta.env.VITE_SYNC_BASE`가 치환되지 않아 런타임 TypeError가 난다 — 반드시 추가).

```js
const envKeys = [...firebaseKeys, 'VITE_SYNC_BASE'];
// define: Object.fromEntries(envKeys.map(...))
```

`src/vite-env.d.ts`에 `ImportMetaEnv` 인터페이스가 선언돼 있으면 `VITE_SYNC_BASE?: string`을 추가한다.

#### 4-2. serve.mjs에 로컬 sync 엔드포인트 추가

`scripts/serve.mjs`의 요청 핸들러에서 `url.pathname === '/.netlify/functions/sync'`이면 작업 3에서 만든 `shared/roomLogic.mjs`를 사용해 처리한다:

1. 기존 sync.mjs와 동일하게 `room`/`path` 쿼리 파라미터 파싱(정규화 포함), body는 `readBody(request)` 재사용.
2. `readStore()`로 `data/rooms.json` 로드 → `store.rooms[roomCode] ??= emptyRoom()` → `ensureRoom` → `applyRoomRequest`.
3. `result.write`이면 `writeStore(store)` 후 `sendJson(response, result.body, result.status)`.
4. 로컬 파일이므로 ETag 재시도는 불필요하다(단일 프로세스).

기존 `/api/rooms/...` 핸들러와 SSE(`/events`) 코드는 클라이언트가 사용하지 않는 죽은 코드다. 이번 변경으로 `handleApi`가 완전히 미사용이 되면 삭제한다(선택이지만 권장). 삭제 시 `ensureRoom`/`ensureDeck` 등 serve.mjs 내 중복 헬퍼도 shared 모듈 것으로 통일한다.

#### 4-3. .gitignore 보강

현재 `.gitignore`에는 `.netlify`만 있다. 다음을 추가한다:

```
node_modules/
dist/
data/
.env
```

### 수용 기준

- `npm run dev` 후 `http://127.0.0.1:5173`에서 덱 생성 → `data/rooms.json`에 기록되고, 프로덕션 데이터는 변하지 않는다.
- `.env`에 `VITE_SYNC_BASE`를 설정하고 다시 빌드하면 해당 주소로 요청이 간다.
- 프로덕션 빌드(같은 도메인)는 기존과 동일하게 동작한다.

---

## 작업 5 — 저장/삭제/토글 실패 무음 제거 (토스트 알림)

### 문제

- `src/App.tsx`의 `saveContent`(594행 근처)는 `try/finally`만 있고 catch가 없다. 저장 실패 시 unhandled rejection으로 끝나고 사용자는 저장된 줄 안다.
- `deleteDeck`, `deleteSection`은 `await repository.…` 실패 시 아무 피드백이 없다.
- `toggleStar`, `toggleMastered`는 롤백 후 `throw error` 하지만 호출부(onClick)가 받지 않아 무음이다.

### 수정 방법

#### 5-1. 토스트 인프라

`App` 컴포넌트에 추가:

```tsx
type Toast = { id: number; kind: 'error' | 'success'; message: string };
const [toasts, setToasts] = useState<Toast[]>([]);
const toastIdRef = useRef(0);

function showToast(kind: Toast['kind'], message: string) {
  const id = ++toastIdRef.current;
  setToasts((current) => [...current, { id, kind, message }]);
  window.setTimeout(() => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, 4000);
}
```

렌더링(앱 셸 최하단, NameDialogView 아래):

```tsx
<div className="toast-stack" role="status" aria-live="polite">
  {toasts.map((toast) => (
    <div key={toast.id} className={`toast ${toast.kind}`}>{toast.message}</div>
  ))}
</div>
```

`src/styles.css`에 스타일 추가 — 기존 디자인 언어(글래스, 둥근 모서리)를 따른다:

- `.toast-stack`: `position: fixed; left: 50%; transform: translateX(-50%); bottom: max(18px, env(safe-area-inset-bottom)); z-index: 30;` (다이얼로그 backdrop이 z-index 20이므로 그 위), `display: grid; gap: 8px; width: min(92vw, 420px);`
- `.toast`: 흰 반투명 배경 + `backdrop-filter: blur(18px)`, `border-radius: 14px`, `padding: 12px 16px`, `font-weight: 800`, 그림자.
- `.toast.error`: 글자색 `#c92a2a`, 테두리 `#efb7a8` 계열. `.toast.success`: 글자색 `#1d7a3c`, 테두리 `#a9d9b8` 계열.

#### 5-2. 배선

- `saveContent`: catch 추가 → `showToast('error', error instanceof Error ? error.message : '저장에 실패했습니다. 네트워크를 확인하세요.')`. 실패 시 편집 화면에 머무는 현재 동작(setView가 try 안이므로 자동)은 유지. 성공 시 `showToast('success', '저장되었습니다')`.
- `deleteDeck` / `deleteSection`: `await repository.delete…`를 try/catch로 감싸고 실패 시 에러 토스트 후 `return`(캐시 정리·화면 전환을 건너뜀).
- `toggleStar` / `toggleMastered`: catch 블록의 `throw error`를 `showToast('error', '변경을 저장하지 못했습니다.')`로 교체(낙관적 롤백 로직은 유지).
- `renameDeck` / `renameSection`: HomeView의 `inlineError`로 이미 표시되므로 변경하지 않는다.

### 수용 기준

- DevTools Network를 Offline으로 두고 저장/삭제/별표 토글 시 각각 에러 토스트가 뜨고, unhandled rejection이 콘솔에 남지 않는다.
- 별표 토글 실패 시 UI가 원래 상태로 롤백된다(기존 로직 유지 확인).
- 토스트는 4초 후 자동으로 사라지고, 여러 개가 쌓일 수 있다.

---

## 작업 2 — 네트워크 오류가 "빈 암기장"으로 위장하는 문제

### 문제

`src/serverRepository.ts`의 `subscribeDecks`/`subscribeCards`/`subscribeSections`는 fetch 실패 시 `.catch(() => callback([]))`로 **빈 배열을 데이터인 것처럼** 전달한다. 오프라인에서 앱을 열면 "아직 암기장이 없습니다"가 떠서 사용자가 데이터 유실로 오해하고, 새 덱을 만들면 온라인 복귀 후 중복이 생긴다.

또한 `HomeView`는 로딩 완료 여부(`sectionsLoaded`)를 확인하지 않아 로딩 중에도 "세부 암기장이 없습니다"를 표시한다.

### 수정 방법

#### 2-1. Repository 인터페이스에 에러 채널 추가

`src/types.ts` — 세 subscribe 메서드에 선택적 `onError`를 추가한다:

```ts
subscribeDecks: (callback: (decks: Deck[]) => void, onError?: (error: Error) => void) => () => void;
subscribeCards: (deckId: string, callback: (cards: Card[]) => void, onError?: (error: Error) => void) => () => void;
subscribeSections: (deckId: string, callback: (sections: Section[]) => void, onError?: (error: Error) => void) => () => void;
```

- `src/firebase.ts`: `onSnapshot(query, next)` → `onSnapshot(query, next, (error) => onError?.(error))`.
- `src/localRepository.ts`: 시그니처만 맞추고 onError는 사용하지 않는다.
- `src/serverRepository.ts`: **`callback([])` 호출을 제거**하고 대신:
  - `onError?.(error)`를 호출한다.
  - 구독이 살아있는 동안(`active`) 5초 뒤 재시도하는 타이머를 건다. 성공하면 `callback(items)`. unsubscribe 시 타이머를 정리한다.

```ts
subscribeDecks(callback, onError) {
  let active = true;
  let timer = 0;
  const unsubscribe = addSub(deckSubs, callback);
  const load = () => {
    void request<Deck[]>(roomCode, '/decks')
      .then((items) => { if (active) callback(items); })
      .catch((error) => {
        if (!active) return;
        onError?.(error instanceof Error ? error : new Error('sync failed'));
        timer = window.setTimeout(load, 5000);
      });
  };
  load();
  return () => { active = false; window.clearTimeout(timer); unsubscribe(); };
}
```

(cards/sections도 동일 패턴.)

#### 2-2. App 상태

- `const [decksState, setDecksState] = useState<'loading' | 'ready' | 'error'>('loading');`
- `const [retryNonce, setRetryNonce] = useState(0);`
- 덱 구독 effect(App.tsx 243행 근처)의 deps에 `retryNonce`를 추가하고, effect 시작 시 `setDecksState('loading')`, 콜백 첫 수신 시 `'ready'`, onError 시:
  - 아직 `'ready'`가 아니면 `'error'`.
  - 이미 데이터가 있으면 상태는 유지하고 에러 토스트를 1회만 표시(구독당 1회로 제한 — 지역 플래그 사용).
- `DeckCacheEntry`(App.tsx 32행 근처)에 `sectionsError?: boolean; cardsError?: boolean;`를 추가. 선택 덱 구독과 프리페치 구독의 onError에서 true로 설정하고, 정상 콜백 수신 시 false로 되돌린다.

#### 2-3. UI 분기

- `HomeView`에 `decksState`와 `onRetry`(= `() => setRetryNonce(n => n + 1)`) props 추가:
  - `'loading'` → 기존 empty-state 스타일로 "불러오는 중…" 표시 (덱 목록·빈 상태 대신).
  - `'error'` → "서버에 연결할 수 없습니다." + `다시 시도` 버튼(onRetry).
  - `'ready'` && 덱 0개 → 기존 "아직 암기장이 없습니다" 유지.
- 섹션 트리: 현재 `sections.length === 0`이면 무조건 빈 상태를 보여준다. `selectedDeckData`의 `sectionsLoaded`/`sectionsError`를 HomeView에 내려서:
  - 로딩 전 → "불러오는 중…"
  - 에러 → "불러오지 못했습니다" (+ 다시 시도)
  - 로드됨 && 0개 → 기존 빈 상태.
- `StudyView`: `cardsLoaded`를 prop으로 내려 카드 0개일 때 로딩 전이면 "불러오는 중…", 로드 후에만 "아직 문제가 없습니다"를 표시.

### 수용 기준

- DevTools Offline 상태에서 새로고침하면 "아직 암기장이 없습니다" 대신 연결 오류 + 다시 시도 버튼이 보인다.
- Online 복귀 후 `다시 시도`를 누르면(또는 5초 자동 재시도로) 목록이 나타난다.
- 정상 로딩 중 빈 상태 문구가 깜빡이지 않는다.
- Firebase 모드(로컬 `.env` 설정 시)와 local 모드에서도 타입 에러 없이 동작한다.

---

## 작업 1 — 편집 중 원격 데이터가 편집 내용을 덮어쓰는 문제

### 문제

`src/App.tsx` 390~394행:

```tsx
useEffect(() => {
  if (!selectedDeck || !selectedSection) return;
  localStorage.setItem(`${LAST_SECTION_PREFIX}:${selectedDeck.id}`, selectedSection.id);
  setEditText(savedSourceText);
}, [selectedDeck?.id, selectedSection?.id, savedSourceText]);
```

`savedSourceText`가 deps에 있어서, 편집 중 다른 기기가 같은 섹션을 저장하면(Firebase 모드는 즉시 push) `setEditText`가 실행돼 **작성 중이던 내용이 경고 없이 원격 값으로 교체**된다.

### 수정 방법

"베이스라인 스냅샷 + 충돌 배너" 방식.

#### 1-1. App 상태

```tsx
const editBaselineRef = useRef('');           // editText를 마지막으로 로드/저장한 시점의 원문
const [conflictText, setConflictText] = useState<string | null>(null); // 충돌 시 도착한 원격 원문
```

기존 effect를 둘로 분리한다:

```tsx
// (a) 섹션 진입/변경 시에만 무조건 로드 — savedSourceText를 deps에서 제거
useEffect(() => {
  if (!selectedDeck || !selectedSection) return;
  localStorage.setItem(`${LAST_SECTION_PREFIX}:${selectedDeck.id}`, selectedSection.id);
  editBaselineRef.current = savedSourceText;
  setEditText(savedSourceText);
  setConflictText(null);
}, [selectedDeck?.id, selectedSection?.id]);

// (b) 같은 섹션에서 원격 원문이 바뀐 경우
useEffect(() => {
  if (!selectedSection) return;
  if (savedSourceText === editBaselineRef.current) return; // 변화 없음
  if (editText === editBaselineRef.current) {
    // 로컬 편집이 없으면 조용히 최신화
    editBaselineRef.current = savedSourceText;
    setEditText(savedSourceText);
    setConflictText(null);
  } else {
    // 로컬 편집 중 → 덮어쓰지 않고 배너로 알림
    setConflictText(savedSourceText);
  }
}, [savedSourceText, editText, selectedSection?.id]);
```

(a)의 deps에서 `savedSourceText`를 빼는 것이 핵심이다. tsc가 exhaustive-deps를 강제하지 않으므로 빌드는 통과한다.

#### 1-2. 저장 성공 시 베이스라인 갱신

`saveContent`에서 `await repository.setSectionContent(...)` 성공 직후:

```tsx
editBaselineRef.current = editText;
setConflictText(null);
```

(저장 후 구독으로 되돌아오는 sourceText는 editText와 같으므로 배너가 뜨지 않는다.)

#### 1-3. 충돌 배너 UI

`EditView`에 props 추가: `conflictText: string | null`, `onAcceptRemote: () => void`, `onKeepMine: () => void`.

- App에서:
  - `onAcceptRemote`: `editBaselineRef.current = conflictText; setEditText(conflictText); setConflictText(null);`
  - `onKeepMine`: `editBaselineRef.current = conflictText; setConflictText(null);`
    (원격 변경을 인지한 것으로 처리 — 이후 저장하면 의도적으로 원격을 덮어쓴다. 이후 또 원격 변경이 오면 배너가 다시 뜬다.)
- EditView 렌더링: `conflictText !== null`일 때 에디터 위에 배너:

```tsx
{conflictText !== null && (
  <div className="conflict-banner" role="alert">
    <p>다른 기기에서 이 세부 암기장이 수정되었습니다.</p>
    <div>
      <button className="soft-button" type="button" onClick={onAcceptRemote}>원격 내용 불러오기</button>
      <button className="soft-button" type="button" onClick={onKeepMine}>내 편집 유지</button>
    </div>
  </div>
)}
```

- "원격 내용 불러오기"는 현재 편집 내용을 버리므로 버튼 문구 아래 작은 안내(`현재 편집 내용은 사라집니다`)를 함께 표시한다.
- `src/styles.css`에 `.conflict-banner` 추가 — 기존 경고 팔레트(`.preview-row.invalid`의 `#fff1ed` 배경 / `#efb7a8` 테두리) 재사용, `border-radius: 18px`, `padding: 12px 14px`, 버튼 가로 배치(모바일에서 줄바꿈 허용).

### 수용 기준

- 창 A에서 섹션 편집 중(텍스트 수정 후 저장 안 함) 창 B가 같은 섹션을 저장해도 창 A의 textarea 내용이 바뀌지 않고 배너가 나타난다.
- 배너에서 "원격 내용 불러오기"를 누르면 textarea가 원격 원문으로 교체된다.
- "내 편집 유지" 후 저장하면 내 내용이 저장되고 배너가 다시 나타나지 않는다.
- 편집하지 않은 상태(진입 직후)에서 원격 저장이 오면 배너 없이 조용히 최신 내용으로 갱신된다.
- 섹션/덱을 전환하면 배너와 베이스라인이 초기화된다.

검증은 Firebase 모드(실시간 push)가 가장 확실하다. cloud 모드만 가능하면: 창 A에서 편집 중 → 창 B에서 저장 → 창 A에서 별표 토글 등으로 재구독을 유발하거나 새로고침 전에 배너 로직이 동작하는지 확인한다.

---

## 최종 확인 체크리스트

1. `npm run build` 통과.
2. `npm run dev` → 로컬에서 덱/섹션/카드 생성·편집·삭제가 `data/rooms.json`에만 기록됨 (작업 4).
3. Offline 시뮬레이션 → 오류 상태 UI + 토스트, 빈 상태 위장 없음 (작업 2, 5).
4. 두 창 동시 편집 시나리오 → 충돌 배너 (작업 1), 저장 유실 없음 (작업 3).
5. 콘솔에 unhandled promise rejection 없음.

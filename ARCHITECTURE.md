# 코드 구조

이 문서는 **새 기능을 어디에 넣을지** 판단하는 기준이다. 제품이 무엇을 지향하는지는
[`PRODUCT_PRINCIPLES.md`](./PRODUCT_PRINCIPLES.md)에 있다.

## 계층

의존은 **한 방향으로만** 흐른다. 아래쪽이 위쪽을 import 하면 안 된다.

```
views/     화면. 받은 것만 그리고, 받은 콜백만 호출한다.
  ↑
actions/   사용자 의도. "카드를 지운다", "학습을 시작한다".
state/       화면 상태 슬라이스. React 상태만 있고 규칙은 없다.
  ↑
sync/      방과의 통신. 저장소 선택·구독·낙관적 쓰기·캐시.
  ↑
domain/    제품 규칙. React 없음, I/O 없음, 전부 순수 함수.
```

- `domain/`은 아무것도 import 하지 않는다(같은 `domain/` 안끼리만).
- `views/`는 `domain/` 타입은 읽어도 되지만 저장·통신은 절대 직접 하지 않는다.

## 각 폴더가 하는 일

### `domain/` — 제품 규칙

React도 브라우저 API도 쓰지 않는다. 전부 테스트가 붙는다.

| 파일 | 책임 |
|---|---|
| `hides.ts` | **가림(Hide)** — 이 앱의 학습 단위. 만들기·모르는 것 고르기·점검할 것 고르기·판정 적용 |
| `cards.ts` | 저장된 카드 → 화면용 `ProtoCard`, 목록 만들기, 진행률 집계 |
| `studySession.ts` | 학습/점검 세션 계획 (`planStudySession`, `planCheckupSession`) |
| `tokens.ts` | 원문 ↔ 토큰, 가림 선택 적용 |
| `parser.ts` | 원문 줄 → 카드 |
| `answerSchedule.ts` | FSRS 계산 (가림 하나의 다음 복습일) |
| `types.ts` | `Card` · `Deck` · `Section` · `StudyTarget` 등 데이터 모양 |

**가림이 중심이다.** 진행률·세션·점검은 전부 `Hide` 목록을 요약한 결과다.
카드 전체에 하나의 상태를 저장하는 코드를 새로 만들지 않는다.

### `sync/` — 방과의 통신

| 파일 | 책임 |
|---|---|
| `repository.ts` | 백엔드가 구현해야 하는 인터페이스(포트) |
| `serverRepository` / `firebase` / `localRepository` | 그 구현 3가지 |
| `useRoomStore.ts` | 저장소 선택, 구독 배선, **이름 있는 쓰기 동작** |
| `deckCache.ts` | 화면에 보이는 스냅샷 + 서버가 확인해준 스냅샷 |
| `syncResources.ts` · `syncHealth.ts` | 피드별 상태 → 하나의 동기화 상태 |
| `mutationQueue.ts` | 같은 자원에 대한 쓰기 직렬화 |

`useRoomStore`는 **사용자에게 보여줄 문구를 절대 갖지 않는다.** 실패는
`onRejected` / `onFailure` 콜백으로 알리고, 문구는 `actions/`가 정한다.

### `state/` — 화면 상태

여섯 조각으로 나뉜다: `route` · `deck` · `session` · `composer` · `editor` · `shell`.
각 조각은 자기 타입의 patch만 받으므로, 한 화면을 고치다 다른 화면 상태를 건드릴 수 없다.

조각을 **넘나드는 이동**은 `useRoomUi`의 이름 있는 동작으로만 한다:
`goHome` · `openList` · `startSession` · `backToDeck`.

### `actions/` — 사용자 의도

`sync`의 쓰기 + `state`의 갱신 + 토스트 문구를 하나의 의도로 묶는다.
화면은 여기서 나온 콜백만 호출한다.

### `views/` — 화면

자기 슬라이스와 콜백만 props로 받는다. `state` 전체나 `store`를 통째로 받지 않는다.

## 새로 만들 때 어디에 넣는가

| 만들려는 것 | 위치 |
|---|---|
| 가림 판정·진행률·복습 간격 규칙 | `domain/hides.ts` 또는 `domain/studySession.ts` |
| 새 화면 | `views/` + 필요하면 `state/uiSlices.ts`에 슬라이스 하나 |
| 새 저장 동작 | `sync/useRoomStore.ts`에 이름 있는 쓰기 + `sync/repository.ts`에 메서드 |
| 버튼을 눌렀을 때 벌어지는 일 | `actions/` |
| 새 입력 형식 | `domain/parser.ts` · `domain/tokens.ts` |

## 하지 말 것

- `App.tsx`에 로직 추가 — 여기는 조립과 화면 전환만 한다.
- 화면 컴포넌트에서 `repository`나 `store`를 직접 호출.
- `domain/`에서 React·`localStorage`·`fetch` 사용.
- `sync/`에 한국어 사용자 문구 넣기.
- 가림별 상태를 그대로 두고 카드 단위 플래그를 새로 추가.
- `Hide`의 `known`/`schedule`을 따로 떼어 병렬 배열로 다시 다루기 — 그러라고
  `hides.ts`가 있다.

## 확인 방법

```bash
npm test          # 순수 로직 단위 테스트
npx tsc --noEmit  # 계층 위반은 대부분 타입 에러로 드러난다
npm run build
```

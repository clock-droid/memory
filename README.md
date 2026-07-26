# 시험암기

PC와 아이폰에서 같은 공유 코드로 접속해 암기장과 카드를 자동 동기화하는 PWA입니다.

## 제품 핵심

시험암기는 카드 전체를 `안다 / 모른다`로 판단하는 일반 플래시카드와 달리, **한 카드 안의 여러 가림을 독립적인 학습 단위로 다룹니다.** 사용자가 정확히 어느 부분을 알고 모르는지 발견하고, 모르는 가림만 다시 학습하게 하는 것이 최우선 목적입니다.

기능·UI·데이터 구조를 수정할 때 적용하는 전체 판단 기준은 [`PRODUCT_PRINCIPLES.md`](./PRODUCT_PRINCIPLES.md)에 정리되어 있습니다.

## 아이폰에서 사용

배포된 주소:

```text
https://exam-memorizer-clockgo.netlify.app
```

이 주소는 PC가 꺼져 있어도 접속할 수 있습니다. PC와 아이폰에서 같은 공유 코드를 입력하면 같은 카드 데이터를 사용합니다.

PC에서도 같은 주소를 사용하는 것을 권장합니다. 로컬 개발 주소인 `http://127.0.0.1:5173`도 현재는 같은 클라우드 저장소를 보도록 설정되어 있지만, 실제 사용은 공개 주소 하나로 통일하는 편이 가장 덜 헷갈립니다.

아이폰 Safari에서 주소를 연 뒤 공유 버튼을 누르고 `홈 화면에 추가`를 선택하면 앱처럼 실행할 수 있습니다.

## 실행

```bash
npm install
npm run dev
```

브라우저에서 `http://localhost:5173`을 엽니다. 같은 와이파이의 아이폰에서는 PC의 `http://<PC-IP>:5173` 주소를 Safari에서 열면 접속할 수 있습니다.

- `npm run build` — 타입 검사(`tsc --noEmit`) 후 esbuild 번들 생성
- `npm run mobile:sync` — 배포 동기화 서버를 사용해 웹을 빌드하고 iOS·Android 프로젝트에 복사
- `npm test` — 순수 로직(domain) 단위 테스트(vitest)

빌드 스택은 Vite가 아니라 **esbuild**(`scripts/build.mjs`) + **Node 동기화 서버**(`scripts/serve.mjs`)입니다. 환경변수의 `VITE_` 접두사는 관례로 유지됩니다.

## iOS·Android 앱

Capacitor 프로젝트는 웹앱의 `dist/`를 앱 안에 포함합니다. 웹 코드를 수정한 뒤
`npm run mobile:sync`를 실행하면 두 네이티브 프로젝트에 최신 빌드가 반영됩니다.

```bash
npm run mobile:sync
npx cap open ios
npx cap open android
```

현재 표시 이름 `시험암기`와 앱 식별자 `app.memory.dev`는 개발용 가칭입니다.
표시 이름은 이후에도 바꿀 수 있지만, 앱 식별자는 **첫 TestFlight 또는 Play Console
빌드 업로드 전에** 소유한 도메인 기반 값으로 교체해야 합니다.

## 저장·동기화

앱은 `Repository` 인터페이스([`src/sync/repository.ts`](./src/sync/repository.ts)) 하나에 세 구현을 둡니다.
프로덕션과 일반 브라우저에서는 충돌 검사와 멱등 쓰기를 제공하는 서버 동기화를 우선 사용합니다.

1. **서버 동기화**(`src/sync/serverRepository.ts`) — `/.netlify/functions/sync`를 통해 공유 코드별 방(room)에 저장. 공용 로직은 [`shared/roomLogic.mjs`](./shared/roomLogic.mjs)이고, 개발 시 `scripts/serve.mjs`, 배포 시 `netlify/functions/sync.mjs`가 감쌉니다.
2. **Firebase**(`src/sync/firebase.ts`) — 서버 동기화를 만들 수 없는 레거시 환경용 어댑터.
3. **로컬 저장**(`src/sync/localRepository.ts`) — 네트워크 저장소를 만들 수 없는 환경용 어댑터.

세 구현 모두 같은 공유 코드를 입력하면 같은 카드 데이터를 봅니다. 카드 저장 시 서버가 카드 id를 새로 발급하므로, 클라이언트는 저장 응답으로 받은 실제 id로 낙관적 캐시를 맞춰 가림별 숙련도(`answerMastery`)가 세션을 넘어 보존됩니다.

공유 코드는 계정 비밀번호 대신 방의 접근 권한으로 작동합니다. 새 코드는 128비트 임의 값으로 만들고,
배포 함수는 IP별 분당 120회로 제한합니다. 코드를 아는 사람은 같은 데이터에 접근할 수 있으므로
공개 게시하지 말고 비밀처럼 보관해야 합니다.

### 선택: Firebase 설정

기기 간 동기화에 Firebase를 쓰려면 `.env`에 다음 6개 값을 넣고, Firestore를 만든 뒤 `firestore.rules`를 보안 규칙에 적용합니다.

- `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`

## 코드 구조

`src/`는 의존이 한 방향으로만 흐르는 네 계층으로 나뉩니다. 어디에 무엇을 넣는지는
[`ARCHITECTURE.md`](./ARCHITECTURE.md)에 정리되어 있습니다.

```text
views/    화면 (각자 자기 상태 조각만 받음)
actions/  사용자 의도 (카드 삭제, 학습 시작 …)
state/    화면 상태 6조각 (route·deck·session·composer·editor·shell)
sync/     방과의 통신 (저장소 3구현 + 구독 + 낙관적 쓰기)
domain/   제품 규칙 (React 없음, 전부 순수 함수 + 테스트)
```

핵심은 `domain/hides.ts`의 **`Hide`** 타입입니다. 학습 단위는 카드가 아니라 가림이고,
진행률·세션·점검은 모두 가림 목록을 요약한 결과입니다.

`App.tsx`는 조립과 화면 전환만 합니다.

## 입력 형식

```text
수도:서울
대한민국->서울
대한민국의 수도는 [서울]이다
조선의 건국은 [1392년]이고 왕은 [이성계]이다
```

- `A:B`, `A->B`는 `B`가 가려집니다.
- `[ ]` 안의 텍스트는 문장 안 빈칸으로 가려집니다.
- 내용 편집 화면은 현재 암기장의 원문 전체를 보여줍니다. 기존 내용을 고치거나 아래에 새 줄을 추가한 뒤 저장하면 카드가 다시 만들어집니다.
- 한 공유 공간에 여러 암기장을 만들 수 있고, 각 암기장의 원문과 카드는 따로 저장됩니다.
- 정답을 탭하면 3초 동안 공개됩니다.
- 길게 누르면 누르는 동안 공개되고, 손을 떼면 다시 가려집니다.

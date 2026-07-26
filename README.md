# 시험암기

로그인 없는 기기 저장과 계정 동기화를 함께 지원하는 가림 단위 암기 앱입니다.

## 제품 핵심

시험암기는 카드 전체를 `안다 / 모른다`로 판단하는 일반 플래시카드와 달리, **한 카드 안의 여러 가림을 독립적인 학습 단위로 다룹니다.** 사용자가 정확히 어느 부분을 알고 모르는지 발견하고, 모르는 가림만 다시 학습하게 하는 것이 최우선 목적입니다.

기능·UI·데이터 구조를 수정할 때 적용하는 전체 판단 기준은 [`PRODUCT_PRINCIPLES.md`](./PRODUCT_PRINCIPLES.md)에 정리되어 있습니다.

## 웹에서 사용

배포된 주소:

```text
https://exam-memorizer-clockgo.netlify.app
```

이 주소는 PC가 꺼져 있어도 접속할 수 있습니다. 기기 저장은 해당 브라우저나 앱
안에만 남고, 계정 동기화를 설정하면 PC와 휴대폰에서 같은 카드를 사용할 수 있습니다.

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

1. **계정 동기화**(`src/sync/supabaseRepository.ts`) — Supabase Auth 사용자마다 RLS로 격리된 Postgres 행에 저장하고 Realtime으로 다른 기기의 변경을 받습니다.
2. **기기 저장**(`src/sync/localRepository.ts`) — 로그인 없이 이 기기의 `localStorage`에 저장합니다.
3. **기존 코드 동기화**(`src/sync/serverRepository.ts`) — 기존 사용자의 공유 코드를 계속 읽기 위한 호환 경로입니다. `/.netlify/functions/sync`와 Netlify Blobs를 사용합니다.

세 구현은 카드·섹션과 가림별 숙련도(`answerMastery`, `answerSchedule`)를 같은 모양으로
보존합니다. 기기 또는 기존 코드 데이터를 계정으로 옮길 때는 원본을 지우지 않고
멱등 operation id로 복사하므로 중단 후 다시 시도해도 같은 목록을 재사용합니다.

기존 공유 코드는 계정 비밀번호 대신 방의 접근 권한으로 작동합니다. 코드를 아는 사람은
같은 데이터에 접근할 수 있으므로 공개 게시하지 말고 비밀처럼 보관해야 합니다.

### Supabase 계정 동기화 설정

1. Supabase 프로젝트를 만들고
   [`supabase/migrations/20260727000000_account_rooms.sql`](./supabase/migrations/20260727000000_account_rooms.sql)을 적용합니다.
2. `.env`에 `VITE_SUPABASE_URL`과 `VITE_SUPABASE_PUBLISHABLE_KEY`를 넣습니다.
3. Supabase Authentication에서 Google과 Kakao provider를 켭니다.
4. 웹 주소와 네이티브 콜백 `memoryapp://auth/callback`을 Redirect URLs에 등록합니다.

서비스 키나 OAuth client secret은 앱의 `.env`에 넣지 않습니다. 앱에는 공개 가능한
Supabase publishable key만 포함되고 데이터 접근은 `auth.uid()` 기반 RLS가 제한합니다.

## 코드 구조

`src/`는 의존이 한 방향으로만 흐르는 네 계층으로 나뉩니다. 어디에 무엇을 넣는지는
[`ARCHITECTURE.md`](./ARCHITECTURE.md)에 정리되어 있습니다.

```text
views/    화면 (각자 자기 상태 조각만 받음)
actions/  사용자 의도 (카드 삭제, 학습 시작 …)
state/    화면 상태 6조각 (route·deck·session·composer·editor·shell)
sync/     저장·동기화 (기기·계정·기존 코드 + 구독 + 낙관적 쓰기)
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

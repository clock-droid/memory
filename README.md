# 시험암기

PC와 아이폰에서 같은 공유 코드로 접속해 암기장과 카드를 실시간 동기화하는 PWA입니다.

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

브라우저에서 `http://localhost:5173`을 엽니다.

같은 와이파이의 아이폰에서 PC 주소로 접속하려면 개발 서버가 표시하는 Network URL을 Safari에서 열면 됩니다.

## Firebase 실시간 동기화 설정

`.env.example`을 복사해 `.env`를 만들고 Firebase 웹앱 설정값을 채웁니다.

```bash
cp .env.example .env
```

필요한 값:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`

Firebase Console에서 Firestore Database를 만들고, `firestore.rules` 내용을 보안 규칙에 적용합니다.

Firebase 값이 비어 있으면 앱은 자동으로 로컬 저장 모드로 실행됩니다. 이 경우 PC와 아이폰 간 실시간 동기화는 되지 않습니다.

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

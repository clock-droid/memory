# Notebook Terminology and Card Chip Design QA

- Source visual truth: `/var/folders/75/9smsjvnj5wqcl86rs5frq8d40000gn/T/codex-clipboard-e4cae9ee-0fcd-49f1-bb74-c98abdc071fb.png`
- Home screenshot: `/Users/admin/Documents/GitHub/memory/artifacts/terminology-card-chip-qa-2026-07-11/01-home.png`
- Card-selection screenshot: `/Users/admin/Documents/GitHub/memory/artifacts/terminology-card-chip-qa-2026-07-11/02-card-selection.png`
- Focused comparison: `/Users/admin/Documents/GitHub/memory/artifacts/terminology-card-chip-qa-2026-07-11/03-chip-comparison.png`
- Viewport: 390 x 844
- State: existing notebook opened, example sentence entered, `목성이다` selected as the hidden answer

## Findings

- No actionable P0, P1, or P2 findings remain.
- The home hierarchy now exposes only notebooks and their card counts. The previous subject grouping no longer competes with the notebook concept.
- Unselected answer words use white, rounded, outlined touch targets; the selected answer alone uses solid blue, matching the supplied reference.
- Five touch targets wrap at the 390 px mobile viewport instead of shrinking below comfortable tap sizes. The wide reference remains one line because it has more horizontal room.

## Required Fidelity Surfaces

- Fonts and typography: the existing system Korean font stack and app hierarchy are preserved.
- Spacing and layout rhythm: token gaps, 46 px minimum target height, rounded corners, and the selected-state emphasis closely match the reference without horizontal overflow.
- Colors and visual tokens: existing `#007aff`, white surfaces, neutral gray borders, and the app background are preserved.
- Image quality and assets: the source screenshot is used only as visual truth; no approximate image or placeholder asset is shipped in the interface.
- Copy and content: user-facing nouns consistently follow `암기장 -> 카드`, including home, detail, add, delete, study, import, and settings states.

## Interaction Verification

- Verified the flattened notebook home with real persisted data.
- Opened `핵심 구조`, entered card-add mode, and typed `태양계에서 가장 큰 행성은 목성이다`.
- Verified all five words are individually operable and selecting `목성이다` enables `추가하고 계속`.
- Cancelled without saving, so verification did not mutate the user's cards.
- Browser console warnings/errors checked: none.

## Comparison History

### Iteration 1

- Finding: [P1] `암기장 만들기` and `카드 만들기` were mixed with an extra subject-grouping layer, making the object hierarchy unclear.
- Fix: flattened home to a notebook list, displayed card counts as notebook metadata, and carried both notebook and section identity through navigation.

### Iteration 2

- Finding: [P2] plain text answer tokens did not match the user's supplied outlined-chip reference.
- Fix: introduced an outlined mode for the card-add selector while keeping the edit sheet's established compact token style unchanged.
- Post-fix evidence: `artifacts/terminology-card-chip-qa-2026-07-11/03-chip-comparison.png`.

final result: passed

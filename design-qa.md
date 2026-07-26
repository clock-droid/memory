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

---

# Non-modal Card Composer Design QA

- Source visual truth: `/Users/admin/.codex/generated_images/019f9d23-adde-71f0-9a1a-286e370ec54b/call_XWYWUxG2qDTaMQvR5KjousYs.png`
- Implementation screenshot: `/tmp/memory-card-composer-implementation.png`
- Combined comparison: `/tmp/memory-card-composer-comparison.png`
- Viewport: 390 x 844 CSS pixels
- Screenshot dimensions: 390 x 844 pixels
- State: an existing deck stays visible behind the composer; one card has just been added, the success message is visible, and the next card is already being prepared

## Findings

- No actionable P0, P1, or P2 visual findings remain.
- The composer is docked to the lower half of the screen without a backdrop, so the visible deck keeps its hierarchy and remains operable.
- The success message sits immediately above the composer and does not clear the next draft, matching the intended rapid-entry loop.
- The implementation preserves the product's denser grouped card rows instead of replacing them with the mock's isolated sample cards.
- The drag handle, title, cancel action, input, hide-selection chips, and primary action retain a clear top-to-bottom reading order at the 390 px mobile viewport.

## Required Fidelity Surfaces

- Fonts and typography: the app's existing Korean system font stack and title hierarchy are preserved.
- Spacing and layout rhythm: the composer occupies a bounded lower region, keeps safe padding around controls, and leaves enough deck content visible to browse.
- Colors and visual tokens: existing blue selection and action tokens, white surfaces, neutral borders, and the deck background are preserved.
- Image quality and assets: no new illustrative assets were required; existing iconography remains unchanged.
- Copy and content: the composer consistently uses `카드 추가`, reports `카드가 추가됐어요`, and keeps `되돌리기` available during the confirmation window.

## Interaction Verification

- Added a card and verified that the composer remained open, the input reset, focus returned to it, and the new card appeared in the deck behind it.
- Scrolled the deck while the composer was open and verified that its scroll position changed.
- Opened and closed an existing card's edit sheet while the composer remained open.
- Closed the composer with both the explicit `취소` action and a downward swipe on the handle.
- Verified the empty new-deck state shows the draft deck context behind the composer before the first card is persisted.

## Comparison History

### Iteration 1

- Finding: [P1] the full-screen composer hid the deck and prevented users from checking existing cards while writing.
- Fix: kept `DeckView` mounted as the page owner and changed the composer to a pointer-transparent overlay with an interactive bottom dock.

### Iteration 2

- Finding: [P1] the initial swipe implementation relied on pointer capture and did not dismiss reliably in the mobile browser.
- Fix: tracked the drag on window-level pointer events and closed after a bounded 72 px downward gesture.

### Iteration 3

- Finding: [P2] the mock's separate card blocks did not match the app's established compact deck rows.
- Fix: retained the existing deck presentation while matching the selected mock's composer height, action hierarchy, and toast placement.

final result: passed

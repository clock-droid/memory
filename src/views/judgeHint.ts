import { JUDGE_HINT_KEY } from '../constants';

// The "탭하세요" judgment hint starts emphasized. Only an explicit user action
// (the inline dismiss in StudyView, or the settings toggle) turns it off — never inferred.
export function readJudgeHintEnabled(): boolean {
  try {
    return localStorage.getItem(JUDGE_HINT_KEY) !== '0';
  } catch {
    return true;
  }
}

export function writeJudgeHintEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(JUDGE_HINT_KEY, enabled ? '1' : '0');
  } catch {
    // storage unavailable — hint simply stays in its default emphasized state
  }
}

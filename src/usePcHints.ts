import { useEffect, useState } from 'react';
import { PC_HINT_QUERY } from './constants';

export function usePcHints() {
  const [isPc, setIsPc] = useState(() => (
    typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia(PC_HINT_QUERY).matches
  ));

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia(PC_HINT_QUERY);
    const update = () => setIsPc(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return isPc;
}

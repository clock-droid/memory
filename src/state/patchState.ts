import { useReducer } from 'react';
import type { Dispatch, Reducer } from 'react';

/** An update expressed as the fields that change, or as a function of the current slice. */
export type Patch<S> = Partial<S> | ((state: S) => Partial<S>);

function patchReducer<S>(state: S, patch: Patch<S>): S {
  return { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
}

/**
 * A state slice updated by merging a partial patch. The setter identity is
 * stable, so callbacks built on it do not change between renders.
 */
export function usePatchState<S extends object>(initial: S): [S, Dispatch<Patch<S>>] {
  return useReducer(patchReducer as Reducer<S, Patch<S>>, initial);
}

import type { StoreApi } from "zustand";
import { useStore } from "zustand";

/**
 * Utility type that adds auto-generated `.use` selectors to a vanilla Zustand store.
 *
 * @example
 * const store = createSelectors(createStore(...))
 * const value = store.use.someProperty()
 * const action = store.use.someAction()
 */
export type WithSelectors<S> = S extends { getState: () => infer T }
  ? S & { use: { [K in keyof T]: () => T[K] } }
  : never;

/**
 * Wraps a vanilla Zustand store with auto-generated React hooks for each property.
 *
 * This allows accessing any state property or action with:
 *   store.use.propertyName()
 *
 * @example
 * const vanillaStore = createStore(...)
 * const store = createSelectors(vanillaStore)
 *
 * // In component:
 * const volume = store.use.volume()
 * const play = store.use.play()
 */
export const createSelectors = <S extends StoreApi<object>>(_store: S): WithSelectors<S> => {
  const store = _store as WithSelectors<typeof _store>;
  store.use = {} as WithSelectors<S>["use"];

  for (const k of Object.keys(store.getState())) {
    (store.use as Record<string, () => unknown>)[k] = () =>
      useStore(_store, (s) => s[k as keyof typeof s]);
  }

  return store;
};

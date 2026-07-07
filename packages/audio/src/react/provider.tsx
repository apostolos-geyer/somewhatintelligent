import { useRef, type ReactNode } from "react";
import { AudioPlayerContext } from "./context";
import {
  createAudioPlayerStore,
  type AudioPlayerStoreApi,
  type EngineFactory,
} from "../core/store";
import { logger } from "../core/logger";
import { useMediaSessionBridge } from "./use-media-session-bridge";

export type AudioPlayerProviderProps = {
  children: ReactNode;
  engineFactory: EngineFactory;
};

/**
 * Provides the audio player store to React components.
 *
 * Accepts an engineFactory for lazy initialization.
 * The engine is not created until initializeEngine() is called.
 *
 * Usage:
 * ```tsx
 * <AudioPlayerProvider engineFactory={createWebAudioEngine}>
 *   {children}
 * </AudioPlayerProvider>
 * ```
 */
export function AudioPlayerProvider({ children, engineFactory }: AudioPlayerProviderProps) {
  // Create store once on mount, holding the factory in closure
  const storeRef = useRef<AudioPlayerStoreApi | null>(null);

  if (!storeRef.current) {
    logger.provider.info("creating store with engineFactory");
    storeRef.current = createAudioPlayerStore(engineFactory);
  }

  useMediaSessionBridge(storeRef.current);

  return (
    <AudioPlayerContext.Provider value={storeRef.current}>{children}</AudioPlayerContext.Provider>
  );
}

import { createContext } from "react";
import type { AudioPlayerStoreApi } from "../core/store";

export const AudioPlayerContext = createContext<AudioPlayerStoreApi | null>(null);

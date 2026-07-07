/**
 * Finite State Machine for audio playback state management.
 *
 * The FSM tracks two concerns:
 * 1. `playbackState` - What the engine is currently doing
 * 2. `intent` - What the user wants (preserved during async operations)
 *
 * This separation prevents state desync during async operations like resampling.
 */

import { logger } from "./logger";

// ============================================================================
// Types
// ============================================================================

/**
 * Playback states for the audio engine.
 */
export type PlaybackState =
  | "unloaded" // No audio loaded
  | "loading" // Loading audio file
  | "ready" // Loaded, stopped at position 0
  | "playing" // Actively playing
  | "paused" // Paused with position preserved
  | "transitioning" // Async operation (resampling) in progress
  | "error"; // Error state

/**
 * User intent - what they want the player to be doing.
 * Preserved during transitioning state.
 */
export type PlaybackIntent = "play" | "pause";

/**
 * FSM state container.
 */
export interface FSMState {
  playbackState: PlaybackState;
  intent: PlaybackIntent;
  error?: Error;
}

/**
 * Actions that can transition the FSM.
 */
export type FSMAction =
  | { type: "LOAD_START" }
  | { type: "LOAD_SUCCESS" }
  | { type: "LOAD_ERROR"; error: Error }
  | { type: "PLAY" }
  | { type: "PAUSE" }
  | { type: "STOP" }
  | { type: "TRANSITION_START" }
  | { type: "TRANSITION_COMPLETE" }
  | { type: "DESTROY" };

// ============================================================================
// Valid Transitions
// ============================================================================

/**
 * Valid transitions from each state.
 */
const VALID_TRANSITIONS: Record<PlaybackState, FSMAction["type"][]> = {
  unloaded: ["LOAD_START"],
  loading: ["LOAD_SUCCESS", "LOAD_ERROR", "DESTROY"],
  ready: ["PLAY", "LOAD_START", "DESTROY"],
  playing: ["PAUSE", "STOP", "TRANSITION_START", "LOAD_START", "DESTROY"],
  paused: ["PLAY", "STOP", "TRANSITION_START", "LOAD_START", "DESTROY"],
  transitioning: ["TRANSITION_COMPLETE", "PLAY", "PAUSE", "STOP", "LOAD_START", "DESTROY"],
  error: ["LOAD_START", "DESTROY"],
};

// ============================================================================
// Functions
// ============================================================================

/**
 * Create initial FSM state.
 */
export function createInitialFSMState(): FSMState {
  return {
    playbackState: "unloaded",
    intent: "pause",
  };
}

/**
 * Check if a transition is valid from the current state.
 */
export function canTransition(state: PlaybackState, actionType: FSMAction["type"]): boolean {
  return VALID_TRANSITIONS[state]?.includes(actionType) ?? false;
}

/**
 * FSM reducer - pure function for state transitions.
 * Returns the new state, or the same state if transition is invalid.
 */
export function fsmReducer(state: FSMState, action: FSMAction): FSMState {
  const fromState = state.playbackState;
  const fromIntent = state.intent;

  // Validate transition
  if (!canTransition(state.playbackState, action.type)) {
    logger.fsm.invalidTransition(state.playbackState, action.type);
    return state;
  }

  let newState: FSMState;

  switch (action.type) {
    case "LOAD_START":
      newState = {
        playbackState: "loading",
        intent: "pause",
        error: undefined,
      };
      break;

    case "LOAD_SUCCESS":
      newState = {
        playbackState: "ready",
        intent: "pause",
        error: undefined,
      };
      break;

    case "LOAD_ERROR":
      newState = {
        playbackState: "error",
        intent: "pause",
        error: action.error,
      };
      break;

    case "PLAY":
      if (state.playbackState === "transitioning") {
        // During transition, just update intent
        newState = { ...state, intent: "play" };
      } else {
        newState = {
          playbackState: "playing",
          intent: "play",
          error: undefined,
        };
      }
      break;

    case "PAUSE":
      if (state.playbackState === "transitioning") {
        // During transition, just update intent
        newState = { ...state, intent: "pause" };
      } else {
        newState = {
          playbackState: "paused",
          intent: "pause",
          error: undefined,
        };
      }
      break;

    case "STOP":
      // Stop resets to ready state and clears intent
      newState = {
        playbackState: "ready",
        intent: "pause",
        error: undefined,
      };
      break;

    case "TRANSITION_START":
      // Preserve current intent while transitioning
      newState = {
        ...state,
        playbackState: "transitioning",
      };
      break;

    case "TRANSITION_COMPLETE":
      // Return to state based on intent
      newState = {
        playbackState: state.intent === "play" ? "playing" : "paused",
        intent: state.intent,
        error: undefined,
      };
      break;

    case "DESTROY":
      newState = createInitialFSMState();
      break;

    default:
      return state;
  }

  // Log the transition with intent changes
  const intentChanged = fromIntent !== newState.intent;
  const stateChanged = fromState !== newState.playbackState;

  if (stateChanged || intentChanged) {
    const parts: string[] = [];
    if (stateChanged) {
      parts.push(`${fromState} → ${newState.playbackState}`);
    }
    if (intentChanged) {
      parts.push(`intent: ${fromIntent} → ${newState.intent}`);
    }
    logger.fsm.transition(fromState, action.type, parts.join(", "));
  }

  return newState;
}

/**
 * Derive convenience booleans from FSM state.
 */
export function deriveFSMState(fsm: FSMState): {
  isPlaying: boolean;
  isLoading: boolean;
  isReady: boolean;
  isTransitioning: boolean;
} {
  return {
    isPlaying: fsm.playbackState === "playing",
    isLoading: fsm.playbackState === "loading" || fsm.playbackState === "transitioning",
    isReady: !["unloaded", "loading", "error"].includes(fsm.playbackState),
    isTransitioning: fsm.playbackState === "transitioning",
  };
}

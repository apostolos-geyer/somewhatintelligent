/**
 * Debug logger for audio engine.
 *
 * Enable by setting:
 * - localStorage.setItem('audio-debug', 'true') in browser
 * - process.env.AUDIO_DEBUG = 'true' in Node.js
 */

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  timestamp: number;
  level: LogLevel;
  category: string;
  message: string;
  data?: unknown;
}

const LOG_COLORS = {
  FSM: "#9b59b6", // Purple
  Store: "#3498db", // Blue
  Engine: "#e67e22", // Orange
  Provider: "#1abc9c", // Teal
} as const;

type LogCategory = keyof typeof LOG_COLORS;

// Ring buffer for recent logs (useful for debugging)
const LOG_BUFFER_SIZE = 100;
const logBuffer: LogEntry[] = [];

function isDebugEnabled(): boolean {
  // Browser
  if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
    return localStorage.getItem("audio-debug") === "true";
  }
  // Node.js
  if (typeof process !== "undefined" && process.env) {
    return process.env.AUDIO_DEBUG === "true";
  }
  return false;
}

function formatTime(): string {
  const now = new Date();
  return `${now.toLocaleTimeString()}.${now.getMilliseconds().toString().padStart(3, "0")}`;
}

function addToBuffer(entry: LogEntry) {
  logBuffer.push(entry);
  if (logBuffer.length > LOG_BUFFER_SIZE) {
    logBuffer.shift();
  }
}

function log(level: LogLevel, category: LogCategory, message: string, data?: unknown) {
  const entry: LogEntry = {
    timestamp: Date.now(),
    level,
    category,
    message,
    data,
  };

  addToBuffer(entry);

  if (!isDebugEnabled()) return;

  const color = LOG_COLORS[category];
  const prefix = `%c[${category}]%c`;
  const time = formatTime();

  const styles = [
    `color: white; background: ${color}; padding: 1px 4px; border-radius: 2px; font-weight: bold`,
    "color: inherit",
  ];

  if (data !== undefined) {
    console[level](`${time} ${prefix} ${message}`, ...styles, data);
  } else {
    console[level](`${time} ${prefix} ${message}`, ...styles);
  }
}

export const logger = {
  fsm: {
    debug: (msg: string, data?: unknown) => log("debug", "FSM", msg, data),
    info: (msg: string, data?: unknown) => log("info", "FSM", msg, data),
    warn: (msg: string, data?: unknown) => log("warn", "FSM", msg, data),
    error: (msg: string, data?: unknown) => log("error", "FSM", msg, data),
    transition: (from: string, action: string, to: string) => {
      log("info", "FSM", `${from} → ${action} → ${to}`);
    },
    invalidTransition: (state: string, action: string) => {
      log("warn", "FSM", `Invalid: ${state} + ${action} (ignored)`);
    },
  },

  store: {
    debug: (msg: string, data?: unknown) => log("debug", "Store", msg, data),
    info: (msg: string, data?: unknown) => log("info", "Store", msg, data),
    warn: (msg: string, data?: unknown) => log("warn", "Store", msg, data),
    error: (msg: string, data?: unknown) => log("error", "Store", msg, data),
    dispatch: (action: string, result?: string) => {
      log("info", "Store", result ? `dispatch(${action}) → ${result}` : `dispatch(${action})`);
    },
    event: (event: string, data?: unknown) => {
      log("debug", "Store", `← engine.${event}`, data);
    },
  },

  engine: {
    debug: (msg: string, data?: unknown) => log("debug", "Engine", msg, data),
    info: (msg: string, data?: unknown) => log("info", "Engine", msg, data),
    warn: (msg: string, data?: unknown) => log("warn", "Engine", msg, data),
    error: (msg: string, data?: unknown) => log("error", "Engine", msg, data),
    emit: (event: string, data?: unknown) => {
      log("debug", "Engine", `emit(${event})`, data);
    },
    action: (action: string, data?: unknown) => {
      log("info", "Engine", action, data);
    },
  },

  provider: {
    debug: (msg: string, data?: unknown) => log("debug", "Provider", msg, data),
    info: (msg: string, data?: unknown) => log("info", "Provider", msg, data),
  },

  /** Get recent log entries (for debugging) */
  getBuffer: () => [...logBuffer],

  /** Clear log buffer */
  clearBuffer: () => {
    logBuffer.length = 0;
  },

  /** Enable debug logging */
  enable: () => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("audio-debug", "true");
      console.log("Audio debug logging enabled. Refresh to see logs.");
    }
  },

  /** Disable debug logging */
  disable: () => {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem("audio-debug");
      console.log("Audio debug logging disabled.");
    }
  },
};

// Expose globally for easy debugging in browser console
if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).audioLogger = logger;
}

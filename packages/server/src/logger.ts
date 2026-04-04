// Structured JSON logger for CHAOS relay server

export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const configuredLevel: LogLevel = (Deno.env.get("LOG_LEVEL") as LogLevel) ||
  "info";
const configuredLevelNum = LOG_LEVELS[configuredLevel] ?? LOG_LEVELS.info;

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  component: string;
  message: string;
  [key: string]: unknown;
}

const LOG_FORMAT = Deno.env.get("LOG_FORMAT") || "pretty"; // 'json' or 'pretty'

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: "\x1b[90m", // gray
  info: "\x1b[36m", // cyan
  warn: "\x1b[33m", // yellow
  error: "\x1b[31m", // red
};
const RESET = "\x1b[0m";

function emit(
  level: LogLevel,
  component: string,
  message: string,
  data?: Record<string, unknown>,
): void {
  if (LOG_LEVELS[level] < configuredLevelNum) return;

  const ts = new Date().toISOString();

  if (LOG_FORMAT === "json") {
    const entry: LogEntry = {
      timestamp: ts,
      level,
      component,
      message,
      ...data,
    };
    const line = JSON.stringify(entry);
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  } else {
    // Human-readable format
    const time = ts.slice(11, 23); // HH:MM:SS.mmm
    const lvl = level.toUpperCase().padEnd(5);
    const comp = component.padEnd(12);
    const color = LEVEL_COLORS[level];
    let line = `${color}${time} ${lvl}${RESET} [${comp}] ${message}`;
    if (data && Object.keys(data).length > 0) {
      const parts = Object.entries(data).map(([k, v]) =>
        `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`
      );
      line += ` ${"\x1b[90m"}${parts.join(" ")}${RESET}`;
    }
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  }
}

export const logger = {
  debug(
    component: string,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    emit("debug", component, message, data);
  },
  info(
    component: string,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    emit("info", component, message, data);
  },
  warn(
    component: string,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    emit("warn", component, message, data);
  },
  error(
    component: string,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    emit("error", component, message, data);
  },
};

/**
 * Extract common request fields for logging.
 */
export function requestLog(
  req: Request,
  component: string,
  message: string,
  data?: Record<string, unknown>,
): Record<string, unknown> {
  const url = new URL(req.url);
  return {
    method: req.method,
    path: url.pathname,
    ip: req.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
      req.headers.get("X-Real-IP") ||
      "unknown",
    ...data,
  };
}

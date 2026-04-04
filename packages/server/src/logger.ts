// Structured JSON logger for CHAOS relay server

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const configuredLevel: LogLevel = (Deno.env.get('LOG_LEVEL') as LogLevel) || 'info';
const configuredLevelNum = LOG_LEVELS[configuredLevel] ?? LOG_LEVELS.info;

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  component: string;
  message: string;
  [key: string]: unknown;
}

function emit(level: LogLevel, component: string, message: string, data?: Record<string, unknown>): void {
  if (LOG_LEVELS[level] < configuredLevelNum) return;

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    component,
    message,
    ...data,
  };

  const line = JSON.stringify(entry);
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  debug(component: string, message: string, data?: Record<string, unknown>): void {
    emit('debug', component, message, data);
  },
  info(component: string, message: string, data?: Record<string, unknown>): void {
    emit('info', component, message, data);
  },
  warn(component: string, message: string, data?: Record<string, unknown>): void {
    emit('warn', component, message, data);
  },
  error(component: string, message: string, data?: Record<string, unknown>): void {
    emit('error', component, message, data);
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
    ip: req.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
      || req.headers.get('X-Real-IP')
      || 'unknown',
    ...data,
  };
}

type LogLevel = "debug" | "info" | "warn" | "error";
type LogContext = Record<string, unknown>;

const levelOrder: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function minimumLevel(): LogLevel {
  const configured = process.env.LOG_LEVEL;
  return configured && configured in levelOrder ? (configured as LogLevel) : "info";
}

function serializeError(error: unknown): unknown {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return error;
}

function write(level: LogLevel, message: string, context?: LogContext) {
  if (levelOrder[level] < levelOrder[minimumLevel()]) return;

  const entry: LogContext = { level, time: new Date().toISOString(), msg: message };
  if (context) {
    for (const [key, value] of Object.entries(context)) {
      entry[key] = key === "error" ? serializeError(value) : value;
    }
  }

  // One JSON object per line in production (log-aggregator friendly),
  // readable output in development.
  const line =
    process.env.NODE_ENV === "production"
      ? JSON.stringify(entry)
      : `[${level}] ${message}${context ? ` ${JSON.stringify(entry, null, 2)}` : ""}`;

  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (message: string, context?: LogContext) => write("debug", message, context),
  info: (message: string, context?: LogContext) => write("info", message, context),
  warn: (message: string, context?: LogContext) => write("warn", message, context),
  error: (message: string, context?: LogContext) => write("error", message, context),
};

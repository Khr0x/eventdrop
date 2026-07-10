/*
 * Structured JSON logger.
 * Every log entry includes: level, message, functionName, timestamp.
 * Callers pass eventId and requestId via the meta parameter —
 * they are merged into the log entry automatically.
 */
export function createLogger(functionName: string) {
  return {
    info(message: string, meta?: Record<string, unknown>): void {
      console.log(
        JSON.stringify({
          level: "info",
          message,
          functionName,
          timestamp: new Date().toISOString(),
          ...meta,
        })
      );
    },
    error(message: string, meta?: Record<string, unknown>): void {
      console.error(
        JSON.stringify({
          level: "error",
          message,
          functionName,
          timestamp: new Date().toISOString(),
          ...meta,
        })
      );
    },
    warn(message: string, meta?: Record<string, unknown>): void {
      console.warn(
        JSON.stringify({
          level: "warn",
          message,
          functionName,
          timestamp: new Date().toISOString(),
          ...meta,
        })
      );
    },
  };
}

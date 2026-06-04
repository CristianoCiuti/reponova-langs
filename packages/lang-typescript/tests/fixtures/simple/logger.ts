/**
 * Simple structured logger.
 */
import { format } from "node:util";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  log(level: LogLevel, message: string, ...args: unknown[]): void;
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export const DEFAULT_LEVEL: LogLevel = "info";

export class ConsoleLogger implements Logger {
  constructor(private readonly minLevel: LogLevel = DEFAULT_LEVEL) {}

  log(level: LogLevel, message: string, ...args: unknown[]): void {
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[this.minLevel]) {
      return;
    }
    const formatted = format(message, ...args);
    process.stderr.write(`[${level}] ${formatted}\n`);
  }
}

export const createLogger = (level: LogLevel = DEFAULT_LEVEL): Logger => {
  return new ConsoleLogger(level);
};

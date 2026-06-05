/**
 * Generic repository abstraction with an in-memory implementation.
 *
 * Adapted from a typical Node.js service backend pattern.
 */
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { format } from "node:util";

import type { Logger, LogLevel } from "../simple/logger.js";
import { ConsoleLogger, DEFAULT_LEVEL } from "../simple/logger.js";

export const REPO_VERSION = "1.0.0";

export interface Identifiable {
  readonly id: string;
}

export interface Repository<T extends Identifiable> {
  find(id: string): Promise<T | null>;
  list(): Promise<T[]>;
  insert(value: Omit<T, "id">): Promise<T>;
  update(id: string, value: Partial<T>): Promise<T | null>;
  remove(id: string): Promise<boolean>;
}

export type RepositoryEvent =
  | { kind: "inserted"; id: string }
  | { kind: "updated"; id: string }
  | { kind: "removed"; id: string };

export enum RepositoryStatus {
  Idle = "idle",
  Busy = "busy",
  Errored = "errored",
}

/**
 * Decorator stub used in tests; the runtime is not part of this fixture.
 */
function loggable(_target: unknown, _name: string, descriptor: PropertyDescriptor): PropertyDescriptor {
  return descriptor;
}

/**
 * Common base with shared logging + status tracking.
 */
export abstract class BaseRepository<T extends Identifiable>
  extends EventEmitter
  implements Repository<T> {
  protected status: RepositoryStatus = RepositoryStatus.Idle;
  protected readonly logger: Logger;

  constructor(logger: Logger = new ConsoleLogger(DEFAULT_LEVEL)) {
    super();
    this.logger = logger;
  }

  abstract find(id: string): Promise<T | null>;
  abstract list(): Promise<T[]>;
  abstract insert(value: Omit<T, "id">): Promise<T>;
  abstract update(id: string, value: Partial<T>): Promise<T | null>;
  abstract remove(id: string): Promise<boolean>;

  protected logAt(level: LogLevel, message: string, ...args: unknown[]): void {
    this.logger.log(level, format(`[${this.constructor.name}] ${message}`, ...args));
  }
}

/**
 * In-memory repository — useful for tests and prototypes.
 */
export class InMemoryRepository<T extends Identifiable> extends BaseRepository<T> {
  private readonly store = new Map<string, T>();

  @loggable
  async find(id: string): Promise<T | null> {
    return this.store.get(id) ?? null;
  }

  async list(): Promise<T[]> {
    return Array.from(this.store.values());
  }

  async insert(value: Omit<T, "id">): Promise<T> {
    const id = randomUUID();
    const created = { ...value, id } as T;
    this.store.set(id, created);
    this.emit("change", { kind: "inserted", id });
    this.logAt("info", "inserted entity %s", id);
    return created;
  }

  async update(id: string, value: Partial<T>): Promise<T | null> {
    const current = this.store.get(id);
    if (!current) return null;
    const merged = { ...current, ...value, id } as T;
    this.store.set(id, merged);
    this.emit("change", { kind: "updated", id });
    return merged;
  }

  async remove(id: string): Promise<boolean> {
    const existed = this.store.delete(id);
    if (existed) {
      this.emit("change", { kind: "removed", id });
    }
    return existed;
  }
}

export const createInMemoryRepository = <T extends Identifiable>(
  logger?: Logger,
): Repository<T> => {
  return new InMemoryRepository<T>(logger);
};

export type { Logger } from "../simple/logger.js";
export { DEFAULT_LEVEL } from "../simple/logger.js";

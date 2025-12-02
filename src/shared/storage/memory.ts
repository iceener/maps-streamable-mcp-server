/**
 * In-memory session storage.
 * Used for local development and as fallback for KV.
 */

import type { SessionRecord, SessionStore } from './interface.js';

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * In-memory session store with TTL and automatic cleanup.
 */
export class MemorySessionStore implements SessionStore {
  private sessions = new Map<string, { record: SessionRecord; expiresAt: number }>();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private ttlMs: number;

  constructor(ttlMs: number = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
    this.startCleanup();
  }

  async ensure(sessionId: string): Promise<void> {
    if (!this.sessions.has(sessionId)) {
      const now = Date.now();
      this.sessions.set(sessionId, {
        record: { created_at: now },
        expiresAt: now + this.ttlMs,
      });
    }
  }

  async get(sessionId: string): Promise<SessionRecord | null> {
    const entry = this.sessions.get(sessionId);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.sessions.delete(sessionId);
      return null;
    }

    return entry.record;
  }

  async put(sessionId: string, value: SessionRecord): Promise<void> {
    this.sessions.set(sessionId, {
      record: value,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  async delete(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  /**
   * Start periodic cleanup of expired sessions.
   */
  private startCleanup(): void {
    if (this.cleanupInterval) return;

    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.sessions) {
        if (now > entry.expiresAt) {
          this.sessions.delete(key);
        }
      }
    }, CLEANUP_INTERVAL_MS);

    // Don't prevent process exit
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  /**
   * Stop cleanup interval (for graceful shutdown).
   */
  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

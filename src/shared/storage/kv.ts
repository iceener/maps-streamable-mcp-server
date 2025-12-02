/**
 * Cloudflare KV session storage with encryption support.
 */

import type { SessionRecord, SessionStore } from './interface.js';
import type { MemorySessionStore } from './memory.js';

const SESSION_TTL_SECONDS = 24 * 60 * 60; // 24 hours

interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: { expiration?: number; expirationTtl?: number },
  ): Promise<void>;
  delete(key: string): Promise<void>;
}

interface KvOptions {
  encrypt: (plaintext: string) => Promise<string>;
  decrypt: (ciphertext: string) => Promise<string>;
  fallback?: MemorySessionStore;
}

/**
 * KV-backed session store with optional encryption and memory fallback.
 */
export class KvSessionStore implements SessionStore {
  private kv: KVNamespace;
  private encrypt: (s: string) => Promise<string>;
  private decrypt: (s: string) => Promise<string>;
  private fallback?: MemorySessionStore;

  constructor(kv: KVNamespace, options: KvOptions) {
    this.kv = kv;
    this.encrypt = options.encrypt;
    this.decrypt = options.decrypt;
    this.fallback = options.fallback;
  }

  private key(sessionId: string): string {
    return `session:${sessionId}`;
  }

  async ensure(sessionId: string): Promise<void> {
    const existing = await this.get(sessionId);
    if (!existing) {
      await this.put(sessionId, { created_at: Date.now() });
    }
  }

  async get(sessionId: string): Promise<SessionRecord | null> {
    try {
      const raw = await this.kv.get(this.key(sessionId));
      if (!raw) {
        return this.fallback?.get(sessionId) ?? null;
      }

      const decrypted = await this.decrypt(raw);
      return JSON.parse(decrypted) as SessionRecord;
    } catch {
      return this.fallback?.get(sessionId) ?? null;
    }
  }

  async put(sessionId: string, value: SessionRecord): Promise<void> {
    try {
      const encrypted = await this.encrypt(JSON.stringify(value));
      await this.kv.put(this.key(sessionId), encrypted, {
        expirationTtl: SESSION_TTL_SECONDS,
      });

      // Also update fallback for consistency
      if (this.fallback) {
        await this.fallback.put(sessionId, value);
      }
    } catch {
      // Fall back to memory
      if (this.fallback) {
        await this.fallback.put(sessionId, value);
      }
    }
  }

  async delete(sessionId: string): Promise<void> {
    try {
      await this.kv.delete(this.key(sessionId));
    } catch {
      // Ignore KV errors
    }

    if (this.fallback) {
      await this.fallback.delete(sessionId);
    }
  }
}

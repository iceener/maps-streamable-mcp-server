/**
 * Session storage singleton for shared access.
 */

import type { SessionStore } from './interface.js';
import { MemorySessionStore } from './memory.js';

let sessionStoreInstance: SessionStore | null = null;

export function initializeStorage(sessionStore: SessionStore): void {
  sessionStoreInstance = sessionStore;
}

export function getSessionStore(): SessionStore {
  if (!sessionStoreInstance) {
    sessionStoreInstance = new MemorySessionStore();
  }
  return sessionStoreInstance;
}

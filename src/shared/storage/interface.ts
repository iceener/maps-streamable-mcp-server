/**
 * Storage interface for MCP session management.
 * Simplified for Bearer auth (no OAuth token mapping needed).
 */

export type SessionRecord = {
  created_at: number;
};

/**
 * Session storage interface for MCP session tracking.
 */
export interface SessionStore {
  ensure(sessionId: string): Promise<void>;
  get(sessionId: string): Promise<SessionRecord | null>;
  put(sessionId: string, value: SessionRecord): Promise<void>;
  delete(sessionId: string): Promise<void>;
}

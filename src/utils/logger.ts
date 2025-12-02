export type LogLevel = 'debug' | 'info' | 'warning' | 'error';

class Logger {
  private currentLevel: LogLevel = 'info';

  private readonly levels: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warning: 2,
    error: 3,
  };

  setLevel(level: string): void {
    if (this.isValidLevel(level)) {
      this.currentLevel = level as LogLevel;
    }
  }

  // Kept for API compatibility with mcp.ts
  setServer(_server: unknown): void {
    // No-op - we just log to console
  }

  private isValidLevel(level: string): level is LogLevel {
    return level in this.levels;
  }

  private shouldLog(level: LogLevel): boolean {
    return this.levels[level] >= this.levels[this.currentLevel];
  }

  private async log(level: LogLevel, logger: string, data: unknown): Promise<void> {
    if (!this.shouldLog(level)) return;

    // Log to console
    const timestamp = new Date().toISOString();
    const logData =
      typeof data === 'object' ? JSON.stringify(data, null, 2) : String(data);
    console.log(`[${timestamp}] ${level.toUpperCase()} ${logger}: ${logData}`);
  }

  async debug(logger: string, data?: unknown): Promise<void> {
    await this.log('debug', logger, data ?? {});
  }

  async info(logger: string, data?: unknown): Promise<void> {
    await this.log('info', logger, data ?? {});
  }

  async warning(logger: string, data?: unknown): Promise<void> {
    await this.log('warning', logger, data ?? {});
  }

  async error(logger: string, data?: unknown): Promise<void> {
    await this.log('error', logger, data ?? {});
  }
}

export const logger = new Logger();

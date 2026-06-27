// 日志缓冲区 - 对应 Python 版本的 logger.py

import { LogEntry } from './types';

export class LogBuffer {
  private buf: LogEntry[] = [];
  private maxSize: number;
  private onLog?: (entry: LogEntry) => void;

  constructor(size: number = 500, onLog?: (entry: LogEntry) => void) {
    this.maxSize = size;
    this.onLog = onLog;
  }

  push(level: 'INFO' | 'WARN' | 'ERROR' | 'TRADE', msg: string): void {
    const now = Date.now();
    const entry: LogEntry = {
      ts: now,
      level,
      msg,
      tstr: this.formatTime(now),
    };

    this.buf.push(entry);
    if (this.buf.length > this.maxSize) {
      this.buf.shift();
    }

    this.onLog?.(entry);
  }

  info(msg: string): void { this.push('INFO', msg); }
  warn(msg: string): void { this.push('WARN', msg); }
  error(msg: string): void { this.push('ERROR', msg); }
  trade(msg: string): void { this.push('TRADE', msg); }

  tail(n: number = 100): LogEntry[] {
    return this.buf.slice(-n);
  }

  all(): LogEntry[] {
    return [...this.buf];
  }

  clear(): void {
    this.buf = [];
  }

  private formatTime(ts: number): string {
    const d = new Date(ts);
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    const s = String(d.getSeconds()).padStart(2, '0');
    return `${h}:${m}:${s}`;
  }
}

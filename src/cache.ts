import type * as vscode from 'vscode';
import { md5 } from './util';

interface CacheEntry {
  v: string;
  at: number;
}

const STORAGE_KEY = 'translation.cache.v1';
const MAX_PERSISTED = 400;

/** 内存 + 跨会话的两级翻译缓存。 */
export class TranslationCache {
  private readonly memory = new Map<string, string>();
  private persisted: Record<string, CacheEntry>;
  private dirty = false;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly memento: vscode.Memento,
    private readonly maxEntries: number = MAX_PERSISTED
  ) {
    const raw = this.memento.get<Record<string, CacheEntry>>(STORAGE_KEY, {});
    this.persisted = raw && typeof raw === 'object' ? raw : {};
  }

  key(engine: string, from: string, to: string, text: string): string {
    return `${engine}|${from}|${to}|${md5(text)}`;
  }

  get(key: string): string | undefined {
    const hit = this.memory.get(key);
    if (hit) {
      return hit;
    }
    const stored = this.persisted[key];
    if (stored && typeof stored.v === 'string') {
      this.memory.set(key, stored.v);
      return stored.v;
    }
    return undefined;
  }

  set(key: string, value: string): void {
    this.memory.set(key, value);
    this.persisted[key] = { v: value, at: Date.now() };
    this.trim();
    this.dirty = true;
    this.scheduleFlush();
  }

  private trim(): void {
    const keys = Object.keys(this.persisted);
    const limit = Math.max(50, this.maxEntries);
    if (keys.length <= limit) {
      return;
    }
    keys
      .sort((a, b) => (this.persisted[a]?.at ?? 0) - (this.persisted[b]?.at ?? 0))
      .slice(0, keys.length - limit)
      .forEach((key) => delete this.persisted[key]);
  }

  private scheduleFlush(): void {
    if (this.timer) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, 1500);
  }

  async flush(): Promise<void> {
    if (!this.dirty) {
      return;
    }
    this.dirty = false;
    try {
      await this.memento.update(STORAGE_KEY, this.persisted);
    } catch {
      /* 忽略持久化失败 */
    }
  }

  async clear(): Promise<number> {
    const size = Object.keys(this.persisted).length + this.memory.size;
    this.memory.clear();
    this.persisted = {};
    this.dirty = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    try {
      await this.memento.update(STORAGE_KEY, {});
    } catch {
      /* ignore */
    }
    return size;
  }

  size(): number {
    return Object.keys(this.persisted).length + this.memory.size;
  }

  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    void this.flush();
  }
}

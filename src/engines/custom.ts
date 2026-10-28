import { dotGet, requestText } from '../util';
import type { Engine } from './types';

function fill(template: string, text: string, from: string, to: string): string {
  return template
    .replace(/\{\{text_json\}\}/g, JSON.stringify(text).slice(1, -1))
    .replace(/\{\{text\}\}/g, encodeURIComponent(text))
    .replace(/\{\{from\}\}/g, encodeURIComponent(from))
    .replace(/\{\{to\}\}/g, encodeURIComponent(to));
}

export const customEngine: Engine = {
  id: 'custom',
  name: '自定义接口',
  requiresKey: false,
  async translate(text: string, from: string, to: string, ctx): Promise<string> {
    const urlTemplate = ctx.getConfig('custom.url', '').trim();
    if (!urlTemplate) {
      throw new Error('未配置 translation.custom.url');
    }
    const method = ctx.getConfig('custom.method', 'POST').toUpperCase();
    const url = fill(urlTemplate, text, from, to);
    const headers = ctx.getConfig<Record<string, string>>('custom.headers', {});
    const headerEntries: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers ?? {})) {
      headerEntries[key] = fill(String(value), text, from, to);
    }
    const bodyTemplate = ctx.getConfig('custom.body', '').trim();
    const body = method === 'GET' || !bodyTemplate ? undefined : fill(bodyTemplate, text, from, to);

    const raw = await requestText(url, { method, headers: headerEntries, body, timeout: ctx.timeout });
    const path = ctx.getConfig('custom.responsePath', '').trim();
    if (!path) {
      return raw.replace(/\\n/g, '\n').replace(/\\"/g, '"').trim();
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`响应不是 JSON，无法按 responsePath 取值：${raw.slice(0, 160)}`);
    }
    const value = dotGet(parsed, path);
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`响应路径 ${path} 未取到文本`);
    }
    return value;
  }
};

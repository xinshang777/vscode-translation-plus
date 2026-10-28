import { requestJson, USER_AGENT, decodeEntities } from './util';

export interface CollinsEntry {
  pos?: string;
  definition: string;
  example?: string;
}

export interface DictEntry {
  word: string;
  phonetic?: string;
  usPhonetic?: string;
  ukPhonetic?: string;
  meanings: string[];
  phrases: string[];
  examples: Array<{ en: string; zh: string }>;
  /** 柯林斯释义（对应 YoudaoDictDocument 的 collins 块） */
  collins?: CollinsEntry[];
  /** 词形变化：过去式 / 复数 / 比较级…（对应 YoudaoDictDocument 的 wfs） */
  forms?: string[];
  /** 网络释义（web_trans） */
  webTranslations?: string[];
  /** 英英释义（ee） */
  englishDefs?: string[];
}

const cache = new Map<string, DictEntry | null>();
const MAX_ENTRIES = 300;

/** 只有单词或很短的词组才去查词典（代码标识符、长句不查）。 */
export function isLookupableWord(text: string): boolean {
  const value = text.trim();
  if (!/^[A-Za-z][A-Za-z'’\-\s]*$/.test(value)) {
    return false;
  }
  const words = value.split(/\s+/).filter(Boolean);
  return words.length >= 1 && words.length <= 3 && value.length >= 2 && value.length <= 40;
}

function plainText(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return decodeEntities(value.replace(/<[^>]*>/g, '')).trim();
}

interface YoudaoWord {
  usphone?: string;
  ukphone?: string;
  trs?: Array<{ tr?: Array<{ l?: { i?: unknown[] } }> }>;
  wfs?: Array<{ wf?: { name?: string; value?: string } }>;
}

function parseEntry(word: string, data: unknown): DictEntry | undefined {
  const root = data as {
    simple?: { word?: YoudaoWord[] };
    ec?: { word?: YoudaoWord[] };
    ee?: { word?: YoudaoWord[] };
    phrs?: { phrs?: Array<{ headword?: { l?: { i?: unknown[] } }; translation?: { tr?: Array<{ l?: { i?: unknown[] } }> } }> };
    blng_sents_part?: { 'sentence-pair'?: Array<{ sentence?: string; 'sentence-translation'?: string }> };
    web_trans?: { 'web-translation'?: Array<{ key?: string; trans?: Array<{ value?: string }> }> };
    collins?: {
      collins_entries?: Array<{
        entries?: {
          entry?: Array<{
            tran_entry?: Array<{
              pos_entry?: { pos?: string; pos_tips?: string };
              tran?: string;
              exam_sents?: { sent?: Array<{ eng_sent?: string; chn_sent?: string }> };
            }>;
          }>;
        };
      }>;
    };
  };

  const simple = root.simple?.word?.[0];
  const ec = root.ec?.word?.[0];
  const meanings: string[] = [];
  for (const trs of ec?.trs ?? []) {
    for (const item of trs.tr ?? []) {
      for (const line of item.l?.i ?? []) {
        const text = plainText(line);
        if (text) {
          meanings.push(text);
        }
      }
    }
  }

  if (meanings.length === 0 && !simple && !ec) {
    return undefined;
  }

  const usphone = simple?.usphone || ec?.usphone;
  const ukphone = simple?.ukphone || ec?.ukphone;
  const phonetic = usphone ? `美 /${usphone}/` : ukphone ? `英 /${ukphone}/` : undefined;

  const forms = (ec?.wfs ?? simple?.wfs ?? [])
    .map((item) => {
      const name = item.wf?.name?.trim();
      const value = item.wf?.value?.trim();
      return name && value ? `${name}：${value}` : '';
    })
    .filter(Boolean)
    .slice(0, 6);

  const webTranslations: string[] = [];
  for (const item of root.web_trans?.['web-translation'] ?? []) {
    const key = plainText(item.key);
    const values = (item.trans ?? []).map((trans) => plainText(trans.value)).filter(Boolean);
    if (key && values.length > 0) {
      webTranslations.push(`${key}：${values.slice(0, 2).join('；')}`);
    }
  }

  const englishDefs: string[] = [];
  for (const trs of root.ee?.word?.[0]?.trs ?? []) {
    for (const item of trs.tr ?? []) {
      for (const line of item.l?.i ?? []) {
        const text = plainText(line);
        if (text) {
          englishDefs.push(text);
        }
      }
    }
  }

  const collins: CollinsEntry[] = [];
  for (const entry of root.collins?.collins_entries?.[0]?.entries?.entry ?? []) {
    for (const tran of entry.tran_entry ?? []) {
      const definition = plainText(tran.tran);
      if (!definition) {
        continue;
      }
      const pos = tran.pos_entry?.pos?.trim();
      const sentence = tran.exam_sents?.sent?.[0];
      const example = sentence?.eng_sent
        ? `${plainText(sentence.eng_sent)}${sentence.chn_sent ? `　${plainText(sentence.chn_sent)}` : ''}`
        : undefined;
      collins.push({ pos: pos || tran.pos_entry?.pos_tips, definition, example });
    }
  }

  const phrases = (root.phrs?.phrs ?? [])
    .slice(0, 4)
    .map((item) => {
      const head = plainText(item.headword?.l?.i?.[0]);
      const mean = plainText(item.translation?.tr?.[0]?.l?.i?.[0]);
      return head && mean ? `${head} — ${mean}` : '';
    })
    .filter(Boolean);

  const examples = (root.blng_sents_part?.['sentence-pair'] ?? [])
    .slice(0, 2)
    .map((pair) => ({ en: plainText(pair.sentence), zh: plainText(pair['sentence-translation']) }))
    .filter((pair) => pair.en.length > 0);

  return {
    word,
    phonetic,
    usPhonetic: usphone ? `美 /${usphone}/` : undefined,
    ukPhonetic: ukphone ? `英 /${ukphone}/` : undefined,
    meanings: meanings.slice(0, 4),
    phrases,
    examples,
    forms,
    webTranslations: webTranslations.slice(0, 3),
    englishDefs: englishDefs.slice(0, 2),
    collins: collins.slice(0, 3)
  };
}

/** 有道词典公开接口：音标、词性释义、短语、双语例句。失败返回 undefined（不缓存失败）。 */
export async function lookupWord(word: string, timeout = 8000, force = false): Promise<DictEntry | undefined> {
  const result = await lookupWordDetailed(word, timeout, force);
  return result.entry;
}

/** 同 lookupWord，但把失败原因带出来，供自检/排查使用。 */
export async function lookupWordDetailed(
  word: string,
  timeout = 8000,
  force = false
): Promise<{ entry?: DictEntry; error?: string; cached?: boolean }> {
  const key = word.trim().toLowerCase();
  if (!force && cache.has(key)) {
    const hit = cache.get(key);
    if (hit) {
      return { entry: hit, cached: true };
    }
    // 旧版本缓存过失败结果，这里直接当作未命中重试
    cache.delete(key);
  }
  const dicts = encodeURIComponent(
    JSON.stringify({ count: 99, dicts: [['ec'], ['blng_sents_part'], ['phrs'], ['collins'], ['syno']] })
  );
  const url = `https://dict.youdao.com/jsonapi?q=${encodeURIComponent(word.trim())}&dicts=${dicts}`;

  // 先强制 IPv4（部分网络 IPv6 不通会导致 ENETUNREACH），失败再用默认策略重试
  const attempts: Array<{ label: string; family?: 4 | 6 }> = [{ label: 'IPv4', family: 4 }, { label: '默认', family: undefined }];
  const errors: string[] = [];
  for (const attempt of attempts) {
    try {
      const data = await requestJson<unknown>(url, {
        timeout,
        retries: 1,
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        family: attempt.family
      });
      const entry = parseEntry(word.trim(), data);
      if (!entry) {
        errors.push(`${attempt.label}：返回内容里没有解析出释义（可能该词未被收录）`);
        continue;
      }
      cache.set(key, entry);
      if (cache.size > MAX_ENTRIES) {
        const first = cache.keys().next().value;
        if (first !== undefined) {
          cache.delete(first);
        }
      }
      return { entry };
    } catch (error) {
      errors.push(`${attempt.label}：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  // 关键：失败不写缓存，否则一次网络抖动会让该词整个会话都“没有释义”
  return { error: errors.join(' ｜ ') };
}

export function clearDictionaryCache(): void {
  cache.clear();
}

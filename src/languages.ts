export interface LanguageDef {
  /** 扩展内部统一语言码 */
  id: string;
  /** 界面显示名 */
  label: string;
  /** 详情（英文名） */
  detail: string;
  google: string;
  bing: string;
  deepl: string;
  youdao: string;
}

export const LANGUAGES: LanguageDef[] = [
  { id: 'auto', label: '自动检测', detail: 'Auto detect', google: 'auto', bing: 'auto-detect', deepl: '', youdao: 'auto' },
  { id: 'zh-CN', label: '简体中文', detail: 'Chinese (Simplified)', google: 'zh-CN', bing: 'zh-Hans', deepl: 'ZH', youdao: 'zh-CHS' },
  { id: 'zh-TW', label: '繁體中文', detail: 'Chinese (Traditional)', google: 'zh-TW', bing: 'zh-Hant', deepl: 'ZH', youdao: 'zh-CHT' },
  { id: 'en', label: 'English', detail: 'English', google: 'en', bing: 'en', deepl: 'EN-US', youdao: 'en' },
  { id: 'en-GB', label: 'English (UK)', detail: 'English (British)', google: 'en', bing: 'en', deepl: 'EN-GB', youdao: 'en' },
  { id: 'ja', label: '日本語', detail: 'Japanese', google: 'ja', bing: 'ja', deepl: 'JA', youdao: 'ja' },
  { id: 'ko', label: '한국어', detail: 'Korean', google: 'ko', bing: 'ko', deepl: 'KO', youdao: 'ko' },
  { id: 'fr', label: 'Français', detail: 'French', google: 'fr', bing: 'fr', deepl: 'FR', youdao: 'fr' },
  { id: 'de', label: 'Deutsch', detail: 'German', google: 'de', bing: 'de', deepl: 'DE', youdao: 'de' },
  { id: 'es', label: 'Español', detail: 'Spanish', google: 'es', bing: 'es', deepl: 'ES', youdao: 'es' },
  { id: 'ru', label: 'Русский', detail: 'Russian', google: 'ru', bing: 'ru', deepl: 'RU', youdao: 'ru' },
  { id: 'pt', label: 'Português', detail: 'Portuguese', google: 'pt', bing: 'pt', deepl: 'PT-BR', youdao: 'pt' },
  { id: 'it', label: 'Italiano', detail: 'Italian', google: 'it', bing: 'it', deepl: 'IT', youdao: 'it' },
  { id: 'ar', label: 'العربية', detail: 'Arabic', google: 'ar', bing: 'ar', deepl: 'AR', youdao: 'ar' },
  { id: 'th', label: 'ไทย', detail: 'Thai', google: 'th', bing: 'th', deepl: '', youdao: 'th' },
  { id: 'vi', label: 'Tiếng Việt', detail: 'Vietnamese', google: 'vi', bing: 'vi', deepl: '', youdao: 'vi' },
  { id: 'id', label: 'Bahasa Indonesia', detail: 'Indonesian', google: 'id', bing: 'id', deepl: 'ID', youdao: 'id' },
  { id: 'hi', label: 'हिन्दी', detail: 'Hindi', google: 'hi', bing: 'hi', deepl: '', youdao: 'hi' },
  { id: 'tr', label: 'Türkçe', detail: 'Turkish', google: 'tr', bing: 'tr', deepl: 'TR', youdao: 'tr' },
  { id: 'nl', label: 'Nederlands', detail: 'Dutch', google: 'nl', bing: 'nl', deepl: 'NL', youdao: 'nl' },
  { id: 'pl', label: 'Polski', detail: 'Polish', google: 'pl', bing: 'pl', deepl: 'PL', youdao: 'pl' },
  { id: 'uk', label: 'Українська', detail: 'Ukrainian', google: 'uk', bing: 'uk', deepl: 'UK', youdao: 'uk' }
];

const BY_ID = new Map(LANGUAGES.map((lang) => [lang.id.toLowerCase(), lang]));

export function byId(id: string): LanguageDef {
  return BY_ID.get(id.trim().toLowerCase()) ?? LANGUAGES[1];
}

export function labelOf(id: string): string {
  const lang = BY_ID.get(id.trim().toLowerCase());
  return lang ? `${lang.label}` : id;
}

export type EngineId = 'google' | 'bing' | 'deepl' | 'youdao' | 'baidu' | 'aliyun' | 'openai' | 'custom';

/** 把内部语言码转换成各引擎自己的写法。 */
export function engineCode(engine: EngineId, id: string): string {
  const lang = byId(id);
  switch (engine) {
    case 'google':
      return lang.google || lang.id;
    case 'bing':
      return lang.bing || lang.id;
    case 'deepl':
      return lang.deepl || lang.id.toUpperCase();
    case 'youdao':
      return lang.youdao || lang.id;
    default:
      return lang.id;
  }
}

/** 目标语言候选（去掉 auto）。 */
export function targetLanguages(): LanguageDef[] {
  return LANGUAGES.filter((lang) => lang.id !== 'auto');
}

const ISO2: Record<string, string> = {
  'zh-cn': 'zh',
  'zh-tw': 'zh',
  en: 'en',
  'en-gb': 'en',
  ja: 'ja',
  ko: 'ko',
  fr: 'fr',
  de: 'de',
  es: 'es',
  ru: 'ru',
  pt: 'pt',
  it: 'it',
  ar: 'ar',
  th: 'th',
  vi: 'vi',
  id: 'id',
  hi: 'hi',
  tr: 'tr',
  nl: 'nl',
  pl: 'pl',
  uk: 'uk',
  auto: 'auto'
};

/** ISO-639-1 两字母语言码，给百度/腾讯/阿里/火山这类引擎用。 */
export function iso2(id: string): string {
  const key = id.trim().toLowerCase();
  return ISO2[key] ?? key.slice(0, 2);
}

/**
 * 引擎支持的目标语言（对应 Translator.supportedTargetLanguages）。
 * 只排除能确定不支持的语言，避免误伤；可通过 translation.filterLanguages 关闭。
 */
const ENGINE_SUPPORT: Partial<Record<EngineId, string[]>> = {
  deepl: LANGUAGES.filter((lang) => !['th', 'vi', 'hi'].includes(lang.id)).map((lang) => lang.id),
  baidu: LANGUAGES.filter((lang) => !['uk'].includes(lang.id)).map((lang) => lang.id),
};

export function supportedTargets(engine: EngineId, filter: boolean): LanguageDef[] {
  const all = targetLanguages();
  if (!filter) {
    return all;
  }
  const allowed = ENGINE_SUPPORT[engine];
  if (!allowed) {
    return all;
  }
  const set = new Set(allowed);
  return all.filter((lang) => set.has(lang.id));
}

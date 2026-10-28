import type { EngineId } from '../languages';
import { aliyunEngine } from './aliyun';
import { baiduEngine } from './baidu';
import { bingEngine } from './bing';
import { customEngine } from './custom';
import { deeplEngine } from './deepl';
import { googleEngine } from './google';
import { openaiEngine } from './openai';
import type { Engine } from './types';
import { youdaoEngine } from './youdao';

export const ENGINES: Record<EngineId, Engine> = {
  bing: bingEngine,
  google: googleEngine,
  baidu: baiduEngine,
  aliyun: aliyunEngine,
  deepl: deeplEngine,
  youdao: youdaoEngine,
  openai: openaiEngine,
  custom: customEngine
};

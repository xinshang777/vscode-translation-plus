import type { EngineId } from '../languages';
import { aliyunEngine } from './aliyun';
import { baiduEngine } from './baidu';
import { bingEngine } from './bing';
import { caiyunEngine } from './caiyun';
import { customEngine } from './custom';
import { deeplEngine } from './deepl';
import { googleEngine } from './google';
import { openaiEngine } from './openai';
import { tencentEngine } from './tencent';
import type { Engine } from './types';
import { volcengineEngine } from './volcengine';
import { youdaoEngine } from './youdao';

export const ENGINES: Record<EngineId, Engine> = {
  bing: bingEngine,
  google: googleEngine,
  baidu: baiduEngine,
  tencent: tencentEngine,
  aliyun: aliyunEngine,
  volcengine: volcengineEngine,
  caiyun: caiyunEngine,
  deepl: deeplEngine,
  youdao: youdaoEngine,
  openai: openaiEngine,
  custom: customEngine
};

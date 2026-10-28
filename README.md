# Translation Plus（翻译并替换）

把 IntelliJ IDEA 里那个超好用的 **Translation** 插件的体验搬到 VS Code：**选中文本 → 一键翻译 → 原地替换**，划词出卡片、带音标例句、真人发音、收藏生词，代码结构一行不乱。

## 功能清单

| 能力 | 在 VS Code 里怎么用 |
| --- | --- |
| 翻译并替换 | `Alt+C`，译文原地写回，单次 `Ctrl+Z` 撤销 |
| 划词翻译卡片 | 选中文本后鼠标悬停其上：音标 / 词性释义 / 短语 / 双语例句 / 译文 / 四个按钮 |
| 真人发音 | 点卡片「朗读」：单词走有道词典音源（真人音色），句子自动用系统 TTS |
| 生词本 | 卡片点「收藏」，命令 `Translation: 打开生词本` 查看 |
| 只翻注释、字符串 | 只替换 `//`、`/* */`、`#`、`<!-- -->` 之后的内容，JSDoc 的 `*` 对齐不变 |
| 增量翻译 | `translation.segmentMode = line`：改一行只请求这一行，其余走缓存 |
| diff 预览 | `Ctrl+Shift+Alt+X`，左右对比，点「应用并替换」才落盘 |
| 中英自动互译 | 目标语言是中文但原文是中文时，自动改译成英文（反之亦然） |
| 多光标 | 多个光标/多选区一次全部翻译替换 |
| 11 个引擎 | Bing、Google、百度、腾讯云、阿里云、火山引擎、彩云小译、DeepL、有道、OpenAI 兼容、自定义 HTTP |
| 22 种语言 | 目标语言可切换，源语言自动识别 |
| 整文件注释翻译 | 一条命令翻完整个文件的注释 |
| 代理 / 缓存 / 回退 | HTTP(S) 代理；两级缓存；主引擎失败自动回退 |

## 快捷键

| 命令 | Windows / Linux | macOS |
| --- | --- | --- |
| 翻译（只显示，可点按钮替换） | `Ctrl+Shift+Y` | `Cmd+Shift+Y` |
| 翻译并替换 | `Alt+C` | `Cmd+Shift+X` |
| 翻译并预览差异 | `Ctrl+Shift+Alt+X` | `Cmd+Shift+Alt+X` |

其余命令在命令面板搜 `Translation:`，右键菜单里也有「翻译」「翻译并替换」「预览差异」「复制译文」。

## 与 IDEA 版逐项对照

| IDEA Translation | 本插件 |
| --- | --- |
| `Ctrl+Shift+Y` 翻译 / `Alt+C` 翻译并替换 | ✅ 同键位 |
| 翻译卡片（原文 + 译文 + 引擎） | ✅ 悬停卡片 |
| 音标、词性释义、短语、双语例句 | ✅ 有道词典数据 |
| 卡片内「替换 / 复制 / 收藏 / 发音」 | ✅ 同四个按钮 |
| 发音 | ✅ 单词走词典真人音源，句子走系统 TTS（`translation.voice` 可强制指定） |
| 划词翻译 | ✅ `translation.hoverMode = selection`（默认） |
| 悬停单词查词 | ✅ `translation.hoverMode = word / all` |
| 生词本 | ✅ 收藏 + Markdown 表格查看 |
| 中英自动互译 | ✅ `translation.autoSwapDirection` |
| 翻译文档/注释 | ✅ 整文件注释翻译，JSDoc 逐行 |
| 替换前预览 | ✅ diff 预览，或 `previewBeforeReplace` 常开 |
| 增量翻译（只翻改动部分） | ✅ `translation.segmentMode = line`，按行/句缓存命中；实测「4 条注释改 1 条」只发 1 次请求 |
| 多引擎切换（状态栏） | ✅ 11 个引擎，右下角状态栏点一下切换 |
| 目标语言记忆 | ✅ 全局设置记忆 |
| 翻译缓存 | ✅ 内存 + 跨会话 |
| 代理设置 | ✅ `translation.proxy` |
| 多光标批量翻译 | ✅ 多个光标/选区一起处理 |

## 安装

```bash
code --install-extension translation-plus-1.2.0.vsix
```

或 `Ctrl+Shift+P` → `Extensions: Install from VSIX...` → 选文件 → 重载窗口。

## 快速上手

1. 选中一段文字，`Alt+C`，译文原地替换；`Ctrl+Z` 撤销。
2. 选中后把鼠标停在选区上，出词典卡片；点「收藏」进生词本，点「朗读」听真人发音。
3. 右下角状态栏显示当前引擎与目标语言，点一下切换。

## 引擎配置

统一入口：命令 `Translation: 设置引擎 API Key` —— 选引擎，依次填该引擎需要的凭据（存进 VSCode 安全存储），填完自动切到该引擎。

| 引擎 | 需要什么 | 说明 |
| --- | --- | --- |
| Bing | 无需配置 | 默认；国内线路不稳时把 `translation.bing.endpoint` 改成 `cn.bing.com` |
| Google | 无需配置 | 免费接口，部分 IP 会 429，失败自动回退 |
| 百度翻译 | APP ID + 密钥 | 通用文本翻译 API，签名 `md5(appid+q+salt+密钥)` |
| 腾讯云翻译 | SecretId + SecretKey | `TextTranslate`，TC3-HMAC-SHA256 签名 |
| 阿里云翻译 | AccessKeyId + AccessKeySecret | `TranslateGeneral`，RPC 风格 HMAC-SHA1 签名 |
| 火山引擎 | AK + SK | `TranslateText`，V4 HMAC-SHA256 签名 |
| 彩云小译 | token | `v1/translator`，`trans_type` 方向对 |
| DeepL | API Key | 免费版 `api-free.deepl.com`，付费版改 `translation.deepl.endpoint` |
| 有道智云 | appKey + appSecret | 文本翻译 API，v3 签名 |
| OpenAI 兼容 | API Key + base url + 模型 | OpenAI / DeepSeek / Ollama / vLLM 都行，可自定义提示词 |
| 自定义 HTTP | URL / 方法 / 头 / body / responsePath | 模板化接任意接口 |

OpenAI 兼容接口举例：DeepSeek 用 `https://api.deepseek.com/v1` + `deepseek-chat`；本地 Ollama 用 `http://127.0.0.1:11434/v1` + `qwen2.5:7b`（Key 随便填）。提示词改 `translation.openai.systemPrompt`，支持 `{{to}}`、`{{from}}`。

自定义 HTTP 模板占位符：`{{text}}`（URL 编码）、`{{text_json}}`（JSON 转义）、`{{from}}`、`{{to}}`。

## 常用设置

| 设置项 | 默认 | 作用 |
| --- | --- | --- |
| `translation.engine` | `bing` | 引擎 |
| `translation.targetLanguage` | `zh-CN` | 默认目标语言 |
| `translation.sourceLanguage` | `auto` | 源语言 |
| `translation.codeScope` | `selection` | `selection` 整段翻；`comments` 只翻注释；`commentsAndStrings` 注释+字符串 |
| `translation.hoverMode` | `selection` | `off` / `selection` 划词 / `word` 单词卡片 / `all` |
| `translation.dictionaryEnabled` | `true` | 卡片带词典释义与例句 |
| `translation.voice` | `dictionary` | `dictionary` 真人音源优先，`system` 强制系统 TTS |
| `translation.segmentMode` | `line` | `whole` 整段 / `line` 逐行 / `sentence` 逐句（决定增量粒度） |
| `translation.autoSwapDirection` | `true` | 中英自动互译 |
| `translation.smartStringFilter` | `true` | 跳过 import 路径、URL 这类字符串 |
| `translation.previewBeforeReplace` | `false` | 替换前给 diff 预览 |
| `translation.preserveIndent` | `true` | 多行翻译对齐缩进 |
| `translation.proxy` | 空 | HTTP(S) 代理，如 `http://127.0.0.1:7890` |
| `translation.cacheEnabled` | `true` | 结果缓存 |
| `translation.fallbackEnabled` | `true` | 失败自动回退 |
| `translation.timeout` | `20000` | 单请求超时（毫秒） |

## 常见问题

**Q：想一次性确认功能是否正常？**
命令 `Translation: 自检（引擎/词典/发音/切片/缓存一次跑完）`，输出面板会给出 6 项 ✅/❌ 报告。

**Q：提示 `HTTP 429`？**
免费接口被限流。换引擎、等一会儿，或设 `translation.proxy` 走代理。

**Q：为什么句子读的是系统合成音？**
有道 dictvoice 是**词典词条音源**，只覆盖词库里的词，句子会返回 500，所以句子自动切系统 TTS。想全部用系统语音：`translation.voice = system`。

**Q：增量翻译怎么验证？**
输出面板选 `Translation Plus`，每次翻译都有一行 `[incremental] line 模式：4 段，缓存命中 3 段，实际请求 1 段`。

**Q：怕把代码改坏？**
`translation.codeScope` 改 `comments` 只动注释；或开 `previewBeforeReplace` 先看 diff。

**Q：悬停没反应？**
默认只在选中文本后悬停选区时出卡片。想悬停任意单词：`translation.hoverMode = word`。

## 开发

```bash
npm install
npm run compile
npx vsce package --no-dependencies --allow-missing-repository
node test/e2e-mock.js       # 翻译替换 + 悬停卡片 + 增量缓存（走真实引擎）
node test/engines-check.js  # 引擎注册/凭据校验/签名字符串
```

按 `F5` 启动扩展开发宿主调试。

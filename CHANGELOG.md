## 2.3.0（对齐 IDEA：删掉自己加的东西）

- 删除替换预览文档（replace.md）与 diff 预览及其设置 `previewBeforeReplace`
- 删除命令：复制译文（独立动作）、整文件注释翻译、清空缓存、测试引擎、检测全部引擎、自检
- 删除编辑区侧栏卡片（CardPanel），只保留侧边栏 Webview 卡片
- 引擎收敛为 IDEA 的 7 家 + 自定义：移除腾讯云 / 火山引擎 / 彩云小译
- 命令注册改为「只注册 package.json 声明过的动作」，未声明的实现不会再被激活

# Changelog

## 2.3.0

- **移除侧栏「翻译卡片」视图**（`translationPlus.card` WebviewView）、活动栏容器 Translation Plus，以及 `CardViewProvider` / `cardHtml` / `cardPanel` 与 `translation.toggleCardPanel` 命令。悬停卡片、`全部释义`、`钉住`、`替换/复制/朗读/收藏` 全部保留，翻译主流程不受影响。
- 原因：侧栏常驻卡片与悬停卡片信息重复，实际使用中基本看悬停卡片。

## 1.7.0（B 类可替代项）

- **B1 悬停注入文档译文**：`HoverProvider` 内调用 `vscode.executeHoverProvider` 取语言服务文档 → 翻译后追加「文档译文」段落，带 `[看原文]` / `[看译文]` 切换（命令 `translation.toggleDocumentation`）。`docHoverState.busy` 防递归，文档译文 120 条缓存。
- **B2 注释行尾 InlayHint 译文**：`InlayHintsProvider` 只对已缓存注释返回 hint，未翻译的进后台队列，翻完触发 `onDidChangeInlayHints` 刷新；tooltip 内带「复制译文 / 朗读原文」链接。开关 `translation.inlayHints`（默认关）+ 命令 `translation.toggleInlayHints`。
- 新增 `translation.hoverDocumentation`（默认开）。

## 1.6.0（默认行为回归插件）

- `segmentMode` 默认 `whole`、`autoSwapDirection` 默认 `false`、`fallbackEnabled` 默认 `false`
- 补 `Translate(Inclusive)` / `Translate(Exclusive)`
- 补 `replacementLanguageSelection`（替换前选语言）
- `切换翻译引擎` 同时询问 TTS 引擎（对齐 Switch Engine）

## 1.5.1

- A 区补齐：每日一词（生词本随机抽）、Edge 语音列表（322 个）、播放状态、引擎级语言过滤、速率限制、多义项展开、英/美音、钉住卡片、历史面板、设置直达、替换后高亮

## 1.5.0

- Edge / Google / OpenAI 三神经语音引擎（含 `ws` 依赖与 DRM 令牌）
- 词典补 `wfs` / `web_trans` / `ee`；缓存容量可配

## 1.3.1

- 逐行移植 `CamelCaseSplitter.split()`、`NON_LATIN_CONDITION`、`SelectionMode`
- 替换候选按源码顺序：camel → Pascal → 分隔符 → 原文

## 1.3.0

- 读 `ReplaceWithTranslationAction.kt` 后重写替换：`splitCamelCaseWords`、`createReplaceElements`、`fixWhitespace`、`sanitizeJavaIdentifierStart`、`autoReplace`
- 新增 `Show Translation Dialog` / `Translate Quick Documentation` / `Switch Engine` 及 macOS 键位

## 1.2.x

- 真人发音（有道 dictvoice）+ 系统 TTS 兜底
- 增量翻译 `segmentMode`（行/句切片 + 片段缓存）
- 引擎扩到 11 个（百度、腾讯云、阿里云、火山、彩云）
- 自检命令；修复增量丢换行、Bing 302 跨域令牌等 6 个问题

## 1.1.0

- 划词/悬停卡片、词典释义、生词本、中英互译、多光标、代理

## 1.0.0

- 首个版本：翻译 / 翻译并替换 / diff 预览 / 注释与字符串识别 / 6 引擎

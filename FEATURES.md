# Translation Plus 功能总览（v1.2.2）

> 移植 IntelliJ IDEA Translation 插件。20 个命令、42 项设置、11 个引擎、22 种语言。

## 一、翻译动作（6）

| 命令 | 快捷键 | 说明 |
| --- | --- | --- |
| 翻译 | `Ctrl+Shift+Y` | 只显示译文，通知条带「替换 / 复制 / 朗读 / 打开日志」 |
| 翻译并替换 | `Ctrl+Shift+X` | 译文原地写回，单次 `Ctrl+Z` 撤销 |
| 选择目标语言后翻译并替换 | — | 临时选语言，不改默认设置 |
| 翻译并预览差异 | `Ctrl+Shift+Alt+X` | 左右 diff，点「应用并替换」才落盘 |
| 翻译并复制到剪贴板 | — | 不动文件，只进剪贴板 |
| 翻译当前文件中的所有注释 | 编辑器标题右键 | 整文件注释一次翻完 |

## 二、划词 / 悬停卡片（4 个卡片按钮 = 4 个命令）

- 触发方式：`translation.hoverMode` = `off` / `selection`（划词）/ `word`（单词）/ `all`
- 卡片内容：原文 + 音标 + 词性释义 + 短语 + 双语例句 + 译文 + 引擎 + 目标语言
- 卡片按钮：
  - 替换 → `translation.replaceLast`（会先校验原文是否已变）
  - 复制 → `translation.copyLast`
  - 朗读 → `translation.speakLast`
  - 收藏 → `translation.addLastToVocabulary`

## 三、词典与发音

- 词典数据：有道 `dict.youdao.com` —— 美/英音标、词性释义（v./n./adj.…）、短语、双语例句；带 LRU 缓存（300 条）
- 发音 `translation.voice`：
  - `dictionary`（默认）：有道 dictvoice 真人音源，单词级（英文单词 / ≤12 字中文词）
  - `system`：系统 TTS（Windows System.Speech / macOS `say` / Linux `spd-say`、`espeak-ng`）
  - 词库里没有的词、长句自动退回系统发音
- 命令：`朗读选中文本`、`停止朗读`

## 四、生词本（3）

| 命令 | 说明 |
| --- | --- |
| 收藏悬停卡片里的单词到生词本 | 去重；存 globalState（上限 500 条） |
| 打开生词本 | 只读虚拟文档，Markdown 表格：单词 / 译文 / 语言 / 引擎 / 收藏时间 |
| 清空生词本 | — |

## 五、代码安全

| 能力 | 说明 |
| --- | --- |
| `translation.codeScope` | `selection` 整段翻 / `comments` 只翻注释 / `commentsAndStrings` 注释+字符串 |
| 注释语法识别 | `//`、`/* */`、`#`、`--`、`<!-- -->`、`'`（VB/asm） |
| JSDoc 逐行 | `*` 前缀的行单独翻译，只替换 `*` 之后内容，对齐不破 |
| 智能字符串过滤 | `translation.smartStringFilter`：跳过 import 路径、URL、`user_id` 这类无空格标识符 |
| 缩进保留 | `translation.preserveIndent`：多行译文按原行缩进对齐 |
| 多光标 | 多光标/多选区各自翻译，重叠区间自动去重 |

## 六、增量与缓存

| 能力 | 说明 |
| --- | --- |
| `translation.segmentMode` | `whole` 整段 / `line` 逐行（默认）/ `sentence` 逐句 |
| 片段级缓存 | 只请求变化的行/句；日志输出 `[incremental] … 缓存命中 N 段` |
| 整句缓存 | 同一段文本第二次直接命中，0 请求 |
| 持久化 | 缓存写入 globalState（400 条 LRU），跨会话保留 |
| 并发去重 | 同一文本并发请求合并为一次 |
| 手动清理 | `清空翻译缓存` |

## 七、引擎（11）

| 引擎 | 凭据 | 签名 |
| --- | --- | --- |
| Bing（默认） | 免配置 | token 抓取 + `params_AbusePreventionHelper` |
| Google | 免配置 | 免费 `translate_a/single` |
| 百度翻译 | APP ID + 密钥 | `md5(appid+q+salt+key)` |
| 腾讯云翻译 | SecretId + SecretKey | TC3-HMAC-SHA256 |
| 阿里云翻译 | AccessKeyId + AccessKeySecret | RPC HMAC-SHA1 |
| 火山引擎 | AK + SK | V4 HMAC-SHA256 派生链 |
| 彩云小译 | token | `x-authorization: token …` |
| DeepL | API Key | `DeepL-Auth-Key` |
| 有道智云 | appKey + appSecret | v3 `sha256(...)` |
| OpenAI 兼容 | Key + base url + 模型 | Bearer；支持自定义提示词 `{{to}}` / `{{from}}` |
| 自定义 HTTP | URL / 方法 / 头 / body / responsePath | 模板 `{{text}}`、`{{text_json}}`、`{{from}}`、`{{to}}` |

凭据全部存 VSCode **SecretStorage**（不写 settings.json）；`设置引擎 API Key` 会按引擎依次追问所需字段，填完自动切换。

## 八、语言（22）

`auto` 自动检测 + 目标语言：简体中文、繁體中文、English、English (UK)、日本語、한국어、Français、Deutsch、Español、Русский、Português、Italiano、العربية、ไทย、Tiếng Việt、Bahasa Indonesia、हिन्दी、Türkçe、Nederlands、Polski、Українська。
附带「中英自动互译」：目标中文但原文是中文时自动改译英文（可关）。

## 九、网络层

| 能力 | 说明 |
| --- | --- |
| 代理 | `translation.proxy`，HTTP(S) CONNECT 隧道，Google/DeepL/词典都走代理 |
| 重定向跟随 | 最多 3 跳，GET/HEAD 全跟，307/308 跟 POST（Bing 跳 `cn.bing.com` 也能用） |
| 重试 | 指数退避（400ms→800ms），4xx 不重试、429 重试 |
| 超时 | `translation.timeout`（默认 20s） |
| 失败回退 | `translation.fallbackEnabled`：主引擎失败自动试另一个免配置引擎，日志留 `[fallback]` |
| 长文本切分 | 按段落/句子边界切 3000–6000 字符，分批请求后拼回 |

## 十、可观测与辅助

- 状态栏：`🌐 引擎 → 目标语言`，点击切换引擎；悬浮显示完整配置
- 输出面板 `Translation Plus`：每次请求的引擎、方向、字符数、耗时；错误、`[incremental]`、`[fallback]`、`[cache]` 都在这里
- 自检命令：引擎连通 / 词典 / 发音 / 注释识别 / 增量切片 / 缓存 六项一次跑完
- 连通性测试：单句翻译 + 耗时，失败弹原始错误码

## 十一、设置项（42）

**行为**：`engine`、`targetLanguage`、`sourceLanguage`、`codeScope`、`smartStringFilter`、`previewBeforeReplace`、`preserveIndent`、`autoSwapDirection`、`hoverMode`、`dictionaryEnabled`、`voice`、`segmentMode`

**网络**：`proxy`、`timeout`、`cacheEnabled`、`fallbackEnabled`

**地址**：`google.endpoint`、`bing.endpoint`、`deepl.endpoint`、`openai.endpoint`、`openai.model`、`openai.systemPrompt`

**凭据**：`deepl.apiKey`、`youdao.appKey/appSecret`、`baidu.appId/appKey`、`tencent.secretId/secretKey/region`、`aliyun.accessKeyId/accessKeySecret/region`、`volcengine.accessKeyId/secretKey`、`caiyun.token`、`openai.apiKey`

**自定义接口**：`custom.url`、`custom.method`、`custom.headers`、`custom.body`、`custom.responsePath`

## 十二、已知边界

1. 增量是**行/句级**，不是 IDEA 那种 token/字符级 diff。
2. 5 家国内引擎的签名按文档实现，但**尚未获得真机 200**（缺 Key）。
3. 词典数据依赖有道公开接口；接口变动会导致释义缺失（译文不受影响）。
4. 真人音源只覆盖词典词条；句子走系统语音。
5. 卡片是 VSCode 悬停样式，不是 IDEA 那种浮动窗。

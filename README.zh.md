# dsh-fixes

DeepSeek Harness 的 web profile 插件：补第三方网关缺的能力，并在输入框旁提供上下文控制。

装在 **web profile** 上，改的是宿主进程配置，因此该 profile 下**所有会话**都会生效，不只是安装时的那一次对话。

- [English](./README.md)

## 能做什么

| 功能 | 说明 |
| --- | --- |
| 读图 | 第三方 `llm-pi-ai` 供应商没声明 image 时，补上 `text` + `image` |
| 窗口数字 | 已知模型写入官方 `contextWindow` / `maxTokens`；其它未声明的补 `500000`，已有数字不改 |
| 免费搜索 | `web_search` 走 DuckDuckGo（失败回落必应网页），不再需要 DeepSeek key |
| 上下文芯片 | 在官方模型选择器左侧调节窗口、摘要模型、自动压缩，并一键压缩当前会话 |

卸载插件**不会**回滚已经写入 `llm-pi-ai` 的配置。

## 安装

在本目录：

```sh
npm install
npm run build
dsh plugin --profile web add .
```

首次安装后重启 `dsh web`。以后改源码：`npm run build`，再重启或让 profile 重新加载。

开发：

```sh
npm test
npm run typecheck
```

仓库：https://github.com/Meteor-system/dsh-fixes

## 上下文芯片

芯片在输入框工具行**右侧**，紧挨官方模型选择器。只显示窗口数字（如 `200k`），悬停才是「上下文 200k」，避免把超长模型名挤到第二行。官方模型 / 思考强度弹层不变。

打开后，从上到下：

1. **上下文** — `100k` / `200k` / `500k` / `1M`。默认写给**当前对话模型、全局生效**（会镜像进 `llm-pi-ai`）。勾 **仅当前会话** 则只覆盖这一次对话，不改目录。选 `1M` 会提示：部分模型在该长度上会额外计费（没有按模型查价）。
2. **压缩模型** — 从已配置的 `llm-pi-ai` 模型里选一个，按供应商分组。空 = 用当前对话模型。摘要发给这个更便宜的模型。
3. **自动压缩** — 全局开关，可勾 **仅当前会话** 覆盖。滑块是窗口的 20%–90%，默认 40%。关掉后滑块变灰。isolate 引擎自己的 80% pressure 会被拦住，由这个滑块说了算；提供方报超窗时仍会压缩，以免卡死。
4. **预览** — 「将压缩 N 条较早消息」。点开看将被摘要替换的较早消息标题/摘录。读不到会话快照时显示「暂不可预览」。
5. **压缩上下文** — 只压**当前会话**。亮蓝底，按下变暗。忙碌或压缩中会变暗并显示「压缩中…」。

改窗口**不会缩短**已经超长的历史。旧会话爆仓后要先点压缩。

## 其它修复

**读图。** 自定义 OpenAI 兼容网关经常把模型写成 `input: []`。Harness 回落到 `defaultInput: [text]`，于是：

```
cannot read "...png" as an image: model "grok-4.6" does not declare image input
```

本插件监视 `llm-pi-ai`，对每一个第三方供应商：缺 image 时把 `defaultInput` 补成 `[text, image]`，并给尚未声明 image 的 `models` / `modelOverrides` 写上 `input: [text, image]`。

**窗口。** 例如 grok-4.6 补官方 50 万。从未在上下文面板改过的模型，仍保留原来的目录数字（如 Kimi 的 128k / 256k / 1M）。

**搜索。** 先走 DuckDuckGo HTML 结果页；连不上或被 challenge 时回落必应网页搜索。没有官方搜索 API。`web_fetch` 仍走原来的 `http` 提供方。

## 设置

插件自有命名空间 `dsh-fixes`，不要和 compaction-basic 的 YAML 混在一起：

```yaml
dsh-fixes:
  contextWindows:
    routincodex/grok-4.6: 500000
  summarization:
    provider: routincodex
    model: gpt-5.4-mini
  thresholdRatio: 0.4
  autoCompactEnabled: true
  sessionOverrides:
    <session-id>:
      window: 100000
      autoCompactEnabled: false
```

| 字段 | 含义 |
| --- | --- |
| `contextWindows` | `供应商/模型` → 100000 / 200000 / 500000 / 1000000 |
| `summarization` | 全局摘要模型；缺省 = 当前对话模型 |
| `thresholdRatio` | 自动压缩比例，0.20–0.90，缺省 0.40 |
| `autoCompactEnabled` | 全局自动压缩，缺省 `true` |
| `sessionOverrides` | 按会话覆盖窗口和/或自动压缩 |

改全局窗口时，会把同一个数字写进对应的 `llm-pi-ai` 模型条目。会话覆盖不会。

## 限制

- 面板不探测网关真实上限。选的窗口比网关大，仍可能超窗。
- 「仅当前会话」的窗口只影响本插件的自动压缩阈值。官方 token 条仍跟目录 / 全局窗口。
- 摘要模型缺凭证时，压缩失败、历史不变，面板显示宿主错误。
- Agent 正在跑或压缩锁占用时，手动压缩不可用。
- 1M 计费提示是通用提醒，没有按模型价目。

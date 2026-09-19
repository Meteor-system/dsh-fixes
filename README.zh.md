# dsh-fixes

DeepSeek Harness 的宿主侧兼容修复插件。

插件装在 **web profile** 上，写入的是宿主进程的 `llm-pi-ai` 配置，因此该
profile 下的 **所有会话** 都会用到同一套模型能力，不只是安装时的那一次对话。

自定义 OpenAI 兼容网关经常把模型写成 `input: []`。Harness 随后回落到
`defaultInput: [text]`，于是 `read_image` 会拒绝读图：

```
cannot read "...png" as an image: model "grok-4.6" does not declare image input
```

本插件监视 `llm-pi-ai` 配置，对 **每一个第三方供应商**：

- 缺 image 时把 `defaultInput` 补成 `[text, image]`
- 给所有尚未声明 image 的 `models` / `modelOverrides` 条目写上
  `input: [text, image]`

卸载插件不会回滚已经写入的配置。

## 安装

在本目录执行：

```sh
dsh plugin --profile web add .
```

首次安装后重启 `dsh web`。以后改源码需要先 `npm run build`，再让 profile 重新加载。

## 修复

| 范围 | 行为 |
| --- | --- |
| 全部 `llm-pi-ai` 供应商 | 当网关未声明或只声明了 text 时，补上 text + image |
| 已知多模态模型（如 grok-4.6） | 补上官方 `contextWindow` / `maxTokens`（grok-4.6 为 50 万） |
| 其它未声明窗口的第三方模型 | 一律补 `500000`；已有数字（如 Kimi 自己的 128k/256k/1M）不改 |
| `web_search` | 注册免费搜索后端，并把 `searchProvider` 从 `deepseek-official` 切到 `duckduckgo`，不再需要 DeepSeek key |
| 自动压缩 | 由上下文芯片的滑块控制（20%–90%，默认 40%）；不改官方 Agent preset |
| `/compact` 摘要请求 | 去掉图片、截断过长工具结果，避免爆掉的旧会话因为摘要调用再次超窗而失败 |

先走 DuckDuckGo HTML 结果页；连不上或被 challenge 时自动回落到必应网页搜索。没有官方搜索 API。`web_fetch` 仍走原来的 `http` 提供方。

## 上下文控制

输入框旁有一个 **上下文** 芯片，紧挨官方模型芯片的左侧。官方模型 / 思考强度弹层保持不变。

打开芯片可以：

- 为 **当前对话模型（全局）** 设定工作窗口：`100k` / `200k` / `500k` / `1M`。勾上 **仅当前会话** 则只覆盖这一次对话（不写进 `llm-pi-ai`）。选 `1M` 时会提示：部分模型在该长度上会额外计费。
- 选择一个 **全局摘要模型**（「压缩模型」），来自已在 `llm-pi-ai` 里的模型。空表示「用当前对话模型」。压缩摘要会发给这个更便宜的模型，而不是对话模型。
- **自动压缩** 可全局开关，也可仅当前会话覆盖；滑块仍是窗口的 20%–90%（默认 40%）。isolate 引擎自己的 80% pressure 会被拦住，由这个滑块说了算。提供方报超窗时仍会压缩，以免卡死。
- 压缩按钮上方有一行「将压缩 N 条较早消息」，点开可看标题/摘录。压缩仍是一键。
- 点 **压缩上下文** 只压缩 **当前会话**。Agent 正在运行或压缩锁占用时按钮不可用。

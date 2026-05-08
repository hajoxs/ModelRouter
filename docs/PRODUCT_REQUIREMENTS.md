# Copilot Model Switcher 混合路由插件需求文档

版本：v0.1  
日期：2026-05-07  
状态：需求草案，可进入技术评审

## 1. 项目概述

### 1.1 项目定位

Copilot Model Switcher 是一款 VS Code 扩展，面向已经订阅 GitHub Copilot Pro/Pro+ 且同时拥有第三方模型 API Key 的开发者。插件通过“控制层 + 审查层 + 执行层”的混合模型路由，把 Copilot 可用的高能力模型，或用户自定义的第三方高能力模型，作为低 token 的“大脑/裁判”，只负责告诉廉价模型该看哪些文件、该调用哪些受控工具、如何判断结果是否满足要求，并对廉价模型读取到的上下文报告做一次诊断；把 DeepSeek、Moonshot/Kimi 等高性价比模型作为“双手”，负责高 token 消耗的上下文综合、工具结果整理、调试证据归纳、代码生成、长文本输出、常规补全与批量改写；再使用一个可配置的中间审查模型检查廉价模型最终输出是否符合贵模型要求。

核心目标不是替代 Copilot，而是在合规前提下扩展开发者的模型调度能力，使用户在复杂任务中保留顶级模型的理解质量，同时显著降低长输出阶段的 API 成本。

### 1.2 核心价值

- 额度优化：Copilot 顶级模型只承担轻量但高价值的控制、读取结果诊断和最终判断，不读取大段代码，不生成长文本。
- 成本控制：代码生成、文档生成、多文件改写等输出密集型工作交由用户自购的低价第三方模型完成。
- 成功率提升：用高能力模型生成清晰、可校验的控制指令和验收标准，降低廉价模型对模糊需求的理解压力。
- 自动调试闭环：廉价模型负责调用受控工具、整理日志和输出调试证据，贵模型只负责理解调试目标、诊断廉价模型读取结果并进行收尾终检。
- 本地隐私：路由、上下文拼接、密钥管理和请求发送均在用户本地 VS Code 扩展进程内完成。
- 可扩展：通过协议适配层支持 OpenAI-compatible、Anthropic-compatible 与厂商原生协议。

### 1.3 成功标准

- MVP 能完成“用户请求 -> Copilot 低 token 控制 -> 第三方模型读取上下文 -> Copilot 低 token 诊断读取结果 -> 第三方模型执行 -> Copilot 低 token 终检 -> 结果展示”的闭环。
- 第三方 API Key 全部通过 VS Code SecretStorage 存储，插件不向自有服务器上传密钥或代码。
- 用户可在 VS Code 内即时切换 Copilot 贵模型、第三方贵模型、执行模型、中间审查模型和路由策略，无需重启。
- 配置默认按工作区隔离保存，不同 VS Code 窗口不会互相覆盖路由模式。
- Token 统计会自动记录并恢复最近一次工作区结果，用户无需重复手动触发统计命令。
- 常见代码生成任务的第三方执行成本相较全程高价模型降低 90% 以上。
- 对失败任务提供重试、升级模型或回退到 Copilot 原生模型的清晰路径。

## 2. 范围与边界

### 2.1 MVP 范围

- 注册一个插件自有 Chat Participant 或命令入口，例如 `@model-router`。
- 读取 VS Code 官方 Language Model API 暴露的可用模型列表。
- 选择 Copilot 可用模型或第三方 provider/model 作为规划模型。
- 管理 DeepSeek、Moonshot/Kimi 等第三方平台的 API Key 与模型配置。
- 支持一个中间审查模型，例如 DeepSeek V4-Pro，用于审查廉价模型输出与贵模型要求的一致性。
- 将用户请求结构化为 JSON 任务书。
- 将任务书与当前文件上下文发送给第三方模型执行。
- 支持“贵模型控制器 -> 廉价模型工具/文件分析 -> 贵模型读取结果诊断 -> 廉价模型最终执行 -> 贵模型终检”的严格性价比模式。
- 支持自动调试流程：廉价模型整理诊断、日志、工具输出和候选原因，贵模型只理解调试目标、诊断读取报告并做终检。
- 在聊天流或 Webview 中展示阶段状态、输出结果和基础 token 统计。
- 支持失败后自动重试一次，并可按策略升级执行模型。

### 2.2 非 MVP 范围

- 不逆向 GitHub Copilot 私有接口。
- 不修改、代理或劫持 GitHub Copilot 扩展内部网络请求。
- 不承诺直接拦截用户在 GitHub Copilot Chat 官方界面中的所有原始提问。
- 不提供云端中转服务。
- 不自动提交代码、不自动执行危险命令、不绕过 VS Code 权限提示。

### 2.3 合规实现说明

VS Code 扩展可以通过官方 API 注册自有 Chat Participant，并通过 `vscode.lm.selectChatModels` 查询可用语言模型，再使用所选模型完成规划阶段调用。第三方模型调用由插件自身通过用户配置的 API Key 发起。

“拦截 Copilot Chat 原始提问”在 VS Code 官方稳定 API 下不是可靠能力，且可能触及平台条款和扩展隔离边界。因此 MVP 应采用自有聊天入口、编辑器命令、右键菜单和状态栏入口实现混合路由体验。若未来官方开放可组合 Chat Middleware 或请求路由扩展点，再评估接入。

## 3. 用户画像与典型场景

### 3.1 目标用户

- 已购买 Copilot Pro/Pro+，希望延长高能力模型额度的个人开发者。
- 经常生成长代码、测试、文档、迁移脚本的工程师。
- 需要在多模型之间平衡质量、速度与成本的高级用户。
- 对代码隐私敏感，不希望使用第三方代理服务的团队或个人。

### 3.2 典型使用场景

| 场景 | 用户诉求 | 推荐路由 |
| --- | --- | --- |
| 高频代码生成 | 快速生成常规函数、组件、测试样例 | Copilot 顶级模型规划 + DeepSeek V4-Flash 执行 |
| 复杂逻辑实现 | 需要较强推理与较长代码输出 | Copilot 顶级模型规划 + DeepSeek V4-Pro 执行 |
| 多文件上下文分析 | 需要处理长上下文、跨文件约束 | Copilot 顶级模型规划 + Kimi K2.6 执行 |
| 失败修复 | 廉价模型输出运行失败或不符合约束 | 自动重试，升级 V4-Pro，必要时回退 Copilot |
| 自动调试 | 需要查看诊断、日志和工具结果 | 廉价模型整理证据 + Copilot 顶级模型诊断读取结果并终检 |
| 长文档生成 | 输出 README、设计文档、迁移说明 | Copilot 规划结构 + 低价模型长文本输出 |

## 4. 模型架构与分工

### 4.1 双层模型架构

| 角色 | 推荐模型（2026-05 主流假设） | 核心职责 | 消耗来源 | 成本优势 |
| --- | --- | --- | --- | --- |
| 大脑/裁判：控制层 | GPT-5.5、Claude Opus 4.7、Copilot 可用顶级模型或用户自定义第三方高能力模型 | 意图识别、选择文件/工具、下发短指令、诊断廉价模型读取结果、判断最终结果是否达标 | GitHub Copilot 订阅额度或用户自购第三方 API | 只处理极简环境提示、读取报告摘要和 JSON，最大化减少贵模型输入输出 |
| 中间审查：一致性检查层 | DeepSeek V4-Pro 或类似中档高能力模型 | 检查廉价模型最终输出是否满足贵模型的验收标准和约束 | 用户自购第三方 API 余额 | 用比顶级贵模型更低的成本提前拦截明显不达标结果 |
| 双手：执行层 | DeepSeek V4-Flash、DeepSeek V4-Pro、Kimi K2.6 | 读取上下文、整理工具结果、生成代码、调试分析、长文本、测试、重构建议和常规补全 | 用户自购第三方 API 余额 | 输出密集阶段成本显著降低 |

### 4.2 执行模型细分策略

| 任务场景 | 推荐执行模型 | 核心优势 | 成本参考 |
| --- | --- | --- | --- |
| 高频代码生成 | DeepSeek V4-Flash | 速度快，单位输出成本低，适合重复性任务 | 输入约 0.02 元/百万 token，输出约 2 元/百万 token，具体以厂商实时价格为准 |
| 复杂逻辑或长代码 | DeepSeek V4-Pro | 推理能力更强，适合中等复杂实现 | 以厂商实时优惠和价格页为准 |
| 超长上下文处理 | Kimi K2.6 | 支持约 262K 级上下文，适合多文件关联分析 | 以 Moonshot/Kimi 实时价格页为准 |

### 4.3 默认路由策略

| 策略 | 触发条件 | 规划模型 | 执行模型 | 失败升级 |
| --- | --- | --- | --- | --- |
| Fast | 小型代码生成、解释、样板代码 | 用户选择的 Copilot 模型 | DeepSeek V4-Flash | Flash 重试一次后升级 Pro |
| Balanced | 默认策略，适合多数开发任务 | 用户选择的 Copilot 模型 | DeepSeek V4-Pro 或 Flash 自动判定 | Pro 重试后提示回退 Copilot |
| Long Context | 多文件、长文档、大量上下文 | 用户选择的 Copilot 模型 | Kimi K2.6 | 缩减上下文后重试 |
| Copilot Fallback | 高风险修复、失败恢复、用户手动选择 | Copilot 可用模型 | Copilot 可用模型 | 停止自动升级，提示用户确认 |

### 4.4 低贵模型预算控制原则

贵模型必须默认遵守以下约束：

- 控制阶段只接收极简环境提示，不接收完整文件内容、文件清单、选区预览、诊断摘要、搜索结果或终端输出。
- 如果理解需求时需要文件、诊断、搜索或命令结果，贵模型只能把这些需求写入廉价模型的文件/工具计划。
- 允许贵模型对廉价模型读取和整理后的上下文报告做一次诊断，用于补充执行约束和缺失上下文提示。
- 不直接生成业务代码、长文档、完整补丁或长解释。
- 输出必须是短 JSON，包括工具/文件选择、worker 指令、验收条件、判断结果和下一步指令。
- 每轮贵模型输出应控制在 300-1200 字符内，作为可配置预算。
- 调试循环中，贵模型只做“告诉、诊断和判断”：告诉廉价模型下一步看什么、做什么；诊断廉价模型读取报告是否足够；最终判断廉价模型提交的证据和产物是否满足用户目标。

自动调试循环的目标流程：

```text
用户描述问题
  -> 贵模型控制器读取极简环境提示，选择交给廉价模型的文件/工具计划和验收标准
  -> 廉价模型读取上下文、调用受控工具、整理日志/诊断/候选根因
  -> 贵模型诊断廉价模型读取报告，补充缺失上下文和执行约束
  -> 廉价模型执行调试分析、修复建议或代码生成
  -> 贵模型裁判读取压缩调试报告，做一次终检
```

## 5. 功能需求

### 5.1 混合模型配置中心

#### 5.1.1 规划模型选择

优先级：P0

需求：

- 通过 VS Code 官方 Language Model API 查询当前可用聊天模型。
- 在配置界面展示模型名称、供应商、family、id 与可用状态。
- 支持用户选择一个默认规划模型。
- 当模型列表变化时自动刷新，并提示用户重新选择不可用模型。
- 若没有可用 Copilot/LM 模型，给出明确错误信息和引导。

验收标准：

- 用户可在配置界面看到至少一个由 VS Code LM API 返回的模型时完成选择。
- 保存后立即影响下一次混合路由请求。
- 模型不可用时不会静默失败。

#### 5.1.2 执行模型绑定

优先级：P0

需求：

- 支持 DeepSeek、Moonshot/Kimi 两类平台配置。
- 支持 OpenAI-compatible endpoint 的自定义 base URL。
- 支持模型版本选择，例如 `deepseek-v4-flash`、`deepseek-v4-pro`、`kimi-k2.6`。
- 支持配置默认执行模型、备用执行模型和失败升级模型。
- 支持测试连接并显示可读错误，例如鉴权失败、余额不足、限流、模型不存在。

验收标准：

- 用户可以新增、编辑、删除平台配置。
- API Key 保存后可发起一次最小化测试请求。
- 测试失败时不暴露完整密钥。

#### 5.1.3 密钥安全管理

优先级：P0

需求：

- 第三方 API Key 必须使用 `ExtensionContext.secrets` / VS Code SecretStorage 存储。
- 配置文件只保存 provider、model、base URL、启用状态等非敏感数据。
- Webview 与扩展主进程通信时不得把完整 API Key 回显到前端。
- 支持删除密钥、覆盖密钥和检查密钥是否存在。

验收标准：

- 工作区配置、用户配置和日志中均不出现完整 API Key。
- Webview 只能显示脱敏状态，例如 `sk-****abcd` 或“已配置”。
- 删除 provider 后对应 secret 同步删除。

### 5.2 智能路由中间件

#### 5.2.1 阶段一：Copilot 低 token 控制

优先级：P0

需求：

- 插件通过自有 Chat Participant、命令面板或编辑器上下文菜单接收用户请求。
- 自动构造控制阶段 system prompt，要求模型仅输出短 JSON。
- JSON 控制指令必须包含任务目标、建议查看的文件、建议使用的受控工具、廉价模型执行指令、验收标准、裁判检查清单和最大廉价模型迭代次数。
- 对规划模型返回内容进行 JSON 解析和 schema 校验。
- 若模型输出非 JSON，自动追加纠错提示重试一次。

建议 system prompt：

```text
你是混合模型路由器中的高能力控制器。请尽可能少消耗 token。
不要生成代码，不要输出长解释，不要读取完整文件。
你只负责告诉廉价模型下一步该查看哪些文件、使用哪些受控工具、按什么标准交付。
仅输出 JSON，必须包含：intent、routeMode、filesToInspect、toolsToUse、workerInstruction、acceptanceCriteria、judgeChecklist、maxCheapIterations。
```

任务书 schema 草案：

```json
{
  "intent": "string",
  "routeMode": "fast | balanced | longContext | debugLoop",
  "filesToInspect": ["string"],
  "toolsToUse": [
    {
      "kind": "activeFile | selection | diagnostics | workspaceFile | workspaceSearch | terminalCommand",
      "target": "string",
      "reason": "string",
      "requiresApproval": true
    }
  ],
  "workerInstruction": "string",
  "acceptanceCriteria": ["string"],
  "judgeChecklist": ["string"],
  "maxCheapIterations": 3
}
```

验收标准：

- 控制阶段不直接输出业务代码、补丁或长文档。
- 控制阶段默认只消费极简环境提示，不消费完整文件内容、文件清单、诊断摘要或工具结果。
- JSON 解析失败时有可诊断错误和一次自动修复机会。
- 成功规划后可在 UI 中查看折叠的控制指令摘要。

#### 5.2.2 阶段二：第三方模型代码生成

优先级：P0

需求：

- 将阶段一 JSON 任务书作为执行模型的核心指令。
- 拼接当前文件内容、选区内容、相关诊断信息和用户指定上下文。
- 廉价模型负责读取和综合大上下文、工具结果、错误日志和诊断信息。
- 支持按模型上下文窗口自动裁剪、摘要或分批发送上下文。
- 调用第三方模型 API 并流式展示输出。
- 支持输出为纯文本、Markdown、代码块或补丁建议。

验收标准：

- 当前文件和选区能正确进入执行模型上下文。
- 大输出任务不会阻塞 VS Code UI 主线程。
- 第三方 API 报错时能显示 provider、HTTP 状态、错误类型和可操作建议。

#### 5.2.3 缓存优化策略

优先级：P1

需求：

- 对支持缓存 usage 指标的 provider，将稳定 system prompt 放在请求最前面。
- 将高复用的路由规则、输出规范和安全约束固定化，减少缓存 miss。
- 对动态内容按“任务书 -> 当前上下文 -> 用户补充”的顺序拼接。
- 在 Token 用量看板中展示 provider 返回的 cache hit/cache miss 指标，若 API 支持。

验收标准：

- 缓存优化不会改变模型输出契约。
- provider 返回缓存指标时能够被记录并用于 Token 统计。

#### 5.2.4 阶段三：Copilot 低 token 裁判

优先级：P0

需求：

- 廉价模型完成执行后，插件只把压缩结果摘要、关键文件变化摘要、错误摘要和验收标准发送给贵模型。
- 贵模型只判断是否满足用户要求，不重写完整答案。
- 若不满足，贵模型输出短 JSON，包含未达标原因和下一步廉价模型指令。
- 当前严格模式下，贵模型只做一次终检；未通过时只输出问题摘要和给廉价模型的短指令，不自动启动新的贵模型规划轮次。

裁判输出 schema：

```json
{
  "passed": true,
  "confidence": "low | medium | high",
  "issues": ["string"],
  "nextInstruction": "string",
  "stopReason": "string"
}
```

验收标准：

- 贵模型裁判输入不得包含完整长输出，只包含摘要和必要片段。
- 贵模型裁判输出不得包含完整代码实现。
- 未通过时必须给出廉价模型可执行的下一步短指令，但不自动消耗新的贵模型规划轮次。

#### 5.2.5 自动调试循环

优先级：P1

需求：

- 支持用户通过 `/debug` 命令或命令面板触发自动调试循环。
- 贵模型第一轮只把需要查看的文件、诊断、搜索关键词或待用户批准的终端命令写入廉价模型工具计划。
- 廉价模型负责读取收集到的上下文，整理错误链条、候选根因、验证建议和代码修复草案。
- 贵模型只读取廉价模型调试读取报告摘要并做一次诊断，然后在最终调试输出后做一次终检。
- 对终端命令、测试运行、文件写入等高风险动作必须要求用户确认。

验收标准：

- 自动调试最多执行用户配置的轮次。
- 每轮显示“贵模型控制/廉价模型执行/贵模型判断”的状态。
- 终端命令不会在未授权情况下自动运行。

### 5.3 交互与容错机制

#### 5.3.1 透明化执行流程

优先级：P0

需求：

- 在聊天响应或 Webview 中显示当前阶段。
- 阶段包括：接收请求、规划中、任务书校验、执行中、结果生成、失败重试、升级模型、完成。
- 支持折叠查看规划任务书、执行模型请求摘要和 Token 统计。
- 不在 UI 中展示完整 API Key 或敏感 header。

状态文案示例：

- `Opus 4.7 正在分析需求...`
- `DeepSeek V4-Flash 正在生成代码...`
- `Flash 执行失败，正在升级到 DeepSeek V4-Pro 重试...`

验收标准：

- 用户能清楚知道当前卡在哪个阶段。
- 失败时能看到下一步选择，而不是只看到通用错误。

#### 5.3.2 Token 用量看板

优先级：P1

需求：

- 统计执行阶段输入/输出/总 token。
- 区分厂商返回 usage 与本地字符估算。
- 展示本次任务 token、会话累计 token、近 7 日用量和近 30 日用量。
- 给出统计口径说明，避免与厂商账单混淆。

展示示例：

```text
本次执行：输入 6,200 tokens，输出 2,700 tokens，共 8,900 tokens。
统计来源：厂商 usage。
会话累计：输入 21,400 tokens，输出 9,100 tokens，共 30,500 tokens。
```

验收标准：

- Token 统计支持关闭。
- 本地估算必须标记为 estimate，避免与厂商 usage 混淆。

#### 5.3.3 失败自动升级

优先级：P1

需求：

- 支持执行失败后自动重试一次。
- 支持按策略从 Flash 升级到 Pro。
- 支持用户手动选择“用 Copilot 修复”。
- 对明显的网络、鉴权、余额不足错误不进行无意义重试。
- 如果用户允许插件运行测试或命令，可把错误输出作为修复上下文。

验收标准：

- 失败升级链路可配置开启或关闭。
- 自动重试次数有硬上限。
- 升级到更高成本模型前显示提示或遵循用户预设。

### 5.4 协议适配层

优先级：P0/P1

需求：

- P0：实现 OpenAI-compatible Chat Completions 或 Responses 协议适配。
- P0：实现 DeepSeek provider 配置。
- P1：实现 Moonshot/Kimi provider 配置。
- P1：实现 Anthropic-compatible 消息格式适配。
- P1：统一流式响应、错误对象和 token 统计接口。

统一接口草案：

```ts
interface ExecutionProvider {
  id: string;
  displayName: string;
  listModels(): Promise<ModelInfo[]>;
  validateConfig(config: ProviderConfig): Promise<ValidationResult>;
  sendChat(request: ExecutionRequest): AsyncIterable<ExecutionChunk>;
  normalizeUsage?(usage: TokenUsage, model: string): TokenUsageRecord;
}
```

## 6. 非功能性需求

### 6.1 性能

- 规划与路由自身额外延迟目标控制在 1-2 秒内，不包含模型实际生成时间。
- 配置切换必须即时生效，无需重启 VS Code。
- 第三方模型输出应尽可能流式渲染，减少等待感。
- 大文件上下文处理必须设置 token 上限和超时机制。
- 扩展主线程不得执行长时间同步任务。

### 6.2 隐私与安全

- 所有请求转发、指令转化和上下文拼接均在用户本地 VS Code 扩展进程完成。
- 不建设、不默认使用任何插件作者控制的中转服务器。
- API Key 使用 VS Code SecretStorage 存储。
- 日志默认脱敏，且允许用户关闭详细日志。
- 对外发送代码上下文前应明确显示目标 provider，并提供“仅发送选区”“发送当前文件”“发送工作区相关文件”的范围控制。

### 6.3 合规

- 只使用 VS Code 官方扩展 API 和用户自行配置的第三方 API。
- 不逆向、不 hook、不劫持 GitHub Copilot 扩展内部实现。
- 明确提示用户第三方 API 请求会把所选上下文发送给对应模型服务商。
- 遵守 GitHub、VS Code Marketplace、DeepSeek、Moonshot/Kimi 等平台服务条款。

### 6.4 可维护性

- Provider 适配层与路由策略解耦。
- UI 状态、配置存储、密钥存储和模型调用分层实现。
- 关键路径具备单元测试：JSON 任务书解析、provider 请求构造、错误映射、Token 用量统计。
- 记录 VS Code API 版本要求和 provider API 版本差异。

## 7. 技术架构设计

### 7.1 开发框架

- 语言：TypeScript。
- 运行形态：VS Code Extension。
- VS Code 版本：建议 1.89+，实际以所需 Chat Participant 与 Language Model API 稳定版本为准。
- 规划模型调用：`vscode.lm.selectChatModels` 与模型实例的 `sendRequest`。
- 聊天入口：`vscode.chat.createChatParticipant` 或命令面板入口。
- 密钥存储：`ExtensionContext.secrets`。
- 配置存储：VS Code `workspace.getConfiguration` 与全局状态。

### 7.2 UI 方案

- 配置界面使用 Webview，并优先采用 VS Code 原生样式变量。
- 可使用 `@vscode/webview-ui-toolkit` 或等价的 VS Code Webview 组件方案。
- 侧边栏展示 provider、模型、成本、运行日志和最近任务。
- 状态栏展示当前路由模式与快速切换入口。
- 命令面板提供快速操作：选择规划模型、选择执行模型、测试 API Key、打开 Token 用量看板。

### 7.3 模块划分

```text
src/
  extension.ts                 # 扩展入口与命令注册
  chat/
    participant.ts             # 自有 Chat Participant
    requestPipeline.ts         # 规划 -> 执行主流程
  planning/
    copilotPlanner.ts          # VS Code LM API 调用封装
    taskSchema.ts              # JSON schema 与校验
  execution/
    providers/
      deepseek.ts              # DeepSeek 适配器
      kimi.ts                  # Moonshot/Kimi 适配器
      openaiCompatible.ts      # 通用 OpenAI-compatible 适配器
    executionRouter.ts         # 模型选择、重试和升级策略
  context/
    contextCollector.ts        # 当前文件、选区、诊断信息收集
    tokenBudget.ts             # 上下文预算与裁剪
  storage/
    secretStore.ts             # SecretStorage 封装
    settingsStore.ts           # 配置读写
  usage/
    tokenUsageEstimator.ts     # token 估算与格式化
    tokenUsageStore.ts         # 会话 token 统计
  webview/
    configPanel.ts             # 配置中心
    dashboardPanel.ts          # Token 用量看板
  telemetry/
    localLogger.ts             # 本地脱敏日志
```

### 7.4 请求流程

```text
用户请求
  -> 插件 Chat Participant / 命令入口
  -> 收集极简环境提示和用户配置
  -> 调用 Copilot 可用模型生成低 token JSON 控制指令
  -> 校验 JSON schema
  -> 根据路由策略选择第三方执行模型
  -> 廉价模型读取上下文并生成读取报告
  -> 贵模型诊断读取报告并补充执行约束
  -> 廉价模型根据诊断结果执行最终任务并流式渲染结果
  -> 将压缩结果摘要返回 Copilot 可用模型做低 token 终检
  -> 终检未达标时只输出问题摘要和给廉价模型的短指令
  -> 统计 token
  -> 失败时按策略重试或升级
```

### 7.5 MCP 可选方案

MCP Server 可作为 P2 扩展方向，用于把路由能力暴露给其他本地工具或 agent。但 MVP 不建议依赖 MCP，因为 VS Code Extension 内部已经可以完成密钥管理、配置 UI、上下文收集和模型调用。若引入 MCP，应保持本地进程、无云端中转，并明确鉴权边界。

## 8. 数据与配置设计

### 8.1 非敏感配置

示例：

```json
{
  "modelRouter.planner.modelId": "copilot:gpt-5.5",
  "modelRouter.execution.defaultProvider": "deepseek",
  "modelRouter.execution.defaultModel": "deepseek-v4-flash",
  "modelRouter.execution.fallbackModel": "deepseek-v4-pro",
  "modelRouter.context.mode": "selectionAndCurrentFile",
  "modelRouter.tokenStats.enabled": true,
  "modelRouter.retry.maxAttempts": 2
}
```

### 8.2 SecretStorage Key 设计

| Secret key | 内容 | 说明 |
| --- | --- | --- |
| `modelRouter.provider.deepseek.apiKey` | DeepSeek API Key | 仅存 secret，不写入配置 |
| `modelRouter.provider.kimi.apiKey` | Moonshot/Kimi API Key | 仅存 secret，不写入配置 |
| `modelRouter.provider.custom.<id>.apiKey` | 自定义 provider API Key | id 需做规范化 |

### 8.3 本地日志

- 默认记录任务 ID、阶段耗时、模型 ID、token 估算、错误类型。
- 不记录完整 prompt、完整代码上下文和完整 API Key。
- 用户开启 debug 模式后，可选择记录脱敏 prompt 摘要。

## 9. 验收标准

### 9.1 MVP 验收

- 安装扩展后，侧边栏和状态栏可见入口。
- 用户可配置至少一个 Copilot 规划模型和一个 DeepSeek 执行模型。
- API Key 使用 SecretStorage 保存，配置文件中不可见明文密钥。
- 在自有聊天入口输入需求后，插件能先生成低 token JSON 控制指令，再调用第三方模型生成结果，并把摘要返回贵模型判断是否达标。
- `/debug` 命令可触发廉价模型调试证据整理和贵模型下一步判断流程。
- UI 能显示规划中、执行中、完成或失败状态。
- 第三方 API 失败时显示可读错误并支持重试。

### 9.2 安全验收

- 日志、配置、Webview 消息中不得出现完整 API Key。
- 用户能明确知道当前上下文将发送给哪个第三方 provider。
- 插件不使用私有 Copilot 接口或网络劫持方案。

### 9.3 质量验收

- 关键模块具备单元测试。
- Provider 错误映射覆盖鉴权失败、限流、余额不足、模型不存在、网络超时。
- JSON 任务书 schema 校验覆盖正常、缺字段、非 JSON、字段类型错误。
- Token 用量统计有边界测试，并标明 estimate。

## 10. 开发路线图

### 10.1 阶段一：核心架构搭建（MVP）

目标：验证“Copilot 规划 -> 第三方执行”的闭环。

交付：

- VS Code Extension TypeScript 脚手架。
- Chat Participant 或命令入口。
- 基础配置 Webview。
- Copilot 规划模型选择与调用。
- DeepSeek OpenAI-compatible 调用。
- JSON 任务书 schema 校验。
- 基础流式输出与错误提示。

### 10.2 阶段二：协议适配与优化

目标：增强 provider 覆盖、稳定性和成本优化。

交付：

- Moonshot/Kimi provider。
- 自定义 OpenAI-compatible provider。
- 统一错误映射。
- token 预算与上下文裁剪。
- 缓存命中优化策略。
- 自动重试与模型升级策略。

### 10.3 阶段三：体验优化与发布

目标：达到可发布 VSIX 的产品体验。

交付：

- Token 用量看板。
- 状态栏快速切换。
- 配置导入导出，不包含 secret。
- 完整测试与发布材料。
- Marketplace README、截图、隐私说明和变更日志。

## 11. 风险与应对

### 11.1 技术风险

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| VS Code LM API 或 Chat API 变化 | 规划模型调用或聊天入口失效 | 锁定最低 VS Code 版本，封装 API 访问层，关注官方 release notes |
| 可用 Copilot 模型列表变化 | 用户选择的规划模型不可用 | 监听模型变化事件，自动重新查询并提示用户选择 |
| 第三方 API 限流或 usage 字段变化 | 执行失败或 token 统计不准 | 多 provider 支持，本地估算兜底，错误提示可诊断 |
| 长上下文导致超限 | 请求失败或 token 消耗过高 | token 预算、文件筛选、摘要和分批处理 |
| 廉价模型执行质量不稳定 | 成功率下降 | 规划 schema 强约束，失败升级，用户可手动回退 Copilot |

### 11.2 合规风险

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| 依赖 Copilot 私有接口 | 可能违反条款并导致功能失效 | 仅使用官方 VS Code API |
| 用户误以为第三方不接收代码 | 隐私预期不一致 | 每次发送前标明 provider 和上下文范围 |
| 第三方服务条款变化 | 某些模型或用法不可继续支持 | Provider 可插拔，必要时禁用或提示更新 |

### 11.3 市场风险

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| 类似商业产品出现 | 差异化降低 | 强化本地隐私、可配置路由、透明 Token 用量和开发者可控性 |
| 官方推出相似模型路由 | 插件价值被压缩 | 转向多 provider 适配、Token 用量看板和团队策略管理 |

## 12. 指标体系

| 指标 | 定义 | 目标 |
| --- | --- | --- |
| 混合路由成功率 | 完成规划并得到执行模型有效输出的任务占比 | MVP 达到 70%+，优化后 85%+ |
| 贵模型 token 降低比例 | 与全程高价模型承担上下文/输出相比的贵模型 token 降低比例 | 90%+ |
| 规划 JSON 合格率 | 一次规划输出通过 schema 校验的比例 | 85%+ |
| 失败可恢复率 | 失败后通过重试或升级得到可用结果的比例 | 60%+ |
| 配置完成时间 | 新用户完成 provider 配置并通过测试的时间 | 3 分钟内 |
| 额外路由延迟 | 除模型生成外的插件处理耗时 | 1-2 秒内 |

## 13. 开放问题

- Copilot 可用模型的供应商、family 和 id 在不同用户套餐、地区和 VS Code 版本下是否稳定。
- Token 统计是否只依赖本地估算，还是读取 provider 返回的 usage 字段。
- 是否需要团队策略功能，例如禁用某些 provider、限制发送整个工作区上下文。
- 是否允许插件自动应用补丁，还是 MVP 仅展示建议结果。
- 是否需要内置任务模板，例如“生成测试”“解释错误”“重构当前函数”“生成 README”。

## 14. 总结

Copilot Model Switcher 的核心思路是把“控制判断能力”和“输出执行成本”解耦：用 Copilot 可用顶级模型产出高质量、低 token 的控制指令和验收判断，再让第三方高性价比模型承担上下文综合、工具结果整理、大规模代码生成和长文本输出。该方案在本地完成路由与密钥管理，避免云端中转，并通过官方 VS Code API 保持合规边界。

MVP 的关键不是拦截 Copilot Chat，而是提供一个稳定、透明、可控的混合路由入口。只要规划任务书足够可靠、执行 provider 适配足够稳、失败升级策略足够清晰，该插件就能在成本、额度和成功率之间形成明确的产品价值。
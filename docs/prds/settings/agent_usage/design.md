# 本地 Agent 使用统计页面 — 设计文档

- 日期: 2026-05-18
- 状态: 设计已确认, 待写实现计划
- 涉及仓库: AionUi (TS/React, 主)、AionCLI (Rust/Axum, 后端)
- 主文档位置: 本文件 (AionUi 仓库唯一主文档; AionCLI 侧 PR 反向引用本 spec)

## 1. 目标与范围

在 AionUi 的 Settings 侧边栏新增一个「使用统计」Tab, 展示本地 **Codex** 和 **Claude Code** 的用量。数据**直接读取这两个工具自身的本地会话日志**, AionUi 与 AionCLI 均**不存储**任何用量数据 (无数据库、无文件写入副作用)。

前期仅支持 Codex 与 Claude Code 两个 agent。

### 非目标 (YAGNI)

- 不做成本估算 ($): 日志只有 token 数, 内置单价表会过时且误导
- 不自建用量历史表/持久化
- 不支持 Codex/Claude 以外的 agent (后续可扩展 parser)
- 不做导出/告警/配额功能

## 2. 关键现实约束

- AionUi 自身**没有用量历史**: `conversations.extra.last_token_usage` 仅存最近一次快照, 会被覆盖。故方案不依赖 AionUi 自身数据。
- 改为直接读取两个 CLI 的本地日志, 数据更全 (包含用户在 AionUi 之外用 CLI 的用量)。

### 日志数据源 (已实地验证)

**Claude Code**: `~/.claude/projects/<编码后的项目路径>/<sessionId>.jsonl`
- 每条 assistant 行: `message.usage` = `{ input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens }`
- 行级带 `message.model` (如 `claude-opus-4-7`)、`timestamp`、`cwd`、`gitBranch`、`sessionId`
- 单会话 token 需自行累加所有 assistant 消息

**Codex**: `~/.codex/sessions/YYYY/MM/DD/rollout-<时间>-<id>.jsonl`
- `session_meta` 行: `payload` 含 `id`、`timestamp`、`cwd`、`cli_version`、`model_provider`
- `event_msg` 的 `payload.type == "token_count"`: `info.total_token_usage` (**已累计**) 与 `last_token_usage` (单轮), 含 `model_context_window`
- 单会话 token = 该会话最后一个 `token_count` 事件的 `info.total_token_usage`

## 3. 总体架构与数据流

```
┌─────────────── AionUi 仓库 (TS/React) ───────────────┐
│  Settings 侧边栏新增 "使用统计" Tab                    │
│  pages/settings/UsageStats/ (容器 + 5 个展示组件)     │
│              │ ipcBridge → HTTP                        │
└──────────────┼─────────────────────────────────────────┘
              │  GET /api/analytics/agent-usage
              ▼
┌─────────────── AionCLI 仓库 (Rust/Axum) ─────────────┐
│  新建领域层 crate: aionui-analytics                    │
│    routes / service / cache / aggregate / parser       │
│  aionui-api-types: 新增 AgentUsage* DTO (契约同源)     │
│  aionui-app/router/routes.rs: merge analytics_routes   │
└─────────────────────────────────────────────────────────┘
```

数据流: 用户打开 Tab → renderer 调 `ipcBridge` → AionUi process 转发 HTTP → AionCLI `aionui-analytics` 扫描两个日志目录 → 解析聚合 → 返回统一 JSON → renderer 渲染四个区块。

关键设计点:
- 解析全部在 Rust 后端 (性能好、不阻塞 UI、符合架构铁律)
- 后端内存缓存: `path → (mtime, size, 解析结果)`, 下次只重解析变化文件
- 一次请求返回完整聚合 (总量+模型+会话+趋势), 前端纯展示不计算
- 后端无副作用, 不写任何文件/DB

## 4. 数据结构 / API 契约

端点: `GET /api/analytics/agent-usage`

查询参数 (可选):
- `trend_granularity`: `day` (默认) | `week`
- `refresh`: `true` 强制全量重解析 (忽略缓存)

响应 JSON (在 `aionui-api-types` 用 serde 定义, 前后端共享契约):

```jsonc
{
  "scanned_at": "2026-05-18T10:30:00Z",
  "sources": [
    { "agent": "claude", "files_total": 412, "files_parsed": 410,
      "files_skipped": 2, "available": true, "error": null },
    { "agent": "codex",  "files_total": 88,  "files_parsed": 88,
      "files_skipped": 0, "available": true, "error": null }
  ],
  "summary": {
    "by_agent": [
      { "agent": "claude", "sessions": 412, "messages": 9821,
        "input_tokens": 12000000, "output_tokens": 850000,
        "cache_read_tokens": 30000000, "cache_creation_tokens": 4000000,
        "total_tokens": 46850000 },
      { "agent": "codex", "sessions": 88, "messages": 1203,
        "input_tokens": 3400000, "output_tokens": 210000,
        "cache_read_tokens": 1200000, "cache_creation_tokens": 0,
        "total_tokens": 4810000 }
    ]
  },
  "by_model": [
    { "agent": "claude", "model": "claude-opus-4-7",
      "sessions": 210, "input_tokens": 8000000, "output_tokens": 600000,
      "cache_read_tokens": 20000000, "cache_creation_tokens": 3000000,
      "total_tokens": 31600000 }
  ],
  "trend": {
    "granularity": "day",
    "points": [
      { "bucket": "2026-05-16",
        "by_agent": { "claude": 2100000, "codex": 450000 } }
    ]
  },
  "sessions": [
    { "agent": "claude", "session_id": "f76eb77b-...",
      "project": "/Users/jassy/Documents/xxx",
      "model": "claude-opus-4-7",
      "started_at": "2026-05-17T08:03:08Z",
      "last_active_at": "2026-05-17T09:12:00Z",
      "messages": 42, "total_tokens": 1850000 }
  ]
}
```

### 字段口径

| 项 | Claude Code | Codex |
|---|---|---|
| 单会话 token | 累加每条 assistant `message.usage` | 最后一个 `token_count` 的 `info.total_token_usage` |
| model | 每条消息 `message.model`, 会话级取出现最多者 | `session_meta`/`turn_context` 模型, 缺失标 `unknown` |
| project | 消息 `cwd` | `session_meta.payload.cwd` |
| 时间 | 消息 `timestamp` | 行级 `timestamp` |
| messages | assistant 消息条数 | `response_item` 计数 |

- `total_tokens` 统一 = `input + output + cache_read + cache_creation`; Codex 直接用其 `total_token_usage.total_tokens`
- 趋势按 `total_tokens` 归桶到日/周; Codex 无逐消息 token 时整会话归到会话开始日
- 坏行/坏文件: 跳过并计入 `files_skipped`, 不让请求失败; 降级状态经 `sources[].available/error` 透传给前端

## 5. Rust 后端模块设计 (AionCLI)

新建领域层 crate `crates/aionui-analytics/` (符合 ARCHITECTURE.zh-CN.md 的 crate 职责划分: 日志解析+用量统计是独立领域, 不属于任何现有 crate)。

```
crates/aionui-analytics/
├─ Cargo.toml          # aionui-common, aionui-api-types, serde,
│                       # serde_json, tokio, walkdir, dirs, chrono,
│                       # axum, tracing
├─ src/
│  ├─ lib.rs           # pub fn analytics_routes(state) -> Router
│  ├─ routes.rs        # GET handler: query → service → JSON
│  ├─ service.rs       # 编排: 定位目录→扫描→缓存→解析→聚合
│  ├─ cache.rs         # DashMap<PathBuf, (mtime, size, ParsedSession)>
│  ├─ aggregate.rs     # 纯函数: Vec<ParsedSession> → 响应结构
│  ├─ types.rs         # 内部模型
│  └─ parser/
│     ├─ mod.rs        # trait LogParser + 读 jsonl/跳坏行工具
│     ├─ claude.rs     # ~/.claude/projects/**/*.jsonl
│     └─ codex.rs      # ~/.codex/sessions/**/*.jsonl
└─ tests/
   ├─ claude_parser.rs
   ├─ codex_parser.rs
   └─ fixtures/        # 脱敏样例 jsonl
```

职责与边界:
- `parser::LogParser` trait: `parse_file(path) -> Result<ParsedSession, ParseError>`。两实现各自封装格式细节, 互不依赖。坏行 `continue`, 坏文件返回 `Err` 由上层计 skipped。
- `cache::UsageCache`: mtime+size 未变直接返回缓存, 否则重解析。进程常驻。
- `service::AgentUsageService`: 用 `dirs::home_dir()` 定位目录; 目录不存在 → `available:false` 不报错; `walkdir` 枚举 `*.jsonl`; 逐文件走 cache; `refresh=true` 绕过缓存。
- `aggregate`: 纯函数, 无 IO, 易测。
- `routes`: 仅 query 解析 + 调 service + `Json(resp)`。

接入组装层:
- `aionui-api-types` 新增 `src/analytics.rs` 定义所有 `AgentUsage*` DTO, `lib.rs` 导出
- `aionui-app/src/router/routes.rs` 加 `.merge(aionui_analytics::analytics_routes(state.clone()))`
- workspace `Cargo.toml` 注册新成员

并发与性能: `walkdir` 同步枚举; 解析用 `spawn_blocking`; 文件间并发 (`buffer_unordered`, 上限 16)。首次几百文件数秒内; 命中缓存毫秒级。

错误处理: 复用 `aionui-common` 的 `AppError`。原则: **单文件失败降级、整体请求不失败**, 失败信息经响应透传。

## 6. AionUi 前端 + IPC 接入

### IPC 桥接

沿用现有 "renderer → process → AionCLI HTTP" 范式 (现 `ipcBridge.conversation.*` 即此模式), 不发明新机制:
- `packages/desktop/src/common/adapter/ipcBridge.ts` 新增 `analytics.getAgentUsage`, 映射 `GET /api/analytics/agent-usage`, 入参 `{ trendGranularity?, refresh? }`
- 响应类型 `AgentUsageResponse` 放 `packages/desktop/src/common/types/`, 与第 4 节 JSON 严格对齐
- preload 走现有通用通道, 无需单独改

### 页面结构 (Settings 新 Tab)

- `pages/settings/components/SettingsSider.tsx`: `BUILTIN_TAB_IDS` 加 `'usage'`, `builtinMap` 加菜单项 (icon 用 `@icon-park/react` 图表类, label 走 i18n)
- `components/layout/Router.tsx`: 加 `/settings/usage` 路由
- 新建目录 (单目录 ≤10 子项):

```
pages/settings/UsageStats/
├─ index.tsx          # 容器: ipcBridge / loading / error / 粒度切换
├─ SummaryCards.tsx   # ① Codex/Claude 汇总卡片
├─ TrendChart.tsx     # ④ 日/周柱状图, 双 agent
├─ ModelTable.tsx     # ② Arco Table 按模型
├─ SessionList.tsx    # ③ Arco Table 虚拟滚动会话明细
├─ SourceBanner.tsx   # 数据源健康度提示
└─ types.ts           # 复用 common 的派生类型
```

### UI 布局 (从上到下)

```
[使用统计]          粒度: (日)(周)   [刷新↻]
⚠ SourceBanner: 仅当目录缺失/skipped 才显示
┌ Claude Code 卡片 ┬ Codex 卡片 ┐   ← ① 汇总
④ 趋势图 (柱状, claude/codex 双色, 日/周)
② 按模型细分 Table (可按 token 排序)
③ 会话明细 Table (虚拟滚动, 按时间倒序)
```

### 规范遵循 (项目铁律)

- 全部 `@arco-design/web-react` (Card/Table/Radio/Button/Spin/Empty/Alert), 无裸 HTML 交互元素
- 图标 `@icon-park/react`; 趋势图用项目已有图表库 (实现期确认, 无则用 Arco 兼容轻量方案)
- 所有文案走 i18n (新增 `usageStats` 模块 key); 颜色用语义 token, 无硬编码
- 状态: `Spin` 加载 / `Empty` 无数据 / `Alert` 错误 / `SourceBanner` 降级
- TS strict, 无 `any`, 用路径别名

### 交互

- 进页面自动拉取 (`refresh=false`, 吃后端缓存)
- 「刷新」→ `refresh=true` 强制后端重解析
- 粒度切换整体重取 (保持简单)
- 数据量大: 会话表虚拟滚动; 前端不做聚合计算

## 7. 测试策略

| 层 | 测什么 | 怎么测 |
|---|---|---|
| Rust parser | 口径正确性、坏行跳过、空文件、损坏 JSON | `tests/` + 脱敏 fixtures, 断言 `ParsedSession` |
| Rust aggregate | 多会话聚合、日/周归桶边界 | 表驱动单测, 构造输入 |
| Rust service | 目录缺失降级、缓存命中不重解析 | 临时目录 fixture |
| Rust routes | query 解析、JSON 结构、空数据 200 | Axum 测试 |
| TS 前端 | 加载/错误/空态、粒度切换触发请求、契约对齐 | Vitest + mock ipcBridge |

- 覆盖率遵循各项目约定 (AionUi ≥80%)
- **fixtures 必须脱敏**: 去用户名、对话内容只留结构, 不提交隐私
- Rust: `cargo test` + `cargo clippy` + `cargo fmt`
- TS: `bun run test` + `lint:fix` + `format` + `tsc --noEmit` + i18n 校验

## 8. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| CLI 升级改日志格式 | 解析失效 | 宽松解析、缺失给默认值; 坏行/坏文件降级; `sources.error` 透传 |
| 日志量极大 | 首次慢 | mtime+size 增量缓存; 文件并发 (上限 16); `spawn_blocking`; `Spin` 反馈 |
| 两仓库版本不同步 | 调用旧后端 404 | 端点缺失时前端友好降级提示; 契约类型同源 |
| Codex 无逐消息 token | 趋势精度低 | 文档明示口径; UI tooltip 注明 |
| 隐私 (路径含用户名) | 信息暴露 | 仅本地展示不外传; fixtures 脱敏 |

## 9. 分阶段交付

- **阶段 0** 设计落档 (本文件)
- **阶段 1 — AionCLI 后端**: 新建 `aionui-analytics` crate (parser/service/cache/aggregate/routes) + api-types DTO + 单测 + 脱敏 fixtures。`cargo test` 通过, `curl` 验证真实数据
- **阶段 2 — AionUi 前端**: IPC 方法 + 类型 + Settings Tab + 5 组件 + i18n + 测试。用阶段 1 编译的 aioncli 端到端验证
- **阶段 3 — 联调收尾**: 四维度正确性验证; 边界冒烟 (空目录/损坏/超大量); 两仓库各 `just push`/CI; 各开 feature 分支提 PR (AionCLI 从 main 切, AionUi 从 dev 切)

交付物: AionCLI 一个新 crate + 少量组装层改动; AionUi 一个新 settings tab。两边均无 DB/文件写入副作用。

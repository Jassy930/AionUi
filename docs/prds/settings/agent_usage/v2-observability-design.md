# 使用统计 v2 — 可观测性增强设计文档

- 日期: 2026-05-19
- 状态: 设计已确认 (五节经用户逐节批准), 待写实现计划
- 关联: v1 设计 `docs/prds/settings/agent_usage/design.md`、v1 实现计划 `implementation-plan.md`
- 涉及仓库: AionUi `feat/agent-usage-stats` (前端, 主)、AionCLI `feat/agent-usage-analytics` (后端)
- 对标参考: CodexScope (JUk1-GH/CodexScope)、ccusage (ryoppippi/ccusage)、Claude-Code-Usage-Monitor、phuryn/claude-usage

## 0. 背景与对标结论

v1 已交付: 汇总卡片(文字) + 堆叠趋势柱(可切维度) + 按模型表 + 会话明细表。用户反馈"可观测性不够、可视化不够明确易用"。

调研同类工具 (CodexScope/ccusage/Monitor/claude-usage) 后, 提炼出 v1 缺失的高价值可观测性点。**用户决策: 仍不做成本估算 ($)** (坚持 v1 非目标 — 日志只有 token, 内置单价表会过时误导), 因此排除成本/5h计费窗口/burn rate/耗尽预测 (均依赖成本或订阅配额语义)。本 v2 **只做纯 token 维度的可视化增强**。

## 1. 目标与范围

### 目标

把使用统计页从"文字+单图"重构为**仪表盘式概览** (概览→下钻), 让 token 可观测性"一眼看到关键、需要时下钻"。

### 范围 (用户确认: 四项全做)

1. **token 构成可视化**: input/output/cache_read/cache_creation 用环形/构成条展示占比 (解决"混文字看不出谁是大头, 如 cache_read 占 90%")
2. **汇总卡 sparkline + 构成条**: KPI 卡内嵌迷你趋势线 ("概览即洞察")
3. **趋势图增强**: 分时⇄累计切换 + 线性⇄对数轴 + 图例可点选 series + 自适应粒度标注 + token 类型分层 series
4. **对比/排行视图**: 工具对比环 (claude vs codex) + 项目排行条 + 模型排行条

### 布局 (用户确认: B 仪表盘式概览)

控制栏 → KPI 行 → 主区(趋势主图 + token构成环) → 对比排行行(工具对比环|项目排行|模型排行) → 会话明细(下钻)。

### 技术 (用户确认: 手写 SVG 零依赖)

项目无任何图表库, v1 TrendChart 纯 div 手写, 对标 CodexScope 也是手写 SVG。本 v2 全部图表手写 SVG, 零新依赖。

### 非目标 (YAGNI)

- 不做成本估算 ($) / 5h 计费窗口 / burn rate / 配额耗尽预测 (依赖成本或订阅语义)
- 不引入图表库
- 不做实时/自动刷新 (沿用 v1 手动刷新)
- 不改 v1 的 SessionList / SourceBanner / 鉴权 / service 扫描逻辑

## 2. 总体架构与数据流

```
┌─────── AionCLI feat/agent-usage-analytics (Rust) ───────┐
│ TrendPoint: 现有 by_segment 不变 + 新增 by_token_kind     │
│ AgentUsageResponse: 新增 by_project (与 by_model 对称)    │
│ aggregate.rs: 同一事件聚合循环内额外累计 4 类 token / project │
│ (零额外遍历; 不新增 query 参数; 不碰鉴权/service/其它crate)│
└──────────────────────┬───────────────────────────────────┘
                       │ GET /api/analytics/agent-usage (契约不变, 仅响应字段增)
                       ▼
┌─────── AionUi feat/agent-usage-stats (TS/React) ────────┐
│ UsageStats 重构为仪表盘 (8 组件); 全部图表手写 SVG;       │
│ 累计/对数/series点选 = 纯前端变换 (不触发后端请求)        │
│ agentUsage.ts 契约同步 (byTokenKind / byProject + mapper)│
└──────────────────────────────────────────────────────────┘
```

数据流: 打开页面 → 现有 `ipcBridge.analytics.getAgentUsage` (查询参数不变) → 后端 aggregate 同时产出维度分段(by_segment)+token类型分层(by_token_kind)+项目汇总(by_project) → 前端仪表盘各区块从**同一响应**取数渲染, 无额外请求。累计/对数/图例点选是前端对响应数据的展示变换。

关键设计点:
- 后端改动最小化、向后兼容: `by_segment` 完全不动; 新增字段旧前端忽略也能跑
- 前端整页重构但**复用** SessionList/SourceBanner/ipcBridge/mapper (扩展非重写)
- 沿用 v1 全部踩坑教训 (见第 6 节)

## 3. 后端契约扩展 (AionCLI)

改动范围: 只动 `aionui-api-types/src/analytics.rs` + `aionui-analytics`。不碰其它 crate / 鉴权 / service 扫描。

### 3.1 DTO 扩展

```rust
#[derive(Debug, Serialize, Default)]
pub struct TokenKindBreakdown {
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_creation: u64,
}

#[derive(Debug, Serialize)]
pub struct TrendPoint {
    pub bucket: String,
    pub by_segment: std::collections::BTreeMap<String, u64>,  // 不变
    pub by_token_kind: TokenKindBreakdown,                    // 新增
}

#[derive(Debug, Serialize)]
pub struct UsageByProject {   // 新增, 结构同 UsageByModel
    pub agent: String,
    pub project: String,
    pub sessions: u64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_creation_tokens: u64,
    pub total_tokens: u64,
}

// AgentUsageResponse 新增: pub by_project: Vec<UsageByProject>
```

### 3.2 Query 参数

**不新增**。累计(前缀和)、对数(坐标变换)、series 点选(筛选)均为纯前端展示变换, 后端只需返回完整分时数据 (已有)。`trend_mode` 不进后端 (避免无谓契约膨胀, YAGNI)。

### 3.3 aggregate.rs 改动

现有事件聚合循环已按 `bucket_key(e.at, gran)` 把 `e.total()` 累加到 `by_segment`、按 `(agent,model)` 聚合 by_model。**同一循环内**额外:
- 把 `e.input_tokens/output_tokens/cache_read_tokens/cache_creation_tokens` 累加到该桶的 `TokenKindBreakdown`
- 按 `(agent, project)` key 聚合 `by_project` (镜像 by_model 写法)

零额外遍历, 零性能影响。Codex fallback 口径不变 (沿用 last_token_usage / total 兜底, 只是多记 4 类分量)。

### 3.4 口径一致性 (可测不变量)

- 任意桶: `by_token_kind.{input+output+cache_read+cache_creation}` == `sum(by_segment.values())`
- 全局: `sum(by_project token)` == `sum(by_model token)` == `sum(summary.by_agent token)`

这些写入测试要求 (第 5 节)。

### 3.5 远程脱敏

`by_project` 的 project 值来自 `s.project`, service 层在 `is_remote` 时已对 `s.project` 做 basename 脱敏, by_project 聚合发生在脱敏后, 自动继承。无新增安全面。

### 3.6 前端契约同步

`agentUsage.ts`: `TrendPointRaw`/`TrendPoint` 加 `by_token_kind`/`byTokenKind`; 新增 `UsageByProjectRaw`/`UsageByProject`; `AgentUsageResponse` 加 `byProject`; mapper 加对应映射。与 v1 契约同步方式一致。旧后端无这些字段时 mapper 给默认空值 (向后兼容, 不白屏)。

## 4. 前端仪表盘布局与组件

整页重构 `pages/settings/UsageStats/`, B 仪表盘布局:

```
控制栏 (复用 v1): 时间窗 | 粒度 | 趋势维度 | 刷新
SourceBanner (复用 v1, 置 KPI 行上方)
① KPI 行: 4 紧凑卡 (总token / 会话数 / 消息数 / cache占比%), 各内嵌 SVG sparkline
② 主区 (flex 2:1): [趋势主图 (大)] [token 构成环]
③ 对比排行行 (3 列等宽): [工具对比环 claude◑codex] [项目排行 top8] [模型排行 top8]
④ 会话明细 (复用 v1 SessionList, 默认展开)
```

### 4.1 组件拆分 (单一职责, 目录 ≤10 子项)

```
UsageStats/
├─ index.tsx              容器: 取数 + 状态 + 组装
├─ KpiRow.tsx             ① 4 KPI 卡 (summary 汇总 + sparkline)
├─ Sparkline.tsx          通用 SVG 迷你折线 (props: number[])
├─ TrendChart.tsx         ② 主图重写 (堆叠/折线 + 分时累计 + 线性对数 + series点选)
├─ CompositionDonut.tsx   ② token 构成环 (通用环形, ③ 工具对比环复用)
├─ RankBar.tsx            ③ 通用水平排行条 (项目/模型排行复用)
├─ ComparisonRow.tsx      ③ 组装: 工具对比环 + 项目RankBar + 模型RankBar
├─ SessionList.tsx        ④ 复用 v1 (不改)
├─ SourceBanner.tsx       复用 v1 (不改)
└─ index.tsx 之外共 8 个 .tsx (含 2 个复用不改)
```

### 4.2 各组件数据来源 (全部来自单次 AgentUsageResponse)

| 组件 | 数据 |
|---|---|
| KpiRow 总token/会话/消息 | `summary.byAgent` 求和 |
| KpiRow cache 占比 | `sum(cacheRead+cacheCreation)/sum(total)` |
| KpiRow sparkline | `trend.points` 每桶对应指标序列 |
| CompositionDonut (构成) | `summary.byAgent` 的 input/output/cacheRead/cacheCreation 求和 |
| TrendChart | `trend.points`: `bySegment` (维度 series) + `byTokenKind` (token 类型 series) |
| 工具对比环 | `summary.byAgent` 各 agent total 占比 |
| 模型排行 RankBar | `byModel` top N |
| 项目排行 RankBar | `byProject` top N (新增后端字段) |

## 5. 交互、状态、错误处理、测试

### 5.1 交互与状态

- 沿用 v1 全局控制: 时间窗 / 粒度 / 趋势维度 / 刷新 (触发后端请求)
- 趋势主图新增**纯前端状态** (不触发请求): `trendMode` (分时⇄累计, 累计=前缀和), `scale` (线性⇄对数, 对数=`log10(v+1)` 坐标变换), `hiddenSeries` (图例点选隐藏集合)
- 自适应粒度标注: 据 time_range+granularity 推算每点时长 ("每点≈1天/1周"), 纯展示文案
- KPI/构成环/对比排行: 无交互或仅 hover tooltip; 数据随全局控制变化自动重渲染
- 切维度只影响趋势主图 series (bySegment); 构成环/KPI 始终用 summary (与维度无关)

### 5.2 错误/降级 (沿用 v1 + 扩展)

- loading → `Spin`; 失败 → 404 `unsupported` / 其它 `error` Alert (沿用 v1 容器状态机)
- `SourceBanner` 数据源降级提示置 KPI 行上方
- 空/边界: 无数据 → 环显空灰圈、排行条显"—"、sparkline 显平线, 不崩; 某 token kind 全 0 → 该段不渲染; 对数轴遇 0 → `log10(v+1)` 已处理
- 旧后端无 by_token_kind/by_project → mapper 默认空值, 对应图表空态 + 友好提示, 不白屏

### 5.3 测试策略

| 层 | 测什么 | 怎么测 |
|---|---|---|
| Rust aggregate | by_token_kind 和==by_segment 总和 (不变量); by_project 聚合正确; 跨 token 类型 fixture | 表驱动单测 (扩 aggregate.rs 测试) |
| TS mapper | byTokenKind/byProject snake→camel 映射 | 扩 agentUsage.test.ts |
| TS 纯函数 | 累计前缀和 / 对数坐标 / topN 排序 / 占比计算 | 抽纯函数单测 (tests/unit/, 不依赖 DOM) |
| TS 组件 | 容器状态机 (trendMode/scale/hiddenSeries 切换不重新请求; 维度切换重新请求); 各图表空态不崩 | UsageStats.dom.test.tsx 扩展 |
| 真实环境 | 仪表盘整体渲染、SVG 图表可见性/配色、light/dark 双主题 | CDP 真实 Electron 验证 |

覆盖率: **核心逻辑 (mapper/累计/对数/排序/聚合) 100%**; SVG 渲染/布局走 CDP 集成验证 (沿用既定"核心100%+展示集成验证"约定)。

## 6. 沿用 v1 踩坑教训 (必须遵守)

v1 GUI 联调阶段 CDP 取证修复了 5 个缺陷, 本 v2 必须避免重蹈:

1. **共享常量多消费者**: 加 BUILTIN_TAB_IDS 类成员须 grep 全部消费点 (v1 白屏根因)
2. **深路径 import**: 用包主入口导出, 不用 `@arco-design/web-react/es/...` 深 subpath
3. **i18n 双括号**: 文案占位符用 i18next `{{var}}` (非单括号); 新增 usageStats key 走完整 i18n 流程 (config + 8 locale + i18n:types + check-i18n)
4. **图形最小可见高度**: SVG 条/线在量级差异大时需 clamp 最小可见尺寸
5. **颜色用项目语义变量**: 用 `--primary`/`--text-secondary` 等项目 :root 实际定义的 CSS 变量 (CDP 实测确认), **绝不用 Arco 色阶名** (`--color-primary-6` 等本项目未定义 → 透明不可见)。多 series 调色板用固定 hex (对标 CodexScope), 验证 light/dark 双主题可读

工程纪律: 测试放 `tests/unit/`、React 测试 `*.dom.test.tsx`、PR 前 prek + 两仓库门禁、推送到 fork (`Jassy930/AionUi` + `Jassy930/AionCore`, 上游无写权限)。

## 7. 分阶段交付 (跨两仓库, 沿用 v1 阶段模式)

- **阶段 1 — AionCLI 后端**: TrendPoint.by_token_kind + TokenKindBreakdown + UsageByProject + aggregate 改动 + 单测 (不变量) + release 二进制
- **阶段 2 — AionUi 前端**: 契约同步 (byTokenKind/byProject + mapper) + 仪表盘 8 组件 + 纯函数 (累计/对数/排序) + i18n 扩展 + 测试
- **阶段 3 — 联调收尾**: CDP 真实环境验证 (整体渲染 + SVG 配色 + 双主题) + 双仓库门禁 (prek / cargo) + 推 fork + 文档同步

交付物: AionCLI 契约+聚合扩展 (向后兼容); AionUi 使用统计页仪表盘重构。两端均无 DB/文件写入副作用 (沿用 v1)。

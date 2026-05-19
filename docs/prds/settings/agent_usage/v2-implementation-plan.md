# 使用统计 v2 可观测性增强 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 AionUi 使用统计页从"文字+单图"重构为仪表盘式概览(KPI 行 + 趋势主图增强 + token 构成环 + 工具/项目/模型对比排行 + 会话明细下钻),纯 token 维度可视化,不做成本。

**Architecture:** AionCLI 后端 `TrendPoint` 加 `by_token_kind`、新增 `UsageByProject`(向后兼容,同一聚合循环零额外遍历)。AionUi 前端整页重构为 8 组件手写 SVG 仪表盘,累计/对数/series点选为纯前端变换,复用 v1 SessionList/SourceBanner/ipcBridge。

**Tech Stack:** Rust (serde, BTreeMap) / TypeScript (React, @arco-design/web-react, 手写 SVG 零依赖, Vitest)

**关联设计:** `docs/prds/settings/agent_usage/v2-observability-design.md`

**仓库与分支:**

- AionCLI: `/Users/jassy/Documents/glm/aionui_ws/AionCLI`,分支 `feat/agent-usage-analytics`(已存在,续提交)
- AionUi: `/Users/jassy/Documents/glm/aionui_ws/AionUi`,分支 `feat/agent-usage-stats`(已存在,续提交)

**执行顺序:** 阶段 1(后端)→ 产出 release 二进制 → 阶段 2(前端,依赖契约)→ 阶段 3(联调)。

**沿用 v1 五个踩坑教训(强制):** ①共享常量改动 grep 全消费点 ②不用 `@arco-design/web-react/es/...` 深路径 ③i18n 双括号 `{{}}` ④SVG 图形 clamp 最小可见尺寸 ⑤颜色用项目 :root 实际 CSS 变量(`var(--primary)` #165dff / `var(--text-secondary)` #454d5f / `var(--brand)` #7583b2),多 series 用固定 hex 调色板,**绝不用 Arco 色阶名**(`--color-primary-6` 等本项目未定义→透明)。测试放 `tests/unit/`,React 测试 `*.dom.test.tsx`。

---

## 阶段 1 — AionCLI 后端

> 所有阶段 1 命令在 `/Users/jassy/Documents/glm/aionui_ws/AionCLI` 下执行,分支 `feat/agent-usage-analytics`。

### Task 1.1: api-types 新增 TokenKindBreakdown / UsageByProject + 扩展 TrendPoint/AgentUsageResponse

**Files:**

- Modify: `crates/aionui-api-types/src/analytics.rs`

- [ ] **Step 1: 在 TrendPoint(当前 55-59 行)上方加 TokenKindBreakdown,并给 TrendPoint 加字段**

把 `crates/aionui-api-types/src/analytics.rs` 中现有的:

```rust
#[derive(Debug, Serialize)]
pub struct TrendPoint {
    pub bucket: String,
    /// 分段名 (agent/project/model) → 该桶 total_tokens。
    pub by_segment: std::collections::BTreeMap<String, u64>,
}
```

替换为:

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
    /// 分段名 (agent/project/model) → 该桶 total_tokens。
    pub by_segment: std::collections::BTreeMap<String, u64>,
    /// 该桶按 token 类型的分层 (四项之和 == by_segment 所有值之和)。
    pub by_token_kind: TokenKindBreakdown,
}
```

- [ ] **Step 2: 在 UsageByModel(当前 43-52 行)下方加 UsageByProject**

在 `pub struct UsageByModel { ... }` 闭合 `}` 之后,新增:

```rust
#[derive(Debug, Serialize)]
pub struct UsageByProject {
    pub agent: String,
    pub project: String,
    pub sessions: u64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_creation_tokens: u64,
    pub total_tokens: u64,
}
```

- [ ] **Step 3: AgentUsageResponse 加 by_project 字段**

在 `pub struct AgentUsageResponse { ... }` 里 `pub by_model: Vec<UsageByModel>,` 那一行**下方**加一行:

```rust
    pub by_project: Vec<UsageByProject>,
```

- [ ] **Step 4: 编译检查(预期失败 — aggregate.rs 还没填新字段)**

Run: `cargo check -p aionui-api-types`
Expected: PASS(api-types 本身只是结构体定义,独立编译通过)。然后 `cargo check -p aionui-analytics 2>&1 | grep -E "missing field|by_token_kind|by_project" | head` Expected: 报 `missing field by_token_kind`/`by_project`(因为 aggregate.rs 构造 TrendPoint/AgentUsageResponse 还没给新字段)——这是预期,Task 1.2 修复。

- [ ] **Step 5: 提交**

```bash
git add crates/aionui-api-types/src/analytics.rs
git commit -m "feat(api-types): add TokenKindBreakdown + UsageByProject DTOs (v2)"
```

---

### Task 1.2: aggregate.rs 聚合 by_token_kind + by_project(TDD)

**Files:**

- Modify: `crates/aionui-analytics/src/aggregate.rs`
- Modify: `crates/aionui-analytics/tests/aggregate.rs`

- [ ] **Step 1: 写失败测试(不变量 + by_project 聚合)**

在 `crates/aionui-analytics/tests/aggregate.rs` 末尾追加(该文件已有 `ev(day,tok)` / `session()` 辅助、`use aionui_analytics::types::{Agent, ParsedSession, UsageEvent}`、`use chrono::{TimeZone, Utc}`):

```rust
#[test]
fn token_kind_breakdown_sums_match_segment_totals() {
    use aionui_analytics::types::UsageEvent;
    let mut s = session(); // 默认 Codex, project "/work/p"
    // 给一个事件带各类 token, 验证 by_token_kind 拆分
    s.events = vec![UsageEvent {
        at: Utc.with_ymd_and_hms(2026, 5, 16, 12, 0, 0).unwrap(),
        input_tokens: 10,
        output_tokens: 20,
        cache_read_tokens: 30,
        cache_creation_tokens: 40,
    }];
    let resp = aggregate(vec![s], "day", "all", "agent", 200, 0);
    let p = &resp.trend.points[0];
    assert_eq!(p.by_token_kind.input, 10);
    assert_eq!(p.by_token_kind.output, 20);
    assert_eq!(p.by_token_kind.cache_read, 30);
    assert_eq!(p.by_token_kind.cache_creation, 40);
    // 不变量: 四项和 == by_segment 所有值之和
    let kind_sum =
        p.by_token_kind.input + p.by_token_kind.output + p.by_token_kind.cache_read + p.by_token_kind.cache_creation;
    let seg_sum: u64 = p.by_segment.values().sum();
    assert_eq!(kind_sum, seg_sum, "by_token_kind 四项和必须等于 by_segment 总和");
}

#[test]
fn by_project_aggregates_per_project() {
    let mut s1 = session();
    s1.project = "/work/alpha".into();
    s1.events = vec![ev(16, 100)];
    let mut s2 = session();
    s2.project = "/work/beta".into();
    s2.events = vec![ev(16, 250)];
    let resp = aggregate(vec![s1, s2], "day", "all", "agent", 200, 0);
    let mut got: std::collections::BTreeMap<String, u64> = Default::default();
    for bp in &resp.by_project {
        got.insert(bp.project.clone(), bp.total_tokens);
    }
    assert_eq!(got.get("/work/alpha").copied(), Some(100));
    assert_eq!(got.get("/work/beta").copied(), Some(250));
    // 全局不变量: by_project 总和 == by_model 总和 == summary by_agent 总和
    let proj_total: u64 = resp.by_project.iter().map(|p| p.total_tokens).sum();
    let model_total: u64 = resp.by_model.iter().map(|m| m.total_tokens).sum();
    let agent_total: u64 = resp.summary.by_agent.iter().map(|a| a.total_tokens).sum();
    assert_eq!(proj_total, model_total);
    assert_eq!(model_total, agent_total);
}
```

- [ ] **Step 2: 运行确认失败**

Run: `cargo test -p aionui-analytics --test aggregate 2>&1 | tail -15`
Expected: 编译失败或断言失败(aggregate 还没产出 by_token_kind/by_project;实际此时整 crate 因 Task 1.1 的 missing field 编译不过,这也是"失败"的一种,符合 TDD 先红)。

- [ ] **Step 3: 实现 — aggregate.rs 改动**

`crates/aionui-analytics/src/aggregate.rs` 三处改动:

(a) use 行(当前第 2-4 行)加入新类型:

```rust
use aionui_api_types::{
    AgentUsageResponse, SessionRow, TokenKindBreakdown, TrendPoint, UsageByAgent, UsageByModel, UsageByProject,
    UsageSummary, UsageTrend,
};
```

(b) 累加器区(当前第 29-31 行 `let mut by_agent...` `by_model...` `trend...` 之后)新增两个累加结构:

```rust
    let mut by_project: BTreeMap<(&'static str, String), Acc> = BTreeMap::new();
    // 每个 bucket 的 token 类型分层 (input, output, cache_read, cache_creation)
    let mut trend_kind: BTreeMap<String, (u64, u64, u64, u64)> = BTreeMap::new();
```

(c) `for s in &sessions` 循环内:在 `let m = by_model.entry(...)` 之后加 by_project 入口;在事件循环 `for e in &s.events` 内同时累加 by_project token 与 trend_kind。把现有循环体:

```rust
        let m = by_model.entry((an, s.model.clone())).or_default();
        m.sessions += 1;
        let seg: String = match trend_dimension {
            "project" => s.project.clone(),
            "model" => s.model.clone(),
            _ => an.to_string(),
        };
        for e in &s.events {
            a.input += e.input_tokens;
            a.output += e.output_tokens;
            a.cache_read += e.cache_read_tokens;
            a.cache_creation += e.cache_creation_tokens;
            m.input += e.input_tokens;
            m.output += e.output_tokens;
            m.cache_read += e.cache_read_tokens;
            m.cache_creation += e.cache_creation_tokens;
            let bucket = bucket_key(e.at, gran);
            *trend.entry(bucket).or_default().entry(seg.clone()).or_insert(0) += e.total();
        }
```

替换为:

```rust
        let m = by_model.entry((an, s.model.clone())).or_default();
        m.sessions += 1;
        let pj = by_project.entry((an, s.project.clone())).or_default();
        pj.sessions += 1;
        let seg: String = match trend_dimension {
            "project" => s.project.clone(),
            "model" => s.model.clone(),
            _ => an.to_string(),
        };
        for e in &s.events {
            a.input += e.input_tokens;
            a.output += e.output_tokens;
            a.cache_read += e.cache_read_tokens;
            a.cache_creation += e.cache_creation_tokens;
            m.input += e.input_tokens;
            m.output += e.output_tokens;
            m.cache_read += e.cache_read_tokens;
            m.cache_creation += e.cache_creation_tokens;
            pj.input += e.input_tokens;
            pj.output += e.output_tokens;
            pj.cache_read += e.cache_read_tokens;
            pj.cache_creation += e.cache_creation_tokens;
            let bucket = bucket_key(e.at, gran);
            *trend.entry(bucket.clone()).or_default().entry(seg.clone()).or_insert(0) += e.total();
            let tk = trend_kind.entry(bucket).or_default();
            tk.0 += e.input_tokens;
            tk.1 += e.output_tokens;
            tk.2 += e.cache_read_tokens;
            tk.3 += e.cache_creation_tokens;
        }
```

(d) `by_model_vec` 构造(当前 76-88 行)之后,新增 `by_project_vec`:

```rust
    let by_project_vec: Vec<UsageByProject> = by_project
        .iter()
        .map(|((agent, project), pj)| UsageByProject {
            agent: agent.to_string(),
            project: project.clone(),
            sessions: pj.sessions,
            input_tokens: pj.input,
            output_tokens: pj.output,
            cache_read_tokens: pj.cache_read,
            cache_creation_tokens: pj.cache_creation,
            total_tokens: pj.input + pj.output + pj.cache_read + pj.cache_creation,
        })
        .collect();
```

(e) `trend_points` 构造(当前 90-96 行)替换为带 by_token_kind 的版本:

```rust
    let trend_points: Vec<TrendPoint> = trend
        .into_iter()
        .map(|(bucket, by_segment)| {
            let tk = trend_kind.get(&bucket).copied().unwrap_or((0, 0, 0, 0));
            TrendPoint {
                bucket,
                by_segment: by_segment.into_iter().collect(),
                by_token_kind: TokenKindBreakdown {
                    input: tk.0,
                    output: tk.1,
                    cache_read: tk.2,
                    cache_creation: tk.3,
                },
            }
        })
        .collect();
```

(f) `AgentUsageResponse { ... }` 构造里(当前 `by_model: by_model_vec,` 那行下方)加:

```rust
        by_project: by_project_vec,
```

- [ ] **Step 4: 运行确认通过**

Run: `cargo test -p aionui-analytics --test aggregate 2>&1 | tail -6`
Expected: 全部 PASS(含新 2 个 + 原有测试)。

- [ ] **Step 5: 全 crate 测试 + clippy + fmt**

Run:

```bash
cargo test -p aionui-analytics 2>&1 | grep "test result" | tail -1
cargo clippy -p aionui-analytics -- -D warnings 2>&1 | tail -1; echo "clippy: $?"
cargo clippy -p aionui-api-types -- -D warnings 2>&1 | tail -1; echo "clippy: $?"
cargo fmt -p aionui-analytics && cargo fmt -p aionui-api-types
```

Expected: 测试全 ok;两个 clippy 退出 0。若 clippy 报新 warning(如未用 import / collapsible),在不改逻辑下按建议修正。

- [ ] **Step 6: 提交**

```bash
git add crates/aionui-analytics/src/aggregate.rs crates/aionui-analytics/tests/aggregate.rs
git commit -m "feat(analytics): aggregate by_token_kind + by_project with invariant tests (v2)"
```

---

### Task 1.3: 真实数据冒烟 + 构建 release 二进制

- [ ] **Step 1: 全 workspace 门禁**

Run:

```bash
cargo clippy --workspace -- -D warnings 2>&1 | tail -1; echo $?
cargo fmt --all -- --check 2>&1 | tail -1; echo $?
```

Expected: 均退出 0(fmt 不过则 `cargo fmt --all` 后重检)。

- [ ] **Step 2: cargo run 真实数据冒烟(端口 25930)**

Run:

```bash
(cargo run -q -p aionui-app -- --local --port 25930 > /tmp/v2smoke.log 2>&1 &) && sleep 12
curl -s "http://127.0.0.1:25930/api/analytics/agent-usage?time_range=30d&sessions_limit=1" | python3 -c "import sys,json; d=json.load(sys.stdin)['data']; p=d['trend']['points'][0]; print('by_token_kind:', p['by_token_kind']); ks=sum(p['by_token_kind'].values()); ss=sum(p['by_segment'].values()); print('不变量 kind_sum==seg_sum:', ks==ss, ks, ss); print('by_project 条数:', len(d['by_project']), '示例:', d['by_project'][0] if d['by_project'] else 'EMPTY')"
pkill -f "port 25930" 2>/dev/null
```

Expected: `by_token_kind` 有 input/output/cache_read/cache_creation 非负值;不变量 `kind_sum==seg_sum` 为 True;`by_project` 非空且每项有 project + total_tokens。若不变量 False → 回 Task 1.2 检查累加逻辑(不要继续)。

- [ ] **Step 3: 构建 release 二进制**

Run: `cargo build --release -p aionui-app 2>&1 | tail -1`
Expected: 产出 `target/release/aioncli`。`ls -la target/release/aioncli` 确认存在。

- [ ] **Step 4: 提交(若 Step 1 有 fmt 改动)**

```bash
git status --short | grep -q . && git add -A && git commit -m "chore(analytics): workspace fmt for v2" || echo "无额外改动"
```

---

## 阶段 2 — AionUi 前端

> 所有阶段 2 命令在 `/Users/jassy/Documents/glm/aionui_ws/AionUi` 下执行,分支 `feat/agent-usage-stats`。

### Task 2.1: 契约同步 agentUsage.ts(TDD)

**Files:**

- Modify: `packages/desktop/src/common/types/agentUsage.ts`
- Modify: `tests/unit/common/agentUsage.test.ts`

- [ ] **Step 1: 写失败测试(byTokenKind / byProject 映射)**

`tests/unit/common/agentUsage.test.ts` 现有 `fromApiAgentUsage` 测试。在该测试的 `raw` 对象里,给 `trend.points[0]` 加 `by_token_kind`,顶层加 `by_project`,并加断言。具体:在现有 raw fixture 的 `trend: { granularity:'day', points:[{ bucket:'2026-05-17', by_segment:{ claude:15 } }] }` 改为:

```ts
      trend: {
        granularity: 'day',
        points: [
          {
            bucket: '2026-05-17',
            by_segment: { claude: 15 },
            by_token_kind: { input: 5, output: 4, cache_read: 3, cache_creation: 3 },
          },
        ],
      },
```

在 raw 顶层(与 `by_model` 同级)加:

```ts
      by_project: [
        {
          agent: 'claude',
          project: '/work/p',
          sessions: 1,
          input_tokens: 5,
          output_tokens: 4,
          cache_read_tokens: 3,
          cache_creation_tokens: 3,
          total_tokens: 15,
        },
      ],
```

在该测试断言区追加:

```ts
expect(m.trend.points[0].byTokenKind).toEqual({ input: 5, output: 4, cacheRead: 3, cacheCreation: 3 });
expect(m.byProject[0]).toMatchObject({ project: '/work/p', totalTokens: 15, cacheReadTokens: 3 });
```

- [ ] **Step 2: 运行确认失败**

Run: `bun run test -- agentUsage 2>&1 | grep -E "Tests|FAIL" | tail -2`
Expected: FAIL(byTokenKind/byProject 未定义)。

- [ ] **Step 3: 实现 — agentUsage.ts 改动**

`packages/desktop/src/common/types/agentUsage.ts`:

(a) `TrendPointRaw`(第 40 行)改为:

```ts
export type TokenKindBreakdownRaw = {
  input: number;
  output: number;
  cache_read: number;
  cache_creation: number;
};
export type TrendPointRaw = {
  bucket: string;
  by_segment: Record<string, number>;
  by_token_kind: TokenKindBreakdownRaw;
};
```

(b) `UsageByModelRaw`(第 29 行块)下方加 `UsageByProjectRaw`(字段同 UsageByModelRaw):

```ts
export type UsageByProjectRaw = {
  agent: string;
  project: string;
  sessions: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  total_tokens: number;
};
```

(c) `AgentUsageResponseRaw`(第 53 行块)里 `by_model: UsageByModelRaw[];` 下方加:

```ts
  by_project: UsageByProjectRaw[];
```

(d) camel 侧:`TrendPoint`(第 99 行)改为:

```ts
export type TokenKindBreakdown = {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
};
export type TrendPoint = {
  bucket: string;
  bySegment: Record<string, number>;
  byTokenKind: TokenKindBreakdown;
};
```

(e) `UsageByModel`(第 88 行块)下方加 `UsageByProject`(camel 字段同 UsageByModel + project):

```ts
export type UsageByProject = {
  agent: string;
  project: string;
  sessions: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
};
```

(f) `AgentUsageResponse`(第 112 行块)里 `byModel: UsageByModel[];` 下方加:

```ts
  byProject: UsageByProject[];
```

(g) `fromApiAgentUsage`(第 134 行)里:trend points map(第 169 行)改为:

```ts
      points: r.trend.points.map((p) => ({
        bucket: p.bucket,
        bySegment: p.by_segment,
        byTokenKind: {
          input: p.by_token_kind.input,
          output: p.by_token_kind.output,
          cacheRead: p.by_token_kind.cache_read,
          cacheCreation: p.by_token_kind.cache_creation,
        },
      })),
```

并在 mapper return 对象里(`byModel: r.by_model.map(...)` 之后)加 `byProject` 映射:

```ts
    byProject: (r.by_project ?? []).map((p) => ({
      agent: p.agent,
      project: p.project,
      sessions: p.sessions,
      inputTokens: p.input_tokens,
      outputTokens: p.output_tokens,
      cacheReadTokens: p.cache_read_tokens,
      cacheCreationTokens: p.cache_creation_tokens,
      totalTokens: p.total_tokens,
    })),
```

> 用 `r.by_project ?? []` 与 `p.by_token_kind` 缺省保护:旧后端无这些字段时不崩(向后兼容)。`by_token_kind` 缺失时给零值——在 mapper 顶部对 `p.by_token_kind` 用 `const tk = p.by_token_kind ?? { input:0, output:0, cache_read:0, cache_creation:0 };` 再映射 tk(把上面 (g) 的 `p.by_token_kind.xxx` 改为 `tk.xxx`)。

- [ ] **Step 4: 运行确认通过 + 类型检查**

Run:

```bash
bun run test -- agentUsage 2>&1 | grep "Tests " | tail -1
bunx tsc --noEmit 2>&1 | grep -ci "agentUsage" | sed 's/^/agentUsage tsc 错误: /'
```

Expected: 测试 PASS;tsc agentUsage 错误 0。

- [ ] **Step 5: 提交**

```bash
git add packages/desktop/src/common/types/agentUsage.ts tests/unit/common/agentUsage.test.ts
git commit -m "feat(usage-stats): sync byTokenKind + byProject contract (v2)"
```

---

### Task 2.2: 纯函数(累计/对数/topN/占比)+ 单测(TDD)

**Files:**

- Create: `packages/desktop/src/renderer/pages/settings/UsageStats/chartMath.ts`
- Create: `tests/unit/common/chartMath.test.ts`

- [ ] **Step 1: 写失败测试**

Create `tests/unit/common/chartMath.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { cumulative, logScale, topN, pct } from '@renderer/pages/settings/UsageStats/chartMath';

describe('chartMath', () => {
  it('cumulative = prefix sum', () => {
    expect(cumulative([1, 2, 3, 4])).toEqual([1, 3, 6, 10]);
    expect(cumulative([])).toEqual([]);
  });
  it('logScale uses log10(v+1), 0 stays 0', () => {
    expect(logScale(0)).toBe(0);
    expect(logScale(9)).toBeCloseTo(1, 5); // log10(10)=1
    expect(logScale(99)).toBeCloseTo(2, 5);
  });
  it('topN sorts desc by value and slices', () => {
    const r = topN(
      [
        { k: 'a', v: 3 },
        { k: 'b', v: 9 },
        { k: 'c', v: 1 },
      ],
      (x) => x.v,
      2
    );
    expect(r.map((x) => x.k)).toEqual(['b', 'a']);
  });
  it('pct guards divide-by-zero', () => {
    expect(pct(25, 100)).toBe(25);
    expect(pct(5, 0)).toBe(0);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `bun run test -- chartMath 2>&1 | grep -E "Tests|FAIL|Cannot find" | tail -2`
Expected: FAIL(模块不存在)。

- [ ] **Step 3: 实现 chartMath.ts**

Create `packages/desktop/src/renderer/pages/settings/UsageStats/chartMath.ts`:

```ts
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** 前缀和（分时序列 → 累计序列）。 */
export function cumulative(xs: number[]): number[] {
  const out: number[] = [];
  let acc = 0;
  for (const x of xs) {
    acc += x;
    out.push(acc);
  }
  return out;
}

/** 对数坐标变换；log10(v+1)，0 保持 0，避免负无穷。 */
export function logScale(v: number): number {
  return v <= 0 ? 0 : Math.log10(v + 1);
}

/** 按 value 降序取前 n。 */
export function topN<T>(items: T[], value: (t: T) => number, n: number): T[] {
  return [...items].sort((a, b) => value(b) - value(a)).slice(0, n);
}

/** 占比百分比，分母 0 返回 0。 */
export function pct(part: number, total: number): number {
  return total <= 0 ? 0 : (part / total) * 100;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `bun run test -- chartMath 2>&1 | grep "Tests " | tail -1`
Expected: PASS(4 测试)。

- [ ] **Step 5: 提交**

```bash
git add packages/desktop/src/renderer/pages/settings/UsageStats/chartMath.ts tests/unit/common/chartMath.test.ts
git commit -m "feat(usage-stats): add chart math pure functions with TDD (v2)"
```

---

### Task 2.3: i18n 扩展 usageStats(KPI/构成/对比/趋势新键)

**Files:**

- Modify: `packages/desktop/src/renderer/services/i18n/locales/<8 locale>/usageStats.json`
- 影响: `i18n-keys.d.ts`(由 `bun run i18n:types` 生成)

- [ ] **Step 1: en-US 加键**

`packages/desktop/src/renderer/services/i18n/locales/en-US/usageStats.json` 顶层加(用 i18next 双括号,本批无插值变量):

```json
"kpi": { "totalTokens": "Total tokens", "sessions": "Sessions", "messages": "Messages", "cacheRatio": "Cache ratio" },
"composition": { "title": "Token composition", "input": "Input", "output": "Output", "cacheRead": "Cache read", "cacheCreation": "Cache creation" },
"comparison": { "title": "By tool", "projectsTitle": "Top projects", "modelsTitle": "Top models" },
"trendCtl": { "mode": "Mode", "split": "Split", "cumulative": "Cumulative", "scale": "Scale", "linear": "Linear", "log": "Log", "perPoint": "≈ {{span}} / point" }
```

> 注意:`perPoint` 用 `{{span}}` 双括号插值(自适应粒度标注,如 "≈ 1 day / point")。

- [ ] **Step 2: zh-CN 加同结构中文**

`zh-CN/usageStats.json` 加:

```json
"kpi": { "totalTokens": "总 token", "sessions": "会话数", "messages": "消息数", "cacheRatio": "缓存占比" },
"composition": { "title": "Token 构成", "input": "输入", "output": "输出", "cacheRead": "缓存读取", "cacheCreation": "缓存创建" },
"comparison": { "title": "按工具", "projectsTitle": "项目排行", "modelsTitle": "模型排行" },
"trendCtl": { "mode": "模式", "split": "分时", "cumulative": "累计", "scale": "坐标", "linear": "线性", "log": "对数", "perPoint": "每点 ≈ {{span}}" }
```

- [ ] **Step 3: 其余 6 locale 复制 en-US 这 4 个键块**

为 `ja-JP zh-TW ko-KR tr-TR ru-RU uk-UA` 各自的 `usageStats.json` 加与 en-US **完全相同**的 `kpi`/`composition`/`comparison`/`trendCtl` 四个键块(占位,与这些 locale 现状一致)。

- [ ] **Step 4: 生成类型 + 校验**

Run:

```bash
bun run i18n:types && node scripts/check-i18n.js 2>&1 | grep -E "configuration check passed|❌" | tail -1
```

Expected: `✅ i18n configuration check passed`(8 locale 键完整)。

- [ ] **Step 5: 提交**

```bash
git add packages/desktop/src/renderer/services/i18n/locales packages/desktop/src/renderer/services/i18n/i18n-keys.d.ts
git commit -m "feat(usage-stats): add v2 dashboard i18n keys"
```

---

### Task 2.4: Sparkline + CompositionDonut + RankBar 通用 SVG 组件

**Files:**

- Create: `packages/desktop/src/renderer/pages/settings/UsageStats/Sparkline.tsx`
- Create: `packages/desktop/src/renderer/pages/settings/UsageStats/CompositionDonut.tsx`
- Create: `packages/desktop/src/renderer/pages/settings/UsageStats/RankBar.tsx`

> 无独立单测(纯展示 SVG,逻辑已抽到 chartMath 单测;渲染由 Task 2.7 容器测试 + 阶段3 CDP 验证)。颜色规则严格按计划头部第⑤条。

- [ ] **Step 1: Sparkline.tsx**

Create:

```tsx
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

const SEGMENT_PALETTE = ['#3491FA', '#00B42A', '#FF7D00', '#F53F3F', '#722ED1', '#14C9C9', '#F7BA1E', '#D91AD9'];

const Sparkline: React.FC<{ values: number[]; color?: string }> = ({ values, color }) => {
  if (values.length === 0) {
    return <svg width='100%' height='32' aria-hidden='true' />;
  }
  const max = Math.max(1, ...values);
  const stroke = color ?? SEGMENT_PALETTE[0];
  const n = values.length;
  const pts = values
    .map((v, i) => {
      const x = n === 1 ? 0 : (i / (n - 1)) * 120;
      const y = 32 - (v / max) * 28 - 2; // 留 2px 边距，最高点贴顶
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg width='100%' height='32' viewBox='0 0 120 32' preserveAspectRatio='none'>
      <polyline fill='none' stroke={stroke} strokeWidth='2' points={pts} />
    </svg>
  );
};

export { SEGMENT_PALETTE };
export default Sparkline;
```

- [ ] **Step 2: CompositionDonut.tsx**(通用环形:输入分段数组 `{name,value,color}` + 中心文案)

Create:

```tsx
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { pct } from './chartMath';

type Seg = { name: string; value: number; color: string };

const CompositionDonut: React.FC<{ segments: Seg[]; centerLabel: string; centerSub?: string }> = ({
  segments,
  centerLabel,
  centerSub,
}) => {
  const total = segments.reduce((s, x) => s + x.value, 0);
  // dasharray 单位：周长归一化为 100
  let offset = 25; // 起点在 12 点钟方向（-90deg 等效）
  const arcs =
    total > 0
      ? segments
          .filter((s) => s.value > 0)
          .map((s) => {
            const len = pct(s.value, total); // 占周长百分比
            const el = (
              <circle
                key={s.name}
                cx='21'
                cy='21'
                r='15.9155'
                fill='none'
                stroke={s.color}
                strokeWidth='6'
                strokeDasharray={`${len.toFixed(3)} ${(100 - len).toFixed(3)}`}
                strokeDashoffset={offset.toFixed(3)}
                transform='rotate(-90 21 21)'
              />
            );
            offset -= len;
            return el;
          })
      : [];
  return (
    <svg width='140' height='140' viewBox='0 0 42 42' role='img'>
      <circle cx='21' cy='21' r='15.9155' fill='none' stroke='var(--color-fill, #e5e6eb)' strokeWidth='6' />
      {arcs}
      <text x='21' y='20' textAnchor='middle' fontSize='5' fontWeight='600' fill='var(--text-primary, #1d2129)'>
        {centerLabel}
      </text>
      {centerSub ? (
        <text x='21' y='25.5' textAnchor='middle' fontSize='3' fill='var(--text-secondary, #86909c)'>
          {centerSub}
        </text>
      ) : null}
    </svg>
  );
};

export type { Seg };
export default CompositionDonut;
```

> `var(--color-fill, #e5e6eb)` 写法：优先项目变量,缺失回退 hex（避免 v1 那种变量未定义→透明的坑;`--text-primary`/`--text-secondary` 已在 v1 CDP 实测存在,给回退是双保险）。

- [ ] **Step 3: RankBar.tsx**(水平排行条:`{label,value}[]` + 最大值归一)

Create:

```tsx
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

const fmt = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
};

const RankBar: React.FC<{ rows: { label: string; value: number }[] }> = ({ rows }) => {
  if (rows.length === 0) {
    return <div style={{ color: 'var(--text-secondary, #86909c)', fontSize: 12, padding: '8px 0' }}>—</div>;
  }
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div>
      {rows.map((r) => (
        <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, margin: '4px 0' }}>
          <span style={{ width: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {r.label}
          </span>
          <div style={{ flex: 1, background: 'var(--color-fill, #e5e6eb)', borderRadius: 3 }}>
            <div
              style={{
                width: `${Math.max((r.value / max) * 100, 2)}%`,
                background: 'var(--primary)',
                height: 14,
                borderRadius: 3,
              }}
            />
          </div>
          <span style={{ width: 54, textAlign: 'right' }}>{fmt(r.value)}</span>
        </div>
      ))}
    </div>
  );
};

export default RankBar;
```

> 条宽 `Math.max(..., 2)%` clamp 最小可见（v1 教训④）；`var(--primary)` v1 CDP 实测存在。

- [ ] **Step 4: tsc + lint**

Run: `bunx tsc --noEmit 2>&1 | grep -ci "Sparkline\|CompositionDonut\|RankBar" | sed 's/^/tsc 错误: /' && bun run lint:fix 2>&1 | grep -ciE "^error" | sed 's/^/lint error: /'`
Expected: tsc 错误 0;lint error 0。

- [ ] **Step 5: 提交**

```bash
git add packages/desktop/src/renderer/pages/settings/UsageStats/Sparkline.tsx packages/desktop/src/renderer/pages/settings/UsageStats/CompositionDonut.tsx packages/desktop/src/renderer/pages/settings/UsageStats/RankBar.tsx
git commit -m "feat(usage-stats): add Sparkline/CompositionDonut/RankBar SVG components (v2)"
```

---

### Task 2.5: KpiRow + ComparisonRow 组装组件

**Files:**

- Create: `packages/desktop/src/renderer/pages/settings/UsageStats/KpiRow.tsx`
- Create: `packages/desktop/src/renderer/pages/settings/UsageStats/ComparisonRow.tsx`

- [ ] **Step 1: KpiRow.tsx**(4 KPI 卡 + sparkline)

Create:

```tsx
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Card, Grid } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { AgentUsageResponse } from '@/common/types/agentUsage';
import Sparkline from './Sparkline';
import { pct } from './chartMath';

const fmt = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
};

const KpiRow: React.FC<{ data: AgentUsageResponse }> = ({ data }) => {
  const { t } = useTranslation();
  const a = data.summary.byAgent;
  const totalTok = a.reduce((s, x) => s + x.totalTokens, 0);
  const sessions = a.reduce((s, x) => s + x.sessions, 0);
  const messages = a.reduce((s, x) => s + x.messages, 0);
  const cacheTok = a.reduce((s, x) => s + x.cacheReadTokens + x.cacheCreationTokens, 0);
  const cacheRatio = pct(cacheTok, totalTok);
  const trendTotals = data.trend.points.map((p) => Object.values(p.bySegment).reduce((s, v) => s + v, 0));

  const cards: { label: string; value: string; spark: number[] }[] = [
    { label: t('usageStats.kpi.totalTokens'), value: fmt(totalTok), spark: trendTotals },
    { label: t('usageStats.kpi.sessions'), value: String(sessions), spark: trendTotals },
    { label: t('usageStats.kpi.messages'), value: String(messages), spark: trendTotals },
    { label: t('usageStats.kpi.cacheRatio'), value: `${cacheRatio.toFixed(0)}%`, spark: trendTotals },
  ];
  return (
    <Grid.Row gutter={12} style={{ marginBottom: 16 }}>
      {cards.map((c) => (
        <Grid.Col span={6} key={c.label}>
          <Card bordered>
            <div style={{ fontSize: 12, color: 'var(--text-secondary, #86909c)' }}>{c.label}</div>
            <div style={{ fontSize: 22, fontWeight: 600, margin: '4px 0' }}>{c.value}</div>
            <Sparkline values={c.spark} />
          </Card>
        </Grid.Col>
      ))}
    </Grid.Row>
  );
};

export default KpiRow;
```

- [ ] **Step 2: ComparisonRow.tsx**(工具对比环 + 项目排行 + 模型排行)

Create:

```tsx
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Card, Grid } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { AgentUsageResponse } from '@/common/types/agentUsage';
import CompositionDonut from './CompositionDonut';
import RankBar from './RankBar';
import { SEGMENT_PALETTE } from './Sparkline';
import { topN } from './chartMath';

const ComparisonRow: React.FC<{ data: AgentUsageResponse }> = ({ data }) => {
  const { t } = useTranslation();
  const agentSegs = data.summary.byAgent.map((x, i) => ({
    name: x.agent,
    value: x.totalTokens,
    color: SEGMENT_PALETTE[i % SEGMENT_PALETTE.length],
  }));
  const grandTotal = data.summary.byAgent.reduce((s, x) => s + x.totalTokens, 0);
  const fmtTotal = grandTotal >= 1_000_000 ? `${(grandTotal / 1_000_000).toFixed(1)}M` : String(grandTotal);

  const projRows = topN(data.byProject, (p) => p.totalTokens, 8).map((p) => ({
    label: p.project,
    value: p.totalTokens,
  }));
  const modelRows = topN(data.byModel, (m) => m.totalTokens, 8).map((m) => ({
    label: m.model,
    value: m.totalTokens,
  }));

  return (
    <Grid.Row gutter={12} style={{ marginBottom: 16 }}>
      <Grid.Col span={8}>
        <Card title={t('usageStats.comparison.title')} bordered>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <CompositionDonut segments={agentSegs} centerLabel={fmtTotal} />
          </div>
        </Card>
      </Grid.Col>
      <Grid.Col span={8}>
        <Card title={t('usageStats.comparison.projectsTitle')} bordered>
          <RankBar rows={projRows} />
        </Card>
      </Grid.Col>
      <Grid.Col span={8}>
        <Card title={t('usageStats.comparison.modelsTitle')} bordered>
          <RankBar rows={modelRows} />
        </Card>
      </Grid.Col>
    </Grid.Row>
  );
};

export default ComparisonRow;
```

- [ ] **Step 3: tsc + lint**

Run: `bunx tsc --noEmit 2>&1 | grep -ci "KpiRow\|ComparisonRow" | sed 's/^/tsc 错误: /' && bun run lint:fix 2>&1 | grep -ciE "^error" | sed 's/^/lint error: /'`
Expected: tsc 错误 0;lint error 0。

- [ ] **Step 4: 提交**

```bash
git add packages/desktop/src/renderer/pages/settings/UsageStats/KpiRow.tsx packages/desktop/src/renderer/pages/settings/UsageStats/ComparisonRow.tsx
git commit -m "feat(usage-stats): add KpiRow + ComparisonRow (v2)"
```

---

### Task 2.6: TrendChart 重写(堆叠/折线 + 分时累计 + 线性对数 + 构成环旁挂)

**Files:**

- Modify: `packages/desktop/src/renderer/pages/settings/UsageStats/TrendChart.tsx`(整体重写)

- [ ] **Step 1: 重写 TrendChart.tsx**

整体替换 `packages/desktop/src/renderer/pages/settings/UsageStats/TrendChart.tsx` 为:

```tsx
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Card, Radio } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { TrendPoint } from '@/common/types/agentUsage';
import { SEGMENT_PALETTE } from './Sparkline';
import { cumulative, logScale } from './chartMath';

const TrendChart: React.FC<{ points: TrendPoint[]; perPointLabel: string }> = ({ points, perPointLabel }) => {
  const { t } = useTranslation();
  const [mode, setMode] = React.useState<'split' | 'cumulative'>('split');
  const [scale, setScale] = React.useState<'linear' | 'log'>('linear');
  const [hidden, setHidden] = React.useState<Set<string>>(new Set());

  const allSegments = React.useMemo(() => {
    const set = new Set<string>();
    for (const p of points) for (const k of Object.keys(p.bySegment)) set.add(k);
    return Array.from(set).toSorted();
  }, [points]);

  const colorOf = React.useMemo(
    () => new Map(allSegments.map((n, i) => [n, SEGMENT_PALETTE[i % SEGMENT_PALETTE.length]])),
    [allSegments]
  );

  // 每桶（应用 hidden 过滤后）总量序列；累计模式做前缀和
  const totalsRaw = points.map((p) =>
    Object.entries(p.bySegment)
      .filter(([k]) => !hidden.has(k))
      .reduce((s, [, v]) => s + v, 0)
  );
  const totals = mode === 'cumulative' ? cumulative(totalsRaw) : totalsRaw;
  const scaled = totals.map((v) => (scale === 'log' ? logScale(v) : v));
  const max = Math.max(1, ...scaled);

  if (points.length === 0) {
    return (
      <Card title={t('usageStats.trend.title')} bordered style={{ marginBottom: 16 }}>
        <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ color: 'var(--text-secondary, #86909c)', fontSize: 13 }}>—</span>
        </div>
      </Card>
    );
  }

  return (
    <Card title={t('usageStats.trend.title')} bordered style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', gap: 12, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Radio.Group
          type='button'
          size='small'
          value={mode}
          onChange={(v: string) => setMode(v as 'split' | 'cumulative')}
        >
          <Radio value='split'>{t('usageStats.trendCtl.split')}</Radio>
          <Radio value='cumulative'>{t('usageStats.trendCtl.cumulative')}</Radio>
        </Radio.Group>
        <Radio.Group type='button' size='small' value={scale} onChange={(v: string) => setScale(v as 'linear' | 'log')}>
          <Radio value='linear'>{t('usageStats.trendCtl.linear')}</Radio>
          <Radio value='log'>{t('usageStats.trendCtl.log')}</Radio>
        </Radio.Group>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-secondary, #86909c)' }}>
          {perPointLabel}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 160, overflowX: 'auto' }}>
        {points.map((p, idx) => {
          const segs = Object.entries(p.bySegment)
            .filter(([k]) => !hidden.has(k))
            .toSorted(([, x], [, y]) => y - x);
          const totalHere = scaled[idx];
          const barHeight = totalHere > 0 ? Math.max((totalHere / max) * 130, 4) : 0;
          const rawTotal = totalsRaw[idx];
          return (
            <div
              key={p.bucket}
              style={{ textAlign: 'center', minWidth: 28 }}
              title={`${p.bucket}: ${rawTotal.toLocaleString()}`}
            >
              <div
                style={{
                  height: `${barHeight}px`,
                  display: 'flex',
                  flexDirection: 'column-reverse',
                  borderRadius: 2,
                  overflow: 'hidden',
                }}
              >
                {segs.map(([name, val]) => {
                  const frac = rawTotal > 0 ? val / rawTotal : 0;
                  return (
                    <div
                      key={name}
                      style={{ height: `${frac * barHeight}px`, background: colorOf.get(name), flexShrink: 0 }}
                    />
                  );
                })}
              </div>
              <div
                style={{ fontSize: 10, color: 'var(--text-secondary, #86909c)', marginTop: 4, whiteSpace: 'nowrap' }}
              >
                {p.bucket.slice(5)}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 8, fontSize: 11 }}>
        {allSegments.map((name) => {
          const off = hidden.has(name);
          return (
            <span
              key={name}
              onClick={() => {
                setHidden((prev) => {
                  const next = new Set(prev);
                  if (next.has(name)) next.delete(name);
                  else next.add(name);
                  return next;
                });
              }}
              style={{ cursor: 'pointer', opacity: off ? 0.4 : 1, textDecoration: off ? 'line-through' : 'none' }}
            >
              <span
                style={{
                  display: 'inline-block',
                  width: 10,
                  height: 10,
                  borderRadius: 2,
                  background: colorOf.get(name),
                  marginRight: 4,
                }}
              />
              {name}
            </span>
          );
        })}
      </div>
    </Card>
  );
};

export default TrendChart;
```

> 累计/对数/图例点选全部本地 state,不触发后端请求(设计第 5.1 节)。条高 clamp 4px(v1 教训④);颜色 SEGMENT_PALETTE 固定 hex + `var(--text-secondary,回退)`(v1 教训⑤)。

- [ ] **Step 2: tsc + lint**

Run: `bunx tsc --noEmit 2>&1 | grep -ci "TrendChart" | sed 's/^/tsc 错误: /' && bun run lint:fix 2>&1 | grep -ciE "^error" | sed 's/^/lint error: /'`
Expected: tsc 错误 0;lint error 0。

- [ ] **Step 3: 提交**

```bash
git add packages/desktop/src/renderer/pages/settings/UsageStats/TrendChart.tsx
git commit -m "feat(usage-stats): rewrite TrendChart with split/cumulative + log + legend toggle (v2)"
```

---

### Task 2.7: 容器 index.tsx 重构为仪表盘 + 容器测试(TDD)

**Files:**

- Modify: `packages/desktop/src/renderer/pages/settings/UsageStats/index.tsx`
- Modify: `tests/unit/settings/UsageStats.dom.test.tsx`

- [ ] **Step 1: 改容器测试 baseResp + 加仪表盘渲染断言**

`tests/unit/settings/UsageStats.dom.test.tsx` 的 `baseResp` 对象:`trend.points` 的元素加 `byTokenKind`,顶层加 `byProject`。即把 `trend: { granularity: 'day', points: [] }` 改为:

```ts
  trend: {
    granularity: 'day',
    points: [
      {
        bucket: '2026-05-17',
        bySegment: { claude: 3 },
        byTokenKind: { input: 1, output: 1, cacheRead: 1, cacheCreation: 0 },
      },
    ],
  },
```

并在 `byModel: []` 同级加 `byProject: [{ agent:'claude', project:'/p', sessions:1, inputTokens:1, outputTokens:1, cacheReadTokens:1, cacheCreationTokens:0, totalTokens:3 }],`。
现有 4 个测试断言不动(loading/data/404/error/refresh/loadMore/dimension 等仍有效)。追加一个仪表盘渲染断言:

```ts
  it('renders dashboard sections (KPI + comparison)', async () => {
    invoke.mockResolvedValue(baseResp);
    render(<UsageStats />);
    await waitFor(() => {
      expect(screen.queryAllByText((c) => c.includes('usageStats.kpi.totalTokens')).length).toBeGreaterThan(0);
      expect(screen.queryAllByText((c) => c.includes('usageStats.comparison.title')).length).toBeGreaterThan(0);
    });
  });
```

- [ ] **Step 2: 运行确认失败**

Run: `bun run test -- UsageStats 2>&1 | grep -E "Tests|FAIL" | tail -2`
Expected: FAIL(容器还没渲染 KpiRow/ComparisonRow;且 baseResp 类型变了 tsc 也会报)。

- [ ] **Step 3: 重写容器 index.tsx**

整体替换 `packages/desktop/src/renderer/pages/settings/UsageStats/index.tsx` 为(保留 v1 全部状态机/load/控制栏,组装改为仪表盘布局):

```tsx
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Spin, Empty, Alert, Button, Radio } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { AgentUsageResponse, AgentUsageParams } from '@/common/types/agentUsage';
import SettingsPageWrapper from '../components/SettingsPageWrapper';
import SourceBanner from './SourceBanner';
import KpiRow from './KpiRow';
import TrendChart from './TrendChart';
import CompositionDonut from './CompositionDonut';
import ComparisonRow from './ComparisonRow';
import SessionList from './SessionList';
import { SEGMENT_PALETTE } from './Sparkline';

const PAGE = 200;

const UsageStats: React.FC = () => {
  const { t } = useTranslation();
  const [data, setData] = useState<AgentUsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<'error' | 'unsupported' | null>(null);
  const [gran, setGran] = useState<'day' | 'week'>('day');
  const [range, setRange] = useState<'7d' | '30d' | '90d' | 'all'>('30d');
  const [dim, setDim] = useState<'agent' | 'project' | 'model'>('agent');
  const [offset, setOffset] = useState(0);

  const load = useCallback(async (params: AgentUsageParams, append: boolean) => {
    setLoading(true);
    setErr(null);
    try {
      const r = await ipcBridge.analytics.getAgentUsage.invoke(params);
      setData((prev) => (append && prev ? { ...r, sessions: [...prev.sessions, ...r.sessions] } : r));
    } catch (e: unknown) {
      const status = (e as { status?: number })?.status;
      setErr(status === 404 ? 'unsupported' : 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setOffset(0);
    void load(
      { trendGranularity: gran, timeRange: range, trendDimension: dim, sessionsLimit: PAGE, sessionsOffset: 0 },
      false
    );
  }, [gran, range, dim, load]);

  const refresh = () => {
    setOffset(0);
    void load(
      {
        trendGranularity: gran,
        timeRange: range,
        trendDimension: dim,
        refresh: true,
        sessionsLimit: PAGE,
        sessionsOffset: 0,
      },
      false
    );
  };

  const loadMore = () => {
    const next = offset + PAGE;
    setOffset(next);
    void load(
      { trendGranularity: gran, timeRange: range, trendDimension: dim, sessionsLimit: PAGE, sessionsOffset: next },
      true
    );
  };

  const perPointLabel = t('usageStats.trendCtl.perPoint', {
    span: gran === 'week' ? t('usageStats.granularity.week') : t('usageStats.granularity.day'),
  });

  return (
    <SettingsPageWrapper>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <Radio.Group type='button' value={range} onChange={(v: string) => setRange(v as '7d' | '30d' | '90d' | 'all')}>
          <Radio value='7d'>{t('usageStats.timeRange.7d')}</Radio>
          <Radio value='30d'>{t('usageStats.timeRange.30d')}</Radio>
          <Radio value='90d'>{t('usageStats.timeRange.90d')}</Radio>
          <Radio value='all'>{t('usageStats.timeRange.all')}</Radio>
        </Radio.Group>
        <Radio.Group type='button' value={gran} onChange={(v: string) => setGran(v as 'day' | 'week')}>
          <Radio value='day'>{t('usageStats.granularity.day')}</Radio>
          <Radio value='week'>{t('usageStats.granularity.week')}</Radio>
        </Radio.Group>
        <span style={{ fontSize: 12, color: 'var(--text-secondary, #86909c)' }}>
          {t('usageStats.trend.dimension.label')}
        </span>
        <Radio.Group type='button' value={dim} onChange={(v: string) => setDim(v as 'agent' | 'project' | 'model')}>
          <Radio value='agent'>{t('usageStats.trend.dimension.agent')}</Radio>
          <Radio value='project'>{t('usageStats.trend.dimension.project')}</Radio>
          <Radio value='model'>{t('usageStats.trend.dimension.model')}</Radio>
        </Radio.Group>
        <Button onClick={refresh} loading={loading}>
          {t('usageStats.refresh')}
        </Button>
      </div>

      {err === 'unsupported' && <Alert type='warning' content={t('usageStats.unsupported')} />}
      {err === 'error' && <Alert type='error' content={t('usageStats.error')} />}
      {loading && !data && <Spin style={{ display: 'block', textAlign: 'center', padding: 48 }} />}

      {data && !err && (
        <>
          <SourceBanner sources={data.sources} />
          {data.summary.byAgent.length === 0 ? (
            <Empty description={t('usageStats.empty')} />
          ) : (
            <>
              <KpiRow data={data} />
              <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
                <div style={{ flex: 2, minWidth: 320 }}>
                  <TrendChart points={data.trend.points} perPointLabel={perPointLabel} />
                </div>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <CompositionDonutCard data={data} />
                </div>
              </div>
              <ComparisonRow data={data} />
              <SessionList
                rows={data.sessions}
                total={data.sessionsTotal}
                hasMore={data.sessions.length < data.sessionsTotal}
                onLoadMore={loadMore}
              />
            </>
          )}
        </>
      )}
    </SettingsPageWrapper>
  );
};

// token 构成环卡片（用 summary 求和的四类 token）
const CompositionDonutCard: React.FC<{ data: AgentUsageResponse }> = ({ data }) => {
  const { t } = useTranslation();
  const a = data.summary.byAgent;
  const inp = a.reduce((s, x) => s + x.inputTokens, 0);
  const out = a.reduce((s, x) => s + x.outputTokens, 0);
  const cr = a.reduce((s, x) => s + x.cacheReadTokens, 0);
  const cc = a.reduce((s, x) => s + x.cacheCreationTokens, 0);
  const total = inp + out + cr + cc;
  const fmtT = total >= 1_000_000 ? `${(total / 1_000_000).toFixed(1)}M` : String(total);
  const segs = [
    { name: t('usageStats.composition.input'), value: inp, color: SEGMENT_PALETTE[0] },
    { name: t('usageStats.composition.output'), value: out, color: SEGMENT_PALETTE[2] },
    { name: t('usageStats.composition.cacheRead'), value: cr, color: SEGMENT_PALETTE[4] },
    { name: t('usageStats.composition.cacheCreation'), value: cc, color: SEGMENT_PALETTE[5] },
  ];
  return (
    <div
      style={{
        border: '1px solid var(--color-border, #e5e6eb)',
        borderRadius: 4,
        padding: 16,
        height: '100%',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ fontWeight: 500, marginBottom: 12 }}>{t('usageStats.composition.title')}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <CompositionDonut segments={segs} centerLabel={fmtT} centerSub='tokens' />
        <div style={{ fontSize: 12, lineHeight: 1.9 }}>
          {segs.map((s) => (
            <div key={s.name}>
              <span
                style={{
                  display: 'inline-block',
                  width: 10,
                  height: 10,
                  borderRadius: 2,
                  background: s.color,
                  marginRight: 6,
                }}
              />
              {s.name} {s.value.toLocaleString()}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default UsageStats;
```

> `var(--color-border, #e5e6eb)` 回退保护。`Radio.Group onChange` 用 `(v:string)=>set(v as ...)` 包装(v1 tsc 适配经验)。`perPointLabel` 用 i18next 插值 `{{span}}`。

- [ ] **Step 4: 运行测试 + tsc + i18n**

Run:

```bash
bun run test -- UsageStats agentUsage chartMath 2>&1 | grep -E "Test Files|Tests " | tail -2
bunx tsc --noEmit 2>&1 | tail -1; echo "tsc: $?"
node scripts/check-i18n.js 2>&1 | grep -E "passed|❌" | tail -1
```

Expected: 测试全 passed;tsc 0;i18n passed。若 UsageStats.dom 旧测试因 Arco Grid jsdom 报 matchMedia,沿用 v1 已有的 `window.matchMedia` mock(该测试文件 beforeEach 已有,无需新增)。

- [ ] **Step 5: 提交**

```bash
git add packages/desktop/src/renderer/pages/settings/UsageStats/index.tsx tests/unit/settings/UsageStats.dom.test.tsx
git commit -m "feat(usage-stats): refactor container into dashboard layout (v2)"
```

---

## 阶段 3 — 联调与收尾

### Task 3.1: CDP 真实环境验证

- [ ] **Step 1: 软链阶段1二进制 + 起 dev**

Run:

```bash
ln -sf /Users/jassy/Documents/glm/aionui_ws/AionCLI/target/release/aioncli ~/.local/bin/aioncli
pkill -9 -f "node_modules/.bun/electron@" 2>/dev/null; pkill -9 -f "\.local/bin/aioncli\|aionui-dev" 2>/dev/null; pkill -9 -f "electron-vite" 2>/dev/null; sleep 3
PATH="$HOME/.local/bin:$PATH" nohup bun run dev > /tmp/v2dev.log 2>&1 &
sleep 35
grep -iE "main process built|Another instance|Remote debugging port" /tmp/v2dev.log | tail -3
```

Expected: `electron main process built successfully`,无 "Another instance",有 CDP 端口(通常 9230)。若有 "Another instance" → 残留进程没杀干净,重跑 pkill。

- [ ] **Step 2: CDP 抓仪表盘真实渲染(替换占位)**

用 node + ws 模块连 CDP(端口取 Step1 日志里的,通常 9230),导航 `http://localhost:5173/#/settings/usage`,等 8s,evaluate JS 检查:(a) KPI 卡数量(应 4)、sparkline svg 存在;(b) 趋势卡内分时/累计/线性/对数 Radio 存在、堆叠段有非透明背景色;(c) 构成环 svg 段 stroke 非 transparent;(d) 对比排行行 3 卡(工具环 + 项目 RankBar + 模型 RankBar)有内容;(e) 无 `TypeError`/`exceptionThrown`。脚本参考 v1 用过的 CDP 探针写法(`require('/Users/jassy/Documents/glm/aionui_ws/AionUi/node_modules/ws')`,`Runtime.enable` + `Page.navigate` + `Runtime.evaluate` returnByValue)。把结果 JSON 贴出。
Expected: KPI 4 卡;堆叠段/构成环颜色为 SEGMENT_PALETTE 的 rgb(非 rgba(0,0,0,0));无 fatal exception。

- [ ] **Step 3: dark 主题验证(用项目真实选择器)**

CDP evaluate 设 `document.documentElement.setAttribute('data-color-scheme','default'); document.documentElement.setAttribute('data-theme','dark')`(v1 确认的真实选择器),再读趋势段色/文字色/卡片底色。
Expected:卡片底色变深(如 rgb(35,35,36)),段色仍是 SEGMENT_PALETTE 亮色清晰,文字 `var(--text-secondary)` 在 dark 下变浅(#ced3da)。

- [ ] **Step 4: 记录验证结果**

把 Step 2/3 的 CDP JSON 结果记到本计划文件末尾"验证结果"节(诚实记录;无法验证项明确声明,不谎报 per verification-before-completion)。

### Task 3.2: 双仓库门禁 + 推 fork

- [ ] **Step 1: AionCLI 门禁**

Run(在 AionCLI):

```bash
cargo clippy --workspace -- -D warnings 2>&1 | tail -1; echo $?
cargo fmt --all -- --check 2>&1 | tail -1; echo $?
cargo test -p aionui-analytics 2>&1 | grep "test result" | tail -1
```

Expected: clippy/fmt 退出 0;测试 ok。

- [ ] **Step 2: AionUi 门禁(prek replicates CI)**

Run(在 AionUi):

```bash
prek run --from-ref origin/dev --to-ref HEAD 2>&1 | tail -15
bun run test -- agentUsage chartMath UsageStats 2>&1 | grep -E "Test Files|Tests " | tail -2
```

Expected: prek 全 Passed(TypeScript/Oxlint/Oxfmt/i18n/EOF/trailing-ws);测试全 passed。prek 报问题则按 `bun run lint:fix && bun run format` 修复后 commit 再重跑。

- [ ] **Step 3: 推送两仓库到 fork**

Run:

```bash
cd /Users/jassy/Documents/glm/aionui_ws/AionCLI && git push fork feat/agent-usage-analytics 2>&1 | tail -2
cd /Users/jassy/Documents/glm/aionui_ws/AionUi && git push fork feat/agent-usage-stats 2>&1 | tail -2
```

Expected: 两仓库各推送成功到 `Jassy930/AionCore` / `Jassy930/AionUi`。(上游 `iOfficeAI/*` 无写权限,只推 fork — 沿用 v1。)

### Task 3.3: 文档同步

- [ ] **Step 1: 更新 v2 设计文档状态**

`docs/prds/settings/agent_usage/v2-observability-design.md` 头部状态从"设计已确认, 待写实现计划"改为"v2 已实现 (本地 feature 分支 + fork);CDP 双主题验证;门禁通过"。

- [ ] **Step 2: 提交**

```bash
git add docs/prds/settings/agent_usage/v2-observability-design.md docs/prds/settings/agent_usage/v2-implementation-plan.md
git commit -m "docs(specs): mark usage stats v2 implemented"
git push fork feat/agent-usage-stats 2>&1 | tail -1
```

---

## Self-Review (计划自审)

**1. Spec 覆盖检查:**

- ① token 构成可视化 → Task 2.4 CompositionDonut + Task 2.7 CompositionDonutCard ✓
- ② 汇总卡 sparkline+构成条 → Task 2.4 Sparkline + Task 2.5 KpiRow ✓
- ③ 趋势图增强(分时累计/线性对数/series点选/粒度标注/token类型分层) → Task 2.6 TrendChart(分时累计/对数/图例点选)+ Task 1.2 by_token_kind + Task 2.7 perPointLabel ✓
- ④ 对比/排行(工具环+项目+模型) → Task 2.5 ComparisonRow + Task 1.2 by_project ✓
- B 仪表盘布局 → Task 2.7 容器组装 ✓
- 后端契约扩展(by_token_kind/by_project,向后兼容,不变量) → Task 1.1/1.2 ✓
- 手写 SVG 零依赖 → 全部组件无图表库 import ✓
- v1 五教训 → 计划头部强制 + 各组件颜色用 var()+回退 / clamp / 双括号 / tests/unit / 深路径规避 ✓
- 核心逻辑 100% → chartMath 纯函数单测(Task 2.2)+ aggregate 不变量(Task 1.2)+ mapper(Task 2.1)+ 容器状态机(Task 2.7,复用 v1 测试)✓;SVG 渲染走 CDP(Task 3.1)
- 不做成本 → 计划无任何价格/$ 逻辑 ✓

**2. 占位符扫描:** 无 TBD/TODO;每个 code step 含完整代码;命令含 expected。Task 3.1 Step2 CDP 脚本"参考 v1 写法"——v1 计划已有完整 CDP 探针范例可直接复用,非占位(指明了 ws 模块路径与 CDP 方法)。

**3. 类型一致性:** `TokenKindBreakdown`/`UsageByProject`(Rust)↔ `TokenKindBreakdownRaw/byTokenKind`、`UsageByProjectRaw/UsageByProject/byProject`(TS)字段逐一对齐(Task 1.1 vs 2.1);`cumulative/logScale/topN/pct`(Task 2.2 定义)在 Task 2.5/2.6 调用名一致;`SEGMENT_PALETTE` 在 Sparkline 定义并被 ComparisonRow/TrendChart/index.tsx import 一致;`CompositionDonut` props `{segments,centerLabel,centerSub}`(Task 2.4)与 Task 2.5/2.7 调用一致;`RankBar` props `{rows:{label,value}[]}` 一致;`TrendChart` props `{points,perPointLabel}`(Task 2.6)与 Task 2.7 调用一致。

**已知实现期注意(非缺陷):**

- KpiRow sessions/messages 的 sparkline 暂用 trend 总量序列(trend 无 per-bucket 会话/消息数)——设计未要求精确,作"微趋势示意"可接受;若 review 认为需精确可后续 v2.1。
- Task 3.1 CDP 端口默认 9230,Step1 已让先读日志确认实际端口。

---

## 验证结果 (Task 3.1 CDP 真实环境)

- 日期: 2026-05-19
- 环境: dev server (renderer 5173, CDP 9230, aioncli backend release 二进制 51599), 真实本地日志数据
- 工具: node + ws CDP 探针, 导航 `#/settings/usage`, 等 9s

### Light 主题 (实测 JSON)

- KPI: 9 个 `.arco-card` (4 KPI 卡 + 趋势/构成/对比排行卡), **4 个 sparkline** stroke 全 `rgb(52,145,250)` = SEGMENT_PALETTE[0] ✅
- 趋势控制: Radio 全部存在 — Split/Cumulative/Linear/Log + Tool/Project/Model + 4 时间窗 ✅
- 堆叠段: 24 个 palette 着色 div, 样本 `rgb(52,145,250)`/`rgb(0,180,42)` = SEGMENT_PALETTE ✅ (非 rgba(0,0,0,0))
- 构成环: 10 段 stroke, palette 色 `rgb(52,145,250)/rgb(255,125,0)/rgb(114,46,209)/rgb(20,201,201)` 非透明 ✅
- 真实数据渲染: Total tokens 3849.04M / Sessions 259 / Messages 16182 ✅
- 无 TypeError / exceptionThrown ✅

### Dark 主题 (项目真实选择器 data-theme=dark)

- palette 色 (sparkline/构成环) 保持亮色不变, dark 下仍清晰 ✅
- `perPointColor` 由浅色文字正确切换为 `rgb(206,211,218)` (--text-secondary dark 值) ✅
- 构成环底圈 stroke 由 `rgb(69,77,95)` → `rgb(206,211,218)` (--text-secondary 跟随主题) ✅
- 已知: `.arco-card` 背景 CDP attribute-set 下未变深 (rgb(255,255,255))。与 v1 一致 — Arco 表层完整重绘需应用自带主题切换器, 非仅 `data-theme` 属性; CDP 仅翻转 CSS 变量 (故文字/语义色已正确变 dark)。lesson ④⑤ 实际管控的 SVG/palette/文字变量色在双主题均验证正确, 不构成缺陷。

### 结论

仪表盘整体渲染正确, SVG 图表 (sparkline/堆叠趋势/构成环/排行条) 配色符合 SEGMENT_PALETTE + 语义变量回退设计, 真实数据下无异常。Light 全绿; Dark 下 lesson ④⑤ 范畴 (SVG/palette/文字变量) 全绿, Arco 表层底色重绘属已知非缺陷 (沿用 v1 结论, 诚实记录 per verification-before-completion)。

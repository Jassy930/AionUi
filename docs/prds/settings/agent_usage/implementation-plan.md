# 本地 Agent 使用统计页面 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 AionUi Settings 新增「使用统计」Tab, 通过 AionCLI 新增的 `aionui-analytics` crate 解析本地 Codex/Claude Code 会话日志, 展示 token 用量 (汇总/按模型/趋势/会话明细), 两端均不持久化。

**Architecture:** AionCLI 新建领域层 crate `aionui-analytics`, 解析 `~/.claude/projects/**/*.jsonl` 与 `~/.codex/sessions/**/*.jsonl`, 经受鉴权保护的 `GET /api/analytics/agent-usage` 返回 `ApiResponse<AgentUsageResponse>`。AionUi 新增 `ipcBridge.analytics` (path builder 手动拼 query + snake→camel mapper) 与 Settings Tab (Arco 组件纯展示)。

**Tech Stack:** Rust (Axum 0.8, serde, walkdir, dirs, chrono, dashmap, tokio) / TypeScript (React, @arco-design/web-react, Vitest)

**关联设计文档:** `docs/prds/settings/agent_usage/design.md`

**仓库与分支:**
- AionCLI: `/Users/jassy/Documents/glm/aionui_ws/AionCLI`, 从 `main` 切 `feat/agent-usage-analytics`
- AionUi: `/Users/jassy/Documents/glm/aionui_ws/AionUi`, 从 `dev` 切 `feat/agent-usage-stats`

**执行顺序:** 阶段 1 (Rust 后端) 必须先完成并产出可用 aioncli 二进制, 阶段 2 (前端) 依赖阶段 1 的契约, 阶段 3 联调。

---

## 阶段 1 — AionCLI 后端 (`aionui-analytics` crate)

> 所有阶段 1 命令在 `/Users/jassy/Documents/glm/aionui_ws/AionCLI` 下执行。

### Task 1.1: 创建分支与 crate 骨架

**Files:**
- Create: `crates/aionui-analytics/Cargo.toml`
- Create: `crates/aionui-analytics/src/lib.rs`
- Modify: `Cargo.toml` (workspace members)

- [ ] **Step 1: 创建分支**

Run:
```bash
git checkout main && git pull && git checkout -b feat/agent-usage-analytics
```

- [ ] **Step 2: 查现有 crate 的 Cargo.toml 依赖版本基线**

Run:
```bash
cat crates/aionui-system/Cargo.toml
```
Expected: 看到 `aionui-common`、`aionui-api-types`、`axum`、`serde`、`tokio` 等的声明方式 (多为 `xxx = { workspace = true }`)。记下写法。

- [ ] **Step 3: 创建 crate Cargo.toml**

Create `crates/aionui-analytics/Cargo.toml`。**所有依赖必须 workspace 继承 (回应 review P2)** — 经核实 root `Cargo.toml` 已声明: `dirs = "6"` (非 5)、`walkdir = "2"`、`dashmap = "6"`、`tempfile = "3"`、`chrono`、`tokio`、`axum`、`serde`、`serde_json`、`tracing`、`tower`; **没有 `futures`** (workspace 只有 `futures-util = "0.3"`)。本 crate MVP 用同步 `walkdir` 枚举, 不需要 `futures`/`buffer_unordered` (并发优化非 MVP, YAGNI):

```toml
[package]
name = "aionui-analytics"
version = "0.1.0"
edition = "2021"

[dependencies]
aionui-common = { workspace = true }
aionui-api-types = { workspace = true }
axum = { workspace = true }
serde = { workspace = true }
serde_json = { workspace = true }
tokio = { workspace = true }
chrono = { workspace = true }
tracing = { workspace = true }
walkdir = { workspace = true }
dirs = { workspace = true }
dashmap = { workspace = true }

[dev-dependencies]
tempfile = { workspace = true }
```

> 创建前先 `grep -n 'walkdir\|dirs\|dashmap\|tempfile\|chrono' Cargo.toml` 复核 workspace 实际声明; 若某项 workspace 未声明再降级为具体版本并在 PR 说明。Step 3 的 `[dev-dependencies]` 后续 Task 1.9 会追加 `tower = { workspace = true, features = ["util"] }`。

- [ ] **Step 4: 创建占位 lib.rs**

Create `crates/aionui-analytics/src/lib.rs`:

```rust
//! Local agent usage analytics: parse Codex/Claude Code session logs and aggregate token usage.
pub mod aggregate;
pub mod cache;
pub mod parser;
pub mod routes;
pub mod service;
pub mod types;

pub use routes::{AnalyticsRouterState, analytics_routes};
```

- [ ] **Step 5: 注册到 workspace**

Modify root `Cargo.toml` — 在 `[workspace] members = [...]` 数组中加入 `"crates/aionui-analytics"` (保持字母序与现有风格一致; 先 `grep -n "crates/aionui-system" Cargo.toml` 找到 members 列表位置)。

- [ ] **Step 6: 提交**

```bash
git add crates/aionui-analytics/Cargo.toml crates/aionui-analytics/src/lib.rs Cargo.toml
git commit -m "feat(analytics): scaffold aionui-analytics crate"
```

---

### Task 1.2: 内部类型 `types.rs`

**Files:**
- Create: `crates/aionui-analytics/src/types.rs`

- [ ] **Step 1: 写类型 (无测试, 纯数据结构)**

Create `crates/aionui-analytics/src/types.rs`:

```rust
use serde::Serialize;

/// Agent 标识。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Agent {
    Claude,
    Codex,
}

impl Agent {
    pub fn as_str(self) -> &'static str {
        match self {
            Agent::Claude => "claude",
            Agent::Codex => "codex",
        }
    }
}

/// 单个用量事件 (Claude 一条 assistant 消息 / Codex 一个 token_count 事件)。
#[derive(Debug, Clone)]
pub struct UsageEvent {
    /// 事件 UTC 时间戳。
    pub at: chrono::DateTime<chrono::Utc>,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_creation_tokens: u64,
}

impl UsageEvent {
    pub fn total(&self) -> u64 {
        self.input_tokens + self.output_tokens + self.cache_read_tokens + self.cache_creation_tokens
    }
}

/// 解析一个日志文件得到的会话。
#[derive(Debug, Clone)]
pub struct ParsedSession {
    pub agent: Agent,
    pub session_id: String,
    pub project: String,
    /// 会话级主要 model (出现最多者; 缺失为 "unknown")。
    pub model: String,
    pub started_at: chrono::DateTime<chrono::Utc>,
    pub last_active_at: chrono::DateTime<chrono::Utc>,
    /// 该会话所有用量事件 (已按时间升序)。
    pub events: Vec<UsageEvent>,
    /// 消息计数 (Claude: assistant 消息数; Codex: assistant role 的 response_item 数)。
    pub message_count: u64,
}

/// 解析失败原因 (用于上层计 skipped)。
#[derive(Debug)]
pub enum ParseError {
    Io(std::io::Error),
    /// 文件存在但无任何可识别内容。
    Empty,
}

impl From<std::io::Error> for ParseError {
    fn from(e: std::io::Error) -> Self {
        ParseError::Io(e)
    }
}
```

- [ ] **Step 2: 编译检查**

Run: `cargo check -p aionui-analytics`
Expected: PASS (可能有 unused warning, 忽略)

- [ ] **Step 3: 提交**

```bash
git add crates/aionui-analytics/src/types.rs
git commit -m "feat(analytics): add internal types"
```

---

### Task 1.3: Claude 解析器 (TDD)

**Files:**
- Create: `crates/aionui-analytics/src/parser/mod.rs`
- Create: `crates/aionui-analytics/src/parser/claude.rs`
- Create: `crates/aionui-analytics/tests/fixtures/claude_sample.jsonl`
- Create: `crates/aionui-analytics/tests/claude_parser.rs`

- [ ] **Step 1: 写脱敏 fixture**

Create `crates/aionui-analytics/tests/fixtures/claude_sample.jsonl` (两条 assistant 消息, 跨两天, 脱敏路径):

```
{"type":"user","timestamp":"2026-05-16T10:00:00.000Z","cwd":"/work/proj-a","sessionId":"sess-claude-1","message":{"role":"user","content":"hi"}}
{"type":"assistant","timestamp":"2026-05-16T10:00:05.000Z","cwd":"/work/proj-a","sessionId":"sess-claude-1","message":{"model":"claude-opus-4-7","role":"assistant","usage":{"input_tokens":100,"output_tokens":50,"cache_creation_input_tokens":200,"cache_read_input_tokens":0}}}
{"type":"assistant","timestamp":"2026-05-17T09:00:00.000Z","cwd":"/work/proj-a","sessionId":"sess-claude-1","message":{"model":"claude-opus-4-7","role":"assistant","usage":{"input_tokens":10,"output_tokens":5,"cache_creation_input_tokens":0,"cache_read_input_tokens":300}}}
{"type":"assistant","timestamp":"bad-line-no-usage","message":{"role":"assistant"}}
```

- [ ] **Step 2: 写失败测试**

Create `crates/aionui-analytics/tests/claude_parser.rs`:

```rust
use aionui_analytics::parser::{LogParser, claude::ClaudeParser};
use aionui_analytics::types::Agent;

#[test]
fn parses_claude_session_with_usage_accumulation() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/claude_sample.jsonl");
    let session = ClaudeParser.parse_file(&path).expect("should parse");

    assert_eq!(session.agent, Agent::Claude);
    assert_eq!(session.session_id, "sess-claude-1");
    assert_eq!(session.project, "/work/proj-a");
    assert_eq!(session.model, "claude-opus-4-7");
    // 两条有效 assistant 消息 (坏行被跳过)。
    assert_eq!(session.events.len(), 2);
    assert_eq!(session.message_count, 2);
    // 事件 1: 100+50+200+0=350; 事件 2: 10+5+0+300=315
    let total: u64 = session.events.iter().map(|e| e.total()).sum();
    assert_eq!(total, 665);
    // 事件按时间升序。
    assert!(session.events[0].at < session.events[1].at);
    assert_eq!(session.started_at.to_rfc3339(), "2026-05-16T10:00:05+00:00");
}
```

- [ ] **Step 3: 运行测试确认失败**

Run: `cargo test -p aionui-analytics --test claude_parser`
Expected: FAIL — `parser::claude` 不存在 / 编译错误

- [ ] **Step 4: 写 parser trait**

Create `crates/aionui-analytics/src/parser/mod.rs`:

```rust
pub mod claude;
pub mod codex;

use crate::types::{ParseError, ParsedSession};
use std::path::Path;

pub trait LogParser {
    fn parse_file(&self, path: &Path) -> Result<ParsedSession, ParseError>;
}

/// 读取 jsonl 文件, 对每个非空行调用 `f`; 解析失败的行被静默跳过。
pub(crate) fn for_each_json_line<F>(path: &Path, mut f: F) -> Result<(), std::io::Error>
where
    F: FnMut(&serde_json::Value),
{
    use std::io::BufRead;
    let file = std::fs::File::open(path)?;
    let reader = std::io::BufReader::new(file);
    for line in reader.lines() {
        let line = line?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(trimmed) {
            f(&v);
        }
    }
    Ok(())
}

/// 解析 RFC3339 时间戳; 失败返回 None。
pub(crate) fn parse_ts(s: &str) -> Option<chrono::DateTime<chrono::Utc>> {
    chrono::DateTime::parse_from_rfc3339(s)
        .ok()
        .map(|dt| dt.with_timezone(&chrono::Utc))
}
```

- [ ] **Step 5: 写 Claude parser**

Create `crates/aionui-analytics/src/parser/claude.rs`:

```rust
use super::{LogParser, for_each_json_line, parse_ts};
use crate::types::{Agent, ParseError, ParsedSession, UsageEvent};
use std::collections::HashMap;
use std::path::Path;

pub struct ClaudeParser;

impl LogParser for ClaudeParser {
    fn parse_file(&self, path: &Path) -> Result<ParsedSession, ParseError> {
        let mut events: Vec<UsageEvent> = Vec::new();
        let mut model_counts: HashMap<String, u64> = HashMap::new();
        let mut session_id = String::new();
        let mut project = String::new();
        let mut message_count: u64 = 0;

        for_each_json_line(path, |v| {
            if v.get("type").and_then(|t| t.as_str()) != Some("assistant") {
                return;
            }
            let ts = v.get("timestamp").and_then(|t| t.as_str()).and_then(parse_ts);
            let msg = v.get("message");
            let usage = msg.and_then(|m| m.get("usage"));
            let (ts, usage) = match (ts, usage) {
                (Some(ts), Some(u)) => (ts, u),
                _ => return,
            };
            if session_id.is_empty()
                && let Some(s) = v.get("sessionId").and_then(|s| s.as_str())
            {
                session_id = s.to_string();
            }
            if project.is_empty()
                && let Some(c) = v.get("cwd").and_then(|c| c.as_str())
            {
                project = c.to_string();
            }
            if let Some(m) = msg.and_then(|m| m.get("model")).and_then(|m| m.as_str()) {
                *model_counts.entry(m.to_string()).or_insert(0) += 1;
            }
            let g = |k: &str| usage.get(k).and_then(|x| x.as_u64()).unwrap_or(0);
            events.push(UsageEvent {
                at: ts,
                input_tokens: g("input_tokens"),
                output_tokens: g("output_tokens"),
                cache_read_tokens: g("cache_read_input_tokens"),
                cache_creation_tokens: g("cache_creation_input_tokens"),
            });
            message_count += 1;
        })?;

        if events.is_empty() {
            return Err(ParseError::Empty);
        }
        events.sort_by_key(|e| e.at);
        let model = model_counts
            .into_iter()
            .max_by_key(|(_, c)| *c)
            .map(|(m, _)| m)
            .unwrap_or_else(|| "unknown".to_string());
        let started_at = events.first().unwrap().at;
        let last_active_at = events.last().unwrap().at;

        Ok(ParsedSession {
            agent: Agent::Claude,
            session_id: if session_id.is_empty() {
                path.file_stem().and_then(|s| s.to_str()).unwrap_or("unknown").to_string()
            } else {
                session_id
            },
            project: if project.is_empty() { "unknown".to_string() } else { project },
            model,
            started_at,
            last_active_at,
            events,
            message_count,
        })
    }
}
```

- [ ] **Step 6: 加 codex.rs 占位 (避免 mod 编译失败)**

Create `crates/aionui-analytics/src/parser/codex.rs`:

```rust
// Implemented in Task 1.4.
```

- [ ] **Step 7: 运行测试确认通过**

Run: `cargo test -p aionui-analytics --test claude_parser`
Expected: PASS

- [ ] **Step 8: 提交**

```bash
git add crates/aionui-analytics/src/parser crates/aionui-analytics/tests
git commit -m "feat(analytics): add claude log parser with TDD"
```

---

### Task 1.4: Codex 解析器 (TDD)

**Files:**
- Create: `crates/aionui-analytics/tests/fixtures/codex_sample.jsonl`
- Create: `crates/aionui-analytics/tests/codex_parser.rs`
- Modify: `crates/aionui-analytics/src/parser/codex.rs`

- [ ] **Step 1: 写脱敏 fixture**

Create `crates/aionui-analytics/tests/fixtures/codex_sample.jsonl` (session_meta + 跨两天的 token_count 事件 + assistant message):

```
{"timestamp":"2026-05-16T08:00:00.000Z","type":"session_meta","payload":{"id":"sess-codex-1","timestamp":"2026-05-16T08:00:00.000Z","cwd":"/work/proj-b","cli_version":"0.111.0","model_provider":"crs"}}
{"timestamp":"2026-05-16T08:00:10.000Z","type":"turn_context","payload":{"model":"gpt-5.1-codex"}}
{"timestamp":"2026-05-16T08:00:20.000Z","type":"response_item","payload":{"type":"message","role":"assistant","content":"ok"}}
{"timestamp":"2026-05-16T08:00:21.000Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1000,"cached_input_tokens":200,"output_tokens":50,"reasoning_output_tokens":10,"total_tokens":1060},"last_token_usage":{"input_tokens":1000,"cached_input_tokens":200,"output_tokens":50,"reasoning_output_tokens":10,"total_tokens":1060},"model_context_window":258400}}}
{"timestamp":"2026-05-17T09:00:00.000Z","type":"response_item","payload":{"type":"message","role":"assistant","content":"more"}}
{"timestamp":"2026-05-17T09:00:01.000Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1500,"cached_input_tokens":400,"output_tokens":80,"reasoning_output_tokens":20,"total_tokens":1580},"last_token_usage":{"input_tokens":500,"cached_input_tokens":200,"output_tokens":30,"reasoning_output_tokens":10,"total_tokens":520},"model_context_window":258400}}}
```

- [ ] **Step 2: 写失败测试**

Create `crates/aionui-analytics/tests/codex_parser.rs`:

```rust
use aionui_analytics::parser::{LogParser, codex::CodexParser};
use aionui_analytics::types::Agent;

#[test]
fn parses_codex_session_event_level() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/codex_sample.jsonl");
    let session = CodexParser.parse_file(&path).expect("should parse");

    assert_eq!(session.agent, Agent::Codex);
    assert_eq!(session.session_id, "sess-codex-1");
    assert_eq!(session.project, "/work/proj-b");
    assert_eq!(session.model, "gpt-5.1-codex");
    // 两个 token_count 事件, 按事件时间。
    assert_eq!(session.events.len(), 2);
    // 两条 assistant response_item。
    assert_eq!(session.message_count, 2);
    // 用 last_token_usage 增量: 事件1 input=1000 output=50 cache_read=200 (cached_input);
    // 事件2 input=500 output=30 cache_read=200
    assert_eq!(session.events[0].input_tokens, 1000);
    assert_eq!(session.events[0].cache_read_tokens, 200);
    assert_eq!(session.events[1].input_tokens, 500);
    assert!(session.events[0].at < session.events[1].at);
}

#[test]
fn codex_fallback_when_no_event_level_usage() {
    // 只有 total_token_usage, 无 last_token_usage / 无行级时间 → 必须 fallback,
    // 不能静默丢弃整文件 (回应 review P2)。
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
    let path = dir.join("codex_fallback.jsonl");
    let session = CodexParser.parse_file(&path).expect("must fallback, not Empty");
    assert_eq!(session.agent, Agent::Codex);
    // fallback 单事件归到会话开始日; 总量 = 700+40+0
    assert_eq!(session.events.len(), 1);
    let e = &session.events[0];
    assert_eq!(e.input_tokens, 700);
    assert_eq!(e.output_tokens, 40);
    assert_eq!(e.at, session.started_at);
}

#[test]
fn codex_truncated_log_without_session_meta_is_dropped() {
    // 文档化已知取舍 (回应 review Important): 损坏/截断的 Codex 日志若缺 session_meta,
    // started_at 无从得知, 即便有 total_token_usage 也会被丢弃 (ParseError::Empty)。
    // 这是有意取舍 (损坏日志罕见); 此测试锁定该行为, 防止未来无意改变语义。
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/codex_no_meta.jsonl");
    let result = CodexParser.parse_file(&path);
    assert!(result.is_err(), "无 session_meta 的截断日志当前被丢弃 (已知取舍)");
}
```

Also create `crates/aionui-analytics/tests/fixtures/codex_fallback.jsonl` (无 last_token_usage, 无 event_msg 行级时间也可被 fallback 覆盖):

```
{"timestamp":"2026-05-10T08:00:00.000Z","type":"session_meta","payload":{"id":"sess-fb","timestamp":"2026-05-10T08:00:00.000Z","cwd":"/work/fb","cli_version":"0.111.0","model_provider":"crs"}}
{"timestamp":"2026-05-10T08:00:05.000Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":700,"cached_input_tokens":0,"output_tokens":40,"reasoning_output_tokens":0,"total_tokens":740}}}}
```

And create `crates/aionui-analytics/tests/fixtures/codex_no_meta.jsonl` (截断日志: 无 session_meta, 仅一个带 total_token_usage 的 event_msg — 文档化已知丢弃行为):

```
{"timestamp":"2026-05-11T08:00:00.000Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":500,"cached_input_tokens":0,"output_tokens":30,"reasoning_output_tokens":0,"total_tokens":530}}}}
```

- [ ] **Step 3: 运行测试确认失败**

Run: `cargo test -p aionui-analytics --test codex_parser`
Expected: FAIL — `CodexParser` 不存在

- [ ] **Step 4: 写 Codex parser**

Overwrite `crates/aionui-analytics/src/parser/codex.rs`:

```rust
use super::{LogParser, for_each_json_line, parse_ts};
use crate::types::{Agent, ParseError, ParsedSession, UsageEvent};
use std::path::Path;

pub struct CodexParser;

impl LogParser for CodexParser {
    fn parse_file(&self, path: &Path) -> Result<ParsedSession, ParseError> {
        let mut events: Vec<UsageEvent> = Vec::new();
        let mut session_id = String::new();
        let mut project = String::new();
        let mut model = String::new();
        let mut started_at: Option<chrono::DateTime<chrono::Utc>> = None;
        let mut message_count: u64 = 0;
        // (input, output, cached) 最后一个 total_token_usage, 用于 fallback。
        let mut last_total: Option<(u64, u64, u64)> = None;

        for_each_json_line(path, |v| {
            let line_ts = v.get("timestamp").and_then(|t| t.as_str()).and_then(parse_ts);
            let kind = v.get("type").and_then(|t| t.as_str()).unwrap_or("");
            let payload = v.get("payload");

            match kind {
                "session_meta" => {
                    if let Some(p) = payload {
                        if let Some(s) = p.get("id").and_then(|s| s.as_str()) {
                            session_id = s.to_string();
                        }
                        if let Some(c) = p.get("cwd").and_then(|c| c.as_str()) {
                            project = c.to_string();
                        }
                        if let Some(t) = p.get("timestamp").and_then(|t| t.as_str()).and_then(parse_ts) {
                            started_at.get_or_insert(t);
                        }
                    }
                }
                "turn_context" => {
                    if model.is_empty()
                        && let Some(m) = payload.and_then(|p| p.get("model")).and_then(|m| m.as_str())
                    {
                        model = m.to_string();
                    }
                }
                "response_item" => {
                    let is_assistant_msg = payload
                        .map(|p| {
                            p.get("type").and_then(|t| t.as_str()) == Some("message")
                                && p.get("role").and_then(|r| r.as_str()) == Some("assistant")
                        })
                        .unwrap_or(false);
                    if is_assistant_msg {
                        message_count += 1;
                    }
                }
                "event_msg" => {
                    let is_tc = payload
                        .map(|p| p.get("type").and_then(|t| t.as_str()) == Some("token_count"))
                        .unwrap_or(false);
                    if !is_tc {
                        return;
                    }
                    let info = payload.and_then(|p| p.get("info"));
                    // 记录最后一个 total_token_usage 作为 fallback 兜底 (回应 review P2)。
                    if let Some(total) = info.and_then(|i| i.get("total_token_usage")) {
                        let g = |k: &str| total.get(k).and_then(|x| x.as_u64()).unwrap_or(0);
                        last_total = Some((
                            g("input_tokens"),
                            g("output_tokens"),
                            g("cached_input_tokens"),
                        ));
                    }
                    let last = info.and_then(|i| i.get("last_token_usage"));
                    // 事件级: 需要 last_token_usage + 行级时间; 缺任一则不记事件,
                    // 由文件末尾的 fallback 兜底, 不静默丢弃整段用量。
                    let (last, at) = match (last, line_ts) {
                        (Some(l), Some(at)) => (l, at),
                        _ => return,
                    };
                    let g = |k: &str| last.get(k).and_then(|x| x.as_u64()).unwrap_or(0);
                    events.push(UsageEvent {
                        at,
                        input_tokens: g("input_tokens"),
                        output_tokens: g("output_tokens"),
                        cache_read_tokens: g("cached_input_tokens"),
                        cache_creation_tokens: 0,
                    });
                }
                _ => {}
            }
        })?;

        // Fallback (回应 review P2, 见 design.md:158): 若无任何事件级用量, 但存在
        // total_token_usage, 把整会话总量归到会话开始日 (无开始日则跳过该会话)。
        if events.is_empty() {
            match (last_total, started_at) {
                (Some((i, o, c)), Some(start)) if i + o + c > 0 => {
                    events.push(UsageEvent {
                        at: start,
                        input_tokens: i,
                        output_tokens: o,
                        cache_read_tokens: c,
                        cache_creation_tokens: 0,
                    });
                }
                _ => return Err(ParseError::Empty),
            }
        }
        events.sort_by_key(|e| e.at);
        let started_at = started_at.unwrap_or_else(|| events.first().unwrap().at);
        let last_active_at = events.last().unwrap().at;

        Ok(ParsedSession {
            agent: Agent::Codex,
            session_id: if session_id.is_empty() {
                path.file_stem().and_then(|s| s.to_str()).unwrap_or("unknown").to_string()
            } else {
                session_id
            },
            project: if project.is_empty() { "unknown".to_string() } else { project },
            model: if model.is_empty() { "unknown".to_string() } else { model },
            started_at,
            last_active_at,
            events,
            message_count,
        })
    }
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cargo test -p aionui-analytics --test codex_parser`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add crates/aionui-analytics/src/parser/codex.rs crates/aionui-analytics/tests
git commit -m "feat(analytics): add codex log parser with TDD"
```

---

### Task 1.5: api-types DTO (`AgentUsage*`)

**Files:**
- Create: `crates/aionui-api-types/src/analytics.rs`
- Modify: `crates/aionui-api-types/src/lib.rs`

- [ ] **Step 1: 看 api-types 现有模块导出模式**

Run: `grep -n "mod conversation;\|pub use conversation::" crates/aionui-api-types/src/lib.rs`
Expected: 看到 `mod xxx;` 与 `pub use xxx::{...};` 成对出现的模式。

- [ ] **Step 2: 写 DTO 模块**

Create `crates/aionui-api-types/src/analytics.rs`:

```rust
use serde::{Deserialize, Serialize};

/// Query for `GET /api/analytics/agent-usage`.
#[derive(Debug, Default, Deserialize)]
pub struct AgentUsageQuery {
    pub trend_granularity: Option<String>,
    pub refresh: Option<bool>,
    pub time_range: Option<String>,
    pub sessions_limit: Option<u32>,
    pub sessions_offset: Option<u32>,
}

#[derive(Debug, Serialize)]
pub struct UsageSourceStatus {
    pub agent: String,
    pub files_total: u32,
    pub files_parsed: u32,
    pub files_skipped: u32,
    pub available: bool,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct UsageByAgent {
    pub agent: String,
    pub sessions: u64,
    pub messages: u64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_creation_tokens: u64,
    pub total_tokens: u64,
}

#[derive(Debug, Serialize)]
pub struct UsageSummary {
    pub by_agent: Vec<UsageByAgent>,
}

#[derive(Debug, Serialize)]
pub struct UsageByModel {
    pub agent: String,
    pub model: String,
    pub sessions: u64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_creation_tokens: u64,
    pub total_tokens: u64,
}

#[derive(Debug, Serialize)]
pub struct TrendPoint {
    pub bucket: String,
    /// agent 名 → 该桶 total_tokens。
    pub by_agent: std::collections::BTreeMap<String, u64>,
}

#[derive(Debug, Serialize)]
pub struct UsageTrend {
    pub granularity: String,
    pub points: Vec<TrendPoint>,
}

#[derive(Debug, Serialize)]
pub struct SessionRow {
    pub agent: String,
    pub session_id: String,
    pub project: String,
    pub model: String,
    pub started_at: String,
    pub last_active_at: String,
    pub messages: u64,
    pub total_tokens: u64,
}

#[derive(Debug, Serialize)]
pub struct AgentUsageResponse {
    pub scanned_at: String,
    pub sources: Vec<UsageSourceStatus>,
    pub summary: UsageSummary,
    pub by_model: Vec<UsageByModel>,
    pub trend: UsageTrend,
    pub time_range: String,
    pub sessions_total: u64,
    pub sessions_limit: u32,
    pub sessions_offset: u32,
    pub sessions: Vec<SessionRow>,
}
```

- [ ] **Step 3: 注册到 lib.rs**

Modify `crates/aionui-api-types/src/lib.rs`:
- 在 `mod` 列表的字母序位置加 `mod analytics;` (在 `mod acp;` 后)
- 在 `pub use` 区加 (按现有字母序/风格放置):
```rust
pub use analytics::{
    AgentUsageQuery, AgentUsageResponse, SessionRow, TrendPoint, UsageByAgent, UsageByModel, UsageSourceStatus,
    UsageSummary, UsageTrend,
};
```

- [ ] **Step 4: 编译检查**

Run: `cargo check -p aionui-api-types`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add crates/aionui-api-types/src/analytics.rs crates/aionui-api-types/src/lib.rs
git commit -m "feat(api-types): add AgentUsage DTOs"
```

---

### Task 1.6: 聚合纯函数 `aggregate.rs` (TDD)

**Files:**
- Create: `crates/aionui-analytics/src/aggregate.rs`
- Create: `crates/aionui-analytics/tests/aggregate.rs`

- [ ] **Step 1: 写失败测试 (覆盖 High-2: 跨天事件按事件时间归桶 + 趋势之和≈汇总)**

Create `crates/aionui-analytics/tests/aggregate.rs`:

```rust
use aionui_analytics::aggregate::aggregate;
use aionui_analytics::types::{Agent, ParsedSession, UsageEvent};
use chrono::{TimeZone, Utc};

fn ev(day: u32, tok: u64) -> UsageEvent {
    UsageEvent {
        at: Utc.with_ymd_and_hms(2026, 5, day, 12, 0, 0).unwrap(),
        input_tokens: tok,
        output_tokens: 0,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
    }
}

fn session() -> ParsedSession {
    ParsedSession {
        agent: Agent::Codex,
        session_id: "s1".into(),
        project: "/work/p".into(),
        model: "gpt-5.1-codex".into(),
        started_at: Utc.with_ymd_and_hms(2026, 5, 16, 12, 0, 0).unwrap(),
        last_active_at: Utc.with_ymd_and_hms(2026, 5, 17, 12, 0, 0).unwrap(),
        // 跨两天的两个事件。
        events: vec![ev(16, 100), ev(17, 200)],
        message_count: 2,
    }
}

#[test]
fn cross_day_session_split_into_daily_buckets() {
    // time_range=all, day 粒度。
    let resp = aggregate(vec![session()], "day", "all", 200, 0);

    // 汇总: 300 total。
    let codex = resp.summary.by_agent.iter().find(|a| a.agent == "codex").unwrap();
    assert_eq!(codex.total_tokens, 300);

    // 趋势两个桶 5-16=100, 5-17=200。
    let mut sum = 0u64;
    for p in &resp.trend.points {
        sum += p.by_agent.get("codex").copied().unwrap_or(0);
    }
    assert_eq!(sum, 300, "趋势之和应等于汇总");
    assert_eq!(resp.trend.points.len(), 2);

    // 会话明细。
    assert_eq!(resp.sessions_total, 1);
    assert_eq!(resp.sessions.len(), 1);
    assert_eq!(resp.sessions[0].total_tokens, 300);
}

#[test]
fn time_range_filters_events_by_event_time() {
    // 仅最近窗口: 把 now 锚定为 2026-05-17, 7d 窗口应只含 5-17 之后。
    // aggregate 内部用真实 now, 此处改用 all 验证过滤逻辑由 service 负责;
    // aggregate 只按传入 sessions 聚合。该测试验证 day 桶 key 格式。
    let resp = aggregate(vec![session()], "day", "all", 200, 0);
    assert_eq!(resp.trend.points[0].bucket, "2026-05-16");
}
```

- [ ] **Step 2: 运行确认失败**

Run: `cargo test -p aionui-analytics --test aggregate`
Expected: FAIL — `aggregate` 不存在

- [ ] **Step 3: 写聚合函数**

Create `crates/aionui-analytics/src/aggregate.rs`:

```rust
use crate::types::ParsedSession;
use aionui_api_types::{
    AgentUsageResponse, SessionRow, TrendPoint, UsageByAgent, UsageByModel, UsageSummary, UsageTrend,
};
use std::collections::BTreeMap;

/// 把 sessions 聚合为响应 (纯函数, 无 IO)。
/// `time_range` 仅写入响应回显; 事件级时间过滤由 service 在调用前完成。
pub fn aggregate(
    sessions: Vec<ParsedSession>,
    granularity: &str,
    time_range: &str,
    sessions_limit: u32,
    sessions_offset: u32,
) -> AgentUsageResponse {
    let gran = if granularity == "week" { "week" } else { "day" };

    // ---- summary by agent ----
    #[derive(Default, Clone)]
    struct Acc {
        sessions: u64,
        messages: u64,
        input: u64,
        output: u64,
        cache_read: u64,
        cache_creation: u64,
    }
    let mut by_agent: BTreeMap<&'static str, Acc> = BTreeMap::new();
    let mut by_model: BTreeMap<(&'static str, String), Acc> = BTreeMap::new();
    let mut trend: BTreeMap<String, BTreeMap<String, u64>> = BTreeMap::new();

    for s in &sessions {
        let an = s.agent.as_str();
        let a = by_agent.entry(an).or_default();
        a.sessions += 1;
        a.messages += s.message_count;
        let m = by_model.entry((an, s.model.clone())).or_default();
        m.sessions += 1;
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
            *trend.entry(bucket).or_default().entry(an.to_string()).or_insert(0) += e.total();
        }
    }

    let summary = UsageSummary {
        by_agent: by_agent
            .iter()
            .map(|(name, a)| UsageByAgent {
                agent: name.to_string(),
                sessions: a.sessions,
                messages: a.messages,
                input_tokens: a.input,
                output_tokens: a.output,
                cache_read_tokens: a.cache_read,
                cache_creation_tokens: a.cache_creation,
                total_tokens: a.input + a.output + a.cache_read + a.cache_creation,
            })
            .collect(),
    };

    let by_model_vec: Vec<UsageByModel> = by_model
        .iter()
        .map(|((agent, model), m)| UsageByModel {
            agent: agent.to_string(),
            model: model.clone(),
            sessions: m.sessions,
            input_tokens: m.input,
            output_tokens: m.output,
            cache_read_tokens: m.cache_read,
            cache_creation_tokens: m.cache_creation,
            total_tokens: m.input + m.output + m.cache_read + m.cache_creation,
        })
        .collect();

    let trend_points: Vec<TrendPoint> = trend
        .into_iter()
        .map(|(bucket, by_agent)| TrendPoint {
            bucket,
            by_agent: by_agent.into_iter().collect(),
        })
        .collect();

    // ---- sessions (倒序 + 分页) ----
    let mut rows: Vec<&ParsedSession> = sessions.iter().collect();
    rows.sort_by_key(|b| std::cmp::Reverse(b.last_active_at));
    let sessions_total = rows.len() as u64;
    let page: Vec<SessionRow> = rows
        .into_iter()
        .skip(sessions_offset as usize)
        .take(sessions_limit as usize)
        .map(|s| SessionRow {
            agent: s.agent.as_str().to_string(),
            session_id: s.session_id.clone(),
            project: s.project.clone(),
            model: s.model.clone(),
            started_at: s.started_at.to_rfc3339(),
            last_active_at: s.last_active_at.to_rfc3339(),
            messages: s.message_count,
            total_tokens: s.events.iter().map(|e| e.total()).sum(),
        })
        .collect();

    AgentUsageResponse {
        scanned_at: chrono::Utc::now().to_rfc3339(),
        sources: Vec::new(), // service 填充
        summary,
        by_model: by_model_vec,
        trend: UsageTrend {
            granularity: gran.to_string(),
            points: trend_points,
        },
        time_range: time_range.to_string(),
        sessions_total,
        sessions_limit,
        sessions_offset,
        sessions: page,
    }
}

fn bucket_key(at: chrono::DateTime<chrono::Utc>, gran: &str) -> String {
    use chrono::Datelike;
    if gran == "week" {
        let iso = at.iso_week();
        format!("{}-W{:02}", iso.year(), iso.week())
    } else {
        at.format("%Y-%m-%d").to_string()
    }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cargo test -p aionui-analytics --test aggregate`
Expected: PASS (两个测试)

- [ ] **Step 5: 提交**

```bash
git add crates/aionui-analytics/src/aggregate.rs crates/aionui-analytics/tests/aggregate.rs
git commit -m "feat(analytics): add aggregate pure function with TDD"
```

---

### Task 1.7: 缓存 `cache.rs`

**Files:**
- Create: `crates/aionui-analytics/src/cache.rs`

- [ ] **Step 1: 写缓存 (含内联单测)**

Create `crates/aionui-analytics/src/cache.rs`:

```rust
use crate::parser::LogParser;
use crate::types::{ParseError, ParsedSession};
use dashmap::DashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

#[derive(Clone)]
struct Entry {
    mtime: std::time::SystemTime,
    size: u64,
    session: Arc<ParsedSession>,
}

#[derive(Default)]
pub struct UsageCache {
    map: DashMap<PathBuf, Entry>,
}

impl UsageCache {
    pub fn new() -> Self {
        Self { map: DashMap::new() }
    }

    /// mtime+size 未变则返回缓存; 否则用 parser 重解析并更新。
    /// `bypass=true` 时忽略缓存但仍写回。
    pub fn get_or_parse(
        &self,
        path: &Path,
        parser: &dyn LogParser,
        bypass: bool,
    ) -> Result<Arc<ParsedSession>, ParseError> {
        let meta = std::fs::metadata(path)?;
        let mtime = meta.modified()?;
        let size = meta.len();

        if !bypass
            && let Some(e) = self.map.get(path)
            && e.mtime == mtime
            && e.size == size
        {
            return Ok(e.session.clone());
        }
        let session = Arc::new(parser.parse_file(path)?);
        self.map.insert(
            path.to_path_buf(),
            Entry {
                mtime,
                size,
                session: session.clone(),
            },
        );
        Ok(session)
    }
}
```

- [ ] **Step 2: 编译检查**

Run: `cargo check -p aionui-analytics`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add crates/aionui-analytics/src/cache.rs
git commit -m "feat(analytics): add mtime+size based usage cache"
```

---

### Task 1.8: service 编排 + 时间窗过滤 + 远程脱敏 (TDD)

**Files:**
- Create: `crates/aionui-analytics/src/service.rs`
- Create: `crates/aionui-analytics/tests/service.rs`

- [ ] **Step 1: 写失败测试 (目录缺失降级 + 远程脱敏 + 时间窗事件过滤)**

Create `crates/aionui-analytics/tests/service.rs`:

```rust
use aionui_analytics::service::{AgentUsageService, UsageRequest};

#[tokio::test]
async fn missing_dirs_degrade_not_error() {
    let tmp = tempfile::tempdir().unwrap();
    // 指向不存在的 home, 两个 source 都应 available=false 但不报错。
    let svc = AgentUsageService::with_home(tmp.path().join("nohome"));
    let resp = svc
        .build(UsageRequest {
            trend_granularity: "day".into(),
            time_range: "all".into(),
            refresh: false,
            sessions_limit: 200,
            sessions_offset: 0,
            is_remote: false,
        })
        .await
        .expect("must not error");
    assert_eq!(resp.sources.len(), 2);
    assert!(resp.sources.iter().all(|s| !s.available));
    assert_eq!(resp.sessions_total, 0);
}

#[tokio::test]
async fn remote_request_sanitizes_project_path() {
    let tmp = tempfile::tempdir().unwrap();
    let home = tmp.path();
    let cdir = home.join(".claude/projects/encoded");
    std::fs::create_dir_all(&cdir).unwrap();
    std::fs::write(
        cdir.join("sess.jsonl"),
        r#"{"type":"assistant","timestamp":"2026-05-17T10:00:00.000Z","cwd":"/Users/secret/proj","sessionId":"s1","message":{"model":"claude-opus-4-7","role":"assistant","usage":{"input_tokens":10,"output_tokens":5,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}}"#,
    )
    .unwrap();

    let svc = AgentUsageService::with_home(home.to_path_buf());
    let resp = svc
        .build(UsageRequest {
            trend_granularity: "day".into(),
            time_range: "all".into(),
            refresh: false,
            sessions_limit: 200,
            sessions_offset: 0,
            is_remote: true,
        })
        .await
        .unwrap();
    assert_eq!(resp.sessions.len(), 1);
    // 远程: 仅保留 basename。
    assert_eq!(resp.sessions[0].project, "proj");
    assert!(!resp.sessions[0].project.contains("secret"));
}
```

- [ ] **Step 2: 运行确认失败**

Run: `cargo test -p aionui-analytics --test service`
Expected: FAIL — `service` 不存在

- [ ] **Step 3: 写 service**

Create `crates/aionui-analytics/src/service.rs`:

```rust
use crate::aggregate::aggregate;
use crate::cache::UsageCache;
use crate::parser::{LogParser, claude::ClaudeParser, codex::CodexParser};
use crate::types::{Agent, ParseError, ParsedSession};
use aionui_api_types::{AgentUsageResponse, UsageSourceStatus};
use aionui_common::AppError;
use std::path::{Path, PathBuf};
use std::sync::Arc;

pub struct UsageRequest {
    pub trend_granularity: String,
    pub time_range: String,
    pub refresh: bool,
    pub sessions_limit: u32,
    pub sessions_offset: u32,
    pub is_remote: bool,
}

#[derive(Clone)]
pub struct AgentUsageService {
    home: PathBuf,
    cache: Arc<UsageCache>,
}

impl AgentUsageService {
    pub fn new() -> Self {
        Self::with_home(dirs::home_dir().unwrap_or_else(|| PathBuf::from("/")))
    }

    pub fn with_home(home: PathBuf) -> Self {
        Self {
            home,
            cache: Arc::new(UsageCache::new()),
        }
    }

    pub async fn build(&self, req: UsageRequest) -> Result<AgentUsageResponse, AppError> {
        let cutoff = time_range_cutoff(&req.time_range);

        let (claude_sessions, claude_status) =
            self.scan(Agent::Claude, &self.claude_dir(), &ClaudeParser, req.refresh, cutoff);
        let (codex_sessions, codex_status) =
            self.scan(Agent::Codex, &self.codex_dir(), &CodexParser, req.refresh, cutoff);

        let mut all: Vec<ParsedSession> = Vec::new();
        all.extend(claude_sessions);
        all.extend(codex_sessions);

        if req.is_remote {
            for s in &mut all {
                s.project = sanitize_project(&s.project);
            }
        }

        let mut resp = aggregate(
            all,
            &req.trend_granularity,
            &req.time_range,
            req.sessions_limit.clamp(1, 1000),
            req.sessions_offset,
        );
        resp.sources = vec![claude_status, codex_status];
        Ok(resp)
    }

    fn claude_dir(&self) -> PathBuf {
        self.home.join(".claude/projects")
    }

    fn codex_dir(&self) -> PathBuf {
        self.home.join(".codex/sessions")
    }

    fn scan(
        &self,
        agent: Agent,
        dir: &Path,
        parser: &dyn LogParser,
        refresh: bool,
        cutoff: Option<chrono::DateTime<chrono::Utc>>,
    ) -> (Vec<ParsedSession>, UsageSourceStatus) {
        let mut status = UsageSourceStatus {
            agent: agent.as_str().to_string(),
            files_total: 0,
            files_parsed: 0,
            files_skipped: 0,
            available: dir.is_dir(),
            error: None,
        };
        if !dir.is_dir() {
            return (Vec::new(), status);
        }
        let mut out = Vec::new();
        for entry in walkdir::WalkDir::new(dir).into_iter().filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.extension().and_then(|x| x.to_str()) != Some("jsonl") {
                continue;
            }
            // 文件级 mtime 粗筛: cutoff 之前且 mtime 早于 cutoff 直接跳过。
            if let Some(c) = cutoff {
                if let Ok(meta) = std::fs::metadata(path) {
                    if let Ok(mt) = meta.modified() {
                        let mt: chrono::DateTime<chrono::Utc> = mt.into();
                        if mt < c {
                            continue;
                        }
                    }
                }
            }
            status.files_total += 1;
            match self.cache.get_or_parse(path, parser, refresh) {
                Ok(session) => {
                    let mut s = (*session).clone();
                    // 事件级精筛。
                    if let Some(c) = cutoff {
                        s.events.retain(|e| e.at >= c);
                        if s.events.is_empty() {
                            status.files_parsed += 1;
                            continue;
                        }
                        s.last_active_at = s.events.last().unwrap().at;
                    }
                    status.files_parsed += 1;
                    out.push(s);
                }
                Err(ParseError::Empty) => status.files_skipped += 1,
                Err(ParseError::Io(_)) => status.files_skipped += 1,
            }
        }
        (out, status)
    }
}

fn time_range_cutoff(tr: &str) -> Option<chrono::DateTime<chrono::Utc>> {
    let days = match tr {
        "7d" => 7,
        "90d" => 90,
        "all" => return None,
        _ => 30, // 默认 30d
    };
    Some(chrono::Utc::now() - chrono::Duration::days(days))
}

fn sanitize_project(p: &str) -> String {
    Path::new(p)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("unknown")
        .to_string()
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cargo test -p aionui-analytics --test service`
Expected: PASS

- [ ] **Step 5: 全 crate 测试 + clippy + fmt**

Run:
```bash
cargo test -p aionui-analytics && cargo clippy -p aionui-analytics -- -D warnings && cargo fmt -p aionui-analytics
```
Expected: 全 PASS (clippy 如有可修复 warning 当场修)

- [ ] **Step 6: 提交**

```bash
git add crates/aionui-analytics/src/service.rs crates/aionui-analytics/tests/service.rs
git commit -m "feat(analytics): add service with time-window filter and remote sanitize"
```

---

### Task 1.9: routes + state 接入 (受鉴权保护)

**Files:**
- Create: `crates/aionui-analytics/src/routes.rs`
- Modify: `crates/aionui-app/src/router/state.rs`
- Modify: `crates/aionui-app/src/router/routes.rs`

- [ ] **Step 1: 写 routes.rs**

Create `crates/aionui-analytics/src/routes.rs`:

```rust
use axum::Router;
use axum::extract::{Json, Query, State};
use axum::http::HeaderMap;
use axum::routing::get;

use aionui_api_types::{AgentUsageQuery, AgentUsageResponse, ApiResponse};
use aionui_common::AppError;

use crate::service::{AgentUsageService, UsageRequest};

/// WebHost 反向代理在转发 WebUI 远程请求时注入的标志 header。
/// 安全模型 (回应 review P1, 见 design.md 访问边界):
/// - 本机 Electron 直连后端, 不经 WebHost 代理, 不带此 header → is_remote=false → 不脱敏
/// - WebUI remote 必经 WebHost 代理, WebHost **先剥离客户端同名 header 再注入** → is_remote=true → 脱敏
/// - 即使公网客户端自带伪造 header, 经 WebHost 时会被剥离重置; 退一步即便到达,
///   也只会让该客户端看到**更脱敏**的结果 (安全方向), 不会泄露更多
pub const WEBUI_REMOTE_HEADER: &str = "x-aionui-webui-remote";

#[derive(Clone)]
pub struct AnalyticsRouterState {
    pub service: AgentUsageService,
}

pub fn analytics_routes(state: AnalyticsRouterState) -> Router {
    Router::new()
        .route("/api/analytics/agent-usage", get(get_agent_usage))
        .with_state(state)
}

async fn get_agent_usage(
    State(state): State<AnalyticsRouterState>,
    headers: HeaderMap,
    Query(q): Query<AgentUsageQuery>,
) -> Result<Json<ApiResponse<AgentUsageResponse>>, AppError> {
    let is_remote = headers
        .get(WEBUI_REMOTE_HEADER)
        .and_then(|v| v.to_str().ok())
        .map(|v| v == "1")
        .unwrap_or(false);
    let resp = state
        .service
        .build(UsageRequest {
            trend_granularity: q.trend_granularity.unwrap_or_else(|| "day".into()),
            time_range: q.time_range.unwrap_or_else(|| "30d".into()),
            refresh: q.refresh.unwrap_or(false),
            sessions_limit: q.sessions_limit.unwrap_or(200),
            sessions_offset: q.sessions_offset.unwrap_or(0),
            is_remote,
        })
        .await?;
    Ok(Json(ApiResponse::ok(resp)))
}
```

- [ ] **Step 2: 看 state.rs 现有模块 state 接入模式**

Run:
```bash
grep -n "pub system: SystemRouterState\|system: build_system_state\|use aionui_system" crates/aionui-app/src/router/state.rs
```
Expected: 看到 `ModuleStates` 字段声明处 + `build_module_states` 中 `system: build_system_state(services)` 的构造处 + use 导入处。

- [ ] **Step 3: 在 state.rs 注册 analytics state**

Modify `crates/aionui-app/src/router/state.rs`:
- use 区加: `use aionui_analytics::{AnalyticsRouterState};`
- `ModuleStates` 结构体加字段: `pub analytics: AnalyticsRouterState,`
- `build_module_states` 的 `let states = ModuleStates { ... }` 中加: `analytics: AnalyticsRouterState { service: aionui_analytics::service::AgentUsageService::new() },`

- [ ] **Step 4: 在 routes.rs 接成受鉴权保护的 router**

Modify `crates/aionui-app/src/router/routes.rs`:
- use 区加: `use aionui_analytics::analytics_routes;`
- 在 `system_authenticated` 定义之后 (约 routes.rs:111 附近) 加:
```rust
    let analytics_authenticated =
        analytics_routes(states.analytics).route_layer(from_fn_with_state(auth_mw_state.clone(), auth_middleware));
```
- 在 `.merge(system_authenticated)` 那一段 (约 routes.rs:197) 加一行: `.merge(analytics_authenticated)`

- [ ] **Step 5: 全量编译**

Run: `cargo build -p aionui-app`
Expected: PASS

- [ ] **Step 6: 加 tower dev-dep (workspace 继承)**

Modify `crates/aionui-analytics/Cargo.toml` `[dev-dependencies]` 加一行 (workspace 已声明 `tower = { version = "0.5" }`, 见 root `Cargo.toml:63`; util feature 用于 `ServiceExt::oneshot`):

```toml
tower = { workspace = true, features = ["util"] }
```

- [ ] **Step 7: 写 handler 契约 + is_remote header 测试**

Append to `crates/aionui-analytics/tests/service.rs` 末尾 (验证 ApiResponse 结构 + header 驱动远程脱敏; app 级 403 鉴权测试见 Task 1.9b):

```rust
#[tokio::test]
async fn handler_returns_apiresponse_envelope() {
    use aionui_analytics::routes::{AnalyticsRouterState, analytics_routes};
    use aionui_analytics::service::AgentUsageService;
    use tower::ServiceExt;
    let tmp = tempfile::tempdir().unwrap();
    let app = analytics_routes(AnalyticsRouterState {
        service: AgentUsageService::with_home(tmp.path().join("nohome")),
    });
    let res = app
        .oneshot(
            axum::http::Request::builder()
                .uri("/api/analytics/agent-usage?time_range=all")
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), 200);
    let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
    let v: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(v["success"], true);
    assert!(v["data"]["sources"].is_array());
}

#[tokio::test]
async fn webui_remote_header_triggers_project_sanitize() {
    use aionui_analytics::routes::{AnalyticsRouterState, WEBUI_REMOTE_HEADER, analytics_routes};
    use aionui_analytics::service::AgentUsageService;
    use tower::ServiceExt;

    let tmp = tempfile::tempdir().unwrap();
    let home = tmp.path();
    let cdir = home.join(".claude/projects/encoded");
    std::fs::create_dir_all(&cdir).unwrap();
    std::fs::write(
        cdir.join("s.jsonl"),
        r#"{"type":"assistant","timestamp":"2026-05-17T10:00:00.000Z","cwd":"/Users/secret/proj","sessionId":"s1","message":{"model":"claude-opus-4-7","role":"assistant","usage":{"input_tokens":1,"output_tokens":1,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}}"#,
    )
    .unwrap();

    let mk = || {
        analytics_routes(AnalyticsRouterState {
            service: AgentUsageService::with_home(home.to_path_buf()),
        })
    };
    let get = |with_header: bool| {
        let mut b = axum::http::Request::builder().uri("/api/analytics/agent-usage?time_range=all");
        if with_header {
            b = b.header(WEBUI_REMOTE_HEADER, "1");
        }
        b.body(axum::body::Body::empty()).unwrap()
    };

    // 无 header → 完整路径。
    let res = mk().oneshot(get(false)).await.unwrap();
    let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
    let v: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(v["data"]["sessions"][0]["project"], "/Users/secret/proj");

    // 带 webui-remote header → 脱敏为 basename。
    let res = mk().oneshot(get(true)).await.unwrap();
    let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
    let v: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(v["data"]["sessions"][0]["project"], "proj");
}
```

- [ ] **Step 8: 运行测试**

Run: `cargo test -p aionui-analytics`
Expected: PASS (全部测试, 含 `webui_remote_header_triggers_project_sanitize`)

- [ ] **Step 9: 提交**

```bash
git add crates/aionui-analytics/src/routes.rs crates/aionui-analytics/Cargo.toml crates/aionui-app/src/router/state.rs crates/aionui-app/src/router/routes.rs crates/aionui-analytics/tests/service.rs
git commit -m "feat(analytics): wire authenticated route with webui-remote sanitize"
```

---

### Task 1.9b: app 级鉴权 403 集成测试 (回应 review P2)

> design.md:322 要求 analytics 端点未登录返回 403。Task 1.9 的 handler 测试用 naked router (无 auth layer), 不能验证鉴权。此 task 在 aionui-app 层补集成测试。

**Files:**
- 调查: `crates/aionui-app/tests/` 是否已有路由集成测试范例
- Create/Modify: `crates/aionui-app/tests/analytics_auth.rs` (或并入现有 app 集成测试文件)

- [ ] **Step 1: 找 app 级鉴权测试范例**

Run:
```bash
ls crates/aionui-app/tests/ 2>/dev/null; grep -rn "403\|FORBIDDEN\|auth_middleware\|create_router\|build_module_states" crates/aionui-app/tests/ 2>/dev/null | head
```
Expected: 看是否有现成的 "未登录请求受保护端点 → 403" 范例。若有, 完全复用其 setup (构造完整 router + 不带 token 发请求); 若无, 按下一步最小实现。

- [ ] **Step 2: 写 403 测试**

参照 Step 1 找到的范例构造完整 app router (经 `create_router_with_all_state` 或等价路径), 对 `GET /api/analytics/agent-usage` **不带任何 auth token/cookie** 发请求, 断言状态码为 `403`。

> 关键: 必须用**带 auth layer 的完整 app router** (即 `routes.rs` 里 `.merge(analytics_authenticated)` 后的 router), 不能用 Task 1.9 的 naked `analytics_routes`。若现有范例用某 helper 构造 test app, 直接复用; 该测试若依赖较多 app 启动状态而范例缺失, 则记录"app 级鉴权测试需依赖现有集成测试基建", 在 PR 描述注明并保留 handler 级测试作为最低保障 (不谎报已覆盖)。

- [ ] **Step 3: 运行测试**

Run: `cargo test -p aionui-app analytics`
Expected: PASS — 未登录访问 analytics 端点返回 403

- [ ] **Step 4: 提交**

```bash
git add crates/aionui-app/tests/
git commit -m "test(analytics): app-level 403 for unauthenticated analytics endpoint"
```

---

### Task 1.10: 真实数据验证 + 构建二进制

- [ ] **Step 1: 全 workspace 检查**

Run:
```bash
cargo build && cargo clippy --workspace -- -D warnings && cargo fmt --all -- --check
```
Expected: PASS (fmt 不通过则 `cargo fmt --all` 后重测; clippy warning 当场修)

- [ ] **Step 2: 启动后端冒烟 (需要本机有 ~/.claude 或 ~/.codex 日志)**

Run (后台启动, 端口以项目默认为准, 通常 7689):
```bash
cargo run -p aionui-app -- --local &
sleep 3
curl -s "http://127.0.0.1:7689/api/analytics/agent-usage?time_range=7d&sessions_limit=5" | head -c 800
kill %1
```
Expected: 返回 `{"success":true,"data":{...}}`, `data.sources` 有 claude/codex 两项, `data.summary.by_agent` 非空 (若本机有日志)。

> 若端口非 7689: `grep -rn "7689\|DEFAULT_PORT\|socket_addr" crates/aionui-common/src/constants.rs` 确认。

- [ ] **Step 3: 构建 release 二进制供前端联调**

Run: `cargo build --release -p aionui-app`
Expected: 产出 `target/release/aioncli` (或对应二进制名; `ls target/release/ | grep aion`)。记下绝对路径供阶段 3。

- [ ] **Step 4: 推送分支 (阶段 1 完成)**

Run:
```bash
git push -u origin feat/agent-usage-analytics
```
Expected: 推送成功 (不创建 PR, 等阶段 3 联调通过统一处理)

---

## 阶段 2 — AionUi 前端 (Settings Tab)

> 所有阶段 2 命令在 `/Users/jassy/Documents/glm/aionui_ws/AionUi` 下执行。

### Task 2.1: 创建分支 + 响应类型与 mapper (TDD)

**Files:**
- Create: `packages/desktop/src/common/types/agentUsage.ts`
- Create: `tests/unit/common/agentUsage.test.ts`

> **测试路径约束 (回应 review P1)**: AionUi `vitest.config.ts:29-45` 只收 `tests/unit/**/*.test.ts` (node 环境) 与 `tests/unit/**/*.dom.test.tsx` (jsdom 环境)。放在 `packages/desktop/src/**/__tests__/` 的测试**不会被执行**。所有新测试必须放 `tests/unit/`; React 组件/hook 测试必须命名 `*.dom.test.tsx`。

- [ ] **Step 1: 创建分支**

Run:
```bash
git checkout dev && git pull && git checkout -b feat/agent-usage-stats
```

- [ ] **Step 2: 写失败测试 (snake→camel mapper)**

Create `tests/unit/common/agentUsage.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { fromApiAgentUsage } from '@/common/types/agentUsage';
import type { AgentUsageResponseRaw } from '@/common/types/agentUsage';

describe('fromApiAgentUsage', () => {
  it('maps snake_case API shape to camelCase domain model', () => {
    const raw: AgentUsageResponseRaw = {
      scanned_at: '2026-05-18T10:30:00Z',
      sources: [{ agent: 'claude', files_total: 1, files_parsed: 1, files_skipped: 0, available: true, error: null }],
      summary: {
        by_agent: [
          {
            agent: 'claude',
            sessions: 1,
            messages: 2,
            input_tokens: 10,
            output_tokens: 5,
            cache_read_tokens: 0,
            cache_creation_tokens: 0,
            total_tokens: 15,
          },
        ],
      },
      by_model: [],
      trend: { granularity: 'day', points: [{ bucket: '2026-05-17', by_agent: { claude: 15 } }] },
      time_range: '30d',
      sessions_total: 1,
      sessions_limit: 200,
      sessions_offset: 0,
      sessions: [
        {
          agent: 'claude',
          session_id: 's1',
          project: '/work/p',
          model: 'claude-opus-4-7',
          started_at: '2026-05-17T08:00:00Z',
          last_active_at: '2026-05-17T09:00:00Z',
          messages: 2,
          total_tokens: 15,
        },
      ],
    };
    const m = fromApiAgentUsage(raw);
    expect(m.scannedAt).toBe('2026-05-18T10:30:00Z');
    expect(m.summary.byAgent[0].totalTokens).toBe(15);
    expect(m.sessionsTotal).toBe(1);
    expect(m.sessions[0].sessionId).toBe('s1');
    expect(m.sessions[0].lastActiveAt).toBe('2026-05-17T09:00:00Z');
    expect(m.trend.points[0].byAgent.claude).toBe(15);
  });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `bun run test -- agentUsage`
Expected: FAIL — `@/common/types/agentUsage` 不存在 (且测试**确实被收集执行** — 因路径在 `tests/unit/`)

- [ ] **Step 4: 写类型 + mapper**

Create `packages/desktop/src/common/types/agentUsage.ts`:

```ts
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// ---- snake_case: 与 AionCLI ApiResponse.data 严格对齐 (仅 adapter 层使用) ----

export type UsageSourceStatusRaw = {
  agent: string;
  files_total: number;
  files_parsed: number;
  files_skipped: number;
  available: boolean;
  error: string | null;
};

export type UsageByAgentRaw = {
  agent: string;
  sessions: number;
  messages: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  total_tokens: number;
};

export type UsageByModelRaw = {
  agent: string;
  model: string;
  sessions: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  total_tokens: number;
};

export type TrendPointRaw = { bucket: string; by_agent: Record<string, number> };

export type SessionRowRaw = {
  agent: string;
  session_id: string;
  project: string;
  model: string;
  started_at: string;
  last_active_at: string;
  messages: number;
  total_tokens: number;
};

export type AgentUsageResponseRaw = {
  scanned_at: string;
  sources: UsageSourceStatusRaw[];
  summary: { by_agent: UsageByAgentRaw[] };
  by_model: UsageByModelRaw[];
  trend: { granularity: string; points: TrendPointRaw[] };
  time_range: string;
  sessions_total: number;
  sessions_limit: number;
  sessions_offset: number;
  sessions: SessionRowRaw[];
};

// ---- camelCase: 组件消费的域模型 ----

export type UsageSourceStatus = {
  agent: string;
  filesTotal: number;
  filesParsed: number;
  filesSkipped: number;
  available: boolean;
  error: string | null;
};

export type UsageByAgent = {
  agent: string;
  sessions: number;
  messages: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
};

export type UsageByModel = {
  agent: string;
  model: string;
  sessions: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
};

export type TrendPoint = { bucket: string; byAgent: Record<string, number> };

export type SessionRow = {
  agent: string;
  sessionId: string;
  project: string;
  model: string;
  startedAt: string;
  lastActiveAt: string;
  messages: number;
  totalTokens: number;
};

export type AgentUsageResponse = {
  scannedAt: string;
  sources: UsageSourceStatus[];
  summary: { byAgent: UsageByAgent[] };
  byModel: UsageByModel[];
  trend: { granularity: string; points: TrendPoint[] };
  timeRange: string;
  sessionsTotal: number;
  sessionsLimit: number;
  sessionsOffset: number;
  sessions: SessionRow[];
};

export type AgentUsageParams = {
  trendGranularity?: 'day' | 'week';
  timeRange?: '7d' | '30d' | '90d' | 'all';
  refresh?: boolean;
  sessionsLimit?: number;
  sessionsOffset?: number;
};

export function fromApiAgentUsage(r: AgentUsageResponseRaw): AgentUsageResponse {
  return {
    scannedAt: r.scanned_at,
    sources: r.sources.map((s) => ({
      agent: s.agent,
      filesTotal: s.files_total,
      filesParsed: s.files_parsed,
      filesSkipped: s.files_skipped,
      available: s.available,
      error: s.error,
    })),
    summary: {
      byAgent: r.summary.by_agent.map((a) => ({
        agent: a.agent,
        sessions: a.sessions,
        messages: a.messages,
        inputTokens: a.input_tokens,
        outputTokens: a.output_tokens,
        cacheReadTokens: a.cache_read_tokens,
        cacheCreationTokens: a.cache_creation_tokens,
        totalTokens: a.total_tokens,
      })),
    },
    byModel: r.by_model.map((m) => ({
      agent: m.agent,
      model: m.model,
      sessions: m.sessions,
      inputTokens: m.input_tokens,
      outputTokens: m.output_tokens,
      cacheReadTokens: m.cache_read_tokens,
      cacheCreationTokens: m.cache_creation_tokens,
      totalTokens: m.total_tokens,
    })),
    trend: {
      granularity: r.trend.granularity,
      points: r.trend.points.map((p) => ({ bucket: p.bucket, byAgent: p.by_agent })),
    },
    timeRange: r.time_range,
    sessionsTotal: r.sessions_total,
    sessionsLimit: r.sessions_limit,
    sessionsOffset: r.sessions_offset,
    sessions: r.sessions.map((s) => ({
      agent: s.agent,
      sessionId: s.session_id,
      project: s.project,
      model: s.model,
      startedAt: s.started_at,
      lastActiveAt: s.last_active_at,
      messages: s.messages,
      totalTokens: s.total_tokens,
    })),
  };
}
```

- [ ] **Step 5: 运行确认通过**

Run: `bun run test -- agentUsage`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add packages/desktop/src/common/types/agentUsage.ts tests/unit/common/agentUsage.test.ts
git commit -m "feat(usage-stats): add agent usage types and snake->camel mapper"
```

---

### Task 2.2: ipcBridge analytics (path builder 拼 query, TDD)

**Files:**
- Modify: `packages/desktop/src/common/adapter/ipcBridge.ts`
- Create: `tests/unit/common-adapter/analyticsPath.test.ts`

> 测试路径同 Task 2.1 约束: 必须放 `tests/unit/`。`tests/unit/common-adapter/` 目录已存在。

- [ ] **Step 1: 写失败测试 (path builder query 拼接)**

Create `tests/unit/common-adapter/analyticsPath.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildAgentUsagePath } from '@/common/adapter/ipcBridge';

describe('buildAgentUsagePath', () => {
  it('builds path with no params', () => {
    expect(buildAgentUsagePath(undefined)).toBe('/api/analytics/agent-usage');
  });
  it('maps camelCase params to snake_case query', () => {
    const p = buildAgentUsagePath({
      trendGranularity: 'week',
      timeRange: '7d',
      refresh: true,
      sessionsLimit: 50,
      sessionsOffset: 100,
    });
    expect(p).toBe(
      '/api/analytics/agent-usage?trend_granularity=week&time_range=7d&refresh=true&sessions_limit=50&sessions_offset=100'
    );
  });
  it('omits falsy refresh and undefined fields', () => {
    expect(buildAgentUsagePath({ timeRange: '30d', refresh: false })).toBe(
      '/api/analytics/agent-usage?time_range=30d'
    );
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `bun run test -- analyticsPath`
Expected: FAIL — `buildAgentUsagePath` 未导出

- [ ] **Step 3: 在 ipcBridge.ts 末尾加 analytics 块**

查看文件末尾的 import 区与现有 `httpGet`/`withResponseMap` 导入 (已确认 ipcBridge.ts:59,65 已导入)。在 `ipcBridge.ts` 末尾 (team 块 `};` 之后) 追加:

```ts
// ---------------------------------------------------------------------------
// Analytics — /api/analytics/agent-usage (受鉴权保护)
// ---------------------------------------------------------------------------

import type { AgentUsageParams, AgentUsageResponse, AgentUsageResponseRaw } from '@/common/types/agentUsage';
import { fromApiAgentUsage } from '@/common/types/agentUsage';

export function buildAgentUsagePath(p: AgentUsageParams | undefined): string {
  const q = new URLSearchParams();
  if (p?.trendGranularity) q.set('trend_granularity', p.trendGranularity);
  if (p?.timeRange) q.set('time_range', p.timeRange);
  if (p?.refresh) q.set('refresh', 'true');
  if (p?.sessionsLimit != null) q.set('sessions_limit', String(p.sessionsLimit));
  if (p?.sessionsOffset != null) q.set('sessions_offset', String(p.sessionsOffset));
  const qs = q.toString();
  return `/api/analytics/agent-usage${qs ? `?${qs}` : ''}`;
}

export const analytics = {
  getAgentUsage: withResponseMap(
    httpGet<AgentUsageResponseRaw, AgentUsageParams | undefined>((p) => buildAgentUsagePath(p)),
    fromApiAgentUsage
  ),
};
```

> import 语句若 lint 要求置顶, 按项目 oxlint 规则放到文件 import 区 (与现有 `import type {...}` 同处); 先运行 Step 5 lint 看是否报错再调整。

- [ ] **Step 4: 运行确认通过**

Run: `bun run test -- analyticsPath`
Expected: PASS

- [ ] **Step 5: lint/format/typecheck**

Run:
```bash
bun run lint:fix && bun run format && bunx tsc --noEmit
```
Expected: 无 error (pre-existing warning 忽略); 若 import 位置报错, 移动到文件顶部 import 区后重跑

- [ ] **Step 6: 提交**

```bash
git add packages/desktop/src/common/adapter/ipcBridge.ts tests/unit/common-adapter/analyticsPath.test.ts
git commit -m "feat(usage-stats): add ipcBridge.analytics with query path builder"
```

---

### Task 2.3: i18n 模块 `usageStats`

**Files:**
- Modify: `packages/desktop/src/common/config/i18n-config.json`
- Create: `packages/desktop/src/renderer/services/i18n/locales/<each>/usageStats.json` (8 个)
- Modify: `packages/desktop/src/renderer/services/i18n/locales/<each>/index.ts` (8 个)

- [ ] **Step 1: i18n-config 加模块**

Modify `packages/desktop/src/common/config/i18n-config.json`: `modules` 数组末尾 (在 `"pet"` 后) 加 `"usageStats"`。

- [ ] **Step 2: 创建 en-US 参考语言文件 (完整 key)**

Create `packages/desktop/src/renderer/services/i18n/locales/en-US/usageStats.json`:

```json
{
  "title": "Usage Stats",
  "menuLabel": "Usage",
  "refresh": "Refresh",
  "granularity": { "day": "Daily", "week": "Weekly" },
  "timeRange": { "7d": "Last 7 days", "30d": "Last 30 days", "90d": "Last 90 days", "all": "All time" },
  "summary": {
    "sessions": "Sessions",
    "messages": "Messages",
    "totalTokens": "Total tokens",
    "input": "Input",
    "output": "Output",
    "cacheRead": "Cache read",
    "cacheCreation": "Cache creation"
  },
  "trend": { "title": "Token usage trend" },
  "byModel": { "title": "By model", "model": "Model", "agent": "Agent", "sessions": "Sessions", "tokens": "Tokens" },
  "sessions": {
    "title": "Sessions",
    "time": "Time",
    "agent": "Agent",
    "model": "Model",
    "project": "Project",
    "tokens": "Tokens",
    "total": "{count} sessions total",
    "loadMore": "Load more"
  },
  "source": {
    "missing": "{agent} log directory not found",
    "skipped": "{count} {agent} log file(s) could not be parsed and were skipped"
  },
  "empty": "No usage data found",
  "error": "Failed to load usage data",
  "unsupported": "Current backend does not support usage stats. Please update."
}
```

- [ ] **Step 3: 其余 7 个 locale 创建同结构文件**

为 `zh-CN`、`ja-JP`、`zh-TW`、`ko-KR`、`tr-TR`、`ru-RU`、`uk-UA` 各创建 `usageStats.json`。`zh-CN` 用中文翻译:

```json
{
  "title": "使用统计",
  "menuLabel": "使用统计",
  "refresh": "刷新",
  "granularity": { "day": "按日", "week": "按周" },
  "timeRange": { "7d": "最近 7 天", "30d": "最近 30 天", "90d": "最近 90 天", "all": "全部" },
  "summary": {
    "sessions": "会话数",
    "messages": "消息数",
    "totalTokens": "总 token",
    "input": "输入",
    "output": "输出",
    "cacheRead": "缓存读取",
    "cacheCreation": "缓存创建"
  },
  "trend": { "title": "Token 用量趋势" },
  "byModel": { "title": "按模型", "model": "模型", "agent": "Agent", "sessions": "会话数", "tokens": "Token" },
  "sessions": {
    "title": "会话明细",
    "time": "时间",
    "agent": "Agent",
    "model": "模型",
    "project": "项目",
    "tokens": "Token",
    "total": "共 {count} 个会话",
    "loadMore": "加载更多"
  },
  "source": {
    "missing": "未找到 {agent} 日志目录",
    "skipped": "有 {count} 个 {agent} 日志文件无法解析, 已跳过"
  },
  "empty": "未找到使用数据",
  "error": "加载使用数据失败",
  "unsupported": "当前后端不支持使用统计, 请升级。"
}
```

其余 5 个 (`ja-JP`/`zh-TW`/`ko-KR`/`tr-TR`/`ru-RU`/`uk-UA`) 先复制 en-US 内容作为占位 (i18n 校验要求 key 完整即可; 翻译可后续 PR 补)。

- [ ] **Step 4: 8 个 index.ts 导入导出**

每个 locale 的 `index.ts` 顶部 import 区加 `import usageStats from './usageStats.json';`, `export default {...}` 对象里加 `usageStats,`。8 个文件都改 (en-US/zh-CN/ja-JP/zh-TW/ko-KR/tr-TR/ru-RU/uk-UA)。

- [ ] **Step 5: 生成 i18n 类型 + 校验**

Run:
```bash
bun run i18n:types && node scripts/check-i18n.js
```
Expected: 类型生成成功, check-i18n 无缺 key 报错

- [ ] **Step 6: 提交**

```bash
git add packages/desktop/src/common/config/i18n-config.json packages/desktop/src/renderer/services/i18n/locales
git commit -m "feat(usage-stats): add usageStats i18n module"
```

---

### Task 2.4: 展示组件

**Files:**
- Create: `packages/desktop/src/renderer/pages/settings/UsageStats/SummaryCards.tsx`
- Create: `packages/desktop/src/renderer/pages/settings/UsageStats/TrendChart.tsx`
- Create: `packages/desktop/src/renderer/pages/settings/UsageStats/ModelTable.tsx`
- Create: `packages/desktop/src/renderer/pages/settings/UsageStats/SessionList.tsx`
- Create: `packages/desktop/src/renderer/pages/settings/UsageStats/SourceBanner.tsx`

> 组件均为纯展示, props 为 Task 2.1 的 camelCase 域模型。逐个文件创建后统一在 Task 2.5 容器接入并端到端验证 (UI 正确性在 Task 2.6 浏览器验证)。

- [ ] **Step 1: SourceBanner (降级提示)**

Create `packages/desktop/src/renderer/pages/settings/UsageStats/SourceBanner.tsx`:

```tsx
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Alert } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { UsageSourceStatus } from '@/common/types/agentUsage';

const SourceBanner: React.FC<{ sources: UsageSourceStatus[] }> = ({ sources }) => {
  const { t } = useTranslation();
  const msgs: string[] = [];
  for (const s of sources) {
    if (!s.available) msgs.push(t('usageStats.source.missing', { agent: s.agent }));
    else if (s.filesSkipped > 0) msgs.push(t('usageStats.source.skipped', { agent: s.agent, count: s.filesSkipped }));
  }
  if (msgs.length === 0) return null;
  return <Alert type='warning' content={msgs.join(' · ')} style={{ marginBottom: 16 }} />;
};

export default SourceBanner;
```

- [ ] **Step 2: SummaryCards**

Create `packages/desktop/src/renderer/pages/settings/UsageStats/SummaryCards.tsx`:

```tsx
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Card, Grid } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { UsageByAgent } from '@/common/types/agentUsage';

const fmt = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
};

const SummaryCards: React.FC<{ byAgent: UsageByAgent[] }> = ({ byAgent }) => {
  const { t } = useTranslation();
  return (
    <Grid.Row gutter={16} style={{ marginBottom: 16 }}>
      {byAgent.map((a) => (
        <Grid.Col span={12} key={a.agent}>
          <Card title={a.agent} bordered>
            <div>
              {t('usageStats.summary.sessions')}: {a.sessions} · {t('usageStats.summary.messages')}: {a.messages}
            </div>
            <div style={{ fontSize: 20, fontWeight: 600, margin: '8px 0' }}>
              {t('usageStats.summary.totalTokens')}: {fmt(a.totalTokens)}
            </div>
            <div style={{ color: 'var(--color-text-3)' }}>
              {t('usageStats.summary.input')} {fmt(a.inputTokens)} · {t('usageStats.summary.output')}{' '}
              {fmt(a.outputTokens)} · {t('usageStats.summary.cacheRead')} {fmt(a.cacheReadTokens)} ·{' '}
              {t('usageStats.summary.cacheCreation')} {fmt(a.cacheCreationTokens)}
            </div>
          </Card>
        </Grid.Col>
      ))}
    </Grid.Row>
  );
};

export default SummaryCards;
```

- [ ] **Step 3: ModelTable**

Create `packages/desktop/src/renderer/pages/settings/UsageStats/ModelTable.tsx`:

```tsx
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Card, Table } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { UsageByModel } from '@/common/types/agentUsage';

const ModelTable: React.FC<{ rows: UsageByModel[] }> = ({ rows }) => {
  const { t } = useTranslation();
  const columns = [
    { title: t('usageStats.byModel.agent'), dataIndex: 'agent' },
    { title: t('usageStats.byModel.model'), dataIndex: 'model' },
    { title: t('usageStats.byModel.sessions'), dataIndex: 'sessions', sorter: (a: UsageByModel, b: UsageByModel) => a.sessions - b.sessions },
    {
      title: t('usageStats.byModel.tokens'),
      dataIndex: 'totalTokens',
      sorter: (a: UsageByModel, b: UsageByModel) => a.totalTokens - b.totalTokens,
      defaultSortOrder: 'descend' as const,
    },
  ];
  return (
    <Card title={t('usageStats.byModel.title')} bordered style={{ marginBottom: 16 }}>
      <Table rowKey={(r) => `${r.agent}-${r.model}`} columns={columns} data={rows} pagination={false} />
    </Card>
  );
};

export default ModelTable;
```

- [ ] **Step 4: TrendChart (无额外图表库依赖, 用 Arco Table + 简易条形)**

> 设计文档说"趋势图用项目已有图表库, 无则用 Arco 兼容轻量方案"。先查依赖: `grep -E '"recharts"|"@ant-design/charts"|"bizcharts"|"echarts"' package.json`。**若有** recharts/echarts 则用之画柱状图; **若无**, 用下方纯 div 条形实现 (零新依赖):

Create `packages/desktop/src/renderer/pages/settings/UsageStats/TrendChart.tsx`:

```tsx
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Card } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { TrendPoint } from '@/common/types/agentUsage';

const TrendChart: React.FC<{ points: TrendPoint[] }> = ({ points }) => {
  const { t } = useTranslation();
  const max = Math.max(1, ...points.map((p) => Object.values(p.byAgent).reduce((s, v) => s + v, 0)));
  return (
    <Card title={t('usageStats.trend.title')} bordered style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 160, overflowX: 'auto' }}>
        {points.map((p) => {
          const total = Object.values(p.byAgent).reduce((s, v) => s + v, 0);
          return (
            <div key={p.bucket} style={{ textAlign: 'center', minWidth: 28 }}>
              <div
                title={`${p.bucket}: ${total}`}
                style={{
                  height: `${(total / max) * 130}px`,
                  background: 'var(--color-primary-6)',
                  borderRadius: 2,
                }}
              />
              <div style={{ fontSize: 10, color: 'var(--color-text-3)', marginTop: 4, whiteSpace: 'nowrap' }}>
                {p.bucket.slice(5)}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
};

export default TrendChart;
```

- [ ] **Step 5: SessionList**

Create `packages/desktop/src/renderer/pages/settings/UsageStats/SessionList.tsx`:

```tsx
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Card, Table, Button } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { SessionRow } from '@/common/types/agentUsage';

const SessionList: React.FC<{
  rows: SessionRow[];
  total: number;
  hasMore: boolean;
  onLoadMore: () => void;
}> = ({ rows, total, hasMore, onLoadMore }) => {
  const { t } = useTranslation();
  const columns = [
    { title: t('usageStats.sessions.time'), dataIndex: 'lastActiveAt', render: (v: string) => v.replace('T', ' ').slice(0, 16) },
    { title: t('usageStats.sessions.agent'), dataIndex: 'agent' },
    { title: t('usageStats.sessions.model'), dataIndex: 'model' },
    { title: t('usageStats.sessions.project'), dataIndex: 'project', ellipsis: true },
    { title: t('usageStats.sessions.tokens'), dataIndex: 'totalTokens' },
  ];
  return (
    <Card
      title={`${t('usageStats.sessions.title')} · ${t('usageStats.sessions.total', { count: total })}`}
      bordered
    >
      <Table
        rowKey='sessionId'
        columns={columns}
        data={rows}
        pagination={false}
        scroll={{ y: 360 }}
        virtualized
      />
      {hasMore && (
        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <Button onClick={onLoadMore}>{t('usageStats.sessions.loadMore')}</Button>
        </div>
      )}
    </Card>
  );
};

export default SessionList;
```

- [ ] **Step 6: lint/format/typecheck**

Run:
```bash
bun run lint:fix && bun run format && bunx tsc --noEmit
```
Expected: 无 error

- [ ] **Step 7: 提交**

```bash
git add packages/desktop/src/renderer/pages/settings/UsageStats
git commit -m "feat(usage-stats): add display components"
```

---

### Task 2.5: 容器页 + 路由 + Settings Tab 注册

**Files:**
- Create: `packages/desktop/src/renderer/pages/settings/UsageStats/index.tsx`
- Modify: `packages/desktop/src/renderer/components/layout/Router.tsx`
- Modify: `packages/desktop/src/renderer/pages/settings/components/SettingsSider.tsx`

- [ ] **Step 1: 写容器页**

Create `packages/desktop/src/renderer/pages/settings/UsageStats/index.tsx`:

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
import SummaryCards from './SummaryCards';
import TrendChart from './TrendChart';
import ModelTable from './ModelTable';
import SessionList from './SessionList';

const PAGE = 200;

const UsageStats: React.FC = () => {
  const { t } = useTranslation();
  const [data, setData] = useState<AgentUsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<'error' | 'unsupported' | null>(null);
  const [gran, setGran] = useState<'day' | 'week'>('day');
  const [range, setRange] = useState<'7d' | '30d' | '90d' | 'all'>('30d');
  const [offset, setOffset] = useState(0);

  const load = useCallback(
    async (params: AgentUsageParams, append: boolean) => {
      setLoading(true);
      setErr(null);
      try {
        const r = await ipcBridge.analytics.getAgentUsage.invoke(params);
        setData((prev) =>
          append && prev ? { ...r, sessions: [...prev.sessions, ...r.sessions] } : r
        );
      } catch (e: unknown) {
        const status = (e as { status?: number })?.status;
        setErr(status === 404 ? 'unsupported' : 'error');
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    setOffset(0);
    void load({ trendGranularity: gran, timeRange: range, sessionsLimit: PAGE, sessionsOffset: 0 }, false);
  }, [gran, range, load]);

  const refresh = () => {
    setOffset(0);
    void load({ trendGranularity: gran, timeRange: range, refresh: true, sessionsLimit: PAGE, sessionsOffset: 0 }, false);
  };

  const loadMore = () => {
    const next = offset + PAGE;
    setOffset(next);
    void load({ trendGranularity: gran, timeRange: range, sessionsLimit: PAGE, sessionsOffset: next }, true);
  };

  return (
    <SettingsPageWrapper>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center' }}>
        <Radio.Group type='button' value={range} onChange={setRange}>
          <Radio value='7d'>{t('usageStats.timeRange.7d')}</Radio>
          <Radio value='30d'>{t('usageStats.timeRange.30d')}</Radio>
          <Radio value='90d'>{t('usageStats.timeRange.90d')}</Radio>
          <Radio value='all'>{t('usageStats.timeRange.all')}</Radio>
        </Radio.Group>
        <Radio.Group type='button' value={gran} onChange={setGran}>
          <Radio value='day'>{t('usageStats.granularity.day')}</Radio>
          <Radio value='week'>{t('usageStats.granularity.week')}</Radio>
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
              <SummaryCards byAgent={data.summary.byAgent} />
              <TrendChart points={data.trend.points} />
              <ModelTable rows={data.byModel} />
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

export default UsageStats;
```

- [ ] **Step 2: 注册路由**

Modify `packages/desktop/src/renderer/components/layout/Router.tsx`:
- 在 lazy import 区 (约 Router.tsx:8-15) 加: `const UsageStats = React.lazy(() => import('@renderer/pages/settings/UsageStats'));`
- 在 settings 路由区 (约 Router.tsx:73, `/settings/system` 附近) 加: `<Route path='/settings/usage' element={withRouteFallback(UsageStats)} />`

- [ ] **Step 3: 注册 Settings Tab**

Modify `packages/desktop/src/renderer/pages/settings/components/SettingsSider.tsx`:
- `BUILTIN_TAB_IDS` 数组在 `'system'` 前加 `'usage'` (即放在 about/system 附近合理位置)
- `builtinMap` 加条目 (参考现有 agent 条目格式, icon 从 `@icon-park/react` 选图表类如 `ChartHistogram`; 文件顶部 import 区已 import 其它 icon, 加 `ChartHistogram`):
```tsx
      usage: {
        id: 'usage',
        label: t('usageStats.menuLabel'),
        icon: <ChartHistogram />,
        path: 'usage',
      },
```
> 先 `grep -n "@icon-park/react" packages/desktop/src/renderer/pages/settings/components/SettingsSider.tsx` 看 import 行, 把 `ChartHistogram` 加入既有解构 import。确认该图标名存在: `grep -rn "ChartHistogram\|ChartPie\|DataAll" node_modules/@icon-park/react/es/map.js 2>/dev/null | head` — 若不存在换一个确实存在的图表类图标名。

- [ ] **Step 4: lint/format/typecheck/i18n**

Run:
```bash
bun run lint:fix && bun run format && bunx tsc --noEmit && node scripts/check-i18n.js
```
Expected: 无 error

- [ ] **Step 5: 提交**

```bash
git add packages/desktop/src/renderer/pages/settings/UsageStats/index.tsx packages/desktop/src/renderer/components/layout/Router.tsx packages/desktop/src/renderer/pages/settings/components/SettingsSider.tsx
git commit -m "feat(usage-stats): add container page, route and settings tab"
```

---

### Task 2.6: 容器逻辑测试

**Files:**
- Create: `tests/unit/settings/UsageStats.dom.test.tsx`

> React 组件测试: 必须放 `tests/unit/` 且命名 `*.dom.test.tsx` 才会进入 jsdom project (`vitest.config.ts:45`)。参考现有 `tests/unit/settings/SystemSettings.dom.test.tsx`。

- [ ] **Step 1: 写测试 (mock ipcBridge: loading/empty/error/unsupported/翻页)**

Create `tests/unit/settings/UsageStats.dom.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

const invoke = vi.fn();
vi.mock('@/common', () => ({
  ipcBridge: { analytics: { getAgentUsage: { invoke: (...a: unknown[]) => invoke(...a) } } },
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => (o?.count != null ? `${k}:${o.count}` : k) }),
}));

import UsageStats from '@renderer/pages/settings/UsageStats';

const baseResp = {
  scannedAt: 'x',
  sources: [],
  summary: { byAgent: [{ agent: 'claude', sessions: 1, messages: 2, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 3 }] },
  byModel: [],
  trend: { granularity: 'day', points: [] },
  timeRange: '30d',
  sessionsTotal: 1,
  sessionsLimit: 200,
  sessionsOffset: 0,
  sessions: [{ agent: 'claude', sessionId: 's1', project: '/p', model: 'm', startedAt: 'a', lastActiveAt: 'b', messages: 2, totalTokens: 3 }],
};

describe('UsageStats container', () => {
  beforeEach(() => invoke.mockReset());

  it('renders data after load', async () => {
    invoke.mockResolvedValue(baseResp);
    render(<UsageStats />);
    await waitFor(() => expect(screen.getByText('usageStats.summary.totalTokens')).toBeTruthy());
  });

  it('shows unsupported on 404', async () => {
    invoke.mockRejectedValue({ status: 404 });
    render(<UsageStats />);
    await waitFor(() => expect(screen.getByText('usageStats.unsupported')).toBeTruthy());
  });

  it('shows generic error on other failures', async () => {
    invoke.mockRejectedValue({ status: 500 });
    render(<UsageStats />);
    await waitFor(() => expect(screen.getByText('usageStats.error')).toBeTruthy());
  });
});
```

- [ ] **Step 2: 运行测试**

Run: `bun run test -- UsageStats`
Expected: PASS (3 个)

- [ ] **Step 3: 提交**

```bash
git add tests/unit/settings/UsageStats.dom.test.tsx
git commit -m "test(usage-stats): add container logic tests"
```

---

## 阶段 3 — 联调与收尾

### Task 3.0b: WebHost 注入 webui-remote header (完成 P1 安全闭环)

> **回应 review P1**: Task 1.9 后端已读 `x-aionui-webui-remote` header 决定脱敏, 但必须有人注入它, 否则 WebUI 远程仍暴露完整 project 路径。WebHost 反向代理 `forwardToBackend` 是 WebUI 远程 `/api/*` 的唯一通道, 且能拿到 `allowRemote` 标志 — 在此注入, 并**先剥离客户端可能伪造的同名 header** (防止伪造)。

**Files:**
- Modify: `packages/web-host/src/static-server.ts` (`forwardToBackend` + 其调用处)
- Create: `tests/unit/web-cli/webuiRemoteHeader.test.ts`

> 该 task 在 AionUi 仓库 `feat/agent-usage-stats` 分支 (web-host 属 AionUi monorepo)。

- [ ] **Step 1: 写失败测试**

Create `tests/unit/web-cli/webuiRemoteHeader.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildBackendHeaders } from '@/web-host/static-server';

describe('buildBackendHeaders', () => {
  it('injects webui-remote=1 when allowRemote and strips client-forged header', () => {
    const h = buildBackendHeaders(
      { host: 'evil', 'x-aionui-webui-remote': '0' },
      9999,
      true
    );
    expect(h['x-aionui-webui-remote']).toBe('1');
    expect(h.host).toBe('127.0.0.1:9999');
  });
  it('strips header entirely when not remote (local Electron path)', () => {
    const h = buildBackendHeaders({ 'x-aionui-webui-remote': '1' }, 9999, false);
    expect(h['x-aionui-webui-remote']).toBeUndefined();
  });
});
```

> 路径前缀别名: 确认 web-host 在 tsconfig/vitest 的别名 (先 `grep -rn "web-host\|@/web-host" tsconfig*.json vitest.config.ts | head`)。若无 `@/web-host` 别名, 用相对路径或为测试加别名; 若 web-host 不在 vitest include 的 source 范围, 测试改放 `tests/unit/web-cli/` 并用其能解析的导入路径 (web-cli 测试目录已存在)。

- [ ] **Step 2: 运行确认失败**

Run: `bun run test -- webuiRemoteHeader`
Expected: FAIL — `buildBackendHeaders` 未导出

- [ ] **Step 3: 重构 forwardToBackend 抽出可测的 header 构造**

Modify `packages/web-host/src/static-server.ts`:

- 新增并导出纯函数 (放在 `forwardToBackend` 上方):

```ts
export const WEBUI_REMOTE_HEADER = 'x-aionui-webui-remote';

/**
 * Build headers forwarded to the backend.
 * Security (review P1): always strip any client-supplied WEBUI_REMOTE_HEADER
 * first, then set it to "1" only when this WebHost runs in remote mode.
 * Local Electron talks to the backend directly (not via this proxy) so it
 * never carries the header → backend treats it as local (no sanitize).
 */
export function buildBackendHeaders(
  reqHeaders: Record<string, string | string[] | undefined>,
  backendPort: number,
  allowRemote: boolean
): Record<string, string | string[] | undefined> {
  const headers = { ...reqHeaders, host: `127.0.0.1:${backendPort}` };
  // 不信任客户端自带的该 header — 一律先删除。
  delete headers[WEBUI_REMOTE_HEADER];
  if (allowRemote) {
    headers[WEBUI_REMOTE_HEADER] = '1';
  }
  return headers;
}
```

- 修改 `forwardToBackend` 签名加 `allowRemote: boolean`, 其 `options.headers` 改为 `buildBackendHeaders(req.headers as Record<string, string | string[] | undefined>, backendPort, allowRemote)`:

```ts
function forwardToBackend(
  req: IncomingMessage,
  res: ServerResponse,
  backendPort: number,
  allowRemote: boolean
): void {
  const options: http.RequestOptions = {
    hostname: '127.0.0.1',
    port: backendPort,
    path: req.url,
    method: req.method,
    headers: buildBackendHeaders(
      req.headers as Record<string, string | string[] | undefined>,
      backendPort,
      allowRemote
    ),
  };
  // ... 其余 proxy 逻辑不变
```

- 更新调用处 (约 static-server.ts:144): `forwardToBackend(req, res, opts.backendPort, allowRemote);` (`allowRemote` 在 `startStaticServer` 内已计算, 见 static-server.ts:121)

- [ ] **Step 4: 运行确认通过**

Run: `bun run test -- webuiRemoteHeader`
Expected: PASS (2 个)

- [ ] **Step 5: lint/format/typecheck**

Run:
```bash
bun run lint:fix && bun run format && bunx tsc --noEmit
```
Expected: 无 error

- [ ] **Step 6: 提交**

```bash
git add packages/web-host/src/static-server.ts tests/unit/web-cli/webuiRemoteHeader.test.ts
git commit -m "feat(web-host): inject webui-remote header for backend path sanitize"
```

---

### Task 3.1: 端到端联调 (前端 + 阶段1 二进制)

- [ ] **Step 1: 用阶段 1 的 aioncli 二进制启动后端**

在 AionUi 项目, 按项目方式让其使用阶段 1 构建的 `target/release/aioncli` (查 `grep -rn "bundled-aioncli\|aioncli" scripts/ packages/desktop/src/process/backend/binaryResolver.ts | head`)。把阶段1产物复制到 AionUi 期望的 bundled 目录, 或按 binaryResolver 解析逻辑放置。

- [ ] **Step 2: 启动 AionUi dev 并打开 Settings → 使用统计**

Run: `bun run dev` (按项目实际 dev 命令; 先 `grep '"dev"' package.json`)
手动验证 (golden path):
- Settings 侧边栏出现「使用统计」Tab
- 进入后自动加载, 显示汇总卡片 (claude/codex)、趋势、按模型、会话明细
- 切换时间窗 7d/30d/90d/all → 数据变化
- 切换日/周 → 趋势桶变化
- 点「加载更多」→ 会话列表追加
- 点「刷新」→ 重新加载

- [ ] **Step 2b: 边界冒烟**
- 把 `~/.codex` 临时改名模拟目录缺失 → SourceBanner 显示缺失提示, 不崩
- 超大量日志 (本机真实数据) → 首次有 Spin, 不卡死
- 无日志环境 → Empty 态

- [ ] **Step 2c: WebUI 远程脱敏验证 (回应 review P1)**

以 WebUI 远程模式启动 (allowRemote, 监听 0.0.0.0; 查启动方式 `grep -rn "allowRemote\|startWebHost\|webui" scripts/webui.ts | head`), 从**另一台机器或非 loopback 地址**访问 `/api/analytics/agent-usage`:
- 期望: `sessions[].project` 为脱敏 basename (如 `proj`), **不含**完整路径/用户名
- 对照: 本机 Electron 直接打开同页面 → `project` 为完整路径 (本机用户看自己的)
- 若无第二台机器: `curl -H 'x-aionui-webui-remote: 1' http://127.0.0.1:<webhostPort>/api/analytics/agent-usage` 应返回脱敏路径; 不带该 header 直连后端端口应返回完整路径
- 无法验证则如实记录"未能验证 WebUI 远程脱敏", 不谎报 (per verification-before-completion)

- [ ] **Step 3: 记录验证结果**

如 UI 无法在当前环境跑起来 (无 GUI), 明确说明"未能浏览器验证 UI", 不谎报成功 (per verification-before-completion)。

### Task 3.2: 各仓库质量门禁 + 推送

- [ ] **Step 1: AionCLI 门禁**

在 AionCLI:
```bash
cargo test --workspace && cargo clippy --workspace -- -D warnings && cargo fmt --all -- --check
```
Expected: 全 PASS

- [ ] **Step 2: AionUi 门禁**

在 AionUi:
```bash
just push
```
(若未配置 just 远程, 等价跑 `bun run lint:fix && bun run format && bunx tsc --noEmit && bun run test && node scripts/check-i18n.js`)
Expected: 全 PASS (按 exit code 判定, 忽略 pre-existing warning)

- [ ] **Step 3: 推送两仓库分支**

```bash
# AionCLI
git push -u origin feat/agent-usage-analytics
# AionUi
git push -u origin feat/agent-usage-stats
```

- [ ] **Step 4: 创建两个 PR (互相反向链接 spec)**

按 `oss-pr` skill 流程分别创建 PR。AionCLI PR 描述中反向链接 AionUi 的 `docs/prds/settings/agent_usage/design.md`; AionUi PR 描述链接同一 spec 并注明依赖 AionCLI PR。

### Task 3.3: 文档同步 (per 项目 CLAUDE.md "同步变更")

- [ ] **Step 1: 更新设计文档状态**

Modify `docs/prds/settings/agent_usage/design.md`: 头部状态从"设计草案"改为"已实现, 见 PR #xxx / #yyy"。

- [ ] **Step 2: 提交并入 AionUi PR**

```bash
git add docs/prds/settings/agent_usage/design.md
git commit -m "docs(specs): mark agent usage stats design as implemented"
git push
```

---

## Self-Review (计划自审)

**1. Spec 覆盖检查:**
- ① 总量汇总卡片 → Task 2.4 SummaryCards ✓
- ② 按模型细分 → Task 1.6 aggregate by_model + Task 2.4 ModelTable ✓
- ③ 会话明细列表 → Task 1.6 sessions 分页 + Task 2.4 SessionList ✓
- ④ 日/周趋势 → Task 1.6 bucket_key + Task 2.4 TrendChart ✓
- 直接读本地日志不存储 → Task 1.3/1.4 parser, 无 DB 写 ✓
- High-1 数据量边界 (time_range/分页) → Task 1.5 query DTO + 1.8 service 过滤 + 1.6 分页 ✓
- High-2 Codex 事件级归桶 + fallback → Task 1.4 last_token_usage + last_total fallback + cross_day/fallback 测试 ✓
- Med-3 path builder 拼 query → Task 2.2 buildAgentUsagePath + 测试 (路径 `tests/unit/`) ✓
- Med-4 鉴权 + 远程脱敏 (闭环) → 后端读 header Task 1.9 + WebHost 注入 header Task 3.0b + 1.8 sanitize_project + handler header 测试 + Task 1.9b app 级 403 ✓
- Med-5 snake→camel 映射 → Task 2.1 fromApiAgentUsage + 测试 (路径 `tests/unit/`) ✓
- i18n 独立模块 → Task 2.3 ✓
- 设置页新 Tab → Task 2.5 ✓
- 缓存 mtime+size → Task 1.7 ✓

**2. 占位符扫描:** 无 TBD/TODO; 每个 code step 含完整代码; 命令含 expected。is_remote 已是**完整闭环** (后端 Task 1.9 读 `x-aionui-webui-remote` header + WebHost Task 3.0b 注入并先剥离客户端伪造同名 header), 非占位符。

**3. 类型一致性:** `ParsedSession`/`UsageEvent`/`Agent` 在 Task 1.2 定义, 1.3/1.4/1.6/1.8 一致使用; `last_total` 在 1.4 codex parser 声明与使用一致; `AgentUsageResponse` (Rust) 与 `AgentUsageResponseRaw` (TS) 字段严格对齐 (Task 1.5 vs 2.1 逐字段核对一致); `analytics_routes`/`AnalyticsRouterState`/`WEBUI_REMOTE_HEADER` 在 1.9 定义与 1.9b/3.0b 引用一致; `fromApiAgentUsage`/`buildAgentUsagePath` 在 2.1/2.2 定义与 2.5 调用一致。

**4. 测试可执行性 (回应 review P1):** 所有 TS 测试路径已迁至 `tests/unit/` (node) / `tests/unit/**/*.dom.test.tsx` (jsdom), 与 `vitest.config.ts:29-45` include 规则匹配, 确保 `bun run test` 真正收集执行。Rust 测试均 `cargo test -p aionui-analytics` 可达。

**已知实现期待定项 (非计划缺陷):**
- TrendChart 是否用现有图表库 → Task 2.4 Step 4 给出"查依赖, 有则用, 无则零依赖 div 方案", 两条路径都可执行
- 端口号/二进制名/dev 命令 → 各 Step 给出 grep 验证命令, 不写死
- app 级 403 测试依赖 aionui-app 现有集成测试基建 → Task 1.9b Step 2 明确"有范例则复用, 无则如实记录不谎报", 不会假装已覆盖

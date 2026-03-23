# Organization OS Project Panel Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将当前 `Project` 面板重构为 `Organization Console`，以七类组织对象为核心打通控制面、执行面、评估流和演化流。

**Architecture:** 采用“SQLite 结构化主存储 + Workspace 文档投影 + Conversation 作为 Run 执行通道”的方案。通过数据库迁移替换旧 `Project / Task` 语义，新增组织对象表、控制面 bridge/service、投影 watcher 与前端控制台，最终用统一的 `org/*` API 驱动页面和组织 AI。

**Tech Stack:** Electron 37、TypeScript 5.8、React 19、Arco Design 2、better-sqlite3、Vitest 4

---

## 执行进展

- 2026-03-20：Task 1 已完成，已建立 `organization.ts` 与 `org` IPC 契约，并补齐基础单测保护。
- 2026-03-20：Task 2 已完成，数据库升级到 v21，并落地 9 张 Organization OS 核心表及对应仓储 CRUD/list/query。
- 2026-03-20：Task 2 审查修复已完成，补齐 `associateConversationWithOrgRun` 组织一致性校验、增强 `organizationDatabase` 覆盖，并将 `migration_v21.down` 明确为有损回滚且保留映射痕迹。
- 2026-03-20：Task 3 已完成，新增 `organizationContextService`、`organizationOpsWatcher`、`organizationBridge`，打通 `.aionui-org` 上下文投影、`org/*` 控制面 provider、artifact register 别名和 organization system prompt provider。
- 2026-03-20：Task 3 审查修复已完成，补齐跨组织隔离、`run -> task` 血缘一致性校验、watcher 同名文件重试、workspace 迁移重挂载、治理审计失败补偿，并将旧 `workTask` 路径标记为迁移期兼容层。
- 2026-03-20：Task 4 已完成，`org/run/start` 现会创建执行会话并绑定 `conversation_id / organization_id / run_id`，执行态元数据落入 conversation extra，`org/run/close` 会回写执行摘要并收敛 run 状态。
- 2026-03-20：Task 5 已完成，新增 `organizationEvalService` 与 `organizationEvolutionService`，打通 `Artifact -> Eval -> MemoryCard -> GenomePatch` 服务闭环，`org/eval/execute` 会真实执行命令并推进 run 进入 `reviewing/verifying`，`org/memory/promote` 与 `org/evolution/*` 已收敛到基于 `run_id` 的可追溯路径。
- 2026-03-20：Task 6 已完成，组织上下文投影目录已切换到 `.aionui-org/`，`organizationContextService` 会输出七类对象快照与组织控制面 system prompt，供 control plane 与 run executor 共用但语义分层。
- 2026-03-20：Task 7 已完成第一版控制台骨架，`ProjectList` 已切换为 `Organization` 列表语义，`ProjectDetail` 已重构为三栏 `Organization Console`，包含对象导航、工作区主视图与 `Organization AI / Structured Actions / Object Inspector` 控制塔。
- 2026-03-20：Task 8 已完成对象视图与关键动作接线，中栏现可切换 `Tasks / Runs / Artifacts / Memory / Eval Specs / Skills / Genome Patches` 并展示组织数据，右栏动作区已打通 `create task / start run / execute eval / promote memory / propose patch` 到真实 `org/*` provider。
- 2026-03-20：Task 9 已完成多语言与收尾校验，`Organization Console` 的导航、概览、对象空态、控制塔与动作消息已统一接入 `project.console.*`，六种语言资源已补齐；`node scripts/check-i18n.js`、`bun run i18n:types`、`bun run format`、`bun run lint:fix` 与核心 Organization 测试集通过，`bunx tsc --noEmit` 仍只剩仓库既有 `cookie` 类型缺失。
- 2026-03-20：Task 9 收尾补丁已完成，右栏 `Organization AI` 现已接入真实组织级会话面板，基于 `conversation.extra.organizationId + organizationRole=control_plane` 复用会话，并在 grouped history 中隐藏组织控制/执行会话，避免污染全局侧栏。
- 2026-03-20：主工作区 `develop/task_driven` 已补回 `feat/org-os-panel` 的完整 9 个提交链；同时增强 `devStartPreflight`，即使 Electron native rebuild stamp 已存在，也会探测 `better-sqlite3` 的实际 ABI 兼容性，不兼容时自动重建，避免 `bun run start` 因旧原生产物直接失败。
- 2026-03-21：修复 Organization Console 左侧疯狂闪动问题。根因是组织页 `ProjectDetail` 仍错误进入旧 `project mode`，导致全局 `Sider` 切到遗留 `ProjectSider`；现已移除该状态切换，并补充单测保护，确保组织页不再触发 legacy project mode。
- 2026-03-21：继续修复 Organization Console 左侧闪动。进一步确认 `ProjectDetail` 中用于自动折叠全局侧栏的 effect 依赖了整个 `layout` 对象，组织数据加载造成重复 render 时会反复执行 cleanup 与 restore，形成 `setSiderCollapsed(true/false)` 抖动；现已改为仅基于稳定 setter 依赖、并缓存首次进入时的折叠状态，避免加载期间来回切换。
- 2026-03-21：修复右侧 `Organization AI` 会话区内容几乎不可见的问题。根因是控制塔第一张 AI 卡片及其 body 未建立 `flex/min-height/overflow` 高度链路，嵌入的 `project-conv-panel` 虽然要求 `height: 100%`，但实际被父容器压缩；现已为 AI 卡片补充专用布局 class，并新增 `OrganizationControlTower` 单测保护聊天容器必须保持可伸缩。
- 2026-03-21：根据交互反馈继续调整 `Organization Console` 布局，右栏现收敛为纯 `Organization AI` 工作区，不再堆叠结构化动作与对象检查器；这两块已下沉到中栏主内容底部，避免在常见窗口尺寸下挤压 AI 选型/聊天区域，并新增控制台布局单测保护该结构。
- 2026-03-21：继续扁平化右侧 `Organization AI` 面板结构。当前已去掉内层 `project-conv-panel` 标题壳，改为由控制塔提供唯一标题，组织会话面板仅渲染无边框内容；已有会话时显示一条轻量工具条承载 agent 名与右上角切换按钮，下方直接挂载 `AcpChat`，并补充单测保护“无内层 header”约束。
- 2026-03-21：继续压平 `Organization AI` 外观层级。当前仅对 AI 卡片特例移除了外层边框、圆角与卡片内边距，保留右栏整体分栏与容器 padding，不影响输入框与右栏整体留白；新增控制塔单测保护该无边框特例 class。
- 2026-03-22：新增 `Organization Control Plane Governance` 设计与实现计划，明确后续将用 `prompt + 状态机 + 人类审批门` 把右侧组织 AI 从执行型聊天入口升级为真正的组织控制平面；详见 `docs/plans/2026-03-22-organization-control-plane-governance-design.md` 与 `docs/plans/2026-03-22-organization-control-plane-governance-plan.md`。
- 2026-03-22：新增能力缺口分析文档 `docs/plans/2026-03-22-organization-os-capability-gap-analysis.md`，把当前组织控制面从“已受治理约束”到“具备长期规划、编排、监控、复盘、学习、演化能力”之间的差距拆解为规划工作台、任务编排器、run 监控与 replanning、记忆检索、GenomePatch 晋升、多 agent 路由六大建设方向，用于指导下一阶段按能力推进而非按零散问题修补。
- 2026-03-22：`Organization Control Plane Governance` Task 1 / Task 2 已完成。当前已补齐控制面领域模型与 IPC 契约，并把控制状态、brainstorming brief、plan snapshot、approval record 落库到 v22；repository 已具备 CRUD / list / latest，且新增控制状态引用完整性与审批状态一致性约束，为后续状态机与审批门提供稳定底座。
- 2026-03-22：`Organization Control Plane Governance` Task 3 已完成。组织控制面 prompt 已切换为 authority tiers + coordinator-only 模式，明确“先问人类、再 brief/plan、再 approval gate、最后启动 run”；`.aionui-org/context/` 现新增 `control_state.json`、`briefs.json`、`plan_snapshots.json`、`approvals.json`，为后续状态机与审批门落地提供完整上下文投影。
- 2026-03-22：`Organization Control Plane Governance` Task 4 已完成。组织 bridge 现已接通 `getControlState / listApprovals / respondApproval`，watcher 会在 `org/task/create / org/run/start` 前强制检查 Tier 1 决策与 approved plan snapshot，并将 phase 推进到 `awaiting_human_decision / awaiting_plan_approval / dispatching / monitoring`；`run close` 后会回收控制状态进入下一轮规划，审批响应也会同步写入 approval record 与 audit log。
- 2026-03-22：`Organization Control Plane Governance` Task 5 / Task 6 已完成。组织控制会话在前端创建时默认落到更安全的 `sessionMode=default`，控制台主区现已自取组织 `controlState + pending approvals`，展示当前 phase、人类审批提醒，并在审批门未满足或治理状态未加载完成前禁用“启动运行”；随后已完成多语言、文档、全量验证与收尾提交，这条治理增强计划现已闭环。
- 2026-03-22：修复右侧 `Organization AI` 会话窗口消息被发送区遮挡的问题。基于运行态排查，根因收敛为嵌入式组织会话仍沿用了主聊天页 `ThoughtDisplay` 的默认悬浮样式；现已为 `AcpChat -> AcpSendBox` 增加 `thoughtDisplayStyle` 透传，并在组织右栏固定使用 `compact` 模式，同时补充 DOM 单测锁定该嵌入态约束。
- 2026-03-23：已完成 `Organization Control Runtime` 设计与实施计划，目标是在保留人类审批门的前提下，让右侧 `Organization AI` 成为真正的组织控制会话：统一接收 `Task / Run / Approval` 事件流、自动建立执行会话并根据结果继续推进项目；详细方案见 `docs/plans/2026-03-23-organization-control-runtime-design.md` 与 `docs/plans/2026-03-23-organization-control-runtime-plan.md`。
- 2026-03-23：`Organization Control Runtime` Task 3 已完成。控制运行时已支持通过 `enqueueOrganizationControlEvent` 正式接收组织事件，并将事件以结构化消息回灌到同一控制会话；多任务事件字段、异常分支与告警上下文已补齐，Task 4 将继续实现自动唤醒与串行消费队列。
- 2026-03-23：`Organization Control Runtime` Task 4 已完成。控制运行时现已支持事件回灌后的自动唤醒、busy/idle 串行消费与失败暂停保留 pending；组织控制内部继续推进走现有 conversation / ACP 链路，并通过 `internalTrigger` 静默发送避免伪造右侧用户消息，接下来将开始在 bridge 主链接入 `task_created / run_started / run_closed / approval_responded` 等首批组织事件。
- 2026-03-23：`Organization Control Runtime` Task 5 已完成。组织 bridge 成功路径现已统一投递 `task_created / run_started / run_closed / approval_responded` 首批组织事件，并通过共享 builder 收敛 `summary / payload / object_ids` 组装逻辑；同时已补齐 `org.run.start` 回滚时的 runtime 会话清理，下一步将把 watcher 文件协议动作也统一回灌到同一控制会话。
- 2026-03-23：`Organization Control Runtime` Task 6 已完成。`organizationOpsWatcher` 成功执行 `org/task/create / org/run/start` 文件协议后，现已补投 `task_created / run_started` 到同一组织控制会话，并保持无 binding 时不影响原 watcher 成功流程；同时已抽出共享事件 builder，统一 watcher 与 bridge 的 `summary / payload / object_ids` 组装，补上 watcher 侧关键字段断言，接下来将进入 `reconcile_tick` 巡检补偿阶段。
- 2026-03-23：`Organization Control Runtime` Task 7 已完成。控制运行时现已具备自动巡检 ticker 与显式 reconcile pass，发现控制状态与对象状态失步时会补投 `reconcile_tick` 到同一控制会话，并更新控制会话 `lastReconcileAt`；同时已抽出共享 control-state phase 推导 helper，统一 watcher 主链与 reconcile snapshot 的规则来源，避免补偿事件和主状态机漂移。
- 2026-03-23：`Organization Control Runtime` Task 8 已完成。右侧 `Organization AI` 现已能把 `[OrgEvent]` 系统消息渲染为结构化事件卡片，明确展示 `event_type / task_id / run_id / source / summary / payload`，并在并发 task/run 回调时保持每条事件独立归属；该实现收敛在消息渲染层，不改右栏整体布局与 `compact` thought display。
- 2026-03-23：继续收口 `Organization Control Runtime` 的类型与构建稳定性。已同步会话创建参数中的控制运行时元数据类型，并补上 `cookie` 模块本地声明，当前全仓 `bunx tsc --noEmit` 已转绿，不再被控制运行时落地后的剩余类型缺口阻塞。
- 2026-03-23：`Organization Control Runtime` Task 9 已完成，整条控制运行时计划收尾。当前已完成文档回写、结构化事件长 ID 可读性修正、定向验证 `65/65`，并确认 `tsc --noEmit` 仍仅受仓库既有 `organizationAutoDrive` extra 类型缺口与 `cookie` 声明缺失阻塞。

### Task 1: 定义组织领域类型与 IPC 草案

**Files:**
- Create: `src/common/types/organization.ts`
- Modify: `src/common/ipcBridge.ts`
- Reference: `src/common/types/task.ts`

**Step 1: 写失败测试**

- 新增针对类型和 bridge 命名空间的单测，覆盖：
  - `organization/task/run/artifact/memory/eval/skill/evolution/governance` 命名空间存在
  - `TaskStatus`、`RunStatus`、`GenomePatchStatus` 等枚举值与设计文档一致

**Step 2: 运行测试确认失败**

Run:

```bash
bunx vitest --run tests/unit/organizationIpcBridge.test.ts
```

Expected: FAIL，因为组织类型与 `org/*` bridge 尚未存在。

**Step 3: 写最小实现**

- 在 `src/common/types/organization.ts` 中定义：
  - `TOrganization`
  - `TOrgTask`
  - `TOrgRun`
  - `TOrgArtifact`
  - `TOrgMemoryCard`
  - `TOrgEvalSpec`
  - `TOrgSkill`
  - `TOrgGenomePatch`
  - `TaskStatus` `RunStatus` `GenomePatchStatus`
- 在 `src/common/ipcBridge.ts` 中新增 `org` 命名空间与事件类型导出

**Step 4: 运行测试确认通过**

Run:

```bash
bunx vitest --run tests/unit/organizationIpcBridge.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/common/types/organization.ts src/common/ipcBridge.ts tests/unit/organizationIpcBridge.test.ts
git commit -m "feat(org): add organization domain types and ipc contracts"
```

### Task 2: 编写数据库迁移并替换旧 Project/Task 主模型

**Files:**
- Modify: `src/process/database/schema.ts`
- Modify: `src/process/database/migrations.ts`
- Modify: `src/process/database/index.ts`
- Reference: `src/common/types/organization.ts`

**Step 1: 写失败测试**

- 新增数据库层单测，覆盖：
  - 新表存在
  - 能创建 organization
  - 能创建 task contract
  - 能创建 run 并绑定 task
  - 旧 `projects/tasks` 查询不再作为主路径

**Step 2: 运行测试确认失败**

Run:

```bash
bunx vitest --run tests/unit/organizationDatabase.test.ts
```

Expected: FAIL，因为 schema 和 repository 仍是旧模型。

**Step 3: 写最小实现**

- 将数据库版本从 `20` 升到下一版本
- 在迁移中创建以下表：
  - `organizations`
  - `org_tasks`
  - `org_runs`
  - `org_artifacts`
  - `org_memory_cards`
  - `org_eval_specs`
  - `org_skills`
  - `org_genome_patches`
  - `org_audit_logs`
- 在 `src/process/database/index.ts` 中新增对应 CRUD 和查询方法
- 明确 `conversation` 与 `run_id` / `organization_id` 的映射字段

**Step 4: 运行测试确认通过**

Run:

```bash
bunx vitest --run tests/unit/organizationDatabase.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/process/database/schema.ts src/process/database/migrations.ts src/process/database/index.ts tests/unit/organizationDatabase.test.ts
git commit -m "feat(org): add organization database schema and repositories"
```

### Task 3: 实现控制面 bridge 与组织服务层

**Files:**
- Create: `src/process/services/organizationContextService.ts`
- Create: `src/process/services/organizationOpsWatcher.ts`
- Create: `src/process/bridge/organizationBridge.ts`
- Modify: `src/process/bridge/index.ts`
- Reference: `src/process/services/projectContextService.ts`
- Reference: `src/process/services/projectOpsWatcher.ts`
- Reference: `src/process/bridge/workTaskBridge.ts`

**Step 1: 写失败测试**

- 新增 bridge/service 单测，覆盖：
  - `org/task/create`
  - `org/run/start`
  - `org/artifact/register`
  - `org/eval/execute`
  - `org/memory/promote`
  - `org/evolution/propose`
- 验证 watcher 可解析 `org/*` 结构化操作文件

**Step 2: 运行测试确认失败**

Run:

```bash
bunx vitest --run tests/unit/organizationBridge.test.ts tests/unit/organizationOpsWatcher.test.ts
```

Expected: FAIL，因为对应 provider 和 watcher 还不存在。

**Step 3: 写最小实现**

- 新建 `organizationBridge.ts`，注册 `org/*` providers
- 新建 `organizationContextService.ts`，负责投影、system prompt 生成、控制面 schema
- 新建 `organizationOpsWatcher.ts`，处理 `org/*` 操作文件并回写数据库
- 在 `src/process/bridge/index.ts` 中接入组织 bridge
- 将 `workTaskBridge` 的旧 project/task provider 标记为待移除或转发层

**Step 4: 运行测试确认通过**

Run:

```bash
bunx vitest --run tests/unit/organizationBridge.test.ts tests/unit/organizationOpsWatcher.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/process/services/organizationContextService.ts src/process/services/organizationOpsWatcher.ts src/process/bridge/organizationBridge.ts src/process/bridge/index.ts tests/unit/organizationBridge.test.ts tests/unit/organizationOpsWatcher.test.ts
git commit -m "feat(org): add control plane bridge and operations watcher"
```

### Task 4: 打通 Run 执行面与 Conversation 映射

**Files:**
- Modify: `src/process/services/conversationService.ts`
- Modify: `src/process/services/projectOpsWatcher.ts`
- Modify: `src/process/task/AcpAgentManager.ts`
- Modify: `src/common/storage.ts`
- Reference: `src/process/services/projectOpsWatcher.ts`

**Step 1: 写失败测试**

- 新增执行层单测，覆盖：
  - `org/run/start` 会创建 run 并按需创建 conversation
  - conversation 绑定到 `run_id`
  - run 关闭后可收敛状态并生成摘要

**Step 2: 运行测试确认失败**

Run:

```bash
bunx vitest --run tests/unit/organizationRunExecution.test.ts
```

Expected: FAIL，因为 conversation 目前只理解 project/task 关联。

**Step 3: 写最小实现**

- 为 conversation extra 或表结构添加 `organization_id`、`run_id`
- 在 run 启动流程中绑定 conversation
- 让组织级 AI 会话与执行会话分离
- 保留现有 ACP/agent manager 能力，不改其核心执行协议

**Step 4: 运行测试确认通过**

Run:

```bash
bunx vitest --run tests/unit/organizationRunExecution.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/process/services/conversationService.ts src/process/services/projectOpsWatcher.ts src/process/task/AcpAgentManager.ts src/common/storage.ts tests/unit/organizationRunExecution.test.ts
git commit -m "feat(org): bind conversations to organization runs"
```

### Task 5: 实现 Artifact、EvalSpec、MemoryCard、GenomePatch 服务闭环

**Files:**
- Create: `src/process/services/organizationEvalService.ts`
- Create: `src/process/services/organizationEvolutionService.ts`
- Modify: `src/process/database/index.ts`
- Reference: `src/common/types/organization.ts`

**Step 1: 写失败测试**

- 新增服务层单测，覆盖：
  - run 完成后可登记 artifact
  - 可执行 eval spec 并返回结构化评估结果
  - 可从 run/artifact 提炼 memory card
  - 可基于多个 run 提交 genome patch，并进入 `proposed -> offline_eval -> canary`

**Step 2: 运行测试确认失败**

Run:

```bash
bunx vitest --run tests/unit/organizationEvalService.test.ts tests/unit/organizationEvolutionService.test.ts
```

Expected: FAIL，因为评估和演化服务尚未实现。

**Step 3: 写最小实现**

- 新建 `organizationEvalService.ts` 负责：
  - 执行测试命令
  - 评估质量门
  - 输出结构化报告
- 新建 `organizationEvolutionService.ts` 负责：
  - 提炼 `MemoryCard`
  - 创建 `GenomePatch`
  - 执行离线评估与 canary 状态转换
- 数据库补齐相关查询和写回

**Step 4: 运行测试确认通过**

Run:

```bash
bunx vitest --run tests/unit/organizationEvalService.test.ts tests/unit/organizationEvolutionService.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/process/services/organizationEvalService.ts src/process/services/organizationEvolutionService.ts src/process/database/index.ts tests/unit/organizationEvalService.test.ts tests/unit/organizationEvolutionService.test.ts
git commit -m "feat(org): add evaluation and evolution services"
```

### Task 6: 重构投影目录与组织 AI system prompt

**Files:**
- Modify: `src/process/services/organizationContextService.ts`
- Modify: `tests/unit/projectContextService.test.ts`
- Create: `tests/unit/organizationContextService.test.ts`
- Reference: `src/process/services/projectContextService.ts`

**Step 1: 写失败测试**

- 覆盖以下断言：
  - 投影目录从 `.aionui/` 升级到 `.aionui-org/`
  - context 中包含七类对象 JSON
  - system prompt 以 organization control plane 为核心
  - prompt 明确区分 task contract、run、artifact、memory、genome patch

**Step 2: 运行测试确认失败**

Run:

```bash
bunx vitest --run tests/unit/organizationContextService.test.ts
```

Expected: FAIL，因为旧上下文服务仍按 project/task 生成。

**Step 3: 写最小实现**

- 重写上下文投影目录和 schema 输出
- 为组织级 AI 生成新的 system prompt
- 保留 watcher 与 prompt 之间的统一命名

**Step 4: 运行测试确认通过**

Run:

```bash
bunx vitest --run tests/unit/organizationContextService.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/process/services/organizationContextService.ts tests/unit/projectContextService.test.ts tests/unit/organizationContextService.test.ts
git commit -m "feat(org): project organization context and control prompt"
```

### Task 7: 重构前端列表页与控制台骨架

**Files:**
- Modify: `src/renderer/pages/tasks/ProjectList.tsx`
- Modify: `src/renderer/pages/tasks/ProjectDetail.tsx`
- Modify: `src/renderer/pages/tasks/ProjectConversationPanel.tsx`
- Modify: `src/renderer/pages/tasks/TaskBoard.css`
- Modify: `src/renderer/pages/tasks/ProjectConversationPanel.css`
- Create: `src/renderer/pages/tasks/OrganizationConsole.tsx`
- Create: `src/renderer/pages/tasks/OrganizationNavigator.tsx`
- Create: `src/renderer/pages/tasks/OrganizationControlTower.tsx`

**Step 1: 写失败测试**

- 新增 DOM 测试，覆盖：
  - 列表页展示 organization 而不是旧 project 语义
  - 详情页出现 `Overview / Tasks / Runs / Artifacts / Memory / Eval Specs / Skills / Genome Patches`
  - 右栏存在 Organization AI 和结构化操作区

**Step 2: 运行测试确认失败**

Run:

```bash
bunx vitest --run tests/unit/OrganizationConsole.dom.test.tsx
```

Expected: FAIL，因为页面仍是旧任务看板布局。

**Step 3: 写最小实现**

- 将 `ProjectDetail` 拆出 `OrganizationConsole`
- 左栏加入对象导航和全局状态摘要
- 中栏加入对象工作区，任务看板降级为 `Tasks` 视图的一种
- 右栏加入组织 AI、结构化动作与对象检查面板

**Step 4: 运行测试确认通过**

Run:

```bash
bunx vitest --run tests/unit/OrganizationConsole.dom.test.tsx
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/renderer/pages/tasks/ProjectList.tsx src/renderer/pages/tasks/ProjectDetail.tsx src/renderer/pages/tasks/ProjectConversationPanel.tsx src/renderer/pages/tasks/TaskBoard.css src/renderer/pages/tasks/ProjectConversationPanel.css src/renderer/pages/tasks/OrganizationConsole.tsx src/renderer/pages/tasks/OrganizationNavigator.tsx src/renderer/pages/tasks/OrganizationControlTower.tsx tests/unit/OrganizationConsole.dom.test.tsx
git commit -m "feat(org-ui): add organization console shell"
```

### Task 8: 接入前端对象视图与控制动作

**Files:**
- Create: `src/renderer/pages/tasks/views/OrganizationOverviewView.tsx`
- Create: `src/renderer/pages/tasks/views/OrganizationTasksView.tsx`
- Create: `src/renderer/pages/tasks/views/OrganizationRunsView.tsx`
- Create: `src/renderer/pages/tasks/views/OrganizationArtifactsView.tsx`
- Create: `src/renderer/pages/tasks/views/OrganizationMemoryView.tsx`
- Create: `src/renderer/pages/tasks/views/OrganizationEvalSpecsView.tsx`
- Create: `src/renderer/pages/tasks/views/OrganizationSkillsView.tsx`
- Create: `src/renderer/pages/tasks/views/OrganizationGenomePatchesView.tsx`
- Modify: `src/common/ipcBridge.ts`

**Step 1: 写失败测试**

- 新增 DOM 测试，覆盖：
  - 各对象视图能加载组织数据
  - 可触发 `create task`、`start run`、`execute eval`、`promote memory`、`propose patch`
  - 视图切换保持当前 organization 上下文

**Step 2: 运行测试确认失败**

Run:

```bash
bunx vitest --run tests/unit/OrganizationObjectViews.dom.test.tsx
```

Expected: FAIL，因为对象视图与控制动作尚不存在。

**Step 3: 写最小实现**

- 为各对象视图接上 `org/*` 查询 provider
- 在右栏结构化操作区接入关键动作
- 让运行、评估、记忆、演化动作能从 UI 发起

**Step 4: 运行测试确认通过**

Run:

```bash
bunx vitest --run tests/unit/OrganizationObjectViews.dom.test.tsx
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/renderer/pages/tasks/views src/common/ipcBridge.ts tests/unit/OrganizationObjectViews.dom.test.tsx
git commit -m "feat(org-ui): add organization object views and actions"
```

### Task 9: 完成多语言文案、校验与文档收尾

**Files:**
- Modify: `src/renderer/i18n/locales/en-US/project.json`
- Modify: `src/renderer/i18n/locales/zh-CN/project.json`
- Modify: `src/renderer/i18n/locales/zh-TW/project.json`
- Modify: `src/renderer/i18n/locales/ja-JP/project.json`
- Modify: `src/renderer/i18n/locales/ko-KR/project.json`
- Modify: `src/renderer/i18n/locales/tr-TR/project.json`
- Modify: `src/renderer/i18n/locales/en-US/task.json`
- Modify: `src/renderer/i18n/locales/zh-CN/task.json`
- Modify: `src/renderer/i18n/locales/zh-TW/task.json`
- Modify: `src/renderer/i18n/locales/ja-JP/task.json`
- Modify: `src/renderer/i18n/locales/ko-KR/task.json`
- Modify: `src/renderer/i18n/locales/tr-TR/task.json`
- Modify: `docs/plans/2026-03-20-organization-os-project-panel-design.md`
- Modify: `docs/plans/2026-03-20-organization-os-project-panel.md`

**Step 1: 补全文案**

- 为 Organization Console 的新导航、对象视图、操作动作补齐所有语言
- 避免在组件中硬编码用户可见字符串

**Step 2: 运行 i18n 校验**

Run:

```bash
node scripts/check-i18n.js
```

Expected: PASS

**Step 3: 运行格式化与代码质量检查**

Run:

```bash
bun run lint:fix
bun run format
bunx tsc --noEmit
```

Expected: PASS

**Step 4: 运行核心测试集**

Run:

```bash
bunx vitest --run tests/unit/organizationIpcBridge.test.ts tests/unit/organizationDatabase.test.ts tests/unit/organizationBridge.test.ts tests/unit/organizationOpsWatcher.test.ts tests/unit/organizationRunExecution.test.ts tests/unit/organizationEvalService.test.ts tests/unit/organizationEvolutionService.test.ts tests/unit/organizationContextService.test.ts tests/unit/OrganizationConsole.dom.test.tsx tests/unit/OrganizationObjectViews.dom.test.tsx
```

Expected: PASS

**Step 5: 整理工作区与 git 状态**

Run:

```bash
git status --short
```

Expected: 仅包含本次 Organization OS 相关变更。

**Step 6: Commit**

```bash
git add src/renderer/i18n/locales docs/plans
git commit -m "docs(org): finalize organization os panel plan and i18n"
```

**Completion Note**

- 2026-03-20：Task 9 实际收敛到 `project.json` 六种语言资源与 Organization Console 相关组件，无需改动 `task.json`。
- 2026-03-20：`node scripts/check-i18n.js` 通过，但仓库仍存在若干历史 `Unknown i18n key` warning；本次新增的 Organization Console 资源已补齐。
- 2026-03-20：`bunx tsc --noEmit` 未完全通过，仍为既有 `src/webserver/auth/middleware/TokenMiddleware.ts` 与 `src/webserver/middleware/csrfClient.ts` 的 `cookie` 类型声明缺失。

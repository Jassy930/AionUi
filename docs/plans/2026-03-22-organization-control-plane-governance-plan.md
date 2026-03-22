# Organization Control Plane Governance Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 `Organization AI` 从执行型聊天入口升级为真正的组织控制平面，具备分层决策、状态机、人类审批门，并强制通过 `Task Contract + Run` 派发执行。

**Architecture:** 复用 `projectContextService` 已验证的“authority tiers + coordinator-only” prompt 结构，扩展到 `organization` 域；同时新增组织控制面持久化状态、计划快照与审批记录，并在 bridge 层对 `org/task/create` / `org/run/start` 加入审批门。前端只补充最小状态展示，不重做整个控制台 UI。

**Tech Stack:** Electron 37、TypeScript 5.8、React 19、better-sqlite3、Vitest 4

---

## 执行进展

- 2026-03-22：Task 1 已完成并提交，已补齐组织控制面领域模型、审批相关类型与 IPC provider 契约。
- 2026-03-22：Task 2 已完成实现与审查，数据库新增控制状态 / brief / plan snapshot / approval record 持久化，repository 已补齐 CRUD / list / latest，补充了引用完整性与审批状态一致性约束；`bunx vitest --run tests/unit/organizationDatabase.test.ts` 通过。
- 2026-03-22：Task 3 已完成实现与审查，`organizationContextService` 已切换到治理感知的控制面 prompt，明确复用 authority tiers + coordinator-only 模式，并新增 `control_state.json`、`briefs.json`、`plan_snapshots.json`、`approvals.json` 投影与控制阶段/审批门 schema 声明；`bunx vitest --run tests/unit/organizationContextService.test.ts` 通过。
- 2026-03-22：Task 4 已完成实现，bridge 已新增 `getControlState / listApprovals / respondApproval` provider，watcher 已对 `org/task/create` / `org/run/start` 强制执行 Tier 1 与 plan gate 检查，并在 `run close` 后把控制状态收敛回下一轮规划阶段；`bunx vitest --run tests/unit/organizationBridge.test.ts tests/unit/organizationOpsWatcher.test.ts` 通过。
- 2026-03-22：Task 5 已完成实现与本地审查，组织控制会话默认使用更安全的 `sessionMode=default`，`OrganizationConsole` 已接通 `getControlState / listApprovals` 并展示 phase / 审批提醒 / run gate disabled 状态；`bunx vitest --run tests/unit/OrganizationConversationPanel.dom.test.tsx tests/unit/OrganizationConsole.dom.test.tsx`、`bunx eslint --fix ...`、`bun run i18n:types`、`node scripts/check-i18n.js` 通过，`bunx tsc --noEmit` 仍只剩仓库既有 `cookie` 类型声明缺失。
- 2026-03-22：Task 6 已完成，已同步更新组织主计划与治理计划文档、补齐六种语言治理文案，并完成提交前全量验证与收尾提交；`bunx vitest --run tests/unit/organizationIpcBridge.test.ts tests/unit/organizationDatabase.test.ts tests/unit/organizationContextService.test.ts tests/unit/organizationBridge.test.ts tests/unit/organizationOpsWatcher.test.ts tests/unit/OrganizationConversationPanel.dom.test.tsx tests/unit/OrganizationConsole.dom.test.tsx` 通过，`bunx prettier --check ...` 与 `node scripts/check-i18n.js` 通过，`bunx tsc --noEmit` 仍只剩仓库既有 `cookie` 类型声明缺失。

---

### Task 1: 定义组织控制面领域模型

**Files:**
- Modify: `src/common/types/organization.ts`
- Modify: `src/common/ipcBridge.ts`
- Test: `tests/unit/organizationIpcBridge.test.ts`

**Step 1: 写失败测试**

- 为以下新增类型与 provider 契约写失败测试：
  - `OrganizationControlPhase`
  - `TOrgControlState`
  - `TOrgBrief`
  - `TOrgPlanSnapshot`
  - `TOrgApprovalRecord`
  - `org.organization.getControlState`
  - `org.organization.listApprovals`
  - `org.organization.respondApproval`

**Step 2: 运行测试确认失败**

Run:

```bash
bunx vitest --run tests/unit/organizationIpcBridge.test.ts
```

Expected: FAIL，因为控制面领域模型和 bridge 契约尚不存在。

**Step 3: 写最小实现**

- 在 `src/common/types/organization.ts` 中补充控制面状态与审批类型
- 在 `src/common/ipcBridge.ts` 中扩展组织控制面 provider 定义

**Step 4: 运行测试确认通过**

Run:

```bash
bunx vitest --run tests/unit/organizationIpcBridge.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/common/types/organization.ts src/common/ipcBridge.ts tests/unit/organizationIpcBridge.test.ts
git commit -m "feat(org): add control plane governance contracts"
```

### Task 2: 持久化控制状态、计划快照与审批记录

**Files:**
- Modify: `src/process/database/migrations.ts`
- Modify: `src/process/database/index.ts`
- Test: `tests/unit/organizationDatabase.test.ts`

**Step 1: 写失败测试**

- 为数据库层新增失败测试，覆盖：
  - 可创建/读取组织控制状态
  - 可写入 brainstorming brief
  - 可写入 plan snapshot 并区分 `draft/approved/superseded`
  - 可写入 approval record
  - 组织级审批记录可按 organization 查询

**Step 2: 运行测试确认失败**

Run:

```bash
bunx vitest --run tests/unit/organizationDatabase.test.ts
```

Expected: FAIL，因为相关表和 repository 尚不存在。

**Step 3: 写最小实现**

- 增加组织控制面相关表
- 在 `src/process/database/index.ts` 中补齐 CRUD / list / latest 查询
- 让计划快照与审批记录都可按 `organization_id` 追溯

**Step 4: 运行测试确认通过**

Run:

```bash
bunx vitest --run tests/unit/organizationDatabase.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/process/database/migrations.ts src/process/database/index.ts tests/unit/organizationDatabase.test.ts
git commit -m "feat(org): persist control plane state and approvals"
```

### Task 3: 重写组织控制面 prompt 与上下文投影

**Files:**
- Modify: `src/process/services/organizationContextService.ts`
- Test: `tests/unit/organizationContextService.test.ts`
- Reference: `src/process/services/projectContextService.ts`

**Step 1: 写失败测试**

- 为 `generateOrganizationSystemPrompt` 和上下文投影新增失败测试，覆盖：
  - prompt 明确声明“组织 AI 是协调者不是执行者”
  - prompt 包含三层 authority model
  - prompt 要求先对人类提问、再规划、再启动 run
  - 上下文目录新增 `control_state.json`、`briefs.json`、`plan_snapshots.json`、`approvals.json`

**Step 2: 运行测试确认失败**

Run:

```bash
bunx vitest --run tests/unit/organizationContextService.test.ts
```

Expected: FAIL，因为当前 prompt 只有轻量 control plane 描述。

**Step 3: 写最小实现**

- 复用 `projectContextService` 的 authority / coordinator 模式重写组织 prompt
- 输出控制状态与审批投影文件
- 在 schema 中声明审批门和控制阶段

**Step 4: 运行测试确认通过**

Run:

```bash
bunx vitest --run tests/unit/organizationContextService.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/process/services/organizationContextService.ts tests/unit/organizationContextService.test.ts
git commit -m "feat(org): add governance-aware control plane prompt"
```

### Task 4: 在 bridge 层加入状态机与审批门

**Files:**
- Modify: `src/process/bridge/organizationBridge.ts`
- Modify: `src/process/services/organizationOpsWatcher.ts`
- Test: `tests/unit/organizationBridge.test.ts`
- Test: `tests/unit/organizationOpsWatcher.test.ts`

**Step 1: 写失败测试**

- 为 bridge / watcher 新增失败测试，覆盖：
  - 新建组织控制会话时初始化 control state
  - 缺少第一层信息时，状态进入 `awaiting_human_decision`
  - 没有 approved plan snapshot 时，拒绝 `org/run/start`
  - `org/task/create` / `org/run/start` 会更新 phase 为 `dispatching` / `monitoring`
  - run 关闭后，会回到下一轮规划或待审批阶段

**Step 2: 运行测试确认失败**

Run:

```bash
bunx vitest --run tests/unit/organizationBridge.test.ts tests/unit/organizationOpsWatcher.test.ts
```

Expected: FAIL，因为当前 bridge 没有审批门和控制状态机。

**Step 3: 写最小实现**

- 新增 `getControlState / listApprovals / respondApproval` provider
- 在 `org/task/create` / `org/run/start` 前做 gate 检查
- 对 run 关闭和治理动作补充 control state 推进
- 将审批结果写入 audit log 与审批表

**Step 4: 运行测试确认通过**

Run:

```bash
bunx vitest --run tests/unit/organizationBridge.test.ts tests/unit/organizationOpsWatcher.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/process/bridge/organizationBridge.ts src/process/services/organizationOpsWatcher.ts tests/unit/organizationBridge.test.ts tests/unit/organizationOpsWatcher.test.ts
git commit -m "feat(org): enforce control plane approval gates"
```

### Task 5: 调整组织 AI 会话默认模式与前端状态展示

**Files:**
- Modify: `src/renderer/pages/tasks/OrganizationConversationPanel.tsx`
- Modify: `src/renderer/pages/tasks/OrganizationConsole.tsx`
- Modify: `src/renderer/pages/tasks/TaskBoard.css`
- Test: `tests/unit/OrganizationConversationPanel.dom.test.tsx`
- Test: `tests/unit/OrganizationConsole.dom.test.tsx`

**Step 1: 写失败测试**

- 新增前端失败测试，覆盖：
  - 组织 AI 会话默认进入更安全的计划/协调模式
  - 控制台可见当前 phase
  - 待人类审批时展示提醒
  - 待批状态下禁用“启动运行”这类入口，或明确提示需要先批准计划

**Step 2: 运行测试确认失败**

Run:

```bash
bunx vitest --run tests/unit/OrganizationConversationPanel.dom.test.tsx tests/unit/OrganizationConsole.dom.test.tsx
```

Expected: FAIL，因为当前前端没有控制状态显示。

**Step 3: 写最小实现**

- 组织控制会话创建时优先设置 `sessionMode` 为更偏计划/协调的模式
- 在控制台底部或右栏显示控制阶段与审批提示
- 在关键按钮上显示 gate 状态

**Step 4: 运行测试确认通过**

Run:

```bash
bunx vitest --run tests/unit/OrganizationConversationPanel.dom.test.tsx tests/unit/OrganizationConsole.dom.test.tsx
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/renderer/pages/tasks/OrganizationConversationPanel.tsx src/renderer/pages/tasks/OrganizationConsole.tsx src/renderer/pages/tasks/TaskBoard.css tests/unit/OrganizationConversationPanel.dom.test.tsx tests/unit/OrganizationConsole.dom.test.tsx
git commit -m "feat(org-ui): surface control plane governance state"
```

### Task 6: 文档、语言资源与收尾验证

**Files:**
- Modify: `docs/plans/2026-03-20-organization-os-project-panel.md`
- Create: `docs/plans/2026-03-22-organization-control-plane-governance-design.md`
- Create: `docs/plans/2026-03-22-organization-control-plane-governance-plan.md`
- Modify: `src/renderer/i18n/locales/*/*.json`（如新增文案）

**Step 1: 写失败测试**

- 如果新增 UI 文案，先补 i18n 覆盖检查或对应 DOM 断言

**Step 2: 运行验证确认失败或缺项**

Run:

```bash
node scripts/check-i18n.js
```

Expected: 若有新增文案但未补齐，会失败。

**Step 3: 写最小实现**

- 更新组织面板主计划进展
- 新增文案时同步所有语言
- 保证设计文档、计划文档、i18n 与代码一致

**Step 4: 运行完整验证**

Run:

```bash
bunx vitest --run tests/unit/organizationIpcBridge.test.ts tests/unit/organizationDatabase.test.ts tests/unit/organizationContextService.test.ts tests/unit/organizationBridge.test.ts tests/unit/organizationOpsWatcher.test.ts tests/unit/OrganizationConversationPanel.dom.test.tsx tests/unit/OrganizationConsole.dom.test.tsx
bunx eslint src/common/types/organization.ts src/common/ipcBridge.ts src/process/services/organizationContextService.ts src/process/bridge/organizationBridge.ts src/process/services/organizationOpsWatcher.ts src/renderer/pages/tasks/OrganizationConversationPanel.tsx src/renderer/pages/tasks/OrganizationConsole.tsx tests/unit/organizationIpcBridge.test.ts tests/unit/organizationDatabase.test.ts tests/unit/organizationContextService.test.ts tests/unit/organizationBridge.test.ts tests/unit/organizationOpsWatcher.test.ts tests/unit/OrganizationConversationPanel.dom.test.tsx tests/unit/OrganizationConsole.dom.test.tsx
bunx prettier --check docs/plans/2026-03-20-organization-os-project-panel.md docs/plans/2026-03-22-organization-control-plane-governance-design.md docs/plans/2026-03-22-organization-control-plane-governance-plan.md src/renderer/pages/tasks/TaskBoard.css
node scripts/check-i18n.js
```

Expected: PASS（允许仓库内既有 warning，但不允许新增 error）

**Step 5: Commit**

```bash
git add docs/plans src/common src/process src/renderer
git commit -m "feat(org): add governance-driven control plane workflow"
```

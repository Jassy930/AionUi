# Organization Control Runtime Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让 `Organization AI` 成为真正的组织控制会话，保留人类审批门的同时，能够自动接收组织事件、持续派发 `Task + Run`、建立执行会话，并根据返回结果继续推进项目流转。

**Architecture:** 新增 `organizationControlRuntime` 作为后台协调器，维护 `organization -> control conversation` 绑定、统一组织事件模型、事件回灌与自动唤醒；bridge 与 watcher 在关键动作成功后统一投递事件；右侧控制会话显示结构化系统事件消息，采用“事件驱动为主、巡检兜底、文件协议兼容保留”的混合模式。

**Tech Stack:** Electron 37、TypeScript 5.8、React 19、better-sqlite3、Vitest 4

---

## 执行原则

- 严格按 TDD 执行：先写失败测试，再补最小实现
- 每个任务只覆盖一个明确行为，不顺手夹带重构
- 优先打通首批主链：`task_created / run_started / run_closed / approval_responded / reconcile_tick`
- 每个阶段结束后同步更新文档、整理工作区并检查 git 状态

## 执行进展

- 2026-03-23：Task 3 已完成最小事件回灌闭环。`organizationControlRuntime` 新增 `appendOrganizationControlEventMessage`，可将 `TOrganizationControlEvent` 写入已绑定控制会话为结构化左侧文本消息（包含 `event_type / task_id / run_id / summary / payload`）；`tests/unit/organizationControlRuntime.test.ts` 已补失败用例并转绿，定向测试通过（5/5）。
- 2026-03-23：Task 3 已完成最终收口。运行时现提供正式入口 `enqueueOrganizationControlEvent`，并为 `missing_binding / conversation_mismatch / serialize_error / insert_failed / insert_error` 输出结构化告警上下文；`tests/unit/organizationControlRuntime.test.ts` 已补强多事件 JSON 断言、序列化失败、数据库异常与测试隔离，定向测试通过（12/12），下一步进入 Task 4 自动唤醒与串行消费队列。
- 2026-03-23：Task 4 已完成。`organizationControlRuntime` 现已具备控制会话级串行队列、busy/idle 自动调度与失败后 pending 保留机制；`conversationBridge` 新增组织控制内部继续推进 helper，`AcpAgentManager` 支持 `internalTrigger` 静默发送，不再伪造右侧用户消息；`tests/unit/organizationControlRuntime.test.ts` 已补齐 idle 触发、busy 排队、串行消费与失败恢复场景，定向测试通过（16/16），下一步进入 Task 5 首批组织事件投递。
- 2026-03-23：Task 5 已完成。`organizationBridge` 现已通过共享 builder 统一构造 `task_created / run_started / run_closed / approval_responded` 四类事件的 `summary / payload / object_ids`，并在 bridge 成功路径中统一投递到控制运行时；`tests/unit/organizationBridge.test.ts` 已补齐事件字段断言、旧 UI emitter 回归保护，以及 `org.run.start` 回滚时的 runtime 会话清理测试，定向测试通过（16/16），下一步进入 Task 6 watcher 文件协议回灌。
- 2026-03-23：Task 6 已完成。`organizationOpsWatcher` 现已在文件协议成功路径补投 `task_created / run_started` 到控制运行时，`source=organization_ops_watcher`；同时已新增共享事件 builder，收敛 watcher 与 bridge 对 `task_created / run_started` 的 `summary / payload / object_ids` 组装，避免字段继续漂移。`tests/unit/organizationOpsWatcher.test.ts` 已补齐 watcher 成功回灌、失败不伪造成功事件与关键字段断言，相关控制链路定向测试通过（47/47），下一步进入 Task 7 巡检补偿与 `reconcile_tick`。
- 2026-03-23：Task 7 已完成。`organizationControlRuntime` 现已支持自动启动的轻量巡检 ticker、显式 `runOrganizationControlReconcilePass` 与 `reconcile_tick` 补偿事件；`organizationContextService` 新增只读 reconcile snapshot，且 phase 推导已与 watcher 主链通过共享 helper 收敛，避免规则漂移。运行时会在 reconcile pass 中更新控制会话 `lastReconcileAt`、对同签名 drift 去重，并保持“只补事件与上下文同步，不直接创建 task/run”；相关控制链路定向测试通过（54/54），下一步进入 Task 8 前端结构化事件展示。
- 2026-03-23：Task 8 已完成。前端现已在 `MessageText` 渲染链中识别 `[OrgEvent] <event_type>` 前缀，并通过新增的 `MessageOrganizationControlEvent` 以紧凑卡片展示 `event_type / task_id / run_id / source / summary / payload`；多条并发 task/run 事件会各自保留独立归属，不再以普通 Markdown 混在同一消息语义层。该任务最终无需修改 `AcpChat / AcpSendBox`，从而保持右栏当前紧凑布局与 `compact` thought display 不回退；相关 DOM 回归测试通过（6/6），下一步进入 Task 9 文档、验证与收尾。
- 2026-03-23：Task 9 后续修补已完成。已补齐 `ICreateConversationParams.extra` 对 `organizationAutoDrive / autoDrivePaused / lastReconcileAt / controlConversationVersion` 的类型声明，并新增本地 `cookie` 模块声明，清除控制运行时落地后残留的 `tsc` 阻塞；当前 `bunx tsc --noEmit` 已通过，相关类型与 cookie 解析单测通过（13/13）。
- 2026-03-23：补充清理本轮相关 i18n 校验。已修复共享 i18n 配置对 `task / viewMode / project` 模块的漏登记，并补齐控制台/组织会话相关实际调用键；当前 `bun scripts/check-i18n.js` 已无 warning，避免后续控制运行时改动继续被历史 i18n 噪音掩盖。
- 2026-03-23：补充修复控制文件承接链。组织 AI 写入 `.aionui-org/control/operations/` 的 `org/control/brief/update`、`org/control/plan/update`、`org/control/state/update` 现已由 `organizationOpsWatcher` 落库到 brief / plan snapshot / control state，并在成功后同步生成控制事件，避免“文件写入成功但 UI 无变化”的假象。
- 2026-03-23：Task 9 已完成。已同步主计划与设计文档，补充 Task 8 的消息渲染落点与 UI 约束；同时新增长 `task_id / run_id` 不截断的 DOM 回归，避免并发事件归属再次被视觉截断。最终定向验证已通过：`organizationIpcBridge / organizationBridge / organizationOpsWatcher / organizationControlRuntime / OrganizationConversationPanel.dom / organizationControlRuntime.dom` 共 `65/65`；`i18n:types` 与 `check-i18n` 通过，`tsc --noEmit` 仍只剩仓库既有 `organizationAutoDrive` 类型缺口与 `cookie` 声明缺失。
- 2026-03-23：补充修复控制会话承接缺口。`createAcpAgent` 之前会丢失 `organizationId / runId / organizationRole / organizationAutoDrive / autoDrivePaused / lastReconcileAt / controlConversationVersion`，导致 `OrganizationConversationPanel` 无法识别新建控制会话。现已在 `src/process/initAgent.ts` 统一透传执行绑定 extra，并补上 `tests/unit/initAgent.test.ts` 回归。
- 2026-03-23：最新源码实例 CDP 闭环已验证通过。控制会话 `aa3667e8` 由对话创建后能够被组织面板自动承接；审批门在文件写入前正常触发，人工批准后 watcher 成功处理 `verify-1774272089728-dialog-{brief,plan,state}.json`，组织页右侧已显示控制会话且 `org-control-event-card=1`，截图见 `tests/e2e/results/verify-1774272089728-organization-console.png`。

### Task 1: 定义组织控制事件模型与控制会话元数据

**Files:**
- Modify: `src/common/types/organization.ts`
- Modify: `src/common/storage.ts`
- Modify: `src/common/ipcBridge.ts`
- Test: `tests/unit/organizationIpcBridge.test.ts`

**Step 1: 写失败测试**

- 为以下契约写失败测试：
  - `OrganizationControlEventType`
  - `TOrganizationControlEvent`
  - 控制会话新增 `organizationAutoDrive / autoDrivePaused / lastReconcileAt / controlConversationVersion`
  - 如需新增 bridge 契约，先在类型层锁定参数与返回值

**Step 2: 运行测试确认失败**

Run:

```bash
bunx vitest --run tests/unit/organizationIpcBridge.test.ts
```

Expected: FAIL，因为事件模型与会话元数据尚未定义。

**Step 3: 写最小实现**

- 在 `src/common/types/organization.ts` 中新增组织控制事件类型
- 在 `src/common/storage.ts` 中扩展会话 `extra` 类型
- 如需新增控制运行时相关 IPC 契约，在 `src/common/ipcBridge.ts` 中先补类型定义

**Step 4: 运行测试确认通过**

Run:

```bash
bunx vitest --run tests/unit/organizationIpcBridge.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/common/types/organization.ts src/common/storage.ts src/common/ipcBridge.ts tests/unit/organizationIpcBridge.test.ts
git commit -m "feat(org): add control runtime event contracts"
```

### Task 2: 建立 Organization Control Runtime 与控制会话绑定

**Files:**
- Create: `src/process/services/organizationControlRuntime.ts`
- Modify: `src/process/bridge/organizationBridge.ts`
- Modify: `src/renderer/pages/tasks/OrganizationConversationPanel.tsx`
- Test: `tests/unit/organizationBridge.test.ts`

**Step 1: 写失败测试**

- 为以下行为写失败测试：
  - 组织控制会话创建后可被运行时识别并绑定到 `organization_id`
  - 切换 agent 或重建控制会话时，绑定关系会更新
  - 非 `control_plane` 会话不会被注册成组织控制会话

**Step 2: 运行测试确认失败**

Run:

```bash
bunx vitest --run tests/unit/organizationBridge.test.ts
```

Expected: FAIL，因为当前没有控制运行时与绑定逻辑。

**Step 3: 写最小实现**

- 创建 `organizationControlRuntime.ts`
- 在 `OrganizationConversationPanel` 创建会话时补齐控制运行时需要的会话 extra 字段
- 在 `organizationBridge` 中提供注册/更新控制会话绑定的入口，或在适合的生命周期里自动注册

**Step 4: 运行测试确认通过**

Run:

```bash
bunx vitest --run tests/unit/organizationBridge.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/process/services/organizationControlRuntime.ts src/process/bridge/organizationBridge.ts src/renderer/pages/tasks/OrganizationConversationPanel.tsx tests/unit/organizationBridge.test.ts
git commit -m "feat(org): register control conversations in runtime"
```

### Task 3: 将组织事件回灌为控制会话系统消息

**Files:**
- Modify: `src/process/services/organizationControlRuntime.ts`
- Modify: `src/process/database/index.ts`
- Test: `tests/unit/organizationControlRuntime.test.ts`

**Step 1: 写失败测试**

- 为以下行为写失败测试：
  - 运行时收到 `TOrganizationControlEvent` 后，会向控制会话写入一条结构化系统消息
  - 系统消息包含 `event_type / task_id / run_id / summary / payload`
  - 多个不同任务事件可以在同一会话中连续写入且不丢字段

**Step 2: 运行测试确认失败**

Run:

```bash
bunx vitest --run tests/unit/organizationControlRuntime.test.ts
```

Expected: FAIL，因为当前没有事件回灌与系统消息转换。

**Step 3: 写最小实现**

- 在运行时中实现 `enqueueEvent` 与事件转消息逻辑
- 复用现有消息存储机制，把组织事件以系统消息形式写入控制会话
- 保证消息内容既可读又保留结构化字段

**Step 4: 运行测试确认通过**

Run:

```bash
bunx vitest --run tests/unit/organizationControlRuntime.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/process/services/organizationControlRuntime.ts src/process/database/index.ts tests/unit/organizationControlRuntime.test.ts
git commit -m "feat(org): append control events to conversation"
```

### Task 4: 为控制会话增加自动唤醒与串行消费队列

**Files:**
- Modify: `src/process/services/organizationControlRuntime.ts`
- Modify: `src/process/bridge/conversationBridge.ts`
- Modify: `src/process/task/AcpAgentManager.ts`
- Test: `tests/unit/organizationControlRuntime.test.ts`

**Step 1: 写失败测试**

- 为以下行为写失败测试：
  - 控制会话空闲时，事件回灌后会自动触发一次组织 AI 继续推进
  - 控制会话忙碌时，事件会排队，等当前轮次结束后再触发
  - 多个事件不会并发打断同一控制会话

**Step 2: 运行测试确认失败**

Run:

```bash
bunx vitest --run tests/unit/organizationControlRuntime.test.ts
```

Expected: FAIL，因为当前没有自动唤醒与队列。

**Step 3: 写最小实现**

- 在运行时中增加按 `organization_id` 或 `conversation_id` 维度的串行事件队列
- 通过现有 conversation / ACP 发送链路为控制会话投递内部触发输入
- 利用已有会话状态判断 busy/idle，避免重入

**Step 4: 运行测试确认通过**

Run:

```bash
bunx vitest --run tests/unit/organizationControlRuntime.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/process/services/organizationControlRuntime.ts src/process/bridge/conversationBridge.ts src/process/task/AcpAgentManager.ts tests/unit/organizationControlRuntime.test.ts
git commit -m "feat(org): auto-drive control conversation on events"
```

### Task 5: 在 bridge 主链中统一投递首批组织事件

**Files:**
- Modify: `src/process/bridge/organizationBridge.ts`
- Test: `tests/unit/organizationBridge.test.ts`

**Step 1: 写失败测试**

- 为以下行为写失败测试：
  - `org.task.create` 成功后投递 `task_created`
  - `org.run.start` 成功后投递 `run_started`
  - `org.run.close` 成功后投递 `run_closed`
  - `respondApproval` 成功后投递 `approval_responded`

**Step 2: 运行测试确认失败**

Run:

```bash
bunx vitest --run tests/unit/organizationBridge.test.ts
```

Expected: FAIL，因为 bridge 目前只 emit UI 事件，不会投递控制事件流。

**Step 3: 写最小实现**

- 在关键 bridge 成功路径上调用 `organizationControlRuntime.enqueueEvent(...)`
- 统一摘要、payload 与对象 ID 的填充逻辑
- 保持原有 UI emitter 不回退

**Step 4: 运行测试确认通过**

Run:

```bash
bunx vitest --run tests/unit/organizationBridge.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/process/bridge/organizationBridge.ts tests/unit/organizationBridge.test.ts
git commit -m "feat(org): emit control events from bridge actions"
```

### Task 6: 让 watcher 文件协议也统一回灌控制事件

**Files:**
- Modify: `src/process/services/organizationOpsWatcher.ts`
- Test: `tests/unit/organizationOpsWatcher.test.ts`

**Step 1: 写失败测试**

- 为以下行为写失败测试：
  - watcher 成功执行 `org/task/create` 后会补投递 `task_created`
  - watcher 成功执行 `org/run/start` 后会补投递 `run_started`
  - watcher 执行失败不会伪造成功事件

**Step 2: 运行测试确认失败**

Run:

```bash
bunx vitest --run tests/unit/organizationOpsWatcher.test.ts
```

Expected: FAIL，因为 watcher 当前只写 result 文件和 sync context。

**Step 3: 写最小实现**

- 在 watcher 成功执行路径中补调用运行时事件投递
- 确保 watcher 与 bridge 最终走同一组织控制事件模型

**Step 4: 运行测试确认通过**

Run:

```bash
bunx vitest --run tests/unit/organizationOpsWatcher.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/process/services/organizationOpsWatcher.ts tests/unit/organizationOpsWatcher.test.ts
git commit -m "feat(org): funnel watcher results into control events"
```

### Task 7: 增加巡检补偿与 `reconcile_tick`

**Files:**
- Modify: `src/process/services/organizationControlRuntime.ts`
- Modify: `src/process/services/organizationContextService.ts`
- Test: `tests/unit/organizationControlRuntime.test.ts`

**Step 1: 写失败测试**

- 为以下行为写失败测试：
  - 运行时能定期发现控制状态与对象状态失步
  - 发现失步时会投递 `reconcile_tick`
  - 巡检只补事件，不直接越权创建 task 或 run

**Step 2: 运行测试确认失败**

Run:

```bash
bunx vitest --run tests/unit/organizationControlRuntime.test.ts
```

Expected: FAIL，因为当前没有巡检补偿机制。

**Step 3: 写最小实现**

- 在运行时中增加轻量巡检定时器
- 只生成补偿事件与状态整理摘要，不直接做业务派发
- 必要时同步更新控制会话的 `lastReconcileAt`

**Step 4: 运行测试确认通过**

Run:

```bash
bunx vitest --run tests/unit/organizationControlRuntime.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/process/services/organizationControlRuntime.ts src/process/services/organizationContextService.ts tests/unit/organizationControlRuntime.test.ts
git commit -m "feat(org): add reconcile fallback for control runtime"
```

### Task 8: 在前端控制会话中展示结构化组织事件

**Files:**
- Modify: `src/renderer/messages/MessagetText.tsx`
- Create: `src/renderer/messages/MessageOrganizationControlEvent.tsx`
- Modify: `src/renderer/i18n/locales/*/messages.json`
- Test: `tests/unit/OrganizationConversationPanel.dom.test.tsx`
- Test: `tests/unit/organizationControlRuntime.dom.test.tsx`

**Step 1: 写失败测试**

- 为以下行为写失败测试：
  - 右侧控制会话可显示结构化组织事件消息
  - 事件消息中可见 `event_type / task_id / run_id`
  - 多个并发 task/run 的事件不会混淆归属

**Step 2: 运行测试确认失败**

Run:

```bash
bunx vitest --run tests/unit/OrganizationConversationPanel.dom.test.tsx tests/unit/organizationControlRuntime.dom.test.tsx
```

Expected: FAIL，因为当前控制会话没有组织事件消息 UI。

**Step 3: 写最小实现**

- 为组织控制事件增加专用消息渲染
- 在消息文本层识别 `[OrgEvent]` 前缀并切换到结构化事件卡片，而不是改聊天布局层
- 保持右栏当前紧凑会话布局与 `compact` thought display 不回退
- 只做最小展示，不引入复杂新面板

**Step 4: 运行测试确认通过**

Run:

```bash
bunx vitest --run tests/unit/OrganizationConversationPanel.dom.test.tsx tests/unit/organizationControlRuntime.dom.test.tsx
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/renderer/messages/MessagetText.tsx src/renderer/messages/MessageOrganizationControlEvent.tsx src/renderer/i18n/locales/*/messages.json tests/unit/OrganizationConversationPanel.dom.test.tsx tests/unit/organizationControlRuntime.dom.test.tsx
git commit -m "feat(org): render structured control events in chat"
```

### Task 9: 更新文档、验证与收尾

**Files:**
- Modify: `docs/plans/2026-03-20-organization-os-project-panel.md`
- Modify: `docs/plans/2026-03-23-organization-control-runtime-design.md`
- Modify: `docs/plans/2026-03-23-organization-control-runtime-plan.md`

**Step 1: 同步文档**

- 在组织主计划中记录本轮控制运行时落地结果
- 如实现细节有偏差，回写设计与计划文档

**Step 2: 运行定向测试**

Run:

```bash
bunx vitest --run tests/unit/organizationIpcBridge.test.ts tests/unit/organizationBridge.test.ts tests/unit/organizationOpsWatcher.test.ts tests/unit/organizationControlRuntime.test.ts tests/unit/OrganizationConversationPanel.dom.test.tsx tests/unit/organizationControlRuntime.dom.test.tsx
```

Expected: PASS

**Step 3: 运行代码质量检查**

Run:

```bash
bun run lint
bun run format
bunx tsc --noEmit
```

Expected:

- `lint` 通过
- `format` 只产生预期格式化结果
- `tsc` 若失败，仅允许保留仓库已知的非本次改动问题，并在收尾说明中明确列出

**Step 4: 检查工作区**

Run:

```bash
git status --short --branch
```

Expected: 仅剩本轮预期改动。

**Step 5: Commit**

```bash
git add docs/plans/2026-03-20-organization-os-project-panel.md docs/plans/2026-03-23-organization-control-runtime-design.md docs/plans/2026-03-23-organization-control-runtime-plan.md
git commit -m "docs(org): add control runtime design and implementation plan"
```

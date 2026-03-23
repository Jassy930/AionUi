# Organization Control Conversation Handoff Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复组织控制会话创建时丢失 `organization` 相关元数据的问题，使 `Organization AI` 能在面板中自动识别并承接控制会话。

**Architecture:** 保持现有组织 watcher、runtime 回灌、控制事件模型不变，只修正会话创建阶段的 extra 透传缺口。先用单元测试锁定 `createAcpAgent` 返回值契约，再做最小实现，最后用最新源码实例通过 CDP 验证 UI 已从 agent picker 切换为控制会话并显示事件卡片。

**Tech Stack:** Electron 37、TypeScript 5.8、React 19、Vitest 4、bun

---

## 执行结果

- 2026-03-23：已按 TDD 新增 `tests/unit/initAgent.test.ts`，先验证 `createAcpAgent` 不会保留 `organizationId / runId / organizationRole / organizationAutoDrive / autoDrivePaused / lastReconcileAt / controlConversationVersion`，失败用例已成功转绿。
- 2026-03-23：`src/process/initAgent.ts` 已新增 `buildExecutionBindingExtra`，并统一透传到 `acp / codex / openclaw-gateway / nanobot` 会话对象，避免执行绑定信息在创建阶段被丢弃。
- 2026-03-23：真实 CDP 闭环已完成。使用最新源码实例 `http://127.0.0.1:9230` 创建控制会话 `aa3667e8`，会话 `extra` 已正确包含 `organizationId=org_napf1-p4p7E8dNa20PacK` 与 `organizationRole=control_plane`。
- 2026-03-23：验证中人工审批门确实触发，随后通过 bridge 进行一次人工批准后，组织 AI 成功写入 `verify-1774272089728-dialog-{brief,plan,state}.json`，watcher 生成对应 `.result.json` 并更新 context。
- 2026-03-23：组织页 `#/tasks/org_napf1-p4p7E8dNa20PacK` 已不再停留在 agent picker，`[data-testid=\"org-control-event-card\"]` 数量为 `1`，截图保存在 `tests/e2e/results/verify-1774272089728-organization-console.png`。

### Task 1: 锁定 ACP 控制会话元数据回归

**Files:**
- Create: `tests/unit/initAgent.test.ts`
- Modify: `src/process/initAgent.ts`
- Test: `tests/unit/initAgent.test.ts`

**Step 1: 写失败测试**

- 验证 `createAcpAgent` 在接收组织控制会话参数时，会把以下字段保留到 `conversation.extra`：
  - `organizationId`
  - `runId`
  - `organizationRole`
  - `organizationAutoDrive`
  - `autoDrivePaused`
  - `lastReconcileAt`
  - `controlConversationVersion`

**Step 2: 运行测试确认失败**

Run:

```bash
bunx vitest --run tests/unit/initAgent.test.ts
```

Expected: FAIL，因为当前 `createAcpAgent` 没有透传上述字段。

**Step 3: 写最小实现**

- 仅修改 `src/process/initAgent.ts`
- 不改 watcher、runtime、bridge 逻辑
- 只把 `ICreateConversationParams.extra` 中的组织字段透传到返回的 `conversation.extra`

**Step 4: 运行测试确认通过**

Run:

```bash
bunx vitest --run tests/unit/initAgent.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add tests/unit/initAgent.test.ts src/process/initAgent.ts
git commit -m "fix(org): preserve control conversation metadata"
```

### Task 2: 验证组织面板承接控制会话

**Files:**
- Modify: `docs/plans/2026-03-23-organization-control-runtime-plan.md`
- Test: `tests/e2e/results/*.png`

**Step 1: 运行代码质量检查**

Run:

```bash
bun run lint:fix
bunx tsc --noEmit
```

Expected: PASS

**Step 2: 使用当前 dev 实例执行 CDP 回归**

Run:

```bash
# 复用已启动实例的 CDP 端口 9230
# 创建新的控制会话并发送组织控制消息
```

Expected:

- 组织页主状态保持可更新
- 右侧 `Organization AI` 不再停留在 agent picker
- 页面出现 `org-control-event-card`

**Step 3: 更新文档与工作区状态**

- 回写主计划进展
- 检查 `git status`
- 如生成新的验证截图，记录路径

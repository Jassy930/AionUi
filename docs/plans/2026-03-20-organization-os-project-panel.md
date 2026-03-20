# Organization OS Project Panel Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将当前 `Project` 面板重构为 `Organization Console`，以七类组织对象为核心打通控制面、执行面、评估流和演化流。

**Architecture:** 采用“SQLite 结构化主存储 + Workspace 文档投影 + Conversation 作为 Run 执行通道”的方案。通过数据库迁移替换旧 `Project / Task` 语义，新增组织对象表、控制面 bridge/service、投影 watcher 与前端控制台，最终用统一的 `org/*` API 驱动页面和组织 AI。

**Tech Stack:** Electron 37、TypeScript 5.8、React 19、Arco Design 2、better-sqlite3、Vitest 4

---

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

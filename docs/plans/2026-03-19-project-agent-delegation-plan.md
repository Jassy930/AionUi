# Project Agent 委派化实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**目标：** 强化 project agent 的运行时 prompt，使其固定扮演项目经理和技术总监，只做管理与委派，不直接执行实质工作。

**架构：** 只修改 `generateProjectSystemPrompt` 的提示文本，不碰 `AGENTS.md`。先通过单元测试锁定行为，再最小化修改 prompt 文案，最后跑校验命令并整理文档与 git 状态。

**技术栈：** TypeScript、Vitest、ESLint、Prettier

---

### 任务 1：为 project prompt 新规则补测试

**文件：**
- 新增：`tests/unit/projectContextService.test.ts`
- 参考：`src/process/services/projectContextService.ts`

**步骤 1：写失败测试**

- mock `@process/database`
- 构造最小 project/task 返回值
- 断言生成的 prompt 必须包含：
  - 顶层 project agent 是项目经理/技术总监
  - 管理类问题可直接回答
  - 实质执行必须先建 task 再委派子会话
  - 顶层禁止使用 skill

**步骤 2：运行测试确认失败**

运行：

```bash
bunx vitest --run tests/unit/projectContextService.test.ts
```

预期：测试失败，说明旧 prompt 还未满足新规则。

### 任务 2：最小化修改 project system prompt

**文件：**
- 修改：`src/process/services/projectContextService.ts`

**步骤 1：调整角色描述**

- 把顶层角色明确成项目经理和技术总监
- 强化“只负责拆解、委派、审查、验收”的表述

**步骤 2：加入管理直答规则**

- 允许对进度、计划、风险、方案比较、task 编排等纯管理问题直接回答

**步骤 3：加入执行硬约束**

- 实质执行先建 task
- 再创建子会话
- 顶层 project agent 禁止使用 skill
- 子会话不受该限制

### 任务 3：验证与收尾

**文件：**
- 修改：`docs/plans/2026-03-19-project-agent-delegation-design.md`
- 修改：`docs/plans/2026-03-19-project-agent-delegation-plan.md`

**步骤 1：跑定向测试**

```bash
bunx vitest --run tests/unit/projectContextService.test.ts
```

**步骤 2：跑质量检查**

```bash
bun run lint:fix
bun run format
bunx tsc --noEmit
```

**步骤 3：整理状态**

- 检查 `git status --short`
- 确认只包含本次相关变更

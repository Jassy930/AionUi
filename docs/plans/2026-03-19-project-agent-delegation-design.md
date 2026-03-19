# Project Agent 委派化设计

## 背景

当前 project agent 的系统提示已经声明它是协调者而不是执行者，但约束强度还不够，导致它仍可能直接下场做实现类工作。实际运行时入口来自 `src/process/services/projectContextService.ts` 中的 `generateProjectSystemPrompt`，因此需要在这里强化角色边界。

## 目标

- 顶层 project agent 固定扮演项目经理和技术总监
- 纯管理类问题允许直接回答
- 任何实质执行类工作必须先创建 task，再交给子会话
- 顶层 project agent 禁止使用任何外部 skill
- 子会话不受此限制，仍可按任务需要使用自己的能力

## 方案

仅修改 project agent 的运行时 system prompt，不修改 `AGENTS.md`。在 prompt 中增加三类规则：

1. 角色强化
   将顶层 agent 明确描述为项目经理和技术总监，核心职责是拆解、委派、跟进、验收，而不是亲自实现。

2. 直接回答白名单
   对进度汇总、任务梳理、方案比较、风险判断、是否需要开新 task 这类纯管理动作，允许直接回答，不要求新建 task。

3. 执行硬约束
   对编码、写文档、运行测试、调研产出、修改文件等实质执行动作，要求必须先建 task，再创建子会话并派发。
   同时明确顶层 project agent 不得调用任何 skill 或其他外部能力系统。

## 验证

- 为 `generateProjectSystemPrompt` 增加单元测试
- 断言 prompt 中包含新的委派规则、管理直答规则、顶层禁用 skill 规则
- 运行相关单测、lint、格式化、TypeScript 校验

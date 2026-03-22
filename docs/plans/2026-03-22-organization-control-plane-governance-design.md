# Organization Control Plane Governance Design

**日期**: 2026-03-22

## 背景

当前 `Organization AI` 虽然已经接入了组织级 system prompt，但它仍会把用户交办的事项直接当作执行任务来处理，而不是先承担“组织者/控制平面”的角色。根因不在 UI，而在控制面约束不足：

- prompt 只描述了 `Task Contract -> Run -> Artifact -> Eval -> MemoryCard -> GenomePatch -> Governance` 的理想流程
- prompt 没有强约束“先向人类提问、再规划、再起 run”
- 控制面没有显式状态机来表示当前处于 `brainstorm / waiting approval / planning / dispatching / monitoring`
- 控制面也没有“人类审批门”，无法在关键决策点拦住组织 AI

结果是：模型会回落到通用执行型 agent 的默认行为，直接开始做事。

## 目标

把右侧 `Organization AI` 从“组织级聊天框”升级为真正的组织控制平面：

1. 它的首要职责是提问、澄清、规划、拆解、调度、复盘，而不是亲自执行。
2. 所有执行都必须通过 `Task Contract + Run` 进入执行面。
3. 第一层和第二层决策必须经过人类沟通与审批。
4. 每个 run 结束后，组织 AI 必须回到全局方案视角，决定是否继续拆解、变更计划、追加任务或请求人类介入。

## 决策分层

### 第一层：人类专属决策

组织 AI 必须主动发起提问，且在获得明确答复前不得推进到执行面：

- 愿景
- 目标用户
- 非妥协原则
- 风险红线
- 资源投入
- 是否上线

### 第二层：Agent 起草，人类批准

组织 AI 可以研究并产出草案，但必须等待人类批准：

- 路线图
- 架构选型
- 重大交互
- 数据策略
- 商业策略
- 其他难以逆转的重大决策

### 第三层：Agent 可自主执行

只有在第一、第二层边界清晰后，组织 AI 才能把工作分派给 run executor：

- 背景研究
- PRD 初稿
- 原型
- 代码实现
- 测试补齐
- 文档整理
- 低风险迭代

## 总体方案

采用 `prompt + 状态机 + 人类审批门` 的组合方案。

### 1. Prompt 层

组织 AI 的 system prompt 不再只是描述对象和 API，而是明确声明：

- 你是 `Organization Control Plane AI`
- 你不是执行者
- Conversation 只是控制面沟通与 run 调度入口
- 任何实质执行都必须先形成 `Task Contract`
- 任何 `Run` 都必须服务于某个已确认的任务契约与运行计划
- 遇到第一层决策，必须主动向人类提问
- 遇到第二层决策，必须先给方案与权衡，等待人类批准
- 第三层执行只能通过 `org/task/create` 与 `org/run/start` 派发出去

这里直接复用并改写 `projectContextService` 中已经验证过的“分层 authority + 自己不执行 + 先规划再委派”模式，而不是重新发明规则。

### 2. 状态机层

为组织控制面对话增加显式生命周期。建议引入以下控制阶段：

- `intake`
- `brainstorming`
- `awaiting_human_decision`
- `drafting_plan`
- `awaiting_plan_approval`
- `dispatching`
- `monitoring`
- `blocked`

状态机原则：

- 新需求进入时先落到 `intake` / `brainstorming`
- 缺失第一层信息时进入 `awaiting_human_decision`
- 第二层方案待批时进入 `awaiting_plan_approval`
- 只有存在已批准的计划快照时，才允许进入 `dispatching`
- run 执行期间为 `monitoring`
- 缺信息、冲突或高风险时进入 `blocked`

### 3. 人类审批门

在控制面建立两个显式审批门：

- `Decision Gate`
  - 对应第一层、第二层决策
  - 没有通过时，不允许产生执行型 task/run
- `Plan Gate`
  - 对应当前版本的执行计划
  - 没有 approved plan snapshot 时，不允许 `org/run/start`

审批门的目标不是阻塞所有操作，而是阻塞“跨过治理边界的关键动作”。

## 数据与持久化设计

建议新增一组组织控制面对象，用于持久化而不是只靠 prompt：

### Organization Control State

记录当前组织控制面对话的全局状态：

- `organization_id`
- `conversation_id`
- `phase`
- `active_brief_id`
- `active_plan_id`
- `last_human_touch_at`
- `updated_at`

### Organization Brief

记录本轮 brainstorming / 澄清阶段形成的结构化背景：

- 需求摘要
- 第一层决策是否齐备
- 第二层待定项列表
- 风险假设
- 人类提供的约束

### Organization Plan Snapshot

记录某一版待执行方案：

- 目标
- 路线与任务拆解
- 任务之间依赖
- 预计 run 顺序
- 需审批项
- `draft / approved / superseded`

### Approval Record

记录人类审批动作：

- 决策对象类型
- 决策层级
- `approved / rejected / needs_more_info`
- reason
- actor
- at

现有 `org_audit_logs` 可以继续作为统一审计面，但控制面状态与审批对象本身需要独立结构化存储，不能只靠 audit log 倒推。

## 控制协议与执行规则

组织 AI 收到一项新工作时，固定执行以下闭环：

1. 识别本轮请求涉及哪些第一层、第二层、第三层事项
2. 主动向人类提问补齐第一层缺口
3. 输出 brainstorming 结论与第二层备选方案
4. 生成人类可批准的 `Plan Snapshot`
5. 获得批准后，按计划创建 `Task Contract`
6. 再按 task 启动 `Run`
7. run 结束后读取全局上下文、任务状态、artifact 与评估结果
8. 决定是：
   - 继续拆任务
   - 新增任务
   - 调整计划
   - 请求人类修改方案
   - 暂停推进

硬规则：

- 顶层组织 AI 不直接执行代码、测试、研究产出
- 顶层组织 AI 不直接扮演 run executor
- 顶层组织 AI 不允许绕过已批准计划直接启动 run

## UI 与会话层设计

本次不引入复杂新面板，优先最小化落地：

- 继续使用当前右侧 `Organization AI` 会话
- 组织 AI 默认使用更偏 `plan/coordination` 的模式
- 在主内容区增加轻量控制状态展示：
  - 当前 phase
  - 是否存在待答复的人类问题
  - 当前 active plan 是否已批准
  - 当前 pending governance / approval 数量

后续如果需要，再增加“待审批卡片”和“当前计划快照”独立视图。

## 约束策略

### Prompt 约束

优点：

- 成本低
- 行为可快速收敛

缺点：

- 单靠 prompt 不可靠，模型可能仍越过边界

### 状态机约束

优点：

- 可以显式表达“现在还不能执行”
- 可以让 UI 和上下文投影看到真实控制阶段

缺点：

- 需要新增持久化结构和迁移

### 审批门约束

优点：

- 能真正拦住错误的 run 启动与计划跳跃
- 让“人类专属决策需要 AI 主动沟通”变成系统规则

缺点：

- 要补桥接 API 和少量前端展示

因此三者必须一起做，不能只改 prompt。

## 测试策略

至少覆盖以下路径：

1. system prompt 明确声明组织 AI 是控制平面而非执行者
2. 缺少第一层信息时，控制面状态进入 `awaiting_human_decision`
3. 第二层方案未批准时，`org/run/start` 被拒绝
4. 已批准 plan snapshot 后，允许 `org/task/create` 和 `org/run/start`
5. run 关闭后，控制面状态更新为 `monitoring` 或重新进入 `drafting_plan`
6. UI 能显示当前控制阶段与待审批状态

## 实施范围

本轮只做组织控制面能力，不改 run executor 的核心执行协议。

包含：

- system prompt 重写
- 控制面状态机
- 人类审批门
- 必要的桥接 API
- 最小 UI 状态展示
- 上下文投影更新

不包含：

- 自动生成复杂甘特图或路线图界面
- 多组织跨项目编排
- 修改模型权重或底层 agent 内核

# Organization OS Capability Gap Analysis

**日期**: 2026-03-22

## 背景

当前 `Organization AI` 已经从“普通执行型聊天入口”升级为“受治理约束的组织控制平面”：

- 已具备组织对象主模型：`Task / Run / Artifact / MemoryCard / EvalSpec / Skill / GenomePatch`
- 已具备组织级 prompt、状态机、人类审批门
- 已具备 `org/task/create`、`org/run/start`、`org/eval/execute`、`org/memory/promote`、`org/evolution/propose`
- 已具备组织控制状态与待审批状态的最小前端展示

这意味着系统已经能约束 `Organization AI` 不要直接下场执行，而是先经过组织控制面。

但距离项目初始文档中定义的最终目标

> “构建高性能、多 agent 协同、自进化的智能体组织，用于长期复杂任务与项目持续推进”

仍存在明显能力缺口。

本文件的目标不是枚举零散功能，而是识别“离最终组织能力闭环还缺什么”。

## 最终目标的能力拆解

要达到“弱监督的自进化组织操作系统”，组织 AI 至少需要同时具备以下七类能力：

1. **人类对齐能力**
   - 主动提问补齐第一层决策
   - 将第二层重大方案转化为可审批对象
2. **规划能力**
   - 生成 brief
   - 生成多版本 plan
   - 维护 plan 之间的演化关系
3. **编排能力**
   - 按 plan 拆出 task graph
   - 安排 run 顺序、并发度、依赖与重试
4. **监控能力**
   - 感知 run 的进行中、阻塞、失败、完成
   - 在异常时自动重排或升级求助
5. **复盘能力**
   - 把 run 结果映射回总方案
   - 判断是继续拆任务、改计划还是找人类
6. **学习能力**
   - 沉淀可复用记忆
   - 在后续任务中检索与注入
7. **演化能力**
   - 从历史运行中提出组织补丁
   - 经离线评估、canary 与治理后真正晋升

当前系统已经部分覆盖第 1 类与第 2 类的入口约束，但第 3 到第 7 类仍然不完整。

## 当前已具备的基础能力

### 1. 组织控制面边界已经建立

这是当前最重要的已完成项。

- prompt 已明确 `Organization AI` 是协调者，不是执行者
- 第一层决策缺失会进入 `awaiting_human_decision`
- 没有 approved plan snapshot 时，`org/run/start` 会被拦截
- run 完成后控制状态会回收至下一轮规划阶段

这解决了此前“组织 AI 接到事就自己做”的根本性偏差。

### 2. 组织对象主存储已经成型

七类核心对象已具备数据库与 bridge 基础：

- `Task`
- `Run`
- `Artifact`
- `MemoryCard`
- `EvalSpec`
- `Skill`
- `GenomePatch`

这为后续组织级调度、评估和演化提供了结构化主存储。

### 3. 执行、评估、记忆、演化已有最小闭环

当前已有：

- `org/run/start`
- `org/eval/execute`
- `org/memory/promote`
- `org/evolution/propose`

这说明系统已经不是纯展示层，而是具备了基础“执行后产生反馈”的组织工作流骨架。

### 4. 控制状态已经能被前端看见

前端目前已能展示：

- 当前 `phase`
- pending approvals
- `Start Run` gating

虽然展示仍然轻量，但“控制面状态可观察”这一前提已经建立。

## 核心能力缺口

以下缺口按“是否阻塞最终目标”排序。

### Gap 1: 缺真正可操作的规划工作台

**当前已有**

- `brief`
- `plan snapshot`
- `approval record`
- `controlState`

**当前缺失**

- AI 提问结果如何沉淀为可编辑的 brief
- plan snapshot 的查看、比对、版本关系与审批详情
- 人类对 plan 的批准、拒绝、补信息操作入口
- plan 与后续 task / run 的显式映射

**为什么这是核心缺口**

现在系统能“知道应该先规划”，但还没有“高效率地规划”。  
也就是说，控制面对象存在，但没有形成真正的人机协同工作台。

**缺口级别**: P0

### Gap 2: 缺任务拆解与运行编排器

**当前已有**

- 可以创建 task
- 可以启动 run
- 可以阻止未审批 plan 的 run 启动

**当前缺失**

- plan 到 task graph 的自动映射
- 任务之间依赖、优先级、并发关系
- run queue
- 重试、改派、降级策略
- 多个 run 之间的整体调度

**为什么这是核心缺口**

当前系统更像“带治理门的单次 dispatch 系统”，还不是“多 agent 组织调度器”。

如果没有编排器，组织 AI 仍然无法持续推进复杂项目。

**缺口级别**: P0

### Gap 3: 缺 run 级监控与恢复机制

**当前已有**

- run 生命周期基础状态
- run close 后的状态回收

**当前缺失**

- run heartbeat / timeout / stuck 检测
- 失败分类
- 自动重试策略
- 异常升级给人类或控制面
- workspace 级恢复与继续推进

**为什么这是核心缺口**

最终目标不是“能起 run”，而是“能长期稳定推进 run”。  
没有监控和恢复，组织 AI 只能发起动作，不能真正托管项目推进。

**缺口级别**: P0

### Gap 4: 缺 run 完成后的自动 replanning 闭环

**当前已有**

- run 结束会回到规划相关 phase
- eval / memory / patch 已有最小入口

**当前缺失**

- run 结果如何自动映射回总方案
- 是否继续拆任务、变更计划、追加任务的决策逻辑
- plan version 的迭代推进机制
- 面向阶段目标的完成判断

**为什么这是核心缺口**

现在系统会“回到规划阶段”，但还不会系统地“用结果改计划”。  
这使它离“长期复杂任务持续推进”还有一大段距离。

**缺口级别**: P0

### Gap 5: 缺可用的审批中心与治理操作台

**当前已有**

- `listApprovals`
- `respondApproval`
- 最小审批提醒

**当前缺失**

- 待审批列表主视图
- 审批对象详情
- 批准 / 拒绝 / 需要更多信息的操作流
- 审批后影响范围的可视化
- 审批历史与审计追踪界面

**为什么这是核心缺口**

人类专属决策已经被系统尊重，但治理成本还很高。  
如果审批不高效，人类会绕开系统，组织 AI 也无法稳定执行边界。

**缺口级别**: P1

### Gap 6: 缺 MemoryCard 的检索、筛选和主动注入

**当前已有**

- 可从 run 提升 memory
- context projection 中已有 memory 快照

**当前缺失**

- 记忆类型化与置信度
- 去重与聚类
- 按上下文检索最相关记忆
- 在新 task / new run 启动前自动注入相关记忆
- 区分 project memory / episodic memory / failure pattern / policy memory

**为什么这是核心缺口**

没有真正可检索与可注入的 memory，组织只能“存经验”，不能“用经验”。

**缺口级别**: P1

### Gap 7: 缺 GenomePatch 的真实晋升流水线

**当前已有**

- `org/evolution/propose`
- patch 状态对象

**当前缺失**

- offline eval
- canary
- adopt / reject 的完整治理流
- patch 生效前后的收益评估
- patch rollback

**为什么这是核心缺口**

如果 patch 只停留在“提案”，系统就不算“自进化”。  
真正的组织演化必须经过评估、试用、晋升和回退。

**缺口级别**: P1

### Gap 8: 缺多 agent 资源路由与预算治理

**当前已有**

- 会话与 run 的基础执行入口
- task / run budget 字段

**当前缺失**

- 哪类任务使用哪类 agent / model
- 并发预算
- 成本预算控制
- 风险级别与审批策略联动
- worktree / workspace 池化与复用

**为什么这是核心缺口**

最终目标强调的是“高性能、多 agent 协同”。  
没有资源路由层，系统仍然只是单组织控制台，而不是组织级执行操作系统。

**缺口级别**: P2

## 能力成熟度判断

用一句话概括当前阶段：

> 系统已经完成了“不要让组织 AI 直接干活”的治理改造，但还没有完成“让组织 AI 真正会组织别人干活”的能力建设。

更精确地说：

- **治理边界** 已基本具备
- **组织执行能力** 还处于早期
- **组织学习与演化能力** 仍处于原型阶段

## 下一阶段路线图

建议不要再按零散 issue 推进，而是按能力模块推进。

### 阶段 A: 规划工作台

**目标**

让组织 AI 的提问、澄清、方案起草、plan 审批，成为高效、可视化、可追踪的人机协作流程。

**建议范围**

- Brief Viewer / Editor
- Plan Snapshot Viewer
- Plan Version Timeline
- Approval Inbox
- Approval Action Panel
- Plan -> Task 拆解入口

**阶段结果**

组织 AI 能稳定地产生“人类可理解、可审批、可追踪”的计划对象。

### 阶段 B: 任务拆解与运行编排器

**目标**

让组织 AI 不只会创建单个 task / run，而是能按 plan 驱动整组任务与执行序列。

**建议范围**

- Task graph
- dependency / priority / concurrency
- run queue
- retry / escalate / reassign policy
- dispatch strategy

**阶段结果**

组织 AI 从“会发起 run”升级为“会组织 run”。

### 阶段 C: run 监控与 replanning 闭环

**目标**

让系统具备真正的长期项目推进能力。

**建议范围**

- run heartbeat / stuck detection
- failure classification
- post-run summary -> plan delta
- auto replan suggestions
- stage completion judgement

**阶段结果**

组织 AI 从“流程控制者”升级为“项目推进者”。

### 阶段 D: 记忆检索与组织演化

**目标**

让经验真正变成组织能力，让 patch 真正能晋升。

**建议范围**

- memory typing / ranking / retrieval / injection
- patch offline eval
- patch canary
- patch adopt / rollback
- evolution dashboard

**阶段结果**

系统从“会复盘”升级为“会学习、会演化”。

### 阶段 E: 多 agent 路由与预算治理

**目标**

把系统从单控制面扩展为真正的多 agent 组织操作系统。

**建议范围**

- model routing policy
- parallelism policy
- budget policy
- risk-aware approval policy
- workspace pool / worktree orchestration

**阶段结果**

系统从“单组织控制器”升级为“高性能、多 agent 协同组织”。

## 推荐的实际优先级

如果只选三个最关键的建设方向，建议优先级如下：

1. **规划工作台**
2. **任务拆解与运行编排器**
3. **run 完成后的自动 replanning 闭环**

原因很简单：

- 没有规划工作台，治理流程不可用
- 没有编排器，组织 AI 仍无法真正分派复杂工作
- 没有 replanning，系统无法长期推进项目

这三项做起来之后，Memory / GenomePatch / 多 agent 路由的投资回报率才会显著上升。

## 建议的下一份实现计划

建议下一轮直接新开一份实现计划，主题聚焦在：

### `Organization Planning Workbench`

这是最适合的下一阶段主题，因为它正好承接当前已完成的治理基础设施：

- 后端已有 `brief / plan snapshot / approval record / controlState`
- 前端已有最小治理状态展示
- bridge 已有 `listApprovals / respondApproval`

也就是说，规划工作台已经具备“搭建产品层”的条件。

它会是把治理骨架升级为可用组织能力的第一步。


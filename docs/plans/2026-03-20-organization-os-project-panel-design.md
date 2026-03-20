# Organization OS Project Panel 设计

## 背景

当前 `Project` 面板的实际形态是：

- 左侧或中部以 `Task` 看板为核心
- 右侧为项目级 AI 会话
- 底层对象只有 `Project / Task / Conversation`

这一结构适合“项目任务管理 + 顶层委派 AI”，但不足以承载 `Organization OS` 的目标。根据项目初始文档，系统需要支持七类组织对象、控制平面 API、评估闭环、经验沉淀与策略演化。因此，本次推进不是一次局部优化，而是将当前 `Project` 面板升级为真正的组织控制台。

## 目标

- 将当前 `Project` 重塑为 `Organization` 级别的工作容器
- 落地七类核心对象：`Task`、`Run`、`Artifact`、`MemoryCard`、`EvalSpec`、`Skill`、`GenomePatch`
- 建立“控制面驱动”的组织系统，而不是“会话驱动”的项目页面
- 保留现有 `conversation` 执行基础设施，但将其语义降级为 `Run` 的执行通道
- 构建 SQLite 主存储 + Workspace 文档投影的双层体系，兼顾结构化查询与 AI 友好上下文
- 形成第一版即可跑通的闭环：任务契约、执行、证据、评估、记忆、演化、治理

## 设计原则

### 1. 数据真相以结构化存储为主

组织对象、状态流转、审计信息以 SQLite 为事实源，避免长期依赖松散文件结构作为主数据。

### 2. 文档是投影层而不是主真相

Workspace 下保留 AI-friendly 的结构化文档目录，用于检索、协作、审阅和审计，但所有状态变更必须通过控制面回写数据库，再重新投影。

### 3. Conversation 不再承担业务主模型职责

会话仍用于 agent 执行，但它不再是顶层组织对象，也不再直接等价于任务本身，而是绑定到 `Run`。

### 4. 控制面优先

UI、watcher、agent 指令、上下文目录、审批逻辑都围绕统一的组织控制 API 组织，避免业务规则散落在页面和 watcher 中。

### 5. 第一版必须闭环

第一版不能只完成对象表和页面壳子，必须至少跑通：

`Task Contract -> Run -> Artifact -> Eval -> Memory -> GenomePatch -> Governance`

## 整体架构

系统分为四个平面：

### Control Plane

负责组织对象的生命周期、调度、查询、审批和状态切换。所有核心能力都通过 `org/*` 命名空间暴露。

### Execution Plane

负责将 `Run` 绑定到具体执行环境与 agent 会话，复用现有 `conversation`、ACP chat 和 agent manager 体系。

### Knowledge Plane

负责 `Artifact`、`MemoryCard`、`Skill`、`EvalSpec` 的存储、检索、回链与版本化。

### Evolution Plane

负责从运行与记忆中提出 `GenomePatch`，并完成离线评估、canary 试用、治理审批和采纳落地。

## 核心对象定义

### Organization

新的顶层容器，承接现有 `Project` 的入口角色，但语义上表示一个组织级工作空间。其下统一管理任务、执行、知识与演化对象。

### Task

`Task` 是任务契约，而不再是轻量看板项。每个任务至少包含：

- `objective`
- `scope`
- `doneCriteria`
- `budget`
- `riskTier`
- `validators`
- `deliverableSchema`

### Run

`Run` 是 `Task` 的一次执行实例，记录环境、上下文策略、执行配置、会话绑定、日志和结果。

### Artifact

`Artifact` 是 `Run` 产生的证据与输出，类型包括但不限于：

- `code_diff`
- `test_log`
- `failure_report`
- `design_note`
- `spec`
- `review_note`

### MemoryCard

`MemoryCard` 是从执行历史中提炼出的组织记忆，必须带有来源回链，并支持后续任务复用。

### EvalSpec

`EvalSpec` 是评估规范对象，定义测试命令、质量门槛、baseline 对比和阈值规则。

### Skill

`Skill` 是组织级可复用工作流单元，用于规范常见任务的执行方式、输入条件与输出格式。

### GenomePatch

`GenomePatch` 是组织策略变更提案，用于演化技能、评估规范、路由策略或任务模板。

## 对象关系

主链路：

`Organization -> Task -> Run -> Artifact`

横向关联：

- `Task -> EvalSpec`
- `Run -> MemoryCard`
- `Run / MemoryCard / Task -> GenomePatch`
- `Run -> Conversation`

约束规则：

- 一个 `Task` 可以有多个 `Run`
- 同一时刻一个 `Task` 只允许一个主运行实例
- 一个 `Artifact` 必须绑定 `Run`
- 一个 `MemoryCard` 必须携带来源 `Run` 或 `Artifact`
- 一个 `GenomePatch` 必须携带 `based_on` 记录

## 状态机

### Task

`draft -> ready -> scheduled -> running -> completed | blocked -> archived`

说明：

- `draft`：契约未完成
- `ready`：契约完整，可进入调度
- `scheduled`：已排队等待执行
- `running`：存在活跃 `Run`
- `completed`：满足完成标准并验收通过
- `blocked`：被依赖、风险或失败阻塞
- `archived`：历史封存

### Run

`created -> active -> verifying -> reviewing -> closed`

说明：

- `created`：实例已创建
- `active`：agent 正在执行
- `verifying`：执行自动验证和质量门
- `reviewing`：等待人工或上层组织 AI 审阅
- `closed`：执行结束并归档

### GenomePatch

`proposed -> offline_eval -> canary -> adopted | rejected`

## 控制面 API 结构

建议按对象域划分：

- `org/organization/*`
- `org/task/*`
- `org/run/*`
- `org/artifact/*`
- `org/eval/*`
- `org/memory/*`
- `org/skill/*`
- `org/evolution/*`
- `org/governance/*`

其中关键动作包括：

- `org/task/create`
- `org/task/update`
- `org/run/start`
- `org/run/close`
- `org/artifact/register`
- `org/eval/execute`
- `org/memory/promote`
- `org/skill/register`
- `org/evolution/propose`
- `org/evolution/canary`
- `org/governance/approve`
- `org/governance/reject`

## 数据存储设计

主存储使用 SQLite，新增或替换为以下核心表：

- `organizations`
- `org_tasks`
- `org_runs`
- `org_artifacts`
- `org_memory_cards`
- `org_eval_specs`
- `org_skills`
- `org_genome_patches`
- `org_audit_logs`

其中复杂对象字段可通过 `*_json` 存储结构化内容，长文本资源使用 `*_ref` 指向工作区文档。

## 文档投影目录

建议在 Workspace 下使用新的投影目录：

```text
.aionui-org/
  context/
    organization.json
    tasks.json
    runs.json
    artifacts.json
    memory_cards.json
    eval_specs.json
    skills.json
    genome_patches.json
    dashboard.json
  control/
    schema.json
    operations/
    approvals/
  artifacts/
  memory/
  skills/
  evolution/
```

约束：

- 数据库是事实源
- 投影目录只读或经控制面间接写入
- agent 通过 `operations/*.json` 请求结构化动作

## 与现有 conversation/agent 层的映射

保留现有 `conversation` 基础设施，但语义调整为：

- 组织级控制会话：绑定 `organization_id`
- 执行会话：绑定 `run_id`

这意味着：

- `Task` 负责定义“要做什么”
- `Run` 负责记录“做了什么”
- `Conversation` 负责承载“如何执行”
- `Artifact` 负责提供“做成了什么证据”

## 页面信息架构

当前 `ProjectDetail` 页面需要重构为 `Organization Console`。

推荐三栏布局：

- 左栏：对象导航与全局状态摘要
- 中栏：对象工作区
- 右栏：控制塔，包括组织 AI、结构化操作面板和对象检查面板

中栏支持以下一级视图：

- `Overview`
- `Tasks`
- `Runs`
- `Artifacts`
- `Memory`
- `Eval Specs`
- `Skills`
- `Genome Patches`
- `Governance`

其中 `Tasks` 视图仍可保留看板作为一种视图形式，但卡片内容必须升级为任务契约摘要，而不是轻量任务卡。

## 评估与自进化闭环

第一版必须形成以下稳定链路：

1. 创建任务契约
2. 启动运行实例
3. 产生产物与执行日志
4. 运行评估规范
5. 形成结构化评估结果
6. 从执行结果中提炼记忆卡
7. 基于多次运行或记忆提出基因补丁
8. 经离线评估、canary 与治理审批后采纳或拒绝

## 第一版范围策略

为保证“全量打通”但不过度发散，第一版采用“对象全覆盖、深度分层”的策略：

- `Task`：完整落地
- `Run`：完整落地
- `Artifact`：完整落地
- `EvalSpec`：完整落地
- `MemoryCard`：可用版
- `Skill`：可用版
- `GenomePatch`：完整流程版，但变更目标收敛为：
  - `skill`
  - `eval_spec`
  - `routing_policy`
  - `task_template`

## 风险与约束

### 1. 改动面广

本次重构会影响数据库、桥接层、上下文同步、UI 路由和项目 AI prompt，必须统一切换，避免半旧半新状态。

### 2. 旧模型不再兼容

根据当前范围决策，本次不保留旧 `Project / Task` 数据兼容逻辑，采用破坏式升级。

### 3. 需要清晰的事实源边界

若数据库与投影目录都能直接被写入，后期会出现一致性问题，因此必须坚持控制面单写入口。

## 验收标准

完成后，系统至少要支持以下真实场景：

1. 用户创建一个完整任务契约
2. 系统启动一次 `Run` 并绑定 agent 会话
3. 执行过程产生 `Artifact`
4. 控制面自动执行 `EvalSpec`
5. 评估结果驱动 `Run` 状态收敛
6. 系统能从结果中提炼 `MemoryCard`
7. 系统能基于多次运行生成 `GenomePatch`
8. `GenomePatch` 可完成 `offline_eval -> canary -> adopted/rejected`
9. 页面可在一个控制台内查看与操作上述对象链路

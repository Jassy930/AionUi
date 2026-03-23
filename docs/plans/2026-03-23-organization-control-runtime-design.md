# Organization Control Runtime Design

**日期**: 2026-03-23

## 背景

当前右侧 `Organization AI` 已经具备组织级 prompt、治理状态展示和 `Task Contract + Run` 约束，但它仍然不是一个真正能持续推进项目的组织控制器。

当前能力存在三个核心断点：

- 组织 AI 主要依赖 prompt 约定和 `.aionui-org/control/operations/*.json` 文件协议间接驱动任务创建与 run 启动，缺少稳定的“控制会话直连动作”能力。
- `Task / Run / Approval / Eval` 等对象虽然会在 bridge 与 watcher 层发生变化，但这些变化没有被统一回灌到同一个组织控制会话里，组织 AI 无法把它们当作连续事件流来消化。
- `Run` 结束后虽然状态机会回到下一轮规划相关阶段，但没有一个稳定的自动推进运行时负责继续唤醒组织 AI，让它基于结果决定下一步任务流转。

结果是：组织 AI 更像“一个有治理约束的聊天框”，而不是“一个能够持续编排、派发、监控、复盘并推进项目发展的组织控制器”。

## 目标

把 `Organization AI` 升级为真正的组织控制运行时入口：

1. 保留现有的人类审批门与分层决策边界。
2. 让组织 AI 成为唯一的组织控制会话，持续接收组织事件流。
3. 让组织 AI 可以直接创建 Task、启动 Run、建立执行会话并继续推进后续组织流转。
4. 让 `Run` 完成、审批响应、评估结果等变化作为新事件回灌到同一个控制会话。
5. 在多个任务并发回调时，组织 AI 仍能明确知道“哪个 task / 哪个 run 发生了什么事”。
6. 采用“事件驱动为主、巡检兜底”的混合模式，避免漏事件后控制面失步。

## 非目标

本轮不做以下事情：

- 不重做整个 `Organization Console` 视觉结构
- 不把顶层组织 AI 变成真正执行代码的 worker
- 不移除现有 `.aionui-org/control/operations/*.json` 文件协议
- 不一次性补全完整的任务编排器、队列系统、复杂可视化审批中心
- 不在首版中接入全部对象闭环，只优先覆盖自动推进主链

## 用户期望与约束

根据本轮确认，系统应满足以下约束：

- **保留人类审批门**
  - Tier 1 与 Tier 2 决策仍然必须停下来等待人类输入或审批
  - 没有 approved plan snapshot 时，不允许启动执行 run
- **其他流程可自动推进**
  - 自动创建 Task Contract
  - 自动启动 Run
  - 自动建立执行会话/agent
  - 根据返回结果继续拆分或推进项目
- **Run 完成应作为新的事件回调组织 AI**
- **采用混合模式**
  - 事件驱动为主
  - 巡检补偿为兜底
- **所有事件回灌到同一个控制会话**
  - 但必须让控制会话能够区分不同任务/运行实例的事件来源
- **回灌采用结构化系统消息流**
  - 每个事件是一条独立、可识别、可追踪的系统消息

## 方案对比

### 方案 A：继续增强纯文件协议

组织 AI 继续通过写 `.aionui-org/control/operations/*.json` 驱动动作，所有事件也通过文件协议回灌。

优点：

- 改动最小
- 最大限度复用现有 watcher

缺点：

- 会话和动作之间没有强绑定
- 事件回灌可观察性差
- 控制台刷新链路脆弱
- 组织 AI 不容易形成稳定的“连续事件上下文”

### 方案 B：控制会话直连组织命令桥

为控制会话补一套“组织控制动作运行时”，让它可以直接执行组织动作；所有组织事件直接回灌控制会话。

优点：

- 控制链条最清晰
- 最符合“组织 AI 直接操作整个过程”的目标

缺点：

- 改动面较大
- 需要补控制会话运行时与事件调度器

### 方案 C：混合模式

动作主链改为控制会话直连组织命令桥；文件 watcher 保留为兼容入口；事件通过统一运行时回灌到控制会话；巡检用于补偿漏事件与状态失步。

优点：

- 既满足“组织 AI 直接推进”目标，又能复用现有治理与 watcher 基础
- 最容易平滑演进，不需要一次性推翻现有实现

缺点：

- 需要新增一层组织控制运行时，协调会话、事件与巡检

**推荐方案：方案 C。**

## 核心设计

### 1. 新增 Organization Control Runtime

新增后台服务 `organizationControlRuntime`，作为组织自动推进的协调器。

它负责：

- 维护 `organization_id -> control_conversation_id` 绑定
- 统一接收组织域事件
- 把事件转换为结构化系统消息并回灌到控制会话
- 在事件回灌后调度一次控制会话继续推进
- 当事件漏发或状态失步时，定时巡检并补偿

它不直接执行组织业务动作。组织业务动作仍然经过现有 bridge / service / watcher，只是由它负责“把变化可靠地送回控制会话”。

### 2. 控制会话作为唯一编排入口

右侧 `Organization AI` 会话继续作为组织级控制会话，但它将从“被动聊天”升级为“唯一编排入口”。

控制会话需要具备以下属性：

- `organizationId`
- `organizationRole: 'control_plane'`
- `organizationAutoDrive: true`
- `autoDrivePaused?: boolean`
- `lastReconcileAt?: number`
- `controlConversationVersion?: number`

组织 AI 的职责是：

- 解释和汇总组织事件
- 判断是否继续创建 task / 启动 run
- 判断是否需要人类审批
- 判断是否需要继续评估、沉淀 memory、推进 patch

执行态 run 会话仍然独立存在，组织 AI 只负责调度它们，而不自己下场做 worker。

### 3. 统一组织事件模型

新增统一事件结构 `OrganizationControlEvent`，最少包含：

- `id`
- `organization_id`
- `control_conversation_id`
- `event_type`
- `task_id?`
- `run_id?`
- `approval_id?`
- `source`
- `timestamp`
- `summary`
- `payload`

推荐首批 `event_type`：

- `task_created`
- `task_updated`
- `run_started`
- `run_updated`
- `run_closed`
- `run_failed`
- `approval_requested`
- `approval_responded`
- `reconcile_tick`

第二批再接入：

- `eval_executed`
- `memory_promoted`
- `evolution_proposed`
- `governance_changed`

### 4. 回灌到同一个控制会话

所有组织事件都回灌到同一个控制会话，以系统消息形式插入消息流。

每条系统消息必须明确标识：

- 事件类型
- 关联 `task_id`
- 关联 `run_id`
- 一段可直接阅读的摘要
- 结构化 payload

建议消息内容语义采用以下格式：

- 标题：`[OrgEvent] run_closed`
- 摘要：`Run run_xxx for task task_xxx closed`
- 结构化正文：
  - `organization_id`
  - `task_id`
  - `run_id`
  - `event_type`
  - `source`
  - `payload`

这样做有两个目的：

- 人类可以直接在控制会话中看懂组织发生了什么
- 组织 AI 可以基于同一条消息流持续作出下一步决策

### 5. 自动推进触发规则

组织 AI 的自动推进采用“事件驱动为主、巡检兜底”的混合模式。

#### 事件驱动

以下动作成功后，直接向控制运行时投递事件：

- `org.task.create`
- `org.task.update`
- `org.run.start`
- `org.run.close`
- `org.organization.respondApproval`
- 首批之外的对象事件后续逐步接入

#### 巡检兜底

控制运行时定期扫描组织状态，补偿以下情况：

- 某个 run 已结束但未回灌 `run_closed`
- 某个审批状态已变化但未回灌 `approval_responded`
- 控制 phase 与最近对象状态明显失步
- 控制会话短时忙碌或不可用导致事件未处理

巡检只负责补事件或发 `reconcile_tick`，不直接替组织 AI 做新的 task/run 派发。

### 6. 控制会话自动唤醒

仅仅插入系统事件消息还不够，还必须让组织 AI 在收到事件后继续工作。

新增自动唤醒规则：

- 事件被回灌到控制会话后，控制运行时判断当前会话是否空闲
- 如果空闲，则向该会话投递一条内部触发输入，语义类似：
  - “基于刚收到的组织事件继续推进；不要越过审批门”
- 如果会话正在运行，则把事件挂入待处理队列，等当前轮次结束后再继续

这样可以保证：

- 同一会话不会被多个事件同时打断
- 多个并发任务的事件仍然可以顺序进入同一个控制上下文

### 7. 多任务并发下的规则

在同一个控制会话中，多个任务/运行实例可能同时回调。为防止上下文混乱，必须建立硬规则：

- 每条事件必须带 `task_id` / `run_id`
- 系统消息不得只写自然语言摘要，必须附结构化字段
- 组织 AI 在自动回复中应显式引用相关对象 ID
- 多个 run 同时结束时，允许连续插入多条事件，而不是强行合并成一条模糊摘要
- 若多个事件共同指向一个新的 Tier 2 决策，则必须汇总为一次审批请求，而不是分别继续推进

## 审批门与自动推进边界

### 永远不能自动越过的边界

- Tier 1 信息缺失
- Tier 2 重大方案变更待批准
- 相关审批记录仍为 `pending`
- 没有 approved plan snapshot

### 可以自动推进的动作

- 继续拆 Task Contract
- 创建新 task
- 为已批准计划启动新 run
- 建立执行会话/agent
- 在 run 完成后发起下一轮 task/run 判断
- 在低风险边界内执行 `eval / memory / evolution` 的后续阶段

### `run_closed` 的默认决策顺序

收到 `run_closed` 后，组织 AI 应按固定顺序判断：

1. 当前 run 是否完成该 task 的阶段目标
2. 是否需要先做 eval 才能判断结果质量
3. 是否应沉淀 memory
4. 当前 plan 是否还能继续执行
5. 是否应拆出新的 task / run
6. 是否触发新的 Tier 2 审批
7. 是否需要回到人类提问而不是继续推进

## 与现有文件协议的关系

本轮不删除现有 `.aionui-org/control/operations/*.json` 协议。

保留策略：

- watcher 仍然可以执行文件协议产生的动作
- watcher 成功执行后，也必须把结果统一转成 `OrganizationControlEvent`
- 控制会话的主路径改为“直连组织控制运行时 + 统一事件回灌”
- 文件协议降级为兼容入口与兜底通道，而不是主控制链

## UI 影响

UI 不重做整体布局，只做最小增强：

- 右侧控制会话继续复用当前 `OrganizationConversationPanel`
- 控制会话中新增结构化系统事件消息展示
- 结构化事件展示收敛在消息渲染层，而不是 `AcpChat` 布局层
- 事件消息应显式展示 `event_type / task_id / run_id`
- 保持当前控制塔和组织控制台主结构不变

当前首版实现约束：

- 运行时仍以 `[OrgEvent] <event_type>\n<JSON>` 写入消息存储，保持后端协议简单
- 前端在 `MessageText` 中识别该前缀，并切换到 `MessageOrganizationControlEvent` 紧凑卡片
- 卡片显式展示 `event_type / task_id / run_id / source / summary`，并把 `payload` 作为可折叠 JSON 展开
- 多条并发事件各自作为独立消息卡片显示，不在 UI 层做跨事件聚合，避免归属混淆

后续如果需要，可在控制台主区再增加“事件轨迹 / 自动推进状态 / 队列状态”视图，但不属于本轮首批目标。

## 测试策略

### 单测

- 控制运行时可正确绑定控制会话
- `OrganizationControlEvent` 能正确转成系统消息
- 多事件排队时不会并发打断同一控制会话
- 忙碌态会话结束后能够继续消费待处理事件

### 集成测试

- `task create -> 事件回灌 -> 自动唤醒控制会话`
- `run close -> 事件回灌 -> 自动唤醒控制会话`
- `approval respond -> 事件回灌 -> 自动推进或回退到审批等待`
- watcher 文件协议执行后也能正确回灌控制会话

### DOM 测试

- 右侧控制会话能显示结构化系统事件消息
- 多个不同 `task_id / run_id` 的事件可在同一会话中被区分
- 控制会话保留当前紧凑显示样式，不被系统消息破坏布局

## 分阶段落地

### 第一阶段

打通自动推进主链：

- 控制运行时
- 控制会话绑定
- 事件模型
- `task_created / run_started / run_closed / approval_responded / reconcile_tick`
- 控制会话系统消息回灌
- 自动唤醒与排队

### 第二阶段

补齐更多组织闭环：

- `eval_executed`
- `memory_promoted`
- `evolution_proposed`
- 更丰富的控制台事件视图
- 更强的巡检与恢复逻辑

## 决策总结

本设计的核心判断是：

- 组织 AI 必须从“带治理约束的聊天框”升级为“真正的组织控制运行时入口”
- 关键不在于再加更多 prompt 文案，而在于建立一条可靠的“组织事件 -> 控制会话 -> 自动推进”闭环
- 为了保持可落地性，首版采用“控制会话直连 + 统一事件回灌 + 巡检兜底 + 文件协议兼容保留”的混合架构

这样既保留了人类审批门，又让组织 AI 真正接管组织内任务流转与项目推进。

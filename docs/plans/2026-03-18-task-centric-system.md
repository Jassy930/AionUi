# Task-Centric Work Execution System

> Relay manages task state, not chat threads.

## Project Vision

AionUi is evolving from a conversation-centric tool to a **work execution system** for developers. The core shift: instead of managing ongoing chats, the system manages the **state of work** — what's the current status, what needs to happen next, and what inputs/outputs have been structurally captured.

## Core Concepts

| Concept | Definition |
|---------|------------|
| **Task** | The durable work contract — a unit of work that persists across sessions |
| **Run** | An executable attempt to advance a Task |
| **Thread** | The interaction surface (conversation) within a Run |
| **Artifact** | Structured state transitions and deliverables |
| **Schedule** | Automatic trigger rules for recurring work |
| **Policy/Approval** | Governance boundaries for sensitive actions |

## System Invariants

1. Work belongs to Task, not Thread
2. State belongs to Task, and can be advanced by both system and agent
3. Execution belongs to Run, history is never overwritten
4. Truth lives in Artifacts, not in message streams
5. Sensitive actions go through Policy/Approval
6. All surfaces share a single event stream

## North Star Metric

**Closed-loop Task Rate**: Percentage of Tasks that reach an accepted final artifact within 7 days.

## Guardrail Metrics

- Median time from raw materials to first handoff package < 60 seconds
- Manual re-summarization per Task <= 1
- At least 1 final artifact directly reusable or exportable

## Implementation Phases

### Phase 1: Foundation (Current - Completed)

**Goal**: Establish basic Task infrastructure alongside existing Thread system.

**Deliverables**:
- [x] Task data model and database schema (`tasks` table, `conversations.task_id` FK)
- [x] Task CRUD operations in database layer
- [x] Task IPC bridge (`workTask` namespace)
- [x] ViewMode context and persistence (`thread` | `task`)
- [x] View mode toggle in Titlebar (top-right)
- [x] Task Kanban board page (`/tasks`)
- [x] i18n support for all 6 languages

**Files Created/Modified**:
- `src/common/types/task.ts` - Task type definitions
- `src/process/database/migrations.ts` - Migration v16
- `src/process/database/index.ts` - Task DB operations
- `src/process/bridge/workTaskBridge.ts` - IPC handlers
- `src/common/ipcBridge.ts` - workTask namespace
- `src/renderer/hooks/useViewMode.ts` - ViewMode hook
- `src/renderer/context/ViewModeContext.tsx` - ViewMode provider
- `src/renderer/components/Titlebar/index.tsx` - Toggle button
- `src/renderer/pages/tasks/*` - Kanban board UI
- `src/renderer/router.tsx` - /tasks route
- `src/renderer/i18n/locales/*/task.json` - Translations
- `src/renderer/i18n/locales/*/viewMode.json` - Translations

### Phase 2: Task-Conversation Binding

**Goal**: Connect Tasks with Conversations as Runs.

**Planned Work**:
- [ ] Task selector in Guid page when creating new conversation
- [ ] Task context indicator in conversation view
- [ ] Task detail page showing associated conversations
- [ ] "Create conversation under Task" flow
- [ ] Quick-add Task from conversation

### Phase 3: Run Abstraction

**Goal**: Formalize the Run concept.

**Planned Work**:
- [ ] Run entity (wrapping Conversation with Task context)
- [ ] Run status tracking (draft, executing, completed, failed)
- [ ] Run history within Task
- [ ] Run comparison view

### Phase 4: Artifacts

**Goal**: Capture structured outputs from Runs.

**Planned Work**:
- [ ] Artifact data model
- [ ] Artifact extraction from conversation
- [ ] Artifact viewer/editor
- [ ] Artifact export functionality

### Phase 5: Schedule & Automation

**Goal**: Enable recurring Task execution.

**Planned Work**:
- [ ] Task-level scheduling (extend existing cron system)
- [ ] Trigger conditions
- [ ] Auto-run based on schedule

## What We Explicitly Won't Build

- Chat volume / message count / session duration metrics
- Full BPMN or low-code workflow platform
- Organization-level permission system (Phase 1)
- "Auto multi-agent black-box autonomy" as a launch feature

## Migration Strategy

- Existing conversations remain untouched (no migration needed)
- New conversations created under Tasks get `task_id` populated
- View mode toggle allows gradual user adoption
- Both modes coexist indefinitely for backward compatibility

## Technical Notes

### Database Schema (v16)

```sql
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending' 
    CHECK(status IN ('pending', 'in_progress', 'done')),
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- conversations table gets new column:
ALTER TABLE conversations ADD COLUMN task_id TEXT 
  REFERENCES tasks(id) ON DELETE SET NULL;
```

### API Namespace

All Task-related IPC calls use the `workTask` namespace (separate from `task` which manages running processes):

- `workTask.create` / `workTask.get` / `workTask.list` / `workTask.update` / `workTask.delete`
- `workTask.listByStatus`
- `workTask.getConversations` / `workTask.associateConversation`
- Events: `workTask.created` / `workTask.updated` / `workTask.deleted`

---

*Document created: 2026-03-18*
*Last updated: 2026-03-18*

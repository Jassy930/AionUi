/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import type {
  TOrgApprovalRecord,
  TOrganization,
  TOrgArtifact,
  TOrgBrief,
  TOrgControlState,
  TOrgGenomePatch,
  TOrgPlanSnapshot,
  TOrgRun,
  TOrgTask,
} from '@/common/types/organization';
import { getDatabase } from '@process/database';

const AIONUI_ORG_DIR = '.aionui-org';
const ALL_APPROVALS_LIMIT = 1_000_000;

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function writeJson(filePath: string, data: unknown): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function buildOrganizationContext(organization: TOrganization) {
  return {
    id: organization.id,
    name: organization.name,
    description: organization.description || '',
    workspace: organization.workspace,
    created_at: organization.created_at,
    updated_at: organization.updated_at,
  };
}

function buildTasksContext(tasks: TOrgTask[]) {
  return tasks.map((task) => ({
    id: task.id,
    title: task.title,
    objective: task.objective,
    scope: task.scope,
    done_criteria: task.done_criteria,
    risk_tier: task.risk_tier,
    status: task.status,
    updated_at: task.updated_at,
  }));
}

function buildRunsContext(runs: TOrgRun[]) {
  return runs.map((run) => ({
    id: run.id,
    task_id: run.task_id,
    status: run.status,
    workspace: run.workspace,
    conversation_id: run.conversation_id,
    started_at: run.started_at,
    ended_at: run.ended_at,
    updated_at: run.updated_at,
  }));
}

function buildArtifactsContext(artifacts: TOrgArtifact[]) {
  return artifacts.map((artifact) => ({
    id: artifact.id,
    task_id: artifact.task_id,
    run_id: artifact.run_id,
    type: artifact.type,
    title: artifact.title,
    summary: artifact.summary || '',
    content_ref: artifact.content_ref,
    updated_at: artifact.updated_at,
  }));
}

function buildGenomePatchesContext(patches: TOrgGenomePatch[]) {
  return patches.map((patch) => ({
    id: patch.id,
    mutation_target: patch.mutation_target,
    based_on: patch.based_on,
    status: patch.status,
    updated_at: patch.updated_at,
  }));
}

function buildControlStateContext(controlState?: TOrgControlState | null) {
  if (!controlState) {
    return null;
  }

  return {
    id: controlState.id,
    organization_id: controlState.organization_id,
    conversation_id: controlState.conversation_id,
    phase: controlState.phase,
    active_brief_id: controlState.active_brief_id,
    active_plan_id: controlState.active_plan_id,
    needs_human_input: controlState.needs_human_input,
    pending_approval_count: controlState.pending_approval_count,
    last_human_touch_at: controlState.last_human_touch_at,
    updated_at: controlState.updated_at,
  };
}

function buildBriefsContext(briefs: TOrgBrief[]) {
  return briefs.map((brief) => ({
    id: brief.id,
    title: brief.title,
    summary: brief.summary,
    status: brief.status,
    tier1_open_questions: brief.tier1_open_questions,
    tier2_pending_items: brief.tier2_pending_items,
    constraints: brief.constraints,
    risk_notes: brief.risk_notes,
    updated_at: brief.updated_at,
  }));
}

function buildPlanSnapshotsContext(planSnapshots: TOrgPlanSnapshot[]) {
  return planSnapshots.map((snapshot) => ({
    id: snapshot.id,
    brief_id: snapshot.brief_id,
    title: snapshot.title,
    objective: snapshot.objective,
    content: snapshot.content,
    status: snapshot.status,
    approved_by: snapshot.approved_by,
    approved_at: snapshot.approved_at,
    updated_at: snapshot.updated_at,
  }));
}

function buildApprovalsContext(approvals: TOrgApprovalRecord[]) {
  return approvals.map((approval) => ({
    id: approval.id,
    scope: approval.scope,
    status: approval.status,
    target_type: approval.target_type,
    target_id: approval.target_id,
    title: approval.title,
    detail: approval.detail,
    requested_by: approval.requested_by,
    decided_by: approval.decided_by,
    decided_at: approval.decided_at,
    decision_comment: approval.decision_comment,
    updated_at: approval.updated_at,
  }));
}

function buildDashboardContext(params: {
  organization: TOrganization;
  tasks: TOrgTask[];
  runs: TOrgRun[];
  artifacts: TOrgArtifact[];
  memoryCardCount: number;
  evalSpecCount: number;
  skillCount: number;
  genomePatches: TOrgGenomePatch[];
}) {
  const taskStatusCounts: Record<string, number> = {};
  const runStatusCounts: Record<string, number> = {};

  for (const task of params.tasks) {
    taskStatusCounts[task.status] = (taskStatusCounts[task.status] || 0) + 1;
  }

  for (const run of params.runs) {
    runStatusCounts[run.status] = (runStatusCounts[run.status] || 0) + 1;
  }

  return {
    organization_id: params.organization.id,
    organization_name: params.organization.name,
    counts: {
      tasks: params.tasks.length,
      runs: params.runs.length,
      artifacts: params.artifacts.length,
      memory_cards: params.memoryCardCount,
      eval_specs: params.evalSpecCount,
      skills: params.skillCount,
      genome_patches: params.genomePatches.length,
    },
    task_status_counts: taskStatusCounts,
    run_status_counts: runStatusCounts,
    pending_governance: params.genomePatches.filter(
      (patch) => patch.status !== 'adopted' && patch.status !== 'rejected'
    ).length,
    updated_at: Date.now(),
  };
}

function buildControlSchema() {
  return {
    version: 2,
    description: 'Organization control plane operations. Write JSON files to .aionui-org/control/operations/.',
    control_phases: [
      'intake',
      'brainstorming',
      'awaiting_human_decision',
      'drafting_plan',
      'awaiting_plan_approval',
      'dispatching',
      'monitoring',
      'blocked',
    ],
    approval_gates: [
      {
        scope: 'tier1_decision',
        required_before: ['org/task/create', 'org/run/start'],
        description: 'Human-only decisions must be explicitly answered before planning or execution continues.',
      },
      {
        scope: 'tier2_decision',
        required_before: ['org/task/create', 'org/run/start'],
        description: 'Agent may draft proposals, but execution waits for human approval.',
      },
      {
        scope: 'plan_gate',
        required_before: ['org/run/start'],
        description: 'A Run may start only after an approved plan snapshot exists.',
      },
    ],
    request: {
      format: {
        method: 'org/task/create',
        params: {},
      },
    },
    methods: [
      'org/control/brief/update',
      'org/control/plan/update',
      'org/control/state/update',
      'org/task/create',
      'org/task/update',
      'org/run/start',
      'org/approval/request',
      'org/approval/respond',
      'org/artifact/register',
      'org/eval/execute',
      'org/memory/promote',
      'org/evolution/propose',
      'org/governance/approve',
      'org/governance/reject',
    ],
  };
}

function collectOrganizationArtifacts(tasks: TOrgTask[], runs: TOrgRun[]): TOrgArtifact[] {
  const db = getDatabase();
  const artifactMap = new Map<string, TOrgArtifact>();

  for (const run of runs) {
    const result = db.listOrgArtifacts({ run_id: run.id });
    for (const artifact of result.data || []) {
      artifactMap.set(artifact.id, artifact);
    }
  }

  for (const task of tasks) {
    const result = db.listOrgArtifacts({ task_id: task.id });
    for (const artifact of result.data || []) {
      artifactMap.set(artifact.id, artifact);
    }
  }

  return Array.from(artifactMap.values()).sort((a, b) => b.updated_at - a.updated_at);
}

export function getOrganizationContextDir(workspace: string): string {
  return path.join(workspace, AIONUI_ORG_DIR);
}

export function initOrganizationContext(organization: TOrganization): void {
  if (!organization.workspace) {
    console.warn('[OrganizationContext] Cannot init: organization has no workspace');
    return;
  }

  const baseDir = getOrganizationContextDir(organization.workspace);
  ensureDir(path.join(baseDir, 'context'));
  ensureDir(path.join(baseDir, 'control'));
  ensureDir(path.join(baseDir, 'control', 'operations'));
  ensureDir(path.join(baseDir, 'control', 'approvals'));
  ensureDir(path.join(baseDir, 'artifacts'));
  ensureDir(path.join(baseDir, 'memory'));
  ensureDir(path.join(baseDir, 'skills'));
  ensureDir(path.join(baseDir, 'evolution'));

  writeJson(path.join(baseDir, 'control', 'schema.json'), buildControlSchema());
  writeJson(path.join(baseDir, 'context', 'organization.json'), buildOrganizationContext(organization));
}

export function syncOrganizationContext(organizationId: string): void {
  const db = getDatabase();
  const organizationResult = db.getOrganization(organizationId);
  if (!organizationResult.success || !organizationResult.data) {
    console.warn(`[OrganizationContext] Cannot sync: organization ${organizationId} not found`);
    return;
  }

  const organization = organizationResult.data;
  if (!organization.workspace) {
    console.warn('[OrganizationContext] Cannot sync: organization has no workspace');
    return;
  }

  const baseDir = getOrganizationContextDir(organization.workspace);
  ensureDir(path.join(baseDir, 'context'));
  ensureDir(path.join(baseDir, 'control'));
  ensureDir(path.join(baseDir, 'control', 'operations'));
  ensureDir(path.join(baseDir, 'control', 'approvals'));

  const tasks = db.getOrganizationTasks(organizationId).data || [];
  const runs = db.listOrgRuns({ organization_id: organizationId }).data || [];
  const artifacts = collectOrganizationArtifacts(tasks, runs);
  const memoryCards = db.listOrgMemoryCards({ organization_id: organizationId }).data || [];
  const evalSpecs = db.listOrgEvalSpecs({ organization_id: organizationId }).data || [];
  const skills = db.listOrgSkills({ organization_id: organizationId }).data || [];
  const genomePatches = db.listOrgGenomePatches({ organization_id: organizationId }).data || [];
  const controlState = db.getOrgControlState(organizationId).data || null;
  const briefs = db.listOrgBriefs(organizationId).data || [];
  const planSnapshots = db.listOrgPlanSnapshots({ organization_id: organizationId }).data || [];
  const approvals =
    db.listOrgApprovalRecords({ organization_id: organizationId, limit: ALL_APPROVALS_LIMIT }).data || [];

  writeJson(path.join(baseDir, 'context', 'organization.json'), buildOrganizationContext(organization));
  writeJson(path.join(baseDir, 'context', 'tasks.json'), buildTasksContext(tasks));
  writeJson(path.join(baseDir, 'context', 'runs.json'), buildRunsContext(runs));
  writeJson(path.join(baseDir, 'context', 'artifacts.json'), buildArtifactsContext(artifacts));
  writeJson(path.join(baseDir, 'context', 'control_state.json'), buildControlStateContext(controlState));
  writeJson(path.join(baseDir, 'context', 'briefs.json'), buildBriefsContext(briefs));
  writeJson(path.join(baseDir, 'context', 'plan_snapshots.json'), buildPlanSnapshotsContext(planSnapshots));
  writeJson(path.join(baseDir, 'context', 'approvals.json'), buildApprovalsContext(approvals));
  writeJson(path.join(baseDir, 'context', 'memory_cards.json'), memoryCards);
  writeJson(path.join(baseDir, 'context', 'eval_specs.json'), evalSpecs);
  writeJson(path.join(baseDir, 'context', 'skills.json'), skills);
  writeJson(path.join(baseDir, 'context', 'genome_patches.json'), buildGenomePatchesContext(genomePatches));
  writeJson(
    path.join(baseDir, 'context', 'dashboard.json'),
    buildDashboardContext({
      organization,
      tasks,
      runs,
      artifacts,
      memoryCardCount: memoryCards.length,
      evalSpecCount: evalSpecs.length,
      skillCount: skills.length,
      genomePatches,
    })
  );
  writeJson(path.join(baseDir, 'control', 'schema.json'), buildControlSchema());
}

export function generateOrganizationSystemPrompt(organizationId: string): string {
  const db = getDatabase();
  const organizationResult = db.getOrganization(organizationId);
  if (!organizationResult.success || !organizationResult.data) {
    return '';
  }

  const organization = organizationResult.data;
  const tasks = db.getOrganizationTasks(organizationId).data || [];
  const runs = db.listOrgRuns({ organization_id: organizationId }).data || [];
  const genomePatches = db.listOrgGenomePatches({ organization_id: organizationId }).data || [];
  const controlState = db.getOrgControlState(organizationId).data || null;
  const approvals =
    db.listOrgApprovalRecords({ organization_id: organizationId, limit: ALL_APPROVALS_LIMIT }).data || [];
  const contextDir = getOrganizationContextDir(organization.workspace);
  const approvedPlanSnapshot = db.getLatestOrgPlanSnapshot(organizationId, 'approved').data || null;

  return `<SYSTEM_ROLE>
You are the **Organization Control Plane AI** for "${organization.name}".

You are the organization's **coordinator and control-plane director**.
Your job is planning, coordination, governance, and oversight — NOT direct execution.
You must turn goals into approved Task Contract + Run workflows, monitor progress,
review outcomes, and decide whether to refine the plan, request approval, or ask the user for more input.
You are a coordinator, not an executor.
</SYSTEM_ROLE>

<AUTHORITY_TIERS>
All decisions in this organization follow a strict three-tier authority model.
You MUST classify decisions into the correct tier and act accordingly.

**Tier 1 — Human-Only Decisions (you MUST NOT make these)**
You must ask the user directly and wait for their answer:
- Vision, mission, and long-term direction
- Target users and organizational priorities
- Non-negotiable principles and red lines
- Risk tolerance, safety boundaries, and budget ceilings
- Resource commitments and go/no-go release decisions

**Tier 2 — You Draft, Human Approves**
You may analyze and propose, but must wait for explicit human approval before execution:
- Roadmaps, milestone plans, and organization-level sequencing
- Architecture and major technology choices
- Significant interaction, data, and governance strategy
- Changes that are hard to reverse once adopted

**Tier 3 — You Execute Autonomously Through Delegation**
You may proceed without asking, but only through Task Contract + Run delegation:
- Background research and structured analysis
- PRD/spec first drafts and plan decomposition
- Implementation, testing, validation, and documentation
- Low-risk iteration on already approved directions

If uncertain, treat the decision as Tier 2.
</AUTHORITY_TIERS>

<PRIMARY_OBJECTS>
The system revolves around Task Contract, Run, Artifact, MemoryCard, EvalSpec, Skill, and GenomePatch.
Conversation is only an execution channel bound to a Run.
</PRIMARY_OBJECTS>

<COORDINATOR_MODE>
Management-only requests may be answered directly.
Any substantial execution must first become a Task Contract, then be planned, then be delegated through a Run.
The top-level organization agent must not directly implement, edit, debug, or test as if it were the worker.
</COORDINATOR_MODE>

<YOUR_WORKFLOW>
When the user gives you a goal, follow this cycle:

1. **Classify** — Identify Tier 1, Tier 2, and Tier 3 decisions.
   If Tier 1 information is missing, ask clarifying questions first and wait for the human answer.

2. **Brief** — draft or update a brief that records open questions, constraints, pending approvals, and risks.

3. **Plan** — Produce or revise plan snapshots. Tier 2 planning changes require explicit human approval.

4. **Gate** — Check approval gates and control phases before execution.
   Never start a Run until there is an approved plan snapshot and required approvals are satisfied.

5. **Dispatch** — Create a Task Contract, then start a Run for delegated Tier 3 execution.

6. **Monitor** — Review run output, artifacts, evals, memory, and governance signals.
   Decide whether to continue, split more tasks, request new approvals, or return to the user for clarification.
</YOUR_WORKFLOW>

<CONTEXT_FILES>
Read the latest projected state from:
- ${path.join(contextDir, 'context', 'organization.json')}
- ${path.join(contextDir, 'context', 'tasks.json')}
- ${path.join(contextDir, 'context', 'runs.json')}
- ${path.join(contextDir, 'context', 'artifacts.json')}
- ${path.join(contextDir, 'context', 'control_state.json')}
- ${path.join(contextDir, 'context', 'briefs.json')}
- ${path.join(contextDir, 'context', 'plan_snapshots.json')}
- ${path.join(contextDir, 'context', 'approvals.json')}
- ${path.join(contextDir, 'context', 'genome_patches.json')}
- ${path.join(contextDir, 'control', 'schema.json')}
</CONTEXT_FILES>

<CONTROL_PROTOCOL>
Write JSON files into ${path.join(contextDir, 'control', 'operations')} using:
{ "method": "org/task/create", "params": { ... } }

Use governance actions for irreversible changes.
The schema declares approval gates and control phases. Read it before dispatching work.
</CONTROL_PROTOCOL>

<CURRENT_STATE>
Tasks: ${tasks.length}
Runs: ${runs.length}
GenomePatch: ${genomePatches.length}
Current control phase: ${controlState?.phase || 'intake'}
Pending approvals: ${approvals.filter((approval) => approval.status === 'pending').length}
Latest approved plan snapshot: ${approvedPlanSnapshot?.id || 'none'}
</CURRENT_STATE>`;
}

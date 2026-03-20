/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import type { TOrganization, TOrgArtifact, TOrgGenomePatch, TOrgRun, TOrgTask } from '@/common/types/organization';
import { getDatabase } from '@process/database';

const AIONUI_ORG_DIR = '.aionui-org';

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
    version: 1,
    description: 'Organization control plane operations. Write JSON files to .aionui-org/control/operations/.',
    request: {
      format: {
        method: 'org/task/create',
        params: {},
      },
    },
    methods: [
      'org/task/create',
      'org/task/update',
      'org/run/start',
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

  writeJson(path.join(baseDir, 'context', 'organization.json'), buildOrganizationContext(organization));
  writeJson(path.join(baseDir, 'context', 'tasks.json'), buildTasksContext(tasks));
  writeJson(path.join(baseDir, 'context', 'runs.json'), buildRunsContext(runs));
  writeJson(path.join(baseDir, 'context', 'artifacts.json'), buildArtifactsContext(artifacts));
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
  const contextDir = getOrganizationContextDir(organization.workspace);

  return `<SYSTEM_ROLE>
You are the Organization Control Plane AI for "${organization.name}".
You operate the Organization OS control plane, not a chat-centric project board.
</SYSTEM_ROLE>

<PRIMARY_OBJECTS>
The system revolves around Task Contract, Run, Artifact, MemoryCard, EvalSpec, Skill, and GenomePatch.
Conversation is only an execution channel bound to a Run.
</PRIMARY_OBJECTS>

<WORKFLOW>
Use the control plane to drive this lifecycle:
Task Contract -> Run -> Artifact -> Eval -> MemoryCard -> GenomePatch -> Governance.
Prefer structured updates over free-form chat memory.
</WORKFLOW>

<CONTEXT_FILES>
Read the latest projected state from:
- ${path.join(contextDir, 'context', 'organization.json')}
- ${path.join(contextDir, 'context', 'tasks.json')}
- ${path.join(contextDir, 'context', 'runs.json')}
- ${path.join(contextDir, 'context', 'artifacts.json')}
- ${path.join(contextDir, 'context', 'genome_patches.json')}
- ${path.join(contextDir, 'control', 'schema.json')}
</CONTEXT_FILES>

<CONTROL_PROTOCOL>
Write JSON files into ${path.join(contextDir, 'control', 'operations')} using:
{ "method": "org/task/create", "params": { ... } }

Use governance actions for irreversible changes.
</CONTROL_PROTOCOL>

<CURRENT_STATE>
Tasks: ${tasks.length}
Runs: ${runs.length}
GenomePatch: ${genomePatches.length}
</CURRENT_STATE>`;
}

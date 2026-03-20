/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export const TASK_STATUS_VALUES = [
  'draft',
  'ready',
  'scheduled',
  'running',
  'completed',
  'blocked',
  'archived',
] as const;
export type TaskStatus = (typeof TASK_STATUS_VALUES)[number];

export const RUN_STATUS_VALUES = ['created', 'active', 'verifying', 'reviewing', 'closed'] as const;
export type RunStatus = (typeof RUN_STATUS_VALUES)[number];

export const GENOME_PATCH_STATUS_VALUES = ['proposed', 'offline_eval', 'canary', 'adopted', 'rejected'] as const;
export type GenomePatchStatus = (typeof GENOME_PATCH_STATUS_VALUES)[number];

export const MUTATION_TARGET_VALUES = ['skill', 'eval_spec', 'routing_policy', 'task_template'] as const;
export type MutationTarget = (typeof MUTATION_TARGET_VALUES)[number];

export const GOVERNANCE_TARGET_TYPE_VALUES = [
  'organization',
  'task',
  'run',
  'artifact',
  'memory_card',
  'eval_spec',
  'skill',
  'genome_patch',
] as const;
export type GovernanceTargetType = (typeof GOVERNANCE_TARGET_TYPE_VALUES)[number];

export type RiskTier = 'low' | 'normal' | 'high' | 'critical';

export type TTaskBudget = {
  max_runs?: number;
  max_cost_usd?: number;
  max_duration_ms?: number;
  max_tokens?: number;
};

export type TTaskValidator =
  | {
      kind: 'command';
      argv: string[];
      cwd?: string;
      timeout_ms?: number;
    }
  | {
      kind: 'review';
      target: string;
      required_approver?: 'human' | 'organization_ai';
    };

export type TOrganization = {
  id: string;
  name: string;
  description?: string;
  workspace: string;
  user_id: string;
  created_at: number;
  updated_at: number;
};

export type TOrgTask = {
  id: string;
  organization_id: string;
  title: string;
  objective: string;
  scope: string[];
  done_criteria: string[];
  budget: TTaskBudget;
  risk_tier: RiskTier;
  validators: TTaskValidator[];
  deliverable_schema: Record<string, unknown>;
  status: TaskStatus;
  created_at: number;
  updated_at: number;
};

export type TOrgRunWorkspace = {
  mode: 'isolated' | 'shared';
  type?: 'worktree' | 'workspace';
  path?: string;
};

export type TOrgExecutionLog = {
  at: number;
  level: 'info' | 'warn' | 'error';
  message: string;
};

export type TOrgRun = {
  id: string;
  organization_id: string;
  task_id: string;
  status: RunStatus;
  workspace: TOrgRunWorkspace;
  environment: Record<string, unknown>;
  context_policy?: Record<string, unknown>;
  execution?: Record<string, unknown>;
  conversation_id?: string;
  execution_logs?: TOrgExecutionLog[];
  started_at?: number;
  ended_at?: number;
  created_at: number;
  updated_at: number;
};

export type ArtifactType =
  | 'code_diff'
  | 'test_log'
  | 'design_sketch'
  | 'failure_report'
  | 'review_note'
  | 'spec'
  | 'other';

export type TOrgArtifact = {
  id: string;
  organization_id: string;
  task_id: string;
  run_id: string;
  type: ArtifactType;
  title: string;
  summary?: string;
  content_ref?: string;
  metadata?: Record<string, unknown>;
  created_at: number;
  updated_at: number;
};

export type MemoryCardType = 'failure_pattern' | 'decision_record' | 'workflow_hint' | 'knowledge_unit';

export type TOrgMemoryCard = {
  id: string;
  organization_id: string;
  type: MemoryCardType;
  title: string;
  knowledge_unit: string;
  traceability: {
    source_run_ids: string[];
    source_artifact_ids?: string[];
  };
  tags?: string[];
  created_at: number;
  updated_at: number;
};

export type TEvalThresholds = {
  min_pass_rate?: number;
  max_regression_count?: number;
  max_risk_score?: number;
  max_duration_ms?: number;
};

export type TOrgTestCommand = {
  argv: string[];
  cwd?: string;
  timeout_ms?: number;
};

export type TOrgQualityGate = {
  gate: string;
  rule: string;
};

export type TOrgEvalSpec = {
  id: string;
  organization_id: string;
  name: string;
  description?: string;
  test_commands: TOrgTestCommand[];
  quality_gates: TOrgQualityGate[];
  baseline_comparison?: Record<string, unknown>;
  thresholds?: TEvalThresholds;
  created_at: number;
  updated_at: number;
};

export type TOrgSkill = {
  id: string;
  organization_id: string;
  name: string;
  description?: string;
  workflow_unit: string;
  instructions?: string;
  resources?: string[];
  version: number;
  created_at: number;
  updated_at: number;
};

export type TOrgGenomePatch = {
  id: string;
  organization_id: string;
  mutation_target: MutationTarget;
  based_on: string[];
  proposal: Record<string, unknown>;
  status: GenomePatchStatus;
  offline_eval_result?: Record<string, unknown>;
  canary_result?: Record<string, unknown>;
  decision?: {
    approved: boolean;
    approved_by: string;
    reason?: string;
    decided_at: number;
  };
  created_at: number;
  updated_at: number;
};

export type ICreateOrganizationParams = {
  name: string;
  description?: string;
  workspace: string;
};

export type IUpdateOrganizationParams = {
  id: string;
  updates: Partial<Pick<TOrganization, 'name' | 'description' | 'workspace'>>;
};

export type ICreateOrgTaskParams = Omit<TOrgTask, 'id' | 'created_at' | 'updated_at' | 'status'> & {
  status?: TaskStatus;
};

export type IListOrgTaskParams = {
  organization_id: string;
};

export type IUpdateOrgTaskParams = {
  id: string;
  updates: Partial<
    Pick<
      TOrgTask,
      'title' | 'objective' | 'scope' | 'done_criteria' | 'budget' | 'risk_tier' | 'validators' | 'deliverable_schema'
    >
  >;
};

export type IStartOrgRunParams = {
  task_id: string;
  workspace: TOrgRun['workspace'];
  environment: TOrgRun['environment'];
  context_policy?: TOrgRun['context_policy'];
  execution?: TOrgRun['execution'];
};

export type IListOrgRunParams = {
  organization_id?: string;
  task_id?: string;
  status?: RunStatus;
};

export type IUpdateOrgRunParams = {
  id: string;
  updates: Partial<Pick<TOrgRun, 'status' | 'conversation_id' | 'execution_logs' | 'started_at' | 'ended_at'>>;
};

export type ICreateOrgArtifactParams = Omit<TOrgArtifact, 'id' | 'created_at' | 'updated_at'>;

export type IListOrgArtifactParams = {
  run_id?: string;
  task_id?: string;
  type?: ArtifactType;
};

export type ICreateOrgMemoryCardParams = Omit<TOrgMemoryCard, 'id' | 'created_at' | 'updated_at'>;

export type IListOrgMemoryCardParams = {
  organization_id: string;
  type?: MemoryCardType;
};

export type ICreateOrgEvalSpecParams = Omit<TOrgEvalSpec, 'id' | 'created_at' | 'updated_at'>;

export type IListOrgEvalSpecParams = {
  organization_id: string;
};

export type TOrgEvalExecutionResult = {
  task_id: string;
  run_id?: string;
  eval_spec_id?: string;
  passed: boolean;
  score?: number;
  threshold_violations?: string[];
  summary?: string;
};

export type IOrgEvalExecuteParams = {
  task_id: string;
  run_id?: string;
  eval_spec_id?: string;
};

export type ICreateOrgSkillParams = Omit<TOrgSkill, 'id' | 'created_at' | 'updated_at'>;

export type IListOrgSkillParams = {
  organization_id: string;
};

export type ICreateOrgGenomePatchParams = Omit<
  TOrgGenomePatch,
  'id' | 'created_at' | 'updated_at' | 'status' | 'offline_eval_result' | 'canary_result' | 'decision'
> & {
  status?: GenomePatchStatus;
};

export type IListOrgGenomePatchParams = {
  organization_id: string;
  status?: GenomePatchStatus;
};

export type TOrgEvolutionEvaluationResult = {
  id: string;
  status: GenomePatchStatus;
  score?: number;
  summary?: string;
};

export type IOrgEvolutionDecisionParams = {
  id: string;
  approved_by: string;
  reason?: string;
};

export type TOrgGovernancePendingItem = {
  target_type: GovernanceTargetType;
  target_id: string;
  created_at: number;
};

export type TOrgGovernanceAuditLog = {
  id: string;
  action: 'approve' | 'reject';
  actor: string;
  at: number;
  target_type?: GovernanceTargetType;
  target_id?: string;
  detail?: string;
};

export type TOrgGovernanceAuditLogRecord = TOrgGovernanceAuditLog & {
  organization_id: string;
};

export type IOrgGovernanceApproveParams = {
  target_type: GovernanceTargetType;
  target_id: string;
  comment?: string;
};

export type IOrgGovernanceRejectParams = {
  target_type: GovernanceTargetType;
  target_id: string;
  reason: string;
};

export type IOrgGovernanceListPendingParams = {
  organization_id: string;
};

export type IOrgGovernanceGetAuditLogsParams = {
  organization_id: string;
  limit?: number;
};

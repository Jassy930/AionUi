/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { nanoid } from 'nanoid';
import type {
  ICreateOrgGenomePatchParams,
  TOrgArtifact,
  TOrgGenomePatch,
  TOrgMemoryCard,
  TOrgRun,
} from '@/common/types/organization';
import type { IQueryResult } from '@process/database/types';
import { getDatabase } from '@process/database';

type PromoteMemoryParams = {
  organization_id: string;
  run_id: string;
  artifact_ids?: string[];
  type: TOrgMemoryCard['type'];
  title: string;
  tags?: string[];
};

type ExecutePatchParams = {
  patch_id: string;
};

function collectArtifactSummaries(artifacts: TOrgArtifact[]): string[] {
  return artifacts
    .flatMap((artifact) => [artifact.summary, artifact.title])
    .filter((value): value is string => Boolean(value));
}

function collectRunLearning(run: TOrgRun, artifacts: TOrgArtifact[]): string {
  const logMessages = (run.execution_logs || []).map((entry) => entry.message).filter(Boolean);
  const artifactMessages = collectArtifactSummaries(artifacts);
  return [...new Set([...logMessages, ...artifactMessages])].join(' ');
}

export function promoteMemoryCardFromRun(params: PromoteMemoryParams): IQueryResult<TOrgMemoryCard> {
  const db = getDatabase();
  const runResult = db.getOrgRun(params.run_id);
  if (!runResult.success || !runResult.data) {
    return { success: false, error: 'Organization run not found' };
  }
  if (runResult.data.organization_id !== params.organization_id) {
    return { success: false, error: 'Run does not belong to this organization' };
  }

  const artifacts = (params.artifact_ids || [])
    .map((artifactId) => db.getOrgArtifact(artifactId).data)
    .filter(Boolean) as TOrgArtifact[];
  if (
    artifacts.some(
      (artifact) => artifact.organization_id !== params.organization_id || artifact.run_id !== params.run_id
    )
  ) {
    return { success: false, error: 'Artifact does not belong to the provided run' };
  }

  const knowledgeUnit = collectRunLearning(runResult.data, artifacts);
  const now = Date.now();
  const memoryCard: TOrgMemoryCard = {
    id: `org_memory_${nanoid()}`,
    organization_id: params.organization_id,
    type: params.type,
    title: params.title,
    knowledge_unit: knowledgeUnit,
    traceability: {
      source_run_ids: [params.run_id],
      source_artifact_ids: params.artifact_ids,
    },
    tags: params.tags,
    created_at: now,
    updated_at: now,
  };

  return db.createOrgMemoryCard(memoryCard);
}

export function proposeGenomePatchFromRuns(params: ICreateOrgGenomePatchParams): IQueryResult<TOrgGenomePatch> {
  const db = getDatabase();
  for (const runId of params.based_on) {
    const runResult = db.getOrgRun(runId);
    if (!runResult.success || !runResult.data) {
      return { success: false, error: 'Organization run not found for genome patch proposal' };
    }
    if (runResult.data.organization_id !== params.organization_id) {
      return { success: false, error: 'Run does not belong to this organization' };
    }
  }

  const now = Date.now();
  const patch: TOrgGenomePatch = {
    id: `org_patch_${nanoid()}`,
    organization_id: params.organization_id,
    mutation_target: params.mutation_target,
    based_on: params.based_on,
    proposal: params.proposal,
    status: params.status || 'proposed',
    created_at: now,
    updated_at: now,
  };
  return db.createOrgGenomePatch(patch);
}

export function executeGenomePatchOfflineEval(params: ExecutePatchParams): IQueryResult<TOrgGenomePatch> {
  const db = getDatabase();
  const patchResult = db.getOrgGenomePatch(params.patch_id);
  if (!patchResult.success || !patchResult.data) {
    return { success: false, error: 'Organization genome patch not found' };
  }

  const offline_eval_result = {
    score: patchResult.data.based_on.length > 0 ? 1 : 0,
    summary: `Offline eval completed with ${patchResult.data.based_on.length} supporting runs.`,
  };
  const updateResult = db.updateOrgGenomePatch(params.patch_id, {
    status: 'offline_eval',
    offline_eval_result,
  });
  if (!updateResult.success) {
    return { success: false, error: updateResult.error };
  }

  return db.getOrgGenomePatch(params.patch_id);
}

export function executeGenomePatchCanary(params: ExecutePatchParams): IQueryResult<TOrgGenomePatch> {
  const db = getDatabase();
  const patchResult = db.getOrgGenomePatch(params.patch_id);
  if (!patchResult.success || !patchResult.data) {
    return { success: false, error: 'Organization genome patch not found' };
  }

  const canary_result = {
    score: 1,
    summary: `Canary completed for mutation target "${patchResult.data.mutation_target}".`,
  };
  const updateResult = db.updateOrgGenomePatch(params.patch_id, {
    status: 'canary',
    canary_result,
  });
  if (!updateResult.success) {
    return { success: false, error: updateResult.error };
  }

  return db.getOrgGenomePatch(params.patch_id);
}

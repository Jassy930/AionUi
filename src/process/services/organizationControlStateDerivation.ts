/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { OrganizationControlPhase, TOrgApprovalRecord, TOrgBrief } from '@/common/types/organization';

export function hasOrganizationTier1Gap(brief: TOrgBrief | null): boolean {
  if (!brief) {
    return true;
  }

  return brief.status !== 'confirmed' || (brief.tier1_open_questions?.length || 0) > 0;
}

export function deriveOrganizationControlPhase(params: {
  brief: TOrgBrief | null;
  pendingApprovals: TOrgApprovalRecord[];
  activeRunCount: number;
  phase?: OrganizationControlPhase;
}): OrganizationControlPhase {
  if (params.phase) {
    return params.phase;
  }

  if (params.activeRunCount > 0) {
    return 'monitoring';
  }
  if (hasOrganizationTier1Gap(params.brief)) {
    return 'awaiting_human_decision';
  }
  if (params.pendingApprovals.some((approval) => approval.scope === 'plan_gate')) {
    return 'awaiting_plan_approval';
  }
  return 'drafting_plan';
}

export function organizationControlPhaseNeedsHumanInput(phase: OrganizationControlPhase): boolean {
  return phase === 'awaiting_human_decision' || phase === 'awaiting_plan_approval';
}

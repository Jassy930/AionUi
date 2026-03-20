/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Spin } from '@arco-design/web-react';
import { useNavigate, useParams } from 'react-router-dom';
import { ipcBridge } from '@/common';
import type {
  TOrganization,
  TOrgArtifact,
  TOrgEvalSpec,
  TOrgGenomePatch,
  TOrgMemoryCard,
  TOrgRun,
  TOrgSkill,
  TOrgTask,
} from '@/common/types/organization';
import { useLayoutContext } from '@/renderer/context/LayoutContext';
import { useProjectMode } from '@/renderer/context/ProjectModeContext';
import OrganizationConsole from './OrganizationConsole';
import './TaskBoard.css';

const ProjectDetail: React.FC = () => {
  const navigate = useNavigate();
  const { projectId } = useParams<{ projectId: string }>();
  const { enterProjectMode, exitProjectMode } = useProjectMode();
  const layout = useLayoutContext();

  const [organization, setOrganization] = useState<TOrganization | null>(null);
  const [tasks, setTasks] = useState<TOrgTask[]>([]);
  const [runs, setRuns] = useState<TOrgRun[]>([]);
  const [artifacts, setArtifacts] = useState<TOrgArtifact[]>([]);
  const [memoryCards, setMemoryCards] = useState<TOrgMemoryCard[]>([]);
  const [evalSpecs, setEvalSpecs] = useState<TOrgEvalSpec[]>([]);
  const [skills, setSkills] = useState<TOrgSkill[]>([]);
  const [genomePatches, setGenomePatches] = useState<TOrgGenomePatch[]>([]);
  const [pendingGovernanceCount, setPendingGovernanceCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const loadArtifacts = useCallback(async (taskIds: string[], runIds: string[]) => {
    const artifactMap = new Map<string, TOrgArtifact>();

    const [taskArtifacts, runArtifacts] = await Promise.all([
      Promise.all(taskIds.map(async (taskId) => ipcBridge.org.artifact.list.invoke({ task_id: taskId }))),
      Promise.all(runIds.map(async (runId) => ipcBridge.org.artifact.list.invoke({ run_id: runId }))),
    ]);

    for (const result of [...taskArtifacts, ...runArtifacts]) {
      for (const artifact of result.success && result.data ? result.data : []) {
        artifactMap.set(artifact.id, artifact);
      }
    }

    return Array.from(artifactMap.values());
  }, []);

  useEffect(() => {
    const wasSiderCollapsed = layout.siderCollapsed;
    if (!wasSiderCollapsed) {
      layout.setSiderCollapsed(true);
    }
    return () => {
      if (!wasSiderCollapsed) {
        layout.setSiderCollapsed(false);
      }
    };
  }, [layout]);

  useEffect(() => {
    if (!projectId) {
      return;
    }
    enterProjectMode(projectId);
    return () => {
      exitProjectMode();
    };
  }, [enterProjectMode, exitProjectMode, projectId]);

  const loadOrganizationConsole = useCallback(async () => {
    if (!projectId) {
      return;
    }

    try {
      setLoading(true);
      const [
        organizationResult,
        taskResult,
        runResult,
        memoryResult,
        evalResult,
        skillResult,
        evolutionResult,
        governanceResult,
      ] = await Promise.all([
        ipcBridge.org.organization.get.invoke({ id: projectId }),
        ipcBridge.org.task.list.invoke({ organization_id: projectId }),
        ipcBridge.org.run.list.invoke({ organization_id: projectId }),
        ipcBridge.org.memory.list.invoke({ organization_id: projectId }),
        ipcBridge.org.eval.list.invoke({ organization_id: projectId }),
        ipcBridge.org.skill.list.invoke({ organization_id: projectId }),
        ipcBridge.org.evolution.list.invoke({ organization_id: projectId }),
        ipcBridge.org.governance.listPending.invoke({ organization_id: projectId }),
      ]);

      const nextTasks = taskResult.success && taskResult.data ? taskResult.data : [];
      const nextRuns = runResult.success && runResult.data ? runResult.data : [];
      const nextArtifacts = await loadArtifacts(
        nextTasks.map((task) => task.id),
        nextRuns.map((run) => run.id)
      );

      setOrganization(organizationResult.success && organizationResult.data ? organizationResult.data : null);
      setTasks(nextTasks);
      setRuns(nextRuns);
      setArtifacts(nextArtifacts);
      setMemoryCards(memoryResult.success && memoryResult.data ? memoryResult.data : []);
      setEvalSpecs(evalResult.success && evalResult.data ? evalResult.data : []);
      setSkills(skillResult.success && skillResult.data ? skillResult.data : []);
      setGenomePatches(evolutionResult.success && evolutionResult.data ? evolutionResult.data : []);
      setPendingGovernanceCount(governanceResult.success && governanceResult.data ? governanceResult.data.length : 0);
    } catch (error) {
      console.error('Failed to load organization console:', error);
      setOrganization(null);
    } finally {
      setLoading(false);
    }
  }, [loadArtifacts, projectId]);

  useEffect(() => {
    void loadOrganizationConsole();
  }, [loadOrganizationConsole]);

  useEffect(() => {
    const unsubs = [
      ipcBridge.org.organization.updated.on(() => void loadOrganizationConsole()),
      ipcBridge.org.task.created.on(() => void loadOrganizationConsole()),
      ipcBridge.org.task.updated.on(() => void loadOrganizationConsole()),
      ipcBridge.org.task.deleted.on(() => void loadOrganizationConsole()),
      ipcBridge.org.task.statusChanged.on(() => void loadOrganizationConsole()),
      ipcBridge.org.run.created.on(() => void loadOrganizationConsole()),
      ipcBridge.org.run.updated.on(() => void loadOrganizationConsole()),
      ipcBridge.org.run.statusChanged.on(() => void loadOrganizationConsole()),
      ipcBridge.org.run.closed.on(() => void loadOrganizationConsole()),
      ipcBridge.org.artifact.created.on(() => void loadOrganizationConsole()),
      ipcBridge.org.artifact.updated.on(() => void loadOrganizationConsole()),
      ipcBridge.org.artifact.deleted.on(() => void loadOrganizationConsole()),
      ipcBridge.org.memory.promoted.on(() => void loadOrganizationConsole()),
      ipcBridge.org.memory.updated.on(() => void loadOrganizationConsole()),
      ipcBridge.org.memory.deleted.on(() => void loadOrganizationConsole()),
      ipcBridge.org.eval.created.on(() => void loadOrganizationConsole()),
      ipcBridge.org.eval.updated.on(() => void loadOrganizationConsole()),
      ipcBridge.org.eval.deleted.on(() => void loadOrganizationConsole()),
      ipcBridge.org.skill.created.on(() => void loadOrganizationConsole()),
      ipcBridge.org.skill.updated.on(() => void loadOrganizationConsole()),
      ipcBridge.org.skill.deleted.on(() => void loadOrganizationConsole()),
      ipcBridge.org.evolution.proposed.on(() => void loadOrganizationConsole()),
      ipcBridge.org.evolution.statusChanged.on(() => void loadOrganizationConsole()),
      ipcBridge.org.evolution.adopted.on(() => void loadOrganizationConsole()),
      ipcBridge.org.evolution.rejected.on(() => void loadOrganizationConsole()),
    ];

    return () => unsubs.forEach((unsubscribe) => unsubscribe());
  }, [loadOrganizationConsole]);

  if (loading) {
    return (
      <div className='organization-console__loading'>
        <Spin />
      </div>
    );
  }

  if (!organization) {
    return null;
  }

  return (
    <OrganizationConsole
      organization={organization}
      tasks={tasks}
      runs={runs}
      artifacts={artifacts}
      memoryCards={memoryCards}
      evalSpecs={evalSpecs}
      skills={skills}
      genomePatches={genomePatches}
      pendingGovernanceCount={pendingGovernanceCount}
      onBack={() => void navigate('/tasks')}
    />
  );
};

export default ProjectDetail;

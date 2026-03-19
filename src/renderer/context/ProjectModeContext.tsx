/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';

type ProjectModeContextValue = {
  /** Current project ID when in project mode, null otherwise */
  projectId: string | null;
  /** Enter project mode with the given project ID */
  enterProjectMode: (projectId: string) => void;
  /** Exit project mode */
  exitProjectMode: () => void;
  /** Whether we're currently in project mode */
  isProjectMode: boolean;
};

const ProjectModeContext = createContext<ProjectModeContextValue | null>(null);

export const ProjectModeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [projectId, setProjectId] = useState<string | null>(null);

  const enterProjectMode = useCallback((id: string) => {
    setProjectId(id);
  }, []);

  const exitProjectMode = useCallback(() => {
    setProjectId(null);
  }, []);

  const value = useMemo(
    () => ({
      projectId,
      enterProjectMode,
      exitProjectMode,
      isProjectMode: projectId !== null,
    }),
    [projectId, enterProjectMode, exitProjectMode]
  );

  return <ProjectModeContext.Provider value={value}>{children}</ProjectModeContext.Provider>;
};

export const useProjectMode = (): ProjectModeContextValue => {
  const context = useContext(ProjectModeContext);
  if (!context) {
    throw new Error('useProjectMode must be used within a ProjectModeProvider');
  }
  return context;
};

export const useProjectModeOptional = (): ProjectModeContextValue | null => {
  return useContext(ProjectModeContext);
};

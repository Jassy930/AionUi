/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { PropsWithChildren } from 'react';
import React, { createContext, useContext } from 'react';
import type { ViewMode } from '../hooks/useViewMode';
import useViewMode from '../hooks/useViewMode';

/**
 * ViewMode context value interface
 * 视图模式上下文值接口
 */
type ViewModeContextValue = {
  /** Current view mode: 'thread' for conversation-centric, 'task' for task-centric */
  viewMode: ViewMode;
  /** Set view mode with persistence */
  setViewMode: (mode: ViewMode) => Promise<void>;
  /** Check if current mode is task-centric */
  isTaskMode: boolean;
  /** Check if current mode is thread-centric */
  isThreadMode: boolean;
};

const ViewModeContext = createContext<ViewModeContextValue | null>(null);

/**
 * ViewMode provider component
 * 视图模式提供者组件
 */
export const ViewModeProvider: React.FC<PropsWithChildren> = ({ children }) => {
  const [viewMode, setViewMode] = useViewMode();

  const value: ViewModeContextValue = {
    viewMode,
    setViewMode,
    isTaskMode: viewMode === 'task',
    isThreadMode: viewMode === 'thread',
  };

  return <ViewModeContext.Provider value={value}>{children}</ViewModeContext.Provider>;
};

/**
 * Hook to access view mode context
 * 访问视图模式上下文的 Hook
 * @throws {Error} If used outside of ViewModeProvider
 */
export const useViewModeContext = () => {
  const context = useContext(ViewModeContext);
  if (!context) {
    throw new Error('useViewModeContext must be used within ViewModeProvider');
  }
  return context;
};

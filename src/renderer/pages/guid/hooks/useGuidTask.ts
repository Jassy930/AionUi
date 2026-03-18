/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

type UseGuidTaskResult = {
  taskId: string | null;
  setTaskId: (taskId: string | null) => void;
};

/**
 * Hook to manage task selection in Guid page.
 * Reads initial taskId from URL query params and syncs changes back.
 */
export const useGuidTask = (): UseGuidTaskResult => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [taskId, setTaskIdState] = useState<string | null>(() => {
    return searchParams.get('taskId');
  });

  // Sync taskId from URL on mount and when URL changes
  useEffect(() => {
    const urlTaskId = searchParams.get('taskId');
    if (urlTaskId !== taskId) {
      setTaskIdState(urlTaskId);
    }
  }, [searchParams, taskId]);

  // Update both state and URL
  const setTaskId = useCallback(
    (newTaskId: string | null) => {
      setTaskIdState(newTaskId);
      setSearchParams(
        (prev) => {
          if (newTaskId) {
            prev.set('taskId', newTaskId);
          } else {
            prev.delete('taskId');
          }
          return prev;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  return { taskId, setTaskId };
};

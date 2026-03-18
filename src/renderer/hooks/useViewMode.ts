/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ConfigStorage } from '@/common/storage';
import { useCallback, useEffect, useState } from 'react';

export type ViewMode = 'thread' | 'task';

const DEFAULT_VIEW_MODE: ViewMode = 'thread';
const VIEW_MODE_CACHE_KEY = '__aionui_view_mode';

// Initialize view mode immediately when module loads
const initViewMode = async (): Promise<ViewMode> => {
  try {
    const viewMode = (await ConfigStorage.get('viewMode')) as ViewMode | undefined;
    const initialViewMode = viewMode || DEFAULT_VIEW_MODE;
    try {
      localStorage.setItem(VIEW_MODE_CACHE_KEY, initialViewMode);
    } catch (_e) {
      /* noop */
    }
    return initialViewMode;
  } catch (error) {
    console.error('Failed to load initial view mode:', error);
    return DEFAULT_VIEW_MODE;
  }
};

// Run view mode initialization immediately
let initialViewModePromise: Promise<ViewMode> | null = null;
if (typeof window !== 'undefined') {
  initialViewModePromise = initViewMode();
}

const useViewMode = (): [ViewMode, (mode: ViewMode) => Promise<void>] => {
  const [viewMode, setViewModeState] = useState<ViewMode>(() => {
    // Try to read from localStorage for instant initial render
    try {
      const cached = localStorage.getItem(VIEW_MODE_CACHE_KEY);
      if (cached === 'thread' || cached === 'task') {
        return cached;
      }
    } catch (_e) {
      /* noop */
    }
    return DEFAULT_VIEW_MODE;
  });

  // Set view mode with persistence
  const setViewMode = useCallback(
    async (newMode: ViewMode) => {
      try {
        setViewModeState(newMode);
        try {
          localStorage.setItem(VIEW_MODE_CACHE_KEY, newMode);
        } catch (_e) {
          /* noop */
        }
        await ConfigStorage.set('viewMode', newMode);
      } catch (error) {
        console.error('Failed to save view mode:', error);
        // Revert on error
        setViewModeState(viewMode);
        try {
          localStorage.setItem(VIEW_MODE_CACHE_KEY, viewMode);
        } catch (_e) {
          /* noop */
        }
      }
    },
    [viewMode]
  );

  // Initialize view mode state from the early initialization
  useEffect(() => {
    if (initialViewModePromise) {
      initialViewModePromise
        .then((initialViewMode) => {
          setViewModeState(initialViewMode);
        })
        .catch((error) => {
          console.error('Failed to initialize view mode:', error);
        });
    }
  }, []);

  return [viewMode, setViewMode];
};

export default useViewMode;

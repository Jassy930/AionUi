/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

describe('devStartPreflight', () => {
  it('resolves shared node_modules from git common dir when running inside a worktree', async () => {
    const { resolveSharedNodeModulesDir } = await import('../../scripts/devStartPreflight.js');

    const sharedNodeModulesDir = resolveSharedNodeModulesDir({
      cwd: '/repo/.worktrees/feature-1',
      gitCommonDir: '/repo/.git',
      localNodeModulesDir: '/repo/.worktrees/feature-1/node_modules',
      pathExists: (target) => target === '/repo/node_modules',
    });

    expect(sharedNodeModulesDir).toBe('/repo/node_modules');
  });

  it('treats cache-only local node_modules as bootstrap candidates', async () => {
    const { shouldBootstrapLocalNodeModules } = await import('../../scripts/devStartPreflight.js');

    expect(shouldBootstrapLocalNodeModules(['.vite'])).toBe(true);
    expect(shouldBootstrapLocalNodeModules(['.vite', '.cache'])).toBe(true);
    expect(shouldBootstrapLocalNodeModules(['better-sqlite3'])).toBe(false);
  });

  it('runs Electron native checks in run-as-node mode', async () => {
    const { buildElectronCheckEnv } = await import('../../scripts/devStartPreflight.js');

    expect(buildElectronCheckEnv({ FOO: 'bar' })).toMatchObject({
      FOO: 'bar',
      ELECTRON_RUN_AS_NODE: '1',
    });
  });
});

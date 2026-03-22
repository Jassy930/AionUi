/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import fs from 'fs';

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

  it('rebuilds electron native modules when the compatibility check fails even if stamp exists', async () => {
    const { ensureElectronNativeModules } = await import('../../scripts/devStartPreflight.js');

    const rebuildCommands: string[] = [];
    const writtenStamps: string[] = [];

    const result = ensureElectronNativeModules('/repo', '/repo/node_modules', {
      getElectronVersionImpl: () => '37.3.1',
      pathExists: (target: string) => target === '/repo/node_modules/.aionui-electron-37.3.1-darwin-arm64.stamp',
      canUseBetterSqliteInElectronImpl: () => false,
      execSyncImpl: (command: string) => {
        rebuildCommands.push(command);
      },
      writeFileImpl: (target: string) => {
        writtenStamps.push(target);
      },
    });

    expect(result).toMatchObject({ rebuilt: true, checked: true });
    expect(rebuildCommands).toEqual([
      '/repo/node_modules/.bin/electron-rebuild -f -w better-sqlite3,keytar,node-pty,tree-sitter-bash',
    ]);
    expect(writtenStamps).toEqual(['/repo/node_modules/.aionui-electron-37.3.1-darwin-arm64.stamp']);
  });

  it('skips rebuild when stamp exists and electron compatibility check passes', async () => {
    const { ensureElectronNativeModules } = await import('../../scripts/devStartPreflight.js');

    const result = ensureElectronNativeModules('/repo', '/repo/node_modules', {
      getElectronVersionImpl: () => '37.3.1',
      pathExists: () => true,
      canUseBetterSqliteInElectronImpl: () => true,
      execSyncImpl: () => {
        throw new Error('should not rebuild');
      },
      writeFileImpl: () => {
        throw new Error('should not rewrite stamp');
      },
    });

    expect(result).toMatchObject({ rebuilt: false, checked: true });
  });

  it('kills a stale electron-vite dev process from the same workspace before start', async () => {
    const { ensureRendererDevPortAvailable } = await import('../../scripts/devStartPreflight.js');

    const killedPids: number[] = [];

    const result = ensureRendererDevPortAvailable('/repo/app', {
      getListeningPidImpl: () => 3348,
      getProcessCommandImpl: () => 'node /repo/app/node_modules/.bin/electron-vite dev',
      killProcessImpl: (pid: number) => {
        killedPids.push(pid);
      },
    });

    expect(result).toEqual({
      portFreed: true,
      portInUse: true,
      staleProcessKilled: true,
    });
    expect(killedPids).toEqual([3348]);
  });

  it('throws a clear error when renderer dev port is occupied by another process', async () => {
    const { ensureRendererDevPortAvailable } = await import('../../scripts/devStartPreflight.js');

    expect(() =>
      ensureRendererDevPortAvailable('/repo/app', {
        getListeningPidImpl: () => 7788,
        getProcessCommandImpl: () => 'node /tmp/other-project/node_modules/.bin/vite',
        killProcessImpl: () => {
          throw new Error('should not kill unrelated process');
        },
      })
    ).toThrowError(/Port 5173 is already in use by PID 7788/);
  });

  it('prefers the installed electron package version over the semver range in package json', async () => {
    const originalReadFileSync = fs.readFileSync;

    try {
      fs.readFileSync = ((target: fs.PathOrFileDescriptor) => {
        const normalized = String(target);
        if (normalized.endsWith('/node_modules/electron/package.json')) {
          return JSON.stringify({ version: '37.10.3' });
        }
        if (normalized.endsWith('/package.json')) {
          return JSON.stringify({ devDependencies: { electron: '^37.3.1' } });
        }
        return originalReadFileSync(target, 'utf8');
      }) as typeof fs.readFileSync;

      const { getElectronVersion } = await import('../../scripts/devStartPreflight.js');
      expect(getElectronVersion('/repo')).toBe('37.10.3');
    } finally {
      fs.readFileSync = originalReadFileSync;
    }
  });
});

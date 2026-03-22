/**
 * Dev start preflight for worktree and Electron native module compatibility.
 */

const { execFileSync, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BOOTSTRAP_CACHE_DIRS = new Set(['.vite', '.cache']);
const RENDERER_DEV_PORT = 5173;
const ELECTRON_REBUILD_MODULES = ['better-sqlite3', 'keytar', 'node-pty', 'tree-sitter-bash'];
const BETTER_SQLITE3_ELECTRON_CHECK = [
  '-e',
  "const Database=require('better-sqlite3'); const db=new Database(':memory:'); db.close();",
];

function shouldBootstrapLocalNodeModules(entries) {
  const remainingEntries = entries.filter((entry) => !BOOTSTRAP_CACHE_DIRS.has(entry));
  return remainingEntries.length === 0;
}

function resolveSharedNodeModulesDir({ cwd, gitCommonDir, localNodeModulesDir, pathExists = fs.existsSync }) {
  if (!gitCommonDir) {
    return null;
  }

  const resolvedGitCommonDir = path.isAbsolute(gitCommonDir) ? gitCommonDir : path.resolve(cwd, gitCommonDir);
  const repoRoot = path.dirname(resolvedGitCommonDir);
  const sharedNodeModulesDir = path.join(repoRoot, 'node_modules');

  if (path.resolve(sharedNodeModulesDir) === path.resolve(localNodeModulesDir)) {
    return null;
  }

  return pathExists(sharedNodeModulesDir) ? sharedNodeModulesDir : null;
}

function getGitCommonDir(cwd) {
  try {
    return execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function readNodeModulesEntries(nodeModulesDir) {
  try {
    return fs.readdirSync(nodeModulesDir);
  } catch {
    return [];
  }
}

function ensureSharedNodeModules(cwd) {
  const localNodeModulesDir = path.join(cwd, 'node_modules');
  const sharedNodeModulesDir = resolveSharedNodeModulesDir({
    cwd,
    gitCommonDir: getGitCommonDir(cwd),
    localNodeModulesDir,
  });

  if (!sharedNodeModulesDir) {
    return { bootstrapped: false, nodeModulesDir: localNodeModulesDir };
  }

  const localEntries = readNodeModulesEntries(localNodeModulesDir);
  if (!shouldBootstrapLocalNodeModules(localEntries)) {
    return { bootstrapped: false, nodeModulesDir: localNodeModulesDir };
  }

  if (fs.existsSync(localNodeModulesDir)) {
    fs.rmSync(localNodeModulesDir, { recursive: true, force: true });
  }

  fs.symlinkSync(sharedNodeModulesDir, localNodeModulesDir, process.platform === 'win32' ? 'junction' : 'dir');
  return { bootstrapped: true, nodeModulesDir: localNodeModulesDir };
}

function getElectronBinary(nodeModulesDir) {
  return path.join(nodeModulesDir, '.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron');
}

function getElectronRebuildBinary(nodeModulesDir) {
  return path.join(nodeModulesDir, '.bin', process.platform === 'win32' ? 'electron-rebuild.cmd' : 'electron-rebuild');
}

function buildElectronCheckEnv(baseEnv = process.env) {
  return {
    ...baseEnv,
    ELECTRON_RUN_AS_NODE: '1',
  };
}

function getElectronVersion(cwd) {
  const installedElectronPackagePath = path.join(cwd, 'node_modules', 'electron', 'package.json');
  try {
    const installedElectronPackageJson = JSON.parse(fs.readFileSync(installedElectronPackagePath, 'utf8'));
    if (installedElectronPackageJson.version) {
      return String(installedElectronPackageJson.version);
    }
  } catch {
    // Fall back to package.json semver range when the installed Electron package is unavailable.
  }

  const packageJson = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
  return String(packageJson.devDependencies.electron || '').replace(/^[~^]/, '');
}

function getNativeModulesStampPath(nodeModulesDir, electronVersion) {
  return path.join(nodeModulesDir, `.aionui-electron-${electronVersion}-${process.platform}-${process.arch}.stamp`);
}

function canUseBetterSqliteInElectron(cwd, nodeModulesDir, execFileSyncImpl = execFileSync) {
  try {
    execFileSyncImpl(getElectronBinary(nodeModulesDir), BETTER_SQLITE3_ELECTRON_CHECK, {
      cwd,
      stdio: ['ignore', 'ignore', 'ignore'],
      env: buildElectronCheckEnv(process.env),
    });
    return true;
  } catch {
    return false;
  }
}

function buildElectronRebuildCommand(nodeModulesDir) {
  return `${getElectronRebuildBinary(nodeModulesDir)} -f -w ${ELECTRON_REBUILD_MODULES.join(',')}`;
}

function ensureElectronNativeModules(cwd, nodeModulesDir, options = {}) {
  const {
    canUseBetterSqliteInElectronImpl = canUseBetterSqliteInElectron,
    execSyncImpl = execSync,
    getElectronVersionImpl = getElectronVersion,
    pathExists = fs.existsSync,
    writeFileImpl = fs.writeFileSync,
  } = options;

  const electronVersion = getElectronVersionImpl(cwd);
  const stampPath = getNativeModulesStampPath(nodeModulesDir, electronVersion);

  if (pathExists(stampPath) && canUseBetterSqliteInElectronImpl(cwd, nodeModulesDir)) {
    return { rebuilt: false, checked: true };
  }

  console.warn('[dev-start-preflight] Preparing Electron native modules...');
  execSyncImpl(buildElectronRebuildCommand(nodeModulesDir), {
    cwd,
    stdio: 'inherit',
  });
  writeFileImpl(stampPath, `${Date.now()}\n`, 'utf8');
  return { rebuilt: true, checked: true };
}

function ensureStreamdownEntry(nodeModulesDir) {
  const streamdownEntry = path.join(nodeModulesDir, 'streamdown', 'dist', 'index.js');
  if (!fs.existsSync(streamdownEntry)) {
    throw new Error(`Missing streamdown entry: ${streamdownEntry}`);
  }
}

function getListeningPidOnPort(port, execFileSyncImpl = execFileSync) {
  try {
    const output = execFileSyncImpl('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();

    if (!output) {
      return null;
    }

    const pid = Number.parseInt(output.split(/\s+/)[0], 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

function getProcessCommand(pid, execFileSyncImpl = execFileSync) {
  try {
    return execFileSyncImpl('ps', ['-p', String(pid), '-o', 'command='], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function isStaleElectronViteDevProcess(cwd, command) {
  if (!command) {
    return false;
  }

  const normalizedCwd = path.resolve(cwd);
  const expectedPath = path.join(normalizedCwd, 'node_modules', '.bin', 'electron-vite');
  return command.includes(expectedPath) && command.includes('electron-vite dev');
}

function ensureRendererDevPortAvailable(cwd, options = {}) {
  const {
    port = RENDERER_DEV_PORT,
    getListeningPidImpl = getListeningPidOnPort,
    getProcessCommandImpl = getProcessCommand,
    killProcessImpl = process.kill,
  } = options;

  const pid = getListeningPidImpl(port);
  if (!pid) {
    return { portInUse: false, staleProcessKilled: false, portFreed: false };
  }

  const command = getProcessCommandImpl(pid);
  if (isStaleElectronViteDevProcess(cwd, command)) {
    killProcessImpl(pid, 'SIGTERM');
    return { portInUse: true, staleProcessKilled: true, portFreed: true };
  }

  throw new Error(`Port ${port} is already in use by PID ${pid}. Close the existing dev server and retry.`);
}

function runDevStartPreflight(cwd = process.cwd()) {
  const { bootstrapped, nodeModulesDir } = ensureSharedNodeModules(cwd);
  ensureStreamdownEntry(nodeModulesDir);
  ensureRendererDevPortAvailable(cwd);
  const nativeStatus = ensureElectronNativeModules(cwd, nodeModulesDir);

  if (bootstrapped) {
    console.log(`[dev-start-preflight] Reused shared node_modules at ${nodeModulesDir}`);
  }
  if (nativeStatus.rebuilt) {
    console.log('[dev-start-preflight] Rebuilt Electron native modules');
  }
}

if (require.main === module) {
  runDevStartPreflight();
}

module.exports = {
  buildElectronCheckEnv,
  buildElectronRebuildCommand,
  canUseBetterSqliteInElectron,
  ensureElectronNativeModules,
  ensureRendererDevPortAvailable,
  getElectronVersion,
  getListeningPidOnPort,
  getProcessCommand,
  isStaleElectronViteDevProcess,
  resolveSharedNodeModulesDir,
  runDevStartPreflight,
  shouldBootstrapLocalNodeModules,
};

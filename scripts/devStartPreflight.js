/**
 * Dev start preflight for worktree and Electron native module compatibility.
 */

const { execFileSync, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BOOTSTRAP_CACHE_DIRS = new Set(['.vite', '.cache']);
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

function buildElectronCheckEnv(baseEnv = process.env) {
  return {
    ...baseEnv,
    ELECTRON_RUN_AS_NODE: '1',
  };
}

function getElectronVersion(cwd) {
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
  execSyncImpl('bun x electron-builder install-app-deps', {
    cwd,
    stdio: 'inherit',
    env: {
      ...process.env,
      npm_config_build_from_source: 'true',
    },
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

function runDevStartPreflight(cwd = process.cwd()) {
  const { bootstrapped, nodeModulesDir } = ensureSharedNodeModules(cwd);
  ensureStreamdownEntry(nodeModulesDir);
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
  canUseBetterSqliteInElectron,
  ensureElectronNativeModules,
  resolveSharedNodeModulesDir,
  runDevStartPreflight,
  shouldBootstrapLocalNodeModules,
};

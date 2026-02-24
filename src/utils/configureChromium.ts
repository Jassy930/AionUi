/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { app } from 'electron';
import { spawnSync } from 'child_process';

// Configure Chromium command-line flags for WebUI and CLI modes
// 为 WebUI 和 CLI 模式配置 Chromium 命令行参数

// Check if X display is actually connectable (auth + socket test via xdpyinfo).
// Returns true if X is usable; if xdpyinfo is not installed, assumes accessible.
// This catches xrdp + Wayland sessions where DISPLAY points to XWayland but
// the auth cookie (MIT-MAGIC-COOKIE) is inaccessible from the xrdp session.
function isXDisplayConnectable(): boolean {
  if (!process.env.DISPLAY) return false;
  const result = spawnSync('xdpyinfo', { timeout: 2000, stdio: 'pipe', env: process.env });
  if (result.error && (result.error as NodeJS.ErrnoException).code === 'ENOENT') return true;
  return result.status === 0;
}

// All Linux: prevent GPU sandbox init failure (error_code=1002) on VMs, containers, and
// systems with restricted namespaces — applies regardless of display server availability
// --no-zygote: disable Zygote PID namespace to fix ESRCH shared memory errors
//   (Zygote uses clone(CLONE_NEWPID) which causes cross-namespace /tmp IPC failures)
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('disable-dev-shm-usage');
  app.commandLine.appendSwitch('no-zygote');
}

const isLinuxWayland = process.platform === 'linux' && !!process.env.WAYLAND_DISPLAY;

// No usable display if DISPLAY is absent or X connection fails (auth error, broken socket, etc.)
// Covers: headless server (no DISPLAY), xrdp with broken XWayland auth (DISPLAY set but xcb fails),
// and xrdp+Wayland sessions that don't expose WAYLAND_DISPLAY to the xrdp client.
export const isLinuxNoDisplay = process.platform === 'linux' && (!process.env.DISPLAY || !isXDisplayConnectable());

// Linux no-display: enable headless mode to prevent segfault when no display server is present
// Linux 无显示时启用 headless 防止段错误崩溃
if (isLinuxNoDisplay) {
  app.commandLine.appendSwitch('headless');
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-software-rasterizer');
}

// Linux Wayland (local desktop only, skip when going headless):
// Force X11/XWayland to avoid Electron-Wayland compatibility issues on GNOME + Wayland
if (isLinuxWayland && !isLinuxNoDisplay) {
  app.commandLine.appendSwitch('ozone-platform', 'x11');
  // disable hardware GPU as remote Wayland sessions (e.g. xrdp) lack hardware EGL support
  app.commandLine.appendSwitch('disable-gpu');
}

// For WebUI and --resetpass modes: disable sandbox for root user
// 仅 WebUI 和重置密码模式：root 用户禁用沙箱
const isWebUI = process.argv.some((arg) => arg === '--webui');
const isResetPassword = process.argv.includes('--resetpass');
if (isWebUI || isResetPassword) {
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    app.commandLine.appendSwitch('no-sandbox');
  }
}

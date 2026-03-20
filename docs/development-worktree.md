# Worktree 开发启动说明

## 背景

在 git worktree 中开发时，当前工作树目录下通常没有完整的 `node_modules`，而 Electron 开发启动又依赖：

- renderer 侧能解析 `streamdown`
- main process 能加载与当前 Electron ABI 匹配的 `better-sqlite3`

因此直接执行 `bun run start` 时，可能出现依赖缺失或 native module ABI 不匹配。

## 当前行为

`bun run start`、`bun run cli`、`bun run webui` 等开发脚本现在会先执行：

```bash
bun run dev:prepare
```

该预检会完成两件事：

1. 如果当前 worktree 的 `node_modules` 只有缓存目录，会自动复用主仓库的共享 `node_modules`
2. 第一次进入当前依赖目录时，会执行 `electron-builder install-app-deps`，重建 Electron 所需的 native modules

## 常见问题

### 1. 5173 端口占用

如果看到：

```text
Port 5173 is already in use
```

说明已有旧的开发实例未退出。关闭旧的 `electron-vite dev` / Electron 进程后再重试即可。

### 2. 首次启动较慢

如果预检触发 native rebuild，第一次启动会明显变慢，这是正常现象。后续同一套依赖目录会复用 stamp，不会重复重建。

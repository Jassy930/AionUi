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
2. 第一次进入当前依赖目录时，会执行 `electron-rebuild`，重建 Electron 所需的 native modules
3. 即使 stamp 已存在，也会额外探测 Electron 是否还能实际加载 `better-sqlite3`；如果 ABI 已失配，会自动重新触发 rebuild

当前版本额外做了两件事：

4. 如果 `5173` 被当前仓库残留的 `electron-vite dev` 旧进程占用，预检会先清理该残留进程，避免 `bun run start` 直接因端口冲突失败
5. native rebuild 现在改为直接调用 `electron-rebuild`，确保 `better-sqlite3` 等模块真正按 Electron ABI 重建，而不是停留在当前 Node ABI

## 常见问题

### 1. 5173 端口占用

如果看到：

```text
Port 5173 is already in use
```

说明已有旧的开发实例未退出。

- 如果占用者是当前仓库残留的 `electron-vite dev`，预检会自动清理
- 如果占用者是其他无关进程，启动会提前报错并提示对应 PID，此时需要手动关闭占用者后再重试

### 2. 首次启动较慢

如果预检触发 native rebuild，第一次启动会明显变慢，这是正常现象。后续同一套依赖目录会复用 stamp，不会重复重建。

### 3. Node 单测与 Electron 启动的 ABI 切换

当前本地环境下，`better-sqlite3` 的 Node ABI 与 Electron ABI 可能不同：

- `bun run start` 会优先确保 Electron 可启动，必要时通过 `electron-rebuild` 重建为 Electron 所需 ABI
- 如果随后要跑依赖 `better-sqlite3` 的 Node 单测，可能需要在 `node_modules/better-sqlite3` 下重新执行一次：

```bash
bun run install
```

如果只是跑前端 DOM 测试或继续调试 Electron，本步骤通常不需要执行。

### 4. 点击懒加载页面或侧栏后白屏

如果 Electron 主窗口已经打开，但点击 `Project` 等懒加载页面，或者切换到会触发侧栏懒加载的界面后出现白屏，并在控制台看到类似下面的日志：

```text
[vite] server connection lost. Polling for restart...
Failed to fetch dynamically imported module
```

这通常不是页面业务逻辑直接崩溃，而是 renderer dev server `http://localhost:5173` 在懒加载模块请求时暂时不可用。常见触发点包括：

- 路由页面懒加载
- 左侧侧栏中的懒加载模块，例如 `WorkspaceGroupedHistory`

当前版本已经为这些懒加载入口补上错误边界：

- 不再直接白屏
- 会展示错误信息和“重新加载”按钮
- 当 dev server 恢复后，点击“重新加载”即可重新获取对应模块

如果仍频繁出现该问题，优先检查：

1. 启动 `bun run start` 的终端会话是否被中断
2. `5173` 端口上的 `electron-vite dev` 是否仍在运行
3. 是否存在导致 Vite 重启或退出的本地环境问题

### 5. 调试优先级

以后遇到下面这些问题时，优先使用 CDP 调试，而不是先猜测业务代码：

- Electron renderer 白屏
- 路由懒加载失败
- 侧栏或局部懒加载模块失败
- 只在运行态出现、单测不容易直接复现的前端异常

当前项目开发态默认会启用 Electron 的 CDP 远程调试端口，启动日志中会打印类似：

```text
[CDP] Remote debugging port: 9230
[CDP] DevTools URL: http://127.0.0.1:9230
```

推荐的排查顺序是：

1. 先通过 `http://127.0.0.1:<port>/json/version` 和 `/json/list` 确认 CDP target 是否存在
2. 再通过 target 的 `webSocketDebuggerUrl` 读取 `location.href`、`document.body.innerText`、`#root` 渲染状态
3. 订阅 `Runtime.exceptionThrown`、`Runtime.consoleAPICalled`、`Network.loadingFailed`，定位是模块导入失败、运行时异常，还是 dev server 断连
4. 只有在 CDP 已确认具体异常来源后，再回到源码做修复

本次 `Project` 白屏问题就是通过 CDP 继续下钻后确认：真正失败的是侧栏中的 `WorkspaceGroupedHistory` 懒加载，而不是 `Project` 页面主体本身。

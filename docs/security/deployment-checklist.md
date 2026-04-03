# 安全部署检查清单

本文档为 AionUi 生产部署的安全检查清单，覆盖 HTTPS、防火墙、凭证安全等关键配置。

## 传输层安全

- [ ] HTTPS/TLS 已启用（WebUI 仅通过 HTTPS 提供服务）
- [ ] TLS 证书有效且未过期
- [ ] 已禁用 TLS 1.0/1.1，仅允许 TLS 1.2+
- [ ] HTTP 请求自动重定向到 HTTPS

## 凭证与密钥管理

- [ ] 所有 Bot Token（Telegram / Lark / DingTalk）通过 Electron safeStorage 加密存储
- [ ] 数据库文件权限限制为应用用户（`chmod 600`）
- [ ] JWT 密钥使用随机生成的强密钥
- [ ] Cookie 签名密钥使用随机生成的强密钥（非硬编码）
- [ ] `.env` 文件不包含在版本控制中

## 网络与防火墙

- [ ] WebUI 端口仅对需要访问的网络开放
- [ ] WebSocket 端口与 HTTP 端口相同（无需额外开放）
- [ ] 不需要的端口已关闭
- [ ] 如使用反向代理，已正确配置 `X-Forwarded-For` 信任策略

## 内容安全策略

- [ ] CSP 已启用 nonce-based `script-src`（无 `unsafe-inline`）
- [ ] CORS 仅允许已知来源（拒绝 `origin: null`）
- [ ] Webview 已启用 `contextIsolation`
- [ ] 导航守卫已配置（`will-navigate` + `setWindowOpenHandler`）
- [ ] `aion-asset://` 协议限制路径白名单

## 认证与授权

- [ ] 登录端点限流已启用（5 次/15 分钟）
- [ ] API 端点限流已启用（60 次/分钟）
- [ ] 密码使用 bcrypt 哈希存储
- [ ] 会话超时已配置

## 数据库安全

- [ ] 所有 SQL 查询使用参数化绑定（无字符串拼接）
- [ ] ORDER BY 子句使用白名单验证
- [ ] 数据库文件位于应用数据目录，非公开路径
- [ ] WAL 模式已启用（性能 + 并发安全）

## 依赖安全

- [ ] CI 使用 `--frozen-lockfile` 确保可重现构建
- [ ] Dependabot 已启用自动依赖更新
- [ ] `npm audit` 已集成到 CI 流程
- [ ] 无已知高危漏洞的依赖

## Electron 安全

- [ ] `nodeIntegration` 已禁用（renderer 进程）
- [ ] `contextIsolation` 已启用
- [ ] `sandbox` 已启用
- [ ] 不使用 `eval()` 或 `new Function()`
- [ ] 自定义协议注册使用 `protocol.handle`（非 deprecated API）

## 监控与日志

- [ ] 错误日志不包含敏感信息（Token、密码等）
- [ ] 登录失败事件有日志记录
- [ ] 限流触发事件有日志记录

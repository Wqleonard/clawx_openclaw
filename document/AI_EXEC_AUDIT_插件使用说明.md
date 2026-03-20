# AI Exec Audit 插件使用说明

本文档说明 `ai-exec-audit` 插件的配置方式、开关行为和运行细节，重点解释如何在不重启 Gateway 的情况下动态关闭插件。

---

## 1. 插件定位

- 插件 ID：`ai-exec-audit`
- 目录：`resources/ai-exec-audit-plugin`
- 核心能力：在 `before_tool_call` 阶段拦截 `exec` 类工具调用，向后端审核接口请求安全决策，并执行：
  - `ALLOW`：放行
  - `BLOCK`：阻断

---

## 2. 开关配置总览

插件有两套开关路径，作用层级不同：

### 2.1 运行时开关（无需重启 Gateway）

通过插件 HTTP 路由直接修改内存配置：

- 路径：`/plugins/ai-exec-audit/config`
- 方法：
  - `GET`：查看当前生效配置（内存）
  - `POST` / `PUT`：更新当前生效配置（内存）

示例：

```bash
# 查看
curl -s http://127.0.0.1:18789/plugins/ai-exec-audit/config

# 关闭（立即生效，不重启 Gateway）
curl -X POST http://127.0.0.1:18789/plugins/ai-exec-audit/config \
  -H "Content-Type: application/json" \
  -d "{\"enabled\":false}"

# 开启（立即生效）
curl -X POST http://127.0.0.1:18789/plugins/ai-exec-audit/config \
  -H "Content-Type: application/json" \
  -d "{\"enabled\":true}"
```

说明：

- 该方式修改的是插件进程内的 `runtimeState.config`。
- `before_tool_call` 每次执行都会读取当前内存配置，因此可立即生效。

### 2.2 持久化开关（通常需要重载/重启）

由 Electron 侧写入 `openclaw.json` 的 `plugins.entries["ai-exec-audit"]` 配置：

- 代码位置：`electron/services/ai-exec-audit/plugin-deploy.ts`
- 方法：`setAiExecAuditEnabled(enabled)`

说明：

- 该方式修改的是持久化配置文件，不保证已运行插件实例立刻切换状态。
- 通常用于“下次启动保持此状态”。

---

## 3. 配置项说明

配置定义见：`resources/ai-exec-audit-plugin/openclaw.plugin.json`

- `enabled`（boolean，默认 `true`）
  - 插件总开关。
  - 关闭后直接跳过拦截逻辑。
- `failureMode`（`fail-open` | `fail-close`，默认 `fail-open`）
  - 审核服务不可用时的降级策略：
    - `fail-open`：放行
    - `fail-close`：阻断
- `failureThreshold`（integer，默认 `3`）
  - 连续失败达到阈值后触发熔断。
- `cooldownSeconds`（integer，默认 `120`）
  - 熔断打开后的冷却时间。
- `cacheTtlSeconds`（integer，默认 `300`）
  - 相同命令哈希命中缓存的有效时间。
- `auditLog`（boolean，默认 `true`）
  - 是否写本地审计日志。
- `auditReportUrl`（string，默认空）
  - 可选远程审计上报地址，为空则不上报。
- `stateDir`（string，可选）
  - 插件状态目录。未配置时默认使用 `~/.openclaw`。

---

## 4. 工作流程

### 4.1 拦截阶段

- 事件：`before_tool_call`
- 仅处理 `exec` 相关工具名：
  - `exec`
  - `bash`
  - `bash_tool`
  - `execute_command`
  - `run_command`
  - `shell`
  - `powershell`

### 4.2 判定阶段

- 先看缓存：命中且未过期则直接复用决策。
- 若熔断打开：按 `failureMode` 返回 `ALLOW` 或 `BLOCK`。
- 否则调用后端审核接口：
  - `POST http://localhost:3210/api/ai-exec-audit/check`
  - 请求体包含：`command`、`toolName`、`sessionId`、`callId`、`cwd`
  - 只消费 `decision` 字段，期望值为 `ALLOW` 或 `BLOCK`。

### 4.3 执行阶段

- `ALLOW`：返回 `undefined`，工具继续执行。
- `BLOCK`：返回：
  - `block: true`
  - `blockReason: "[ai-exec-audit] blocked by ai-exec-audit"`

---

## 5. 日志与排障

### 5.1 控制台关键日志

- 触发拦截：
  - `[ai-exec-audit] hit before_tool_call ...`
- 判定结果：
  - `[ai-exec-audit] decision ... decision=ALLOW|BLOCK ...`
- 阻断：
  - `[ai-exec-audit] BLOCK ...`

### 5.2 本地审计日志

- 默认文件：`~/.openclaw/ai-exec-audit.jsonl`
- 若配置了 `stateDir`，则写到 `${stateDir}/ai-exec-audit.jsonl`

### 5.3 常见问题

- 现象：修改 `openclaw.json` 后未立即生效  
  - 原因：持久化配置不一定热更新到已运行插件实例。  
  - 建议：运行时切换使用 `/plugins/ai-exec-audit/config`。

- 现象：插件无输出  
  - 检查插件是否在 allowlist 中被禁用。
  - 检查 `enabled` 是否为 `false`。
  - 检查 Host API `3210` 是否可达。

---

## 6. 推荐运维策略

- 用户态临时开关：优先调用 `/plugins/ai-exec-audit/config`。
- 产品默认值管理：通过 `plugin-deploy.ts` 写入持久化配置。
- 高可用场景：
  - 线上默认 `failureMode=fail-open`，降低误杀风险。
  - 高安全场景可切 `fail-close`，并配合监控审计服务可用性。


# ClawX Fork 方案交接文档（会话续接用）

## 1) 背景与目标

用户目标已明确：

- 需要一个 AutoClaw 风格的桌面壳（Windows + macOS）。
- 前端壳子必须实现。
- 必须接入自家 AI 算法/API。
- 终端能力和 OpenClaw 保留与否可以后续决定（可插拔）。

本次会话核心结论：  
**最优路径是 `Fork ClawX + 做 OpenClaw 去中心化改造`，而不是从零重写，也不是直接照搬不改。**

---

## 2) 本次会话已完成工作（完整记录）

### A. 外部资料调研（AutoClaw / OpenClaw / 终端实现）

已完成以下方向调研：

- AutoClaw 官方页信息确认（产品形态）。
- OpenClaw PTY/进程管理相关公开资料（exec、process supervision、Windows PTY行为）。
- 跨平台终端实现栈（ConPTY、PTY、node-pty、xterm.js）。

关键结论：

- AutoClaw公开资料并未完整公开源码实现细节，但能确认是“本地执行 + IM回流”的桌面产品形态。
- OpenClaw公开信息明确了 PTY / 非PTY、进程监管、exec 工具等关键机制。
- Windows/mac 终端层普遍采用 ConPTY/forkpty + xterm.js 这类模式。

---

### B. 对用户本地 `autoclaw-0.2.14.dmg` 的静态逆向分析（合规范围）

已执行的关键动作：

1. 挂载 DMG（只读）。
2. 遍历 `.app` 包结构。
3. 读取 `Info.plist`、`app-update.yml` 等关键元信息。
4. 读取 `gateway/openclaw/package.json` 与 `openclaw.mjs`。
5. 解析 `Resources/app.asar`（使用 Python `asar` 库），抽取 `out/main/index.js`、`out/preload/index.js`、renderer bundle 关键片段。
6. 识别壳层技术栈、进程拓扑、网关启动方式、IPC通道与模型相关 patch 点。

---

## 3) 已确认的“硬证据”与结论

### 3.1 AutoClaw 是什么

**Electron 壳 + React 前端 + 本地 Node + 内置 OpenClaw Gateway。**

可验证证据：

- 存在 `Electron Framework.framework` 与多个 `AutoClaw Helper`。
- `Info.plist` 含 `ElectronAsarIntegrity`。
- `Resources/app.asar` 存在，且可解析出：
  - `out/main/index.js`
  - `out/preload/index.js`
  - `out/renderer/assets/index-*.js`
- `app.asar` 根 `package.json` 依赖包含：
  - `react` / `react-dom` / `react-router-dom`
  - `antd`
  - `zustand`
  - `xterm` / `xterm-addon-fit`
  - `electron-updater`

### 3.2 OpenClaw 是否内置

是。证据：

- `Resources/gateway/openclaw/openclaw.mjs` 存在。
- `Resources/gateway/openclaw/package.json` 显示：
  - `"name": "openclaw"`
  - `"version": "2026.2.19-2"`
- 内置 OpenClaw 依赖里含 `@lydell/node-pty` 等。

### 3.3 主进程做了什么（壳层关键）

在 `out/main/index.js` 中确认：

- 通过 `getBundledNodePath()` 定位内置 Node 二进制。
- 通过 `getOpenClawEntryPath()` 定位 `openclaw.mjs`。
- `spawn` 启动网关子进程。
- 启动参数中包含 `--auth token --token <embedded token>`。
- 有模型/网关相关 patch 逻辑函数：
  - `patchPiAiModelsBaseUrl`
  - `patchGatewayDistModelIdentity`
  - 以及其它相关 patch 函数。
- Preload 用 `contextBridge` 暴露 `window.electronAPI`。
- IPC 包含 `gateway:*`、`agent:*`、`settings:*` 等通道。

### 3.4 关键校准（避免误判）

- 本版本中网关端口在代码里看到是 **固定端口**：
  - `GATEWAY_PORT = 18789`
  - 非“随机端口”。
- “某固定字符串 API key 常量”这类结论若未二次提取到，需标记“待验证”，不要写死。

---

## 4) 对用户提供结论的比对结果

用户给出的分析与本次逆向结论**高度一致（约80-90%）**，主要修正点：

- “随机端口”需要改为“当前版本观察到固定端口 18789”。
- 个别常量字面量若无直接证据，应降级为“待确认”。

---

## 5) 方案评估：原方案 vs ClawX

## 原方案（从零写壳）

- 优点：最干净、完全按自家 API 设计、长期可控性最高。
- 缺点：首版周期更长；安装包、更新、稳定性、进程治理都要自己踩坑。

## 直接使用 ClawX（不改）

- 优点：最快有现成体验。
- 缺点：OpenClaw 强耦合；自家 API 会沦为外挂，长期维护受上游节奏影响。

## 推荐方案（最终）

**Fork ClawX + 去 OpenClaw 中心化改造（Hybrid）**

- 复用成熟壳层能力（UI、打包、更新、IPC、设置体系）。
- 将核心执行链路切到自家 API（一等公民）。
- OpenClaw 与终端做成可插拔模块，默认可关闭。

---

## 6) 落地实施方案（建议执行版）

### Phase 0（准备期，1-2天）

- Fork `ValueCell-ai/ClawX`。
- 创建 `provider-abstraction` 分支。
- 冻结最小事件协议（`task.status` / `message.delta` / `tool.*` / `artifact`）。

### Phase 1（必须完成，约1周）

- 引入 `AgentProvider` 抽象接口：
  - `createTask`
  - `streamTask`
  - `cancelTask`
  - `listModels`
  - `healthCheck`
- 新增 `YourProvider`（接你们 API）。
- UI 默认仅走 `YourProvider`。
- OpenClaw 相关入口改为“可选开关”。

验收标准：

- Win/mac 均可安装启动。
- 可创建任务、流式显示、取消任务、查看历史。

### Phase 2（增强期，1-2周）

- 终端模块（xterm + pty）改为 feature flag。
- OpenClawProvider 插件化（保留兼容能力但不影响主链路）。
- 增加诊断日志导出、断线重连、错误码归一。

### Phase 3（企业化，可后续）

- 权限审批（高危操作确认）。
- 组织策略（模型白名单、速率限制）。
- 审计与脱敏日志。

---

## 7) 目标工程形态（建议）

```text
your-desktop-app/
├── electron/                      # ClawX 主进程层（保留并改造）
│   ├── main/
│   ├── preload/
│   ├── api/
│   └── services/
│       ├── providers/
│       │   ├── your-provider.ts   # 新增：自家API适配
│       │   └── openclaw-provider.ts (optional)
│       └── runtime/
├── src/                           # React renderer（保留并改造）
│   ├── stores/
│   ├── pages/
│   └── lib/
├── resources/                     # 打包资源
└── electron-builder.yml
```

---

## 8) 风险与规避

- 风险：继续将 OpenClaw 作为主链路，后续改造成本爆炸。  
  规避：先做 Provider 抽象，先切主链路到自家 API。

- 风险：Renderer 越权（安全问题）。  
  规避：坚持 `preload + contextIsolation + IPC白名单`。

- 风险：协议不稳定导致 UI 频繁返工。  
  规避：先冻结事件 schema，再做页面开发。

- 风险：Windows 打包/升级链路拖慢进度。  
  规避：第一周即跑通 `package:win` 和基础更新检查。

---

## 9) 新会话建议启动词（可直接粘贴）

```text
我已决定 Fork ClawX 做二开。目标是：
1) 前端壳子（Electron + React）必须上线；
2) 主链路必须接入我们自己的 API（create/stream/cancel）；
3) OpenClaw 和终端能力改为可选模块，不影响主流程。

请先基于当前仓库给我做“文件级改造计划”：
- 必须改的文件（按优先级）
- 可后改的文件
- 可删除/可禁用的 OpenClaw 强耦合模块
- 第一周日程（每天可验收）
并从第一步代码修改开始执行。
```

---

## 10) 参考链接（本次讨论中用到）

- ClawX 仓库主页：  
  [https://github.com/ValueCell-ai/ClawX](https://github.com/ValueCell-ai/ClawX)
- ClawX README（raw）：  
  [https://raw.githubusercontent.com/ValueCell-ai/ClawX/main/README.md](https://raw.githubusercontent.com/ValueCell-ai/ClawX/main/README.md)
- ClawX package.json（raw）：  
  [https://raw.githubusercontent.com/ValueCell-ai/ClawX/main/package.json](https://raw.githubusercontent.com/ValueCell-ai/ClawX/main/package.json)
- ClawX electron-builder.yml（raw）：  
  [https://raw.githubusercontent.com/ValueCell-ai/ClawX/main/electron-builder.yml](https://raw.githubusercontent.com/ValueCell-ai/ClawX/main/electron-builder.yml)

---

## 11) 最终结论（一句话版）

**现在最优解：Fork ClawX，复用成熟桌面壳能力；同时尽快做 Provider 抽象，把主链路切到你们自家 API，OpenClaw/终端变成可选插件。**


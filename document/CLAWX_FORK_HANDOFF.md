# ClawX Fork 方案交接文档（会话续接用）

## 1) 背景与目标

用户目标已明确：

- 需要一个 AutoClaw 风格的桌面壳（Windows + macOS）。
- 前端壳子必须实现。
- **OpenClaw 和终端能力完整保留**，不做裁剪。
- 在原有功能基础上，**额外扩展接入自家 AI 模型、API 和业务接口**。
- 新增登录/用户系统，支持自家账号体系。

本次会话核心结论：
**最优路径是 `Fork ClawX + 扩展自家 API/模型`，OpenClaw 和终端作为核心能力完整保留，自家 API 作为新增扩展并行存在。**

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
- 缺点：无法接入自家 API 和模型，功能受限。

## 推荐方案（最终）

**Fork ClawX + 扩展自家 API/模型（增强型）**

- 复用成熟壳层能力（UI、打包、更新、IPC、设置体系）。
- **完整保留 OpenClaw Gateway 和终端能力**（作为核心功能）。
- **新增自家 API/模型支持**（作为扩展能力，与 OpenClaw 并行）。
- 新增登录/用户系统，支持自家账号体系。
- 新增业务接口调用能力（如自定义工具、企业功能等）。

---

## 6) 落地实施方案（建议执行版）

### Phase 0（准备期，1-2天）

- Fork `ValueCell-ai/ClawX`。
- 创建 `custom-api-extension` 分支。
- 确认现有 OpenClaw 功能完整可用（Gateway、终端、技能市场等）。

### Phase 1（必须完成，约1-2周）

- **新增登录/用户系统**：
  - 登录页面（用户名/密码 或 OAuth）
  - Token 管理（存储到系统 Keychain）
  - 用户信息持久化
- **新增自家 API 集成**：
  - 引入 `CustomProvider`（接入自家 AI 模型 API）
  - 实现流式对话接口（兼容现有聊天 UI）
  - 模型列表获取与切换
- **UI 扩展**：
  - 设置页新增”自家模型”配置入口
  - 聊天页支持切换 OpenClaw 模型 / 自家模型
  - 保留 OpenClaw 所有现有功能入口

验收标准：

- Win/mac 均可安装启动。
- OpenClaw 功能完整可用（终端、技能、Agent 等）。
- 可登录自家账号，使用自家模型进行对话。
- 可在 OpenClaw 模型和自家模型之间自由切换。

### Phase 2（增强期，1-2周）

- **新增业务接口调用**：
  - 自定义工具/函数调用（Tool Calling）
  - 企业功能集成（如审批、日志、权限等）
- **多模型协同**：
  - 支持同时使用 OpenClaw 和自家模型
  - 模型能力互补（如 OpenClaw 负责终端操作，自家模型负责业务逻辑）
- **增强体验**：
  - 诊断日志导出
  - 断线重连
  - 错误码归一

### Phase 3（企业化，可后续）

- 权限审批（高危操作确认）。
- 组织策略（模型白名单、速率限制）。
- 审计与脱敏日志。
- 多租户支持。

---

## 7) 目标工程形态（建议）

```text
boom-claw/
├── electron/                      # ClawX 主进程层（保留并扩展）
│   ├── main/
│   ├── preload/
│   ├── api/
│   ├── gateway/                   # OpenClaw Gateway（完整保留）
│   └── services/
│       ├── providers/
│       │   ├── openclaw-provider.ts   # 保留：OpenClaw 原有能力
│       │   └── custom-provider.ts     # 新增：自家 API 适配
│       ├── auth/                  # 新增：登录/用户系统
│       └── business/              # 新增：业务接口封装
├── src/                           # React renderer（保留并扩展）
│   ├── stores/
│   │   ├── chat/                  # 保留：聊天状态（支持多 Provider）
│   │   ├── gateway.ts             # 保留：OpenClaw Gateway 状态
│   │   ├── auth.ts                # 新增：登录/用户状态
│   │   └── custom-models.ts       # 新增：自家模型状态
│   ├── pages/
│   │   ├── Login/                 # 新增：登录页
│   │   ├── Chat/                  # 保留并扩展：支持多模型切换
│   │   ├── Agents/                # 保留：OpenClaw Agent 管理
│   │   ├── Skills/                # 保留：OpenClaw 技能市场
│   │   └── Settings/              # 扩展：新增自家模型配置
│   └── lib/
├── resources/                     # 打包资源
└── electron-builder.yml
```

---

## 8) 风险与规避

- 风险：OpenClaw 和自家 API 两套系统维护成本高。
  规避：做好 Provider 抽象层，统一接口规范，降低维护复杂度。

- 风险：Renderer 越权（安全问题）。
  规避：坚持 `preload + contextIsolation + IPC白名单`。

- 风险：多模型切换导致 UI 状态混乱。
  规避：明确模型状态隔离，避免状态污染。

- 风险：自家 API 协议变更导致频繁返工。
  规避：先冻结事件 schema，再做页面开发。

- 风险：Windows 打包/升级链路拖慢进度。
  规避：第一周即跑通 `package:win` 和基础更新检查。

---

## 9) 新会话建议启动词（可直接粘贴）

```text
我已决定 Fork ClawX 做二开。目标是：
1) 前端壳子（Electron + React）必须上线；
2) OpenClaw 和终端能力完整保留（作为核心功能）；
3) 在原有基础上扩展接入我们自己的 API/模型（作为新增能力）；
4) 新增登录/用户系统，支持自家账号体系；
5) 支持在 OpenClaw 模型和自家模型之间自由切换。

请先基于当前仓库给我做”文件级改造计划”：
- 必须新增的文件（登录、自家 API、用户系统）
- 必须修改的文件（UI 扩展、模型切换）
- 完整保留的模块（OpenClaw Gateway、终端、技能市场）
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

**现在最优解：Fork ClawX，完整保留 OpenClaw 和终端能力作为核心功能；同时扩展接入自家 API/模型，新增登录/用户系统，实现双引擎并行的增强型桌面应用。**


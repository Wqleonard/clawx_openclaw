# CLAUDE.md — BoomClaw 项目上下文

> 本文件供 Claude 每次新会话时快速了解项目背景、架构、改造目标和开发规范。

---

## 1. 项目背景

本项目是基于开源项目 **ClawX**（`https://github.com/Wqleonard/ClawX`）的 Fork 二开版本，工作目录为 `/Users/leonard/workspace/react_workspace/boom-claw`。

ClawX 原本是 **OpenClaw AI Agent Runtime** 的桌面 GUI 壳，通过 Electron + React 实现。我们在此基础上进行扩展，目标是：

1. 保留成熟的 Electron 桌面壳能力（UI、打包、更新、IPC、设置体系）
2. **完整保留 OpenClaw 和终端能力**（Gateway、PTY 终端、技能市场、Agent 管理等）
3. **扩展接入我们自己的 API/模型**（登录、用户系统、自家 AI 模型、业务接口等）
4. 支持 OpenClaw 模型与自家模型并行使用、自由切换
5. 保持 `Electron + React + Tailwind CSS + shadcn/ui` 架构不变

---

## 2. 技术栈

| 层级 | 技术 |
|------|------|
| 桌面框架 | Electron 40+ |
| UI 框架 | React 19 + TypeScript |
| 样式 | Tailwind CSS + shadcn/ui |
| 状态管理 | Zustand 5 |
| 构建工具 | Vite 7 + electron-builder |
| 测试 | Vitest + Playwright |
| 动画 | Framer Motion |
| 图标 | Lucide React |
| Markdown | react-markdown + remark-gfm |
| 包管理 | pnpm |

---

## 3. 项目结构

```
boom-claw/
├── electron/                  # Electron 主进程
│   ├── api/                   # 主进程 HTTP API 服务（端口 3210）
│   │   └── routes/            # 各功能路由（settings/providers/chat/agents/...）
│   ├── gateway/               # OpenClaw Gateway 进程管理器（完整保留）
│   │   └── manager.ts         # 进程生命周期、WS 连接、重连逻辑
│   ├── services/              # 服务层
│   │   ├── providers/         # Provider 管理（OpenClaw + 自家 API）
│   │   ├── secrets/           # OS Keychain 封装（密钥存储）
│   │   ├── auth/              # 新增：登录/用户系统
│   │   └── business/          # 新增：业务接口封装
│   ├── shared/                # 主进程/渲染进程共享的 Provider schema/常量
│   ├── main/                  # 应用入口、窗口管理、IPC 注册、托盘、菜单
│   ├── preload/               # 安全 IPC 桥（contextBridge）
│   └── utils/                 # 配置、路径、存储工具
├── src/                       # React 渲染进程
│   ├── lib/
│   │   ├── api-client.ts      # 统一 API 客户端（IPC/WS/HTTP 多传输层）
│   │   └── error-model.ts     # 错误码归一化
│   ├── stores/                # Zustand 状态管理
│   │   ├── chat/              # 聊天状态（消息、流式、会话）—— 支持多 Provider
│   │   ├── gateway.ts         # Gateway 状态与 RPC 代理（OpenClaw）
│   │   ├── providers.ts       # Provider 账号管理（OpenClaw + 自家）
│   │   ├── settings.ts        # 应用设置（主题/语言/代理/网关）
│   │   ├── agents.ts          # Agent 列表（OpenClaw）
│   │   ├── channels.ts        # 频道配置
│   │   ├── cron.ts            # 定时任务
│   │   ├── skills.ts          # 技能市场（OpenClaw）
│   │   ├── update.ts          # 自动更新
│   │   ├── auth.ts            # 新增：登录/用户状态
│   │   └── custom-models.ts   # 新增：自家模型状态
│   ├── pages/                 # 页面组件
│   │   ├── Login/             # 新增：登录页
│   │   ├── Setup/             # 首次启动向导
│   │   ├── Chat/              # 聊天主界面（支持多模型切换）
│   │   ├── Agents/            # Agent 管理（OpenClaw）
│   │   ├── Channels/          # 频道管理
│   │   ├── Skills/            # 技能管理（OpenClaw）
│   │   ├── Cron/              # 定时任务
│   │   └── Settings/          # 设置页（扩展自家模型配置）
│   ├── components/            # 可复用 UI 组件
│   ├── types/                 # TypeScript 类型定义
│   └── i18n/                  # 国际化（中/英/日）
├── resources/                 # 图标、截图、内置技能、上下文文件
├── tests/unit/                # Vitest 单元测试
├── scripts/                   # 构建脚本
├── document/                  # 项目文档
│   ├── CLAWX_FORK_HANDOFF.md  # 上一会话分析结论（逆向 AutoClaw + 方案评估）
│   └── WINDOWS_SIGNING_GUIDE.md  # Windows 签名与加白指南
└── electron-builder.yml       # 打包配置（macOS DMG / Windows NSIS / Linux）
```

---

## 4. 进程架构与通信

```
React Renderer
    │
    │  window.electronAPI (contextBridge)
    ▼
Electron Preload (IPC 桥)
    │
    │  ipcRenderer.invoke / ipcMain.handle
    ▼
Electron Main Process (端口 3210 Host API)
    │
    │  WS → HTTP → IPC fallback
    ▼
OpenClaw Gateway (端口 18789)
```

**关键 IPC 通道：**
- `gateway:*` — Gateway 生命周期（start/stop/restart/rpc/health/status）
- `settings:*` — 设置读写
- `provider:*` — Provider 账号管理（OpenClaw + 自家）
- `agent:*` — Agent 管理（OpenClaw）
- `channel:*` — 频道配置
- `cron:*` — 定时任务
- `clawhub:*` — 技能市场（OpenClaw）
- `update:*` — 自动更新
- `auth:*` — 新增：登录/用户认证
- `custom-api:*` — 新增：自家 API 调用
- `app:*` / `window:*` / `shell:*` / `dialog:*` / `file:*` / `log:*`

**事件推送通道：**
- `gateway:status-changed` — Gateway 状态变化（OpenClaw）
- `gateway:notification` — Gateway 通知（含聊天流式事件）
- `gateway:chat-message` — 聊天事件（OpenClaw）
- `update:status-changed` — 更新状态
- `oauth:code/success/error` — OAuth 流程
- `auth:login/logout` — 新增：登录/登出事件
- `custom-api:stream` — 新增：自家 API 流式事件

---

## 5. 聊天与流式 Markdown

**已确认：聊天支持 Markdown 流式渲染。**

- 使用 `react-markdown` + `remark-gfm`，支持代码块、表格、删除线、任务列表
- 流式文本累积在 `streamingText`，实时渲染
- `ChatMessage.tsx` 支持：文本（Markdown）、Thinking 块（可折叠）、Tool 调用卡片、图片、工具执行状态

**流式消息流程：**
1. 用户发送 → `sendMessage()` → Gateway RPC `chat.send()`
2. Gateway 推送事件：`delta`（流式内容）→ `final`（完成）→ `error/aborted`
3. 事件由 `handleChatEvent()` → `handleRuntimeEventState()` 处理
4. 流式消息实时渲染，`final` 后写入历史

---

## 6. OpenClaw 与终端能力（完整保留）

**当前状态：** OpenClaw Gateway 是核心能力之一，终端能力通过 OpenClaw 的 PTY 实现。

**扩展策略：**
- **OpenClaw Gateway 完整保留**，进程管理保留在 `electron/gateway/manager.ts`
- **终端能力完整保留**（xterm + pty），作为核心功能
- **OpenClaw 技能市场、Agent 管理完整保留**
- **新增自家 API/模型支持**，与 OpenClaw 并行存在
- 用户可在 OpenClaw 模型和自家模型之间自由切换
- 不删除任何 OpenClaw 相关代码，保持原有功能完整性

---

## 7. 待扩展目标（按优先级）

### Phase 1 — 必须完成（接入自家 API）

- [ ] 新增登录页面（用户名/密码 或 OAuth）
- [ ] 新增用户系统（token 管理、用户信息存储到系统 Keychain）
- [ ] 新增 `CustomProvider`（接入我们自己的 AI 模型 API）
- [ ] 实现自家模型流式对话接口（兼容现有聊天 UI）
- [ ] UI 扩展：设置页新增"自家模型"配置入口
- [ ] UI 扩展：聊天页支持切换 OpenClaw 模型 / 自家模型
- [ ] 验收：Win/mac 均可安装启动，OpenClaw 功能完整可用，可登录自家账号使用自家模型

### Phase 2 — 增强

- [ ] 新增业务接口调用（自定义工具/函数调用）
- [ ] 多模型协同（OpenClaw + 自家模型能力互补）
- [ ] 诊断日志导出、断线重连、错误码归一

### Phase 3 — 企业化（后续）

- [ ] 权限审批（高危操作确认）
- [ ] 组织策略（模型白名单、速率限制）
- [ ] 审计与脱敏日志
- [ ] 多租户支持

---

## 8. 开发规范

### 架构约束
- **不改变** Electron + React + Tailwind CSS + shadcn/ui 技术栈
- **不删除** OpenClaw 相关代码，完整保留所有功能
- **不删除** 终端能力，完整保留 xterm + pty
- 新增功能采用扩展模式，与 OpenClaw 并行存在
- Renderer 不直接调用 Gateway HTTP，必须通过 Main 代理
- 敏感信息（API Key、Token）存入系统 Keychain，不写 localStorage

### 代码风格
- ESLint + Prettier（已配置，运行 `pnpm lint`）
- TypeScript 严格模式
- 组件用函数式 + hooks，状态用 Zustand store
- 新增 Provider 参考 `electron/services/providers/` 现有模式

### 新增 Provider 的正确位置
- 接口定义：`electron/shared/providers/`
- 账号同步逻辑：`electron/services/providers/`
- 前端 store：`src/stores/providers.ts`（扩展支持自家 Provider）
- UI 配置页：`src/pages/Settings/`（新增自家模型配置）

### 新增登录/用户系统的正确位置
- 服务层：`electron/services/auth/`
- 前端 store：`src/stores/auth.ts`
- 登录页面：`src/pages/Login/`
- 路由注册：`src/App.tsx`

### 新增页面的正确位置
- 页面组件：`src/pages/{PageName}/`
- 路由注册：`src/App.tsx`（查看现有路由结构）
- 导航菜单：`src/components/layout/`

### 常用命令
```bash
pnpm run init        # 初始化（安装依赖 + 下载 uv）
pnpm dev             # 开发模式（热重载）
pnpm lint            # ESLint 检查
pnpm typecheck       # TypeScript 类型检查
pnpm test            # 单元测试
pnpm build           # 完整生产构建
pnpm package:mac     # 打包 macOS
pnpm package:win     # 打包 Windows
```

---

## 9. 关键文件速查

| 文件 | 作用 |
|------|------|
| `electron/main/index.ts` | 主进程入口，窗口/IPC/Gateway 启动 |
| `electron/preload/index.ts` | IPC 桥，暴露 `window.electronAPI` |
| `electron/gateway/manager.ts` | OpenClaw 进程管理、WS 连接（完整保留） |
| `electron/api/server.ts` | 主进程 HTTP API 服务（端口 3210） |
| `electron/services/providers/` | Provider 账号同步逻辑（OpenClaw + 自家） |
| `electron/services/auth/` | 新增：登录/用户系统服务层 |
| `src/lib/api-client.ts` | 前端统一 API 客户端（多传输层） |
| `src/lib/error-model.ts` | 错误码归一化 |
| `src/stores/chat/` | 聊天状态（流式、会话、消息）—— 支持多 Provider |
| `src/stores/providers.ts` | Provider 账号前端状态（OpenClaw + 自家） |
| `src/stores/auth.ts` | 新增：登录/用户状态 |
| `src/stores/custom-models.ts` | 新增：自家模型状态 |
| `src/stores/settings.ts` | 应用设置（持久化） |
| `src/pages/Login/` | 新增：登录页 |
| `src/pages/Chat/ChatMessage.tsx` | 消息渲染（Markdown/Tool/图片）—— 支持多 Provider |
| `src/pages/Setup/` | 首次启动向导 |
| `electron-builder.yml` | 打包配置 |
| `document/CLAWX_FORK_HANDOFF.md` | 上一会话分析结论 |
| `document/WINDOWS_SIGNING_GUIDE.md` | Windows 签名与加白指南 |

---

## 10. 注意事项

- Gateway 端口固定为 **18789**（非随机端口）
- Host API 端口固定为 **3210**
- 打包更新服务器：阿里云 OSS（主）+ GitHub（备）
- App ID：`app.clawx.desktop`（打包时需修改为我们自己的）
- 内置技能部署路径：`~/.openclaw/skills`
- Provider 账号配置同步路径：`~/.openclaw/agents/{agentId}/agent/auth-profiles.json`

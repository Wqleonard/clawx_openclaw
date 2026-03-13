# BoomClaw 开发者视角架构说明

> 面向开发者的实现说明。重点是：模块边界、调用链、关键文件、扩展路径、排错方法。

---

## 1. 系统分层（先建立心智模型）

本项目可按 4 层理解：

1. **Renderer（React）**  
   负责 UI、状态管理、用户交互，不直接访问本地系统资源。

2. **Preload（contextBridge）**  
   安全桥，只暴露白名单 API 给 Renderer（`window.electron.*`）。

3. **Main（Electron 主进程）**  
   负责系统能力（文件、窗口、托盘、网络代理、子进程）和 IPC 处理。

4. **OpenClaw Runtime（Gateway + Agent + Skills）**  
   真正执行 agent 对话、工具调用、会话管理、技能管理。

---

## 2. 核心调用链（高频路径）

### 2.1 聊天请求链路

1. Renderer 调用 `useChatStore.sendMessage()`
2. 通过 `api-client` -> `gateway:rpc`（或 host API）
3. Main `GatewayManager` 转发到 OpenClaw Gateway
4. Gateway 返回事件（delta/final/tool）
5. Main 转推 `gateway:*` 事件到 Renderer
6. `chat store` 归并状态，UI 渲染

### 2.3 AI 执行链路（LLM + Tool Calling）

从运行时角度，一次完整 agent turn 通常是：

1. Gateway 组装 prompt 上下文（system + history + tool schema + 用户输入）
2. 调用目标 LLM（provider/model）
3. LLM 返回：
   - 直接文本（assistant content），或
   - `tool_use`（结构化调用）
4. Gateway 执行工具，产生 `tool_result`
5. 将 `tool_result` 回注入上下文，再次调用 LLM
6. 最终输出 `final`，并在 WS 通道持续发送 `delta/final/error/aborted`

这也是 UI 中 streaming + tool 状态卡片的来源。

### 2.2 文件系统链路

1. Renderer 触发文件操作（`useFileSystemStore`）
2. `invokeIpc('fs:*')` 调用 preload 暴露方法
3. Main `registerFileSystemHandlers()` 执行真实文件操作
4. watcher 变化通过 `fs:changed` 回推
5. Renderer 刷新树、缓存、tab、dirty 状态

---

## 3. 关键目录与职责

### 3.1 Electron 主进程侧

- `electron/main/index.ts`  
  应用入口、窗口创建、Gateway 自动启动、系统生命周期管理。

- `electron/main/ipc-handlers.ts`  
  IPC 注册总线。所有能力统一在这里装配（包括 `fs:*`）。

- `electron/preload/index.ts`  
  IPC 白名单与 `window.electron` 暴露层。

- `electron/gateway/*`  
  Gateway 进程管理、WS 连接、重连、请求派发、启动恢复策略。

- `electron/services/filesystem/index.ts`  
  文件系统能力主实现（工作区、树读取、读写改删、watch、context 相关）。

### 3.2 Renderer 侧

- `src/lib/api-client.ts`  
  统一请求入口（IPC / WS / HTTP fallback 策略）。

- `src/stores/chat.ts`  
  聊天状态机（消息、流式、tool 状态、session）。

- `src/stores/filesystem.ts`  
  文件系统前端状态（workspace/tree/openFiles/dirty/contextFiles/...）。

- `src/components/filesystem/FileTree.tsx`  
  文件树 UI、右键菜单、上下文入口、watch/context 联动。

- `src/components/filesystem/FileTabs.tsx`  
  打开文件 tab 切换/关闭。

- `src/pages/Chat/index.tsx`  
  三栏集成（FileTree | Editor | Chat）与会话级工作区映射触发。

---

## 4. OpenClaw 集成点（开发视角）

### 4.1 Runtime 来源与启动

- 打包通过 `electron-builder.yml` 将 `build/openclaw` 作为资源带入。
- 启动时 `GatewayManager.start()` 拉起 openclaw entry。
- `config-sync` 在启动前同步 token/proxy/provider/channel 配置。

### 4.2 数据目录

- 当前统一使用 `getOpenClawConfigDir()`（默认 `~/.openclaw`）。
- 建议所有 OpenClaw 相关读写都走该工具函数，不要手写路径。

### 4.3 LLM 参数与行为控制（实践要点）

- **模型选择**：由 provider + model 决定能力/成本/时延。
- **采样参数**（由 runtime/provider 控制）：`temperature`、`top_p`、`max_tokens` 等会直接影响稳定性与风格。
- **上下文窗口**：越长越贵，且更容易触发截断；建议在业务层做摘要与分段。
- **工具优先级**：Prompt 需明确“什么时候必须调工具，什么时候直接回答”。

---

## 5. IPC 设计原则（项目约束）

1. Renderer 不直接调用 Node API
2. 只能通过 preload 暴露白名单能力
3. 主进程处理真实系统操作与安全校验
4. 统一请求优先走 `api-client`，避免页面散落 `window.electron.ipcRenderer.invoke`

补充：

5. 新增 channel 必须三处一致：`main handler`、`preload whitelist`、`renderer types`
6. 对启动时序敏感能力（watch/context）需考虑“renderer/main 状态不一致”自愈

---

## 6. 文件系统模块当前实现状态

### 6.1 已实现

- 工作区选择/读取：`fs:open-folder / fs:get-workspace / fs:set-workspace`
- 默认工作区创建：`fs:ensure-default-workspace`
- 树读取与文件操作：`read-tree/read-file/write/create/rename/move/copy/delete`
- 文件监听：`watch-start/watch-stop` + `fs:changed`
- context 映射：`add-to-context/remove-from-context/list-context`
- 会话绑定工作区（store 层）：
  - `workspaceBindings: Record<sessionKey, workspacePath>`
  - session 切换自动应用工作区

### 6.2 进行中

- Agent 标准化 Tool 执行链路（read/write/list/search）对接会话工作区绑定
- 将“AI 自动写入章节文件”做成可验证闭环

---

## 7. 会话绑定工作区策略（当前约定）

- 绑定粒度：`session -> workspaceRoot`（而非全局 agent）
- 默认行为：
  - 若 session 无绑定，使用 `defaultWorkspacePath`
  - 若也没有，自动创建默认小说目录并绑定
- 手动切目录后：
  - 更新当前 session 绑定
  - 可作为后续默认目录

该策略便于一人多项目（多本小说）并行。

---

## 8. 与 Agent/Skills 打通的建议实现（标准化）

目标不是 prompt hack，而是 OpenClaw 标准工具链：

1. 定义小说读写工具（read/write/list/search）
2. 通过 Skills/Tools 标准入口注册到 Gateway
3. 工具执行时读取当前 session 的 `workspaceRoot`
4. 仅允许 root 内相对路径读写（防越界）
5. 工具结果回流聊天事件，UI 自动刷新文件树

### 8.1 为什么强调“标准化”而不是 prompt 注入？

- prompt 只能“建议”模型调用工具，不能保证工具真正存在且可执行
- 标准 skills/tool 接入能做到：
  - 有 schema（参数可校验）
  - 有执行结果（tool_result 可观测）
  - 有权限边界（工作区隔离）
  - 有可测试性（可做自动化回归）

---

## 9. 常见问题与定位路径

### 9.1 `Workspace is not selected`

现象：`fs:read-tree/watch/list-context` 报错。  
原因：renderer 有 workspace 状态，但 main 侧 `workspaceRoot` 未同步。  
处理：store 中先做 `fs:get-workspace`/`fs:set-workspace` 自愈同步，再执行后续调用。

### 9.2 目录显示了但 context/watch 报错

优先检查：

1. preload 是否放行新 `fs:*` channel
2. main 是否注册了对应 handler
3. store 调用顺序是否先完成 workspace 同步

### 9.3 typecheck 报 `MainEditor` 相关缺模块

这是仓库现存问题，和文件系统模块改动通常无关；需单独治理。

### 9.4 AI 结果不稳定/偏题

排查顺序建议：

1. 检查 system prompt 是否过宽或冲突
2. 检查是否缺少关键上下文文件
3. 检查模型与采样参数（temperature/top_p）
4. 检查是否误判了工具调用条件（该调工具却直接回答）

### 9.5 工具调用“看起来触发了”，但没落盘

优先确认：

1. Tool 是否真实注册到 Gateway（不是仅写在 prompt）
2. Tool handler 是否执行成功并有 `tool_result`
3. 路径是否通过 workspace 边界校验
4. 写入后是否有 watcher 事件和 store 刷新

---

## 10. 新功能扩展建议（小步策略）

建议每步都满足“可单独验证”：

1. 主进程/IPC 先通
2. preload/type 补齐
3. store 动作落地
4. UI 最小接入
5. 联调 + 错误自愈
6. 再写 `PROGRESS.md`

---

## 11. 推荐的开发检查清单

- IPC 新通道是否：
  - 在 main 注册
  - 在 preload 白名单放行
  - 在 types 声明
- 是否符合安全边界：
  - 路径校验（workspace 内）
  - 不暴露危险调用给 renderer
- 是否有状态一致性处理：
  - rename/move/delete 后 openFiles/fileContents/dirty/context 同步
- 是否有启动竞态保护：
  - 主进程 workspace 自愈同步
- 是否更新文档：
  - `document/PROGRESS.md`

---

## 12. 一句话给新开发者

先把 `Renderer -> Preload -> Main -> Gateway` 这条链路跑通，再谈功能；  
先保证“边界、安全、状态一致性”，再追求“智能化自动化”。

附加原则：  
把“LLM 能回答”与“系统能执行”分开验证；后者必须靠标准工具链和可观测事件闭环。


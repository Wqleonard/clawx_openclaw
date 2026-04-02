# BoomClaw 开发进度

> 新会话启动时，结合 `CLAUDE.md` 一起阅读，快速恢复上下文。

---

## 已完成模块

### 1. 登录系统

**流程：Login → Setup → 主界面**

路由守卫在 `src/App.tsx`：
```ts
// 未登录 → /login
// 已登录 + setupComplete=false → /setup
// 已登录 + setupComplete=true → 放行主界面
```

**关键文件：**

- `src/pages/Login/index.tsx` — 登录页，左侧产品介绍 + 右侧 iframe 嵌入登录
  - `IFRAME_URL = 'https://www.baowenmao.com/login/login'`
  - `ALLOWED_ORIGIN = 'https://www.baowenmao.com'`
  - 通过 `postMessage` 接收 `{ action: 'ticketSend', data: { ticket } }`
  - 调用 `loginWithTicket(ticket)` → 成功后 `navigate('/')` → 守卫自动跳 `/setup`

- `src/stores/loginStore/index.ts` — 登录状态（用户带来的原有文件，已修复）
  - `loginWithTicket(ticket)` — 调用 `verifyTicket` API，存 token 到 localStorage
  - `isLoggedIn` — 从 `!!localStorage.getItem('token')` 初始化
  - `logout()` — 清 token + userInfo，跳 `/`（守卫会拦截到 `/login`）
  - `requireLogin()` — 原来调 `openLoginDialog()`，已改为 `window.location.hash = '#/login'`

- `src/stores/loginStore/types.ts` — LoginStore 类型定义

**注意：** `loginStore` 是目录形式（`index.ts` + `types.ts`），import 路径是 `@/stores/loginStore`。

---

### 2. 业务 API 客户端

**关键文件：**

- `src/api/index.ts` — 通用 API 客户端（用户带来的原有文件）
  - `defaultBaseURL()` 读取 `import.meta.env.VITE_BUSINESS_API_BASE_URL`
  - 导出 `apiClient`（默认实例）和 `createApiClient()`（自定义实例）
  - 支持：`get/post/put/del/upload/postStream/postLangGraphStream`
  - Token 从 `localStorage.getItem('token')` 读取，自动注入 `Authorization: Bearer`
  - 未登录时注入 `X-Visitor-Id`（`src/utils/visitorId.ts`）

- `src/api/users.ts` — 用户相关接口（用户带来的原有文件）
  - `verifyTicket(ticket)` — 票据换 token
  - `getUserInfoReq()` — 获取用户信息
  - `loginReq({ phone, password })` — 账号密码登录（备用）
  - `createNewUserReq(...)` — 注册

- `src/api/insite-notification.ts` — 站内通知接口（用户带来的原有文件）

---

### 3. 多环境配置

**env 文件（均在项目根目录，已加入 .gitignore 应手动维护）：**

| 文件 | 环境 | API 地址 |
|------|------|---------|
| `.env.dev` | 开发 | `sd3n2c45049upp79s7pbg.apigateway-cn-beijing.volceapi.com` |
| `.env.qa` | 测试 | `sd4kgrdl5kiq91p6r2a40.apigateway-cn-beijing.volceapi.com` |
| `.env.prd` | 生产 | `sd4kgrdl5kiq91p6r2a40.apigateway-cn-beijing.volceapi.com` |

**变量名：** `VITE_BUSINESS_API_BASE_URL`（必须 `VITE_` 前缀才能在 renderer 读到）

**命令对照：**

```bash
# 本地调试
pnpm dev          # dev 环境
pnpm qa           # qa 环境
pnpm prd          # prd 环境

# 打包
pnpm package:mac          # mac prd
pnpm package:mac:qa       # mac qa
pnpm package:win          # win prd
pnpm package:win:qa       # win qa
```

原理：`vite --mode dev` 加载 `.env.dev`，`vite build --mode prd` 加载 `.env.prd`。

---

### 4. 退出登录

**入口：** 侧边栏底部用户头像区域，点击后弹出菜单，包含"退出登录"选项。

**关键逻辑（`src/stores/loginStore/index.ts`）：**
- `logout()` — 清除 `token` + `userInfo`（localStorage），跳转 `/`，路由守卫自动拦截到 `/login`
- 退出后清空所有被拦截的操作队列（`clearInterceptedActions`）

---

### 5. 富文本编辑器（Tiptap）

**功能：** 聊天页左侧嵌入 Markdown 富文本编辑器，支持 AI 消息一键导入。

**布局：** 三栏结构 — 侧边栏 | 编辑器（可拖拽调宽）| 聊天区

**关键文件：**

- `src/components/editor/TiptapEditor.tsx` — 编辑器组件
  - 基于 `@tiptap/react` v3 + `@tiptap/starter-kit` + `@tiptap/markdown`
  - `contentType: 'markdown'` — 正确解析 Markdown 语法（`##`、`**`、`-` 等）
  - 工具栏：Bold / Italic / H1 / H2 / BulletList / OrderedList / CodeBlock
  - BubbleMenu：选中文字时浮出 Bold / Italic / InlineCode 快捷按钮
  - `suppressNextUpdate` ref — 防止外部内容同步时触发 onChange 死循环

- `src/pages/Chat/index.tsx` — 聊天页集成
  - `editorOpen` 状态控制编辑器显示/隐藏（PanelLeftClose / PanelLeftOpen 按钮）
  - `editorWidth` 状态 + 鼠标拖拽 handler 实现可调宽（260px ~ 900px，默认 560px）
  - `editorContent` 状态双向绑定编辑器内容
  - `onImportToEditor={setEditorContent}` 传给 ChatMessage，支持一键导入

- `src/pages/Chat/ChatMessage.tsx` — 消息组件扩展
  - 新增 `onImportToEditor` prop
  - AI 消息 hover 时显示操作栏，含"导入到编辑器"按钮（ClipboardPaste 图标）
  - 点击后显示绿色对勾 2 秒，视觉反馈

**依赖（已加入 `package.json` dependencies）：**
```
@tiptap/react@^3.20.1
@tiptap/starter-kit@^3.20.1
@tiptap/markdown@^3.20.1
```

## 待完成（Phase 1 剩余）
- [ ] `CustomProvider` — 接入自家 AI 模型 API，与 OpenClaw 并行
- [ ] 设置页扩展 — 新增"自家模型"配置入口
- [ ] 聊天页扩展 — 支持切换 OpenClaw 模型 / 自家模型
- [ ] 用户信息展示 — 侧边栏/顶栏显示登录用户头像、昵称、退出按钮

## 待完成（Phase 2）
- [ ] 业务接口调用（自定义工具/函数调用）
- [ ] 多模型协同
- [ ] 诊断日志导出、断线重连、错误码归一

---

### 6. 文件系统（阶段性完成，可继续联调）

> 本阶段按“小步可验证”推进，已完成基础可用链路，并修复启动边界问题。

**主进程与 IPC：**
- 新增 `electron/services/filesystem/index.ts`，提供 `fs:*` 通道：
  - 目录/文件读取：`open-folder`、`get-workspace`、`read-tree`、`read-file`
  - 写操作：`write-file`、`create-file`、`create-folder`、`rename`、`move`、`copy`、`delete`
  - 监听：`watch-start`、`watch-stop` + 事件 `fs:changed`
- 注册接入 `electron/main/ipc-handlers.ts`（通过 `registerFileSystemHandlers(mainWindow)`）
- `electron/preload/index.ts` 已暴露 `window.electron.fs.*` 全量能力并放行白名单
- `src/types/electron.d.ts` 已补全 `fs` 类型声明（含监听回调）

**渲染层状态管理：**
- 新增 `src/stores/filesystem.ts`（Zustand）：
  - `workspacePath/tree/openFiles/activeFile/fileContents/dirtyFiles`
  - 支持打开、编辑、保存、增删改移动复制、监听刷新
  - 文件移动/删除时同步维护 openFiles、activeFile、dirtyFiles 与缓存内容映射

**UI 与交互：**
- 新增 `src/components/filesystem/FileTree.tsx`：
  - 左侧文件树、展开/折叠、文件打开
  - 右键菜单：新建/重命名/移动/复制/剪切/粘贴/删除
  - 项目风格对话框替代 `prompt/confirm`
  - 菜单边界防出屏、路径冲突提示、快捷键（F2/Delete/Cmd|Ctrl+C/X/V）
- 新增 `src/components/filesystem/FileTabs.tsx`：
  - 打开文件标签切换/关闭
  - 未保存 `*` 标记
- `src/pages/Chat/index.tsx` 已完成三栏集成：`FileTree | Editor | Chat`，并支持 `Cmd/Ctrl+S`

**本轮关键修复（已验证）：**
- 修复空文件切换不同步：`TiptapEditor` 外部内容同步支持空字符串覆盖旧内容
- 修复应用新开窗口误报 `fs:watch-start`：
  - 当 renderer 持久化了 `workspacePath` 但 main 尚未选中工作目录时，
    `startWatching()` 现在会静默降级并清理本地文件系统状态，不再弹红色错误提示

**当前建议验证清单：**
- [x] 新建空文件后，编辑器正确显示空内容
- [x] 文件树右键菜单与对话框可用（无 `prompt()` 报错）
- [x] 复制/剪切/粘贴冲突提示生效
- [x] FileTabs 切换/关闭/脏标记生效
- [x] 新开应用未选目录时，不再出现 `Workspace is not selected` 红色报错

---

### 7. 文件系统 Step 8a（已完成）：文件加入 Agent 上下文

**新增 IPC（Main + Preload + Types）：**
- `fs:add-to-context`
- `fs:remove-from-context`
- `fs:list-context`

对应文件：
- `electron/services/filesystem/index.ts`
- `electron/preload/index.ts`
- `src/types/electron.d.ts`

**实现细节：**
- context 落盘路径：`~/.openclaw/agents/{agentId}/context/boomclaw-files/`
- 以“工作目录相对路径”镜像保存，避免同名文件覆盖：
  - 例：`workspace/chapters/01.md` → `.../context/boomclaw-files/chapters/01.md`
- 仅允许添加工作目录内文件（复用 workspace 安全校验）
- `agentId` 做格式校验（仅允许 `[a-z0-9_-]`）

**Store 扩展（`src/stores/filesystem.ts`）：**
- 新增状态：`contextFiles: string[]`
- 新增动作：
  - `addToContext(filePath, agentId?)`
  - `removeFromContext(filePath, agentId?)`
  - `loadContextFiles(agentId?)`
- 已处理 rename/move/delete 时 `contextFiles` 的路径同步映射

**UI 扩展（`src/components/filesystem/FileTree.tsx`）：**
- 右键文件新增：
  - `添加到上下文` / `Add to Context`
  - `从上下文移除` / `Remove from Context`
- 已添加到上下文的文件在树中高亮（主色文本）
- 跟随当前会话 agent（`currentAgentId`）加载对应 `contextFiles`

**建议验证：**
- [ ] 右键任意文件 → 添加到上下文后，菜单切为“从上下文移除”
- [ ] 切换会话 agent 后，文件树上下文高亮随 agent 变化
- [ ] 移动/重命名已加入上下文的文件，状态保持同步

---

### 8. 会话绑定工作区（首个小步闭环）

> 目标：让“小说工作目录”随会话自动映射，避免用户每次手动选目录。

**本步已实现：**
- 新增 IPC：`fs:ensure-default-workspace`
  - 自动创建默认小说目录：
    - `~/Documents/BoomClaw Workspaces/我的第一部小说`
  - 自动初始化目录结构与模板文件：
    - `00_设定/人物设定.md`
    - `00_设定/世界观.md`
    - `01_大纲/总纲.md`
    - `02_正文/第01章.md`
    - `README.md`
- `preload` 与 `electron.d.ts` 已补充 `ensureDefaultWorkspace` 暴露

**Store 扩展（`src/stores/filesystem.ts`）：**
- 新增状态：
  - `defaultWorkspacePath`
  - `workspaceBindings: Record<sessionKey, workspacePath>`
- 新增动作：
  - `bindWorkspaceToSession(sessionKey, workspacePath)`
  - `applyWorkspaceForSession(sessionKey)`
  - `ensureDefaultWorkspaceForSession(sessionKey)`
- 持久化范围新增：
  - `defaultWorkspacePath`
  - `workspaceBindings`

**会话联动（`src/pages/Chat/index.tsx`）：**
- 监听 `currentSessionKey` 变化，自动调用 `applyWorkspaceForSession(currentSessionKey)`
  - 已绑定会话：加载绑定目录
  - 未绑定会话：自动创建/加载默认小说目录并绑定

**手动选目录联动（`src/components/filesystem/FileTree.tsx`）：**
- 用户点击“打开目录”后，自动绑定到当前会话：
  - `bindWorkspaceToSession(currentSessionKey, selectedPath)`

**建议验证：**
- [ ] 首次打开聊天页时，自动出现 `我的第一部小说` 默认工作区
- [ ] 新建会话后，自动映射到默认工作区（若无专属绑定）
- [ ] 在会话 A 选新目录后，切换会话 B 再切回 A，目录映射保持不丢失

---

### 9. 会话工作区与 Agent 标准链路（进行中，主链已通）

> 目标：不靠临时 prompt hack，而是通过 OpenClaw 的标准 skill/tool 机制，让 AI 在会话绑定工作区内稳定执行读写。

**本轮已完成：**
- 会话绑定目录会同步到 OpenClaw `agent.workspace`（主链路）
  - `electron/utils/agent-config.ts` 新增 `updateAgentWorkspace(agentId, workspacePath)`
  - `electron/api/routes/agents.ts` 扩展 `PUT /api/agents/:agentId` 支持 `workspace`
  - `src/stores/filesystem.ts` 在 `bindWorkspaceToSession/applyWorkspaceForSession` 时同步 agent workspace
- 工作区切换后仅在路径变更时触发 gateway reload（避免频繁重载）

**用户已验证：**
- [x] 控制台 `Workspace is not selected` 问题已解决
- [x] 新建会话能自动打开默认目录
- [x] 基础文件读写 API 正常

**当前问题（未解决）：**
- [ ] 输入“帮我写一篇小说”时，模型仍可能直接在聊天中输出正文，未稳定触发“先读目录 + 再写文件”

---

### 10. 目录可见性优化（已完成）

> 目标：避免普通用户在小说目录看到运行时引导文件而困惑。

**已实现（UI 层隐藏，不影响运行时）：**
- `src/stores/filesystem.ts` 对工作区根目录文件树做过滤，隐藏以下运行时文件：
  - `AGENTS.md` / `SOUL.md` / `TOOLS.md` / `USER.md`
  - `IDENTITY.md` / `HEARTBEAT.md` / `BOOT.md`
  - `BOOTSTRAP.md` / `BOOTSRAP.md`
  - `README.md` / `READMR.md`

**说明：**
- 仅隐藏展示，不删除文件；OpenClaw 运行仍可使用这些引导文件。

---

### 11. Skill 化尝试（已完成第一步，待验证行为）

> 用户要求改为“能力层注入”（OpenClaw skill/tool），而非对每条消息做强提示注入。

**已完成：**
- 新增本地写作 skill：
  - `resources/custom-skills/novel-writing-workflow/SKILL.md`
- 启动时自动安装 + 自动启用：
  - `electron/utils/skill-config.ts` 新增 `ensureManagedLocalSkillsInstalled()`
  - `electron/main/index.ts` 启动流程新增该安装调用
- 已移除聊天发送链路中的“强提示词注入”逻辑（回归原始消息发送）：
  - `src/stores/chat/runtime-send-actions.ts`

**当前结论：**
- skill 已接入工程侧发布/安装链路；
- 但“小说任务自动写文件”行为仍未稳定出现，需继续做执行层闭环（见下节）。

---

## 下个会话接力（高优先级）

1. **先做可观测性**（必须）  
   在 chat 运行时统计本轮是否发生文件相关 `tool_use/tool_result`，并记录最小诊断信息（tool 名、参数摘要、是否落盘）。

2. **做执行兜底（一次性重试）**  
   若命中“小说写作意图”且本轮无文件写入，则自动追加一次系统级重试指令（仅一次），要求先 list/read 再 write。

3. **确认 skill 是否被 runtime 实际加载**  
   核查 `~/.openclaw/skills/novel-writing-workflow` 与 `openclaw.json skills.entries` 的启用状态，并验证 gateway reload 后生效。

4. **联调验收标准**  
   对“帮我写一篇小说”至少满足：
   - 先读目录/关键文件；
   - 再给简短计划；
   - 最后写入 `02_正文/*.md` 并在聊天里汇总。

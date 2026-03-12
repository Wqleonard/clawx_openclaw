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

---

## 待完成（Phase 1 剩余）

- [ ] `CustomProvider` — 接入自家 AI 模型 API，与 OpenClaw 并行
- [ ] 设置页扩展 — 新增"自家模型"配置入口
- [ ] 聊天页扩展 — 支持切换 OpenClaw 模型 / 自家模型
- [ ] 用户信息展示 — 侧边栏/顶栏显示登录用户头像、昵称

## 待完成（Phase 2）

- [ ] 业务接口调用（自定义工具/函数调用）
- [ ] 多模型协同
- [ ] 诊断日志导出、断线重连、错误码归一

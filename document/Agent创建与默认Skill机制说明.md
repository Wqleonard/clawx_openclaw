# BoomClaw — Agent 创建与默认 Skill 机制说明

> 本文档面向接手开发的同事，帮助 AI 快速理解 `electron/` 侧的两项核心改动：
> 1. **Agent 创建逻辑扩展**：支持模板创建、从现有 Agent 复制、创建时绑定工作区、创建后动态更新工作区
> 2. **预装 Skill 机制**：`preinstalled-manifest.json` 驱动的自动 Skill 部署流程

---

## 一、Agent 创建逻辑（`electron/utils/agent-config.ts`）

### 1.1 新增：`listAgentTemplates()`

**提交**：「让 agent 创建允许从模板进行创建」

**作用**：扫描 `resources/agent-templates/` 目录，返回所有可用模板列表，供前端展示模板选择 UI。

```typescript
export async function listAgentTemplates(): Promise<AgentTemplate[]>
// 返回：AgentTemplate[] = { id: string; name: string; description?: string }[]
```

**实现逻辑**：
- 遍历 `resources/agent-templates/` 下每个子目录
- 读取子目录内的 `meta.json`（字段：`name`、`description`）
- 若无 `meta.json` 则以目录名作为 `id` 和 `name`
- 忽略非目录条目，`meta.json` 解析失败时静默跳过

**对应路由**：`GET /api/agents/templates`（在 `electron/api/routes/agents.ts` 中新增）

---

### 1.2 变更：`createAgent()` 签名扩展

**变更历程**（三次提交逐步扩展）：

```
// 原始签名（改动前）
createAgent(name: string): Promise<AgentsSnapshot>

// 第一次扩展：支持模板
createAgent(name: string, templateId?: string): Promise<AgentsSnapshot>

// 第二次扩展：支持从现有 Agent 复制（templateId 改为 options 对象）
createAgent(name: string, options?: { templateId?: string; sourceAgentId?: string }): Promise<AgentsSnapshot>

// 第三次扩展：支持创建时指定工作区（当前最终签名）
createAgent(name: string, options?: { templateId?: string; sourceAgentId?: string; workspacePath?: string }): Promise<AgentsSnapshot>
```

**`options` 参数说明**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `templateId` | `string?` | 模板目录名，对应 `resources/agent-templates/{templateId}/`；不传则使用 `default` 模板 |
| `sourceAgentId` | `string?` | 现有 Agent 的 ID；传入后从该 Agent 工作区复制启动文件，优先级高于 `templateId` |
| `workspacePath` | `string?` | 创建时指定工作区绝对路径；不传则自动分配 `~/.openclaw/workspace-{agentId}` |

**`createAgent()` 内部流程**：

```
1. withConfigLock() 加锁（防并发写 openclaw.json）
2. 读 ~/.openclaw/openclaw.json
3. normalizeAgentsConfig() → 取现有 agent 列表
4. slugifyAgentId(name) 生成候选 ID，与现有 ID + 磁盘目录去重，冲突则追加 -2、-3...
5. 解析工作区路径：
     options.workspacePath?.trim() || `~/.openclaw/workspace-${nextId}`
6. 构造 AgentListEntry { id, name, workspace, agentDir }，追加到 agents.list
7. 写回 ~/.openclaw/openclaw.json
8. provisionAgentFilesystem(config, newAgent, options)  ← 文件系统初始化（见下）
9. buildSnapshotFromConfig(config) 返回快照
```

---

### 1.3 私有函数变更：`provisionAgentFilesystem()`

**签名变化**：

```typescript
// 改动前
async function provisionAgentFilesystem(config, agent): Promise<void>

// 改动后（第一次，仅 templateId）
async function provisionAgentFilesystem(config, agent, templateId?: string): Promise<void>

// 改动后（第二次，改为 options 对象，当前最终）
async function provisionAgentFilesystem(
  config: AgentConfigDocument,
  agent: AgentListEntry,
  options?: { templateId?: string; sourceAgentId?: string },
): Promise<void>
```

**内部分支逻辑**：

```
options.sourceAgentId 有值？
    ├── 是 → copyBootstrapFiles(sourceWorkspace, targetWorkspace)
    │         从现有 Agent 的工作区复制 IDENTITY.md / SOUL.md 等启动文件
    └── 否 → writeBootstrapFilesFromTemplate(resolvedTemplateId, targetWorkspace)
              从 resources/agent-templates/{templateId}/ 复制启动文件
              templateId 未传时默认用 'default'

两种分支均幂等：目标文件已存在则跳过，不覆盖
最后：copyRuntimeFiles(sourceAgentDir, targetAgentDir)
      从 main agent 的 agentDir 复制运行时文件（auth-profiles.json 等）
```

**`writeBootstrapFilesFromTemplate()`**（本次新增的私有函数）：

```typescript
async function writeBootstrapFilesFromTemplate(templateId: string, targetWorkspace: string): Promise<void>
```

- 模板路径：`resources/agent-templates/{templateId}/`
- 若模板目录不存在，直接抛出 `Error: Agent template "xxx" not found`
- 遍历 `AGENT_BOOTSTRAP_FILES`（`IDENTITY.md`、`SOUL.md`、`AGENTS.md` 等）逐一复制
- 目标文件已存在则跳过（幂等）

---

### 1.4 新增：`updateAgentWorkspace()`

**提交**：「给 agent 对话注入 skills 和文件目录读写」

**签名**：

```typescript
export async function updateAgentWorkspace(
  agentId: string,
  workspacePath: string,
): Promise<{ snapshot: AgentsSnapshot; changed: boolean }>
```

**作用**：在 Agent 已创建之后，动态修改它的工作区目录（写 `~/.openclaw/openclaw.json`）。

**关键设计 — `changed` 标志**：

```typescript
const prevWorkspace = entries[index].workspace?.trim() ?? '';
const changed = prevWorkspace !== nextWorkspace;

if (changed) {
  // 只有路径真的变了才写文件
  entries[index] = { ...entries[index], workspace: nextWorkspace };
  config.agents = { ...agentsConfig, list: entries };
  await writeOpenClawConfig(config);
}
// 无论是否变化，都返回最新快照
const snapshot = await buildSnapshotFromConfig(config);
return { snapshot, changed };
```

调用方（`electron/api/routes/agents.ts`）根据 `changed` 决定是否触发 Gateway reload：

```typescript
const { snapshot, changed } = await updateAgentWorkspace(agentId, body.workspace);
if (changed) {
  scheduleGatewayReload(ctx, 'update-agent-workspace');
}
```

**这样设计的原因**：更新工作区不需要重建文件系统（不像创建 Agent），但 Gateway 需要 reload 才能使新路径生效。路径无变化时不触发 reload，避免频繁重载。

---

## 二、路由层变更（`electron/api/routes/agents.ts`）

### 2.1 新增路由：`GET /api/agents/templates`

```typescript
if (url.pathname === '/api/agents/templates' && req.method === 'GET') {
  const templates = await listAgentTemplates();
  sendJson(res, 200, { success: true, templates });
}
```

返回格式：`{ success: true, templates: AgentTemplate[] }`

---

### 2.2 变更路由：`POST /api/agents`

**Body 类型从** `{ name: string }` **扩展为**：

```typescript
{
  name: string;
  templateId?: string;       // 选用哪个模板
  sourceAgentId?: string;    // 从哪个已有 Agent 复制
  workspacePath?: string;    // 创建时指定工作区路径
}
```

全部透传给 `createAgent(body.name, { templateId, sourceAgentId, workspacePath })`。

---

### 2.3 变更路由：`PUT /api/agents/:agentId`

原本只支持修改名称（`{ name: string }`），现在新增对 `workspace` 字段的判断：

```typescript
const body = await parseJsonBody<{ name?: string; workspace?: string }>(req);
const agentId = decodeURIComponent(parts[0]);

if (typeof body.workspace === 'string') {
  // workspace 更新分支 —— 调用 updateAgentWorkspace
  const { snapshot, changed } = await updateAgentWorkspace(agentId, body.workspace);
  if (changed) scheduleGatewayReload(ctx, 'update-agent-workspace');
  sendJson(res, 200, { success: true, changed, ...snapshot });
  return true;
}

// 没有 workspace 字段 → 仍走原来的改名逻辑
const snapshot = await updateAgentName(agentId, body.name || '');
scheduleGatewayReload(ctx, 'update-agent-name');
sendJson(res, 200, { success: true, ...snapshot });
```

**两个操作用同一个 PUT 路由，靠请求 body 中是否有 `workspace` 字段来区分。**

---

## 三、预装 Skill 机制（`electron/utils/skill-config.ts`）

### 3.1 两个关键目录

**① `resources/skills/preinstalled-manifest.json`** — 指定要安装哪些 Skill 的清单文件：

```json
{
  "skills": [
    { "slug": "story-setting-skill",    "version": "1.0.0", "autoEnable": true },
    { "slug": "role-setting-skill",     "version": "1.0.0", "autoEnable": true },
    { "slug": "outline-creation-skill", "version": "1.0.0", "autoEnable": true },
    { "slug": "intro-creation-skill",   "version": "1.0.0", "autoEnable": true },
    { "slug": "content-creation-skill", "version": "1.0.0", "autoEnable": true }
  ]
}
```

**② `resources/preinstalled-skills/`** — Skill 的真实源文件目录，每个 `slug` 对应一个子目录：

```
resources/preinstalled-skills/
├── story-setting-skill/
│   └── SKILL.md
├── role-setting-skill/
│   ├── SKILL.md
│   └── 角色设定写作指南/          ← Skill 附带的参考资料目录
│       ├── 小程序-女频短篇 - 甜文-...md
│       ├── 小程序-女频短篇 - 虐文-...md
│       └── ...（按体裁分类的写作参考文档）
├── outline-creation-skill/
│   ├── SKILL.md
│   └── 大纲写作指南/
├── intro-creation-skill/
│   ├── SKILL.md
│   └── 导语写作指南/
└── content-creation-skill/
    ├── SKILL.md
    └── 文风.md
```

> **重要**：`resources/skills/preinstalled-manifest.json` 只是声明要安装哪些、版本号是多少；真正被复制到用户本地的文件全部来自 `resources/preinstalled-skills/{slug}/`。两者必须对应。

---

### 3.2 `ensurePreinstalledSkillsInstalled()`

**触发时机**：主进程启动时（`electron/main/index.ts`），非阻塞调用。

**源目录解析**（`resolvePreinstalledSkillsSourceRoot()`，按优先级查找第一个存在的）：

```
1. {getResourcesDir()}/preinstalled-skills      ← 打包后 / 开发时 resources/ 目录
2. {process.cwd()}/build/preinstalled-skills    ← 备用：构建产物目录
3. {__dirname}/../../build/preinstalled-skills  ← 备用：相对路径
```

**安装策略（幂等）**：

| 场景 | 行为 |
|------|------|
| `~/.openclaw/skills/{slug}/` 不存在 | 严格镜像复制 `resources/preinstalled-skills/{slug}/`，写 `.storyclaw-preinstalled.json` 标记 |
| 目标已有 `SKILL.md`，无标记文件 | **覆盖更新（严格镜像）**，先删目标目录再复制 |
| 标记存在且版本 == 期望版本 | **跳过** |
| 标记存在但版本不同 | **覆盖更新（严格镜像）**，先删目标目录再复制 |

`autoEnable: true` 时安装完成后自动调用 `setSkillsEnabled([slug], true)`。


---

## 四、关键文件速查

| 文件 | 主要改动 |
|------|----------|
| `electron/utils/agent-config.ts` | 新增 `listAgentTemplates()`、`updateAgentWorkspace()`；扩展 `createAgent()` 签名（options 对象）；新增私有函数 `writeBootstrapFilesFromTemplate()` |
| `electron/api/routes/agents.ts` | 新增 `GET /api/agents/templates`；`POST /api/agents` body 扩展；`PUT /api/agents/:id` 新增 `workspace` 字段处理分支 |
| `resources/agent-templates/` | 新增多个模板目录（`default/`、`open_claw/`、`bao_wen_agent/`），每个含 `meta.json` + 启动文件 |
| `resources/skills/preinstalled-manifest.json` | 声明要安装的 Skill 清单（slug + version + autoEnable） |
| `resources/preinstalled-skills/` | 5 个 Skill 的真实源文件（`SKILL.md` + 各体裁写作参考目录） |

---

## 五、前端（src）调用层梳理

> 调用规则：
> - **HTTP 路由**（`/api/agents/*`）→ `hostApiFetch`（`src/lib/host-api.ts`）
> - **IPC 通道**（`fs:*`、`dialog:*` 等）→ `invokeIpc`（`src/lib/api-client.ts`）
> - **事件监听**（文件变更推送等）→ `window.electron.fs.onChanged(...)`

---

### 5.1 `src/stores/agents.ts`：Agent 管理

| store 方法 | 实际调用 | 说明 |
|-----------|----------|------|
| `fetchTemplates()` | `hostApiFetch GET /api/agents/templates` | 拉取模板列表，存入 `templates` state |
| `createAgent(name, options?)` | `hostApiFetch POST /api/agents` | 创建 Agent |
| `updateAgent(agentId, name)` | `hostApiFetch PUT /api/agents/:id { name }` | 改名 |
| `deleteAgent(agentId)` | `hostApiFetch DELETE /api/agents/:id` | 删除 |

`createAgent` 的 `options` 参数（均可选）：

```typescript
{
  templateId?: string;     // 对应 resources/agent-templates/ 下的目录名
  sourceAgentId?: string;  // 从现有 Agent 复制提示词，优先级高于 templateId
  workspacePath?: string;  // 创建时绑定工作区路径，不传则自动分配
}
```

---

### 5.2 `src/stores/filesystem.ts`：工作区绑定与文件操作

工作区与 Agent 的绑定关系由 `useFileSystemStore` 管理，核心是 `workspaceBindings: Record<sessionKey, workspacePath>`。

**`sessionKey` 格式**：`agent:{agentId}`，例如 `agent:main`、`agent:my-writer`

| store 方法 | 实际调用 | 说明 |
|-----------|----------|------|
| `bindWorkspaceToSession(sessionKey, workspacePath)` | `hostApiFetch PUT /api/agents/:id { workspace }` | 将工作区路径写入 bindings，并同步到 openclaw.json |
| `applyWorkspaceForSession(sessionKey)` | 同上 | 切换会话时自动应用已绑定的工作区 |
| `openFolder()` | `invokeIpc('fs:open-folder')` | 弹系统对话框选目录（fs 专用通道） |
| `initWorkspace(path)` | `invokeIpc('fs:set-workspace', path)` + `refreshTree()` | 设置工作区并刷新目录树 |
| `refreshTree()` | `invokeIpc('fs:read-tree')` | 读取目录树 |
| `openFile(path)` | `invokeIpc('fs:read-file', path)` | 读文件内容 |
| `saveFile(path)` | `invokeIpc('fs:write-file', path, content)` | 写文件 |
| `addToContext(path, agentId?)` | `invokeIpc('fs:add-to-context', path, agentId)` | 将文件镜像到 Agent context 目录 |
| `startWatching()` | `invokeIpc('fs:watch-start')` + `window.electron.fs.onChanged(cb)` | 监听目录变化，变化时自动 `refreshTree` |

**`syncAgentWorkspaceBinding`（内部私有函数）**：将 `sessionKey` 解析为 `agentId`，调用 `hostApiFetch PUT /api/agents/:id { workspace }`，由 `bindWorkspaceToSession` 和 `applyWorkspaceForSession` 在内部调用，组件不需要直接使用。

---

### 5.3 Agents 页面中的文件夹选择

`src/pages/Agents/index.tsx` 的创建对话框里，选择工作区目录走的是 `dialog:open` IPC，而不是 `fs:open-folder`：

```typescript
import { invokeIpc } from '@/lib/api-client';

const result = await invokeIpc<{ canceled: boolean; filePaths: string[] }>('dialog:open', {
  properties: ['openDirectory'],
});
if (!result.canceled && result.filePaths.length > 0) {
  setWorkspacePath(result.filePaths[0]);
}
```

> `fs:open-folder`（在 `filesystem.ts` 的 `openFolder()` 中）和 `dialog:open`（在 Agents 页面中）都能打开系统目录选择框，但前者在选完后会自动初始化工作区，后者只返回路径供表单使用。

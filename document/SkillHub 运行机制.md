# SkillHub 运行机制

## 1. 架构与调用链

```
┌─────────────────────────────────────────────────────────────────┐
│  Renderer (React)                                                │
│  src/stores/skills.ts  →  hostApiFetch('/api/skillhub/search')   │
│                        →  hostApiFetch('/api/skillhub/install')  │
└───────────────────────────────┬─────────────────────────────────┘
                                │ IPC / Host API (端口 3210)
┌───────────────────────────────▼─────────────────────────────────┐
│  Main Process                                                   │
│  electron/api/routes/skillhub.ts  →  handleSkillHubRoutes()     │
│  electron/api/context.ts          →  ctx.skillHubService        │
│  electron/services/skillhub-service.ts  →  SkillHubService      │
└───────────────────────────────┬─────────────────────────────────┘
                                │ HTTP GET（搜索/下载）
┌───────────────────────────────▼─────────────────────────────────┐
│  外部服务                                                        │
│  搜索: lb-xxx.clb.gz-tencentclb.com/api/v1/search               │
│  下载: 主 URL (clb) / 备 URL (COS)                              │
│  可选: 本地索引 electron/demo/skillhub/skills_index.local.json   │
└─────────────────────────────────────────────────────────────────┘
```

## 2. 搜索机制

- **在线（默认）**：`GET` 腾讯 CLB `/api/v1/search?q=&limit=`，请求头 `User-Agent: skillhub-inkmind-client/1.0`，超时 10s。响应期望 `{ results: [ { slug, displayName|name, summary|description, version } ] }`。未返回有效 results 时回退到离线。
- **离线**：读 `electron/demo/skillhub/skills_index.local.json`（可为顶层数组或 `data.skills`），用 `query` 对每项 `slug/name/description/summary/tags` 拼成小写文本做子串匹配，按命中次数排序后取前 `limit` 条。文件不存在则返回空数组。
- **路由**：`POST /api/skillhub/search`，Body `{ query, limit?, offline? }`，返回 `{ success, results }` 或 `{ success: false, error }`。

## 3. 下载与安装机制

- **下载**：主 URL `.../api/v1/download?slug={slug}`，备 URL `.../skills/{slug}.zip`。按主→备顺序试，每 URL 最多重试 2 次（间隔 500ms 递增）。校验响应前 4 字节为 ZIP 魔数 `PK\x03\x04`，用 JSZip 解压得到 `Record<path, string|Buffer>`，从 `config.json` 或 `{slug}/config.json` 取 `name`、`version`。单次 GET 超时 30s。
- **安装**：`POST /api/skillhub/install`，Body `{ slug }`。先 `fetchSkill({ slug })`，再写入 `~/.openclaw/skills/{slug}`，按 `skill.files` 相对路径建目录并写文件（string 用 UTF-8）。安装结果与 ClawHub 共用同一目录，由 `ClawHubService.listInstalled()` 扫描合并展示。
- **仅拉取**：`POST /api/skillhub/fetch` 只拉取并解压到内存，返回 `{ success, skill }`，不写盘。

## 4. 与 ClawHub 的协作

- 安装目录统一为 `~/.openclaw/skills/{slug}`。
- `ClawHubService.listInstalled()`：先执行 `clawhub list`，再扫描 `~/.openclaw/skills` 子目录，有 `SKILL.md` 或 `config.json` 且不在 CLI 列表中的视为磁盘技能（含 SkillHub 安装），合并进列表，版本从 config/frontmatter 读。
- 卸载走 `POST /api/clawhub/uninstall`，删目录并更新 `.clawhub/lock.json`，SkillHub 安装的技能也由此卸载。技能配置（API Key、env）经 `GET/PUT /api/skills/configs`、`/api/skills/config` 管理，与来源无关。

## 5. 数据流小结

| 操作       | 前端                  | Host API                     | 服务层                         | 外部/磁盘           |
|------------|-----------------------|-----------------------------|--------------------------------|---------------------|
| 搜索       | `searchSkills(query)` | `POST /api/skillhub/search` | `SkillHubService.searchSkills()` | CLB API 或本地索引  |
| 安装       | `installSkill(slug)`  | `POST /api/skillhub/install`| `fetchSkill()` → 写 `~/.openclaw/skills/{slug}` | 主/备下载 URL       |
| 已安装列表 | `fetchSkills()`       | `GET /api/clawhub/list`     | `ClawHubService.listInstalled()` | 磁盘扫描 + CLI list |
| 卸载       | `uninstallSkill(slug)`| `POST /api/clawhub/uninstall` | `ClawHubService.uninstall()`  | 删目录 + lock.json  |

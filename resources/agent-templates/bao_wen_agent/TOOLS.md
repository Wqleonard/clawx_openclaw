# TOOLS.md - Local Notes

Skills define _how_ tools work. This file is for _your_ specifics — the stuff that's unique to your setup.

## What Goes Here

Things like:

- Camera names and locations
- SSH hosts and aliases
- Preferred voices for TTS
- Speaker/room names
- Device nicknames
- Anything environment-specific

## Examples

```markdown
### Cameras

- living-room → Main area, 180° wide angle
- front-door → Entrance, motion-triggered

### SSH

- home-server → 192.168.1.100, user: admin

### TTS

- Preferred voice: "Nova" (warm, slightly British)
- Default speaker: Kitchen HomePod
```

## Why Separate?

Skills are shared. Your setup is yours. Keeping them apart means you can update skills without losing your notes, and share skills without leaking your infrastructure.

---

Add whatever helps you do your job. This is your cheat sheet.

<!-- StoryClaw:begin -->
## StoryClaw Tool Notes

### uv (Python)

- `uv` is bundled with StoryClaw and on PATH. Do NOT use bare `python` or `pip`.
- Run scripts: `uv run python <script>` | Install packages: `uv pip install <package>`

### Browser

- `browser` tool provides full automation (scraping, form filling, testing) via an isolated managed browser.
- Flow: `action="start"` → `action="snapshot"` (see page + get element refs like `e12`) → `action="act"` (click/type using refs).
- Open new tabs: `action="open"` with `targetUrl`.
- To just open a URL for the user to view, use `shell:openExternal` instead.

## 小说文件结构

你需要在你的工作空间中创建以下文件来完成一个小说得创作。
如果用户没有额外得要求，小说文件直接创建在你的工作空间根目录，不再创建额外“项目根文件夹”。

```
./大纲.md                  # 大纲文件（章节列表；若用户未指定长度，默认生成 10 章）
./设定/                    # 设定目录
./设定/故事设定.md         # 故事设定（文章标题、主要事件、文本类型、世界观设定）（必须生成）
./设定/角色设定.md         # 角色设定（主角信息、角色表、角色关系网）（必须生成）
./设定/...                 # 其他设定文件
./正文/                    # 正文目录
./正文/导语.md             # 导语文件（开头吸引内容，500 字以内）
./正文/第一章.md           # 第一章正文（默认 2000 字以内）
./正文/第二章.md           # 第二章正文
./正文/...                 # 其余章节
```

## Markdown 文件格式规范

所有 `.md` 文件必须遵守以下格式要求：

1. 遵循 CommonMark 规范。
2. 禁止使用行尾空格。
3. 禁止使用 HTML 段落标签（如 `<p></p>`）。
4. 需要分段时使用连续空行（`\n\n`）进行换行。

## 技能系统

| 技能 | 适用场景 |
|---|---|
| `story-setting-skill` | 设计世界观 |
| `role-setting-skill` | 创建/完善角色档案、关系图谱 |
| `outline-creation-skill` | 规划章节大纲 |
| `intro-creation-skill` | 生成或改写导语（正文/导语.md） |
| `content-creation-skill` | 撰写、续写、扩写正文章节 |

## 工作案例

<example>
User：（用户表达想创作小说）
Assistant：（先思考并识别信息缺口）
Assistant：在开始创作前，我需要先确认题材、篇幅和章节规模。你希望写什么类型？预计多少章节？
User：（补充信息）
Assistant：（根据当前任务类型先读取对应技能文件，例如设定任务读取 `story-setting-skill/SKILL.md`，大纲任务读取 `outline-creation-skill/SKILL.md`）
Assistant：（根据skill要求编写文件）
Assistant：（向用户汇报）我已完成第一阶段，接下来是否继续进入正文创作？
</example>

<example>
User：（对已生成内容提出修改）
Assistant：（先分析修改点与影响范围）
Assistant：（先读取与修改目标匹配的技能文件，例如正文修改读取 `content-creation-skill/SKILL.md`，角色调整读取 `role-setting-skill/SKILL.md`）
Assistant：（根据skill要求编写文件）
Assistant：（向用户汇报）我已按你的意见完成本轮修改。请确认是否满意，或告诉我下一步要继续调整的点。
</example>

## 工具调用规则

1. 工具必须通过真实 tool call（函数名 + 参数）触发，不能仅用自然语言描述“我将调用某工具”。
2. 未形成 tool call 的自然语言不产生任何工具执行效果。
3. 需要灵感、题材素材或事实补充时，优先使用网络搜索工具来获取参考信息。

<!-- StoryClaw:end -->
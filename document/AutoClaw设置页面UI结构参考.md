# AutoClaw 设置页面 UI 结构参考

> 通过逆向解包 `AutoClaw-0.2.17-arm64-mac.zip`（`app.asar`）提取的设置页面完整结构，供 BoomClaw 仿制参考。
> 解包命令：`npx asar extract app.asar /tmp/autoclaw-0217-extracted`
> 关键文件：`/tmp/autoclaw-0217-extracted/out/renderer/assets/index-uGfPtZzh.js`

---

## 当前任务状态（新会话必读）

### 任务目标
在 BoomClaw 侧边栏 Settings 按钮**上方**新增一个「偏好设置」入口按钮，点击进入 `/preferences` 路由页面，UI **完全仿照 AutoClaw 0.2.17 的设置页面**，包括左侧导航顺序、右侧每个 section 的内容和样式。

### 已完成
- `src/pages/Preferences/index.tsx` — 主页面，左侧 180px 导航 + 右侧内容两栏布局
- `src/pages/Preferences/sections/GeneralSection.tsx` — 通用页（账号与安全 + 外观与行为 + 退出登录）
- `src/pages/Preferences/sections/ModelsSection.tsx` — 模型与 API（复用 ProvidersSettings）
- `src/pages/Preferences/sections/WorkspaceSection.tsx` — 工作区
- `src/pages/Preferences/sections/SkillsSection.tsx` — 技能（复用 Skills 页）
- `src/pages/Preferences/sections/ChannelsSection.tsx` — IM 频道（复用 Channels 页）
- `src/pages/Preferences/sections/UsageSection.tsx` — 用量统计（复用 Models 页 Token Usage 逻辑）
- `src/pages/Preferences/sections/AboutSection.tsx` — 关于（版本 + 更新 + 链接）
- `src/pages/Preferences/sections/PlaceholderSections.tsx` — MCP/积分详情/数据与隐私/提交反馈（占位）
- `src/components/layout/Sidebar.tsx` — 新增 SlidersHorizontal 图标入口按钮
- `src/App.tsx` — 注册 `/preferences` 路由
- i18n 三语言新增 `sidebar.preferences` key

### 待优化（逐一截图比对）
用户将逐一提供每个菜单项的截图，需要逐一比对并优化 UI 细节，使其与 AutoClaw 完全一致。

---

## 1. 整体布局

### 入口
- BoomClaw 实现：侧边栏 Settings 按钮**上方**新增「偏好设置」按钮（`SlidersHorizontal` 图标）
- AutoClaw 原版：顶部导航栏齿轮按钮打开全屏弹窗

### 页面结构
```
┌──────────────────────────────────────────────────────────┐
│  左侧导航 (180px)  │  右侧内容区（可滚动，p-8）           │
│  bg-black/[0.02]  │  max-w-2xl                           │
│  border-r         │                                       │
│                   │  [section 标题 - 13px 大写灰色]       │
│  ● 通用           │  [卡片容器 rounded-2xl]               │
│  ○ 用量统计       │    [设置行 px-5 py-4]                 │
│  ○ 积分详情       │    [分隔线 border-b]                  │
│  ○ 模型与 API     │    [设置行 px-5 py-4]                 │
│  ○ MCP 服务       │                                       │
│  ○ 技能           │                                       │
│  ○ IM 频道        │                                       │
│  ○ 工作区         │                                       │
│  ○ 数据与隐私     │                                       │
│  ○ 提交反馈       │                                       │
│  ──────────────   │                                       │
│  ○ 关于           │                                       │
└──────────────────────────────────────────────────────────┘
```

### 左侧导航样式
- 宽度：`w-[180px]`
- 背景：`bg-black/[0.02] dark:bg-white/[0.02]`
- 右边框：`border-r border-black/5 dark:border-white/5`
- 导航项：`px-3 py-[7px] rounded-lg text-[13px]`
- 选中：`bg-black/8 dark:bg-white/10 text-foreground font-medium`
- 未选中：`text-muted-foreground hover:bg-black/5`
- About 用 `flex-1` spacer 推到底部，上方有分隔线

---

## 2. 左侧导航菜单（完整顺序，来自 `settings.tab.*`）

| 顺序 | key | 中文 | 英文 |
|------|-----|------|------|
| 1 | `general` | 通用 | General |
| 2 | `usage` | 用量统计 | Usage |
| 3 | `points` | 积分详情 | Points |
| 4 | `models` | 模型与 API | Models & API |
| 5 | `mcp` | MCP 服务 | MCP Servers |
| 6 | `skills` | 技能 | Skills |
| 7 | `channels` | IM 频道 | IM Channels |
| 8 | `workspace` | 工作区 | Workspace |
| 9 | `privacy` | 数据与隐私 | Data & Privacy |
| 10 | `feedback` | 提交反馈 | Send Feedback |
| — | `about` | 关于 | About |

> 注意：左侧 tab 用的是 `settings.tab.*`，不是 `settings.*.title`

---

## 3. 右侧内容通用样式规范

```tsx
// Section 标题（每个 section 顶部）
<h2 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-1">
  标题
</h2>

// 卡片容器
<div className="rounded-2xl border border-black/5 dark:border-white/8 bg-black/[0.02] dark:bg-white/[0.03] overflow-hidden">
  {/* 设置行 */}
  <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-black/5 dark:border-white/5">
    <div>
      <p className="text-[14px] font-medium text-foreground">标签</p>
      <p className="text-[12px] text-muted-foreground mt-0.5">描述</p>
    </div>
    <Switch /> {/* 或其他控件 */}
  </div>
</div>
```

---

## 4. 各 Section 详细内容（0.2.17）

### 4.1 通用（General）— `GeneralSection.tsx`

右侧包含**两个 section card** + **底部退出登录按钮**：

**账号与安全**
- 手机号（只读显示，右侧显示号码）
- 注销账号（右侧红色「注销」按钮，点击需输入手机号中间4位确认）

**外观与行为**
- 主题模式：两个圆形色块按钮
  - Orange Cream（浅色）：`linear-gradient(135deg, #f97316 0%, #fff7ed 60%, #ffffff 100%)`
  - Neon Noir（深色）：`linear-gradient(135deg, #0f0f1a 0%, #1a0a2e 50%, #3b0764 100%)`
  - 选中时：`border-foreground/40 scale-110 shadow-md`
- 开机自启（Switch）
- 显示工具调用（Switch）

**退出登录**（底部全宽红色边框按钮）

---

### 4.2 用量统计（Usage）— `UsageSection.tsx`

- 顶部说明文字
- 过滤器：按模型/按时间 + 近7天/近30天/全部
- 柱状图（UsageBarChart）：输入蓝/输出紫/缓存橙
- 条目列表：模型名 + provider/agentId + token数 + 时间戳
- 分页按钮

---

### 4.3 积分详情（Points）— 占位

- 总积分 + 去充值按钮
- 积分分类：通用/订阅/赠送/促销
- 积分记录列表（全部/消耗/获得）

---

### 4.4 模型与 API（Models & API）— `ModelsSection.tsx`

- 复用 `<ProvidersSettings />` 组件

---

### 4.5 MCP 服务 — 占位

---

### 4.6 技能（Skills）— `SkillsSection.tsx`

- 复用 `<Skills />` 页面组件

---

### 4.7 IM 频道（IM Channels）— `ChannelsSection.tsx`

- 复用 `<Channels />` 页面组件

---

### 4.8 工作区（Workspace）— `WorkspaceSection.tsx`

- 默认项目目录（路径显示 + Browse 按钮）
- 自动保存上下文（Switch）
- 文件监听（Switch）
- 限制文件访问（Switch）

---

### 4.9 数据与隐私 — 占位

---

### 4.10 提交反馈（Send Feedback）— `PlaceholderSections.tsx`

- 反馈内容 Textarea
- 联系方式 Input
- 附带本地日志 Switch
- 提交按钮

---

### 4.11 关于（About）— `AboutSection.tsx`

- 版本号显示
- 文档/GitHub 链接按钮
- 更新检查（复用 `<UpdateSettings />`）
- 自动检查/自动下载 Switch

---

## 5. 关键文件路径

| 文件 | 作用 |
|------|------|
| `src/pages/Preferences/index.tsx` | 主页面框架（左侧导航 + 右侧内容） |
| `src/pages/Preferences/sections/GeneralSection.tsx` | 通用（账号+外观+退出） |
| `src/pages/Preferences/sections/ModelsSection.tsx` | 模型与 API |
| `src/pages/Preferences/sections/WorkspaceSection.tsx` | 工作区 |
| `src/pages/Preferences/sections/SkillsSection.tsx` | 技能 |
| `src/pages/Preferences/sections/ChannelsSection.tsx` | IM 频道 |
| `src/pages/Preferences/sections/UsageSection.tsx` | 用量统计 |
| `src/pages/Preferences/sections/AboutSection.tsx` | 关于 |
| `src/pages/Preferences/sections/PlaceholderSections.tsx` | MCP/积分/隐私/反馈占位 |
| `src/components/layout/Sidebar.tsx` | 侧边栏（新增偏好设置按钮） |
| `src/App.tsx` | 路由注册（`/preferences`） |

---

## 6. 下一步优化方向

用户将逐一提供每个菜单项的截图，需要：
1. 对比截图与当前实现的差异
2. 逐一修复 UI 细节（间距、颜色、字体大小、圆角、分隔线等）
3. 补全占位 section 的实际功能（积分、MCP、隐私）

**优化优先级**：
1. 通用（General）— 最重要，包含账号和外观
2. 用量统计（Usage）
3. 模型与 API（Models）
4. 其余 section

---

## 7. 重新解包说明

如需重新解包 AutoClaw 0.2.17：
```bash
cd /tmp
unzip -q "/Users/leonard/workspace/react_workspace/boom-claw/document/AutoClaw-0.2.17-arm64-mac.zip" -d autoclaw-0217
npx asar extract "/tmp/autoclaw-0217/AutoClaw.app/Contents/Resources/app.asar" /tmp/autoclaw-0217-extracted
# 关键文件：/tmp/autoclaw-0217-extracted/out/renderer/assets/index-uGfPtZzh.js
```

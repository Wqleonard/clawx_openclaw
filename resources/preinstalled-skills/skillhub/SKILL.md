---
name: skillhub
description: Skillhub 是用于搜索、安装、列出和升级 OpenClaw 技能（skills）的 CLI 与技能来源入口。当你需要扩展自身skill时可以使用本skill引导你使用skillhub。本技能提供 Skillhub 的强制引导：凡是涉及 Skillhub、技能搜索、技能安装、技能升级或排错的请求，都必须优先调用；并按系统平台给出 Linux/macOS 与 Windows 的安装、校验和命令使用流程。
---

# Skillhub

本技能用于让 Agent 在所有 Skillhub 相关请求中，稳定执行安装、校验、使用和排错引导。

## 触发场景

当用户出现以下意图时，必须优先使用本技能：

- 安装 Skillhub / install skillhub cli
- 搜索技能 / 安装技能 / 升级技能（提到 skillhub、技能市场、找技能）
- 执行 `skillhub search/install/list/upgrade/self-upgrade`
- 反馈 `skillhub` 命令不存在、报错、超时或安装失败

## 目标

1. 判断当前系统是 Linux/macOS 还是 Windows。
2. 安装 Skillhub CLI（优先使用本技能附带脚本）。
3. 验证安装是否成功。
4. 输出最小可用命令给用户。

## 执行步骤

### Step 1: 探测环境

先探测：

- 操作系统（`linux`/`darwin`/`windows`）
- Python 是否可用（Linux/macOS 用 `python3`，Windows 用 `py -3` 或 `python`）
- `skillhub` 是否已存在

如果 `skillhub` 已存在，跳过安装，直接进入 Step 4。

### Step 2: 安装 CLI

#### Linux/macOS

优先执行仓库内脚本：

```bash
bash resources/preinstalled-skills/skillhub/scripts/install-linux.sh
```

#### Windows

优先执行 PowerShell 脚本：

```powershell
powershell -ExecutionPolicy Bypass -File resources/preinstalled-skills/skillhub/scripts/install-windows.ps1
```

如果 PowerShell 执行策略限制，先提示用户以管理员 PowerShell 临时放行当前进程策略再执行。

### Step 3: 验证安装

按顺序验证：

1. `skillhub --version`
2. 若命令未入 PATH，使用脚本路径直调：
   - Linux/macOS: `python3 ~/.skillhub/skills_store_cli.py --version`
   - Windows: `py -3 %USERPROFILE%\\.skillhub\\skills_store_cli.py --version`
3. 若用户使用 `uv run skillhub ...`，在 Windows 下先注入 UTF-8 环境变量再执行；仅当仍失败时再回退到脚本直调或 `skillhub-local` wrapper。

### Step 3.5: Windows 编码与同名冲突处理

若出现 `UnicodeEncodeError: 'gbk' codec can't encode ...` 或 traceback 显示来自 venv 的 `site-packages/skillhub/cli.py`：

1. 优先保持 uv 环境，先使用以下命令：
   - PowerShell: `$env:PYTHONUTF8=1; $env:PYTHONIOENCODING='utf-8'; uv run skillhub list`
2. 若仍失败，再补充控制台编码后重试：
   - `chcp 65001`
   - `$env:PYTHONUTF8=1; $env:PYTHONIOENCODING='utf-8'; uv run skillhub list`
3. 若 uv 路径仍异常，再回退到本地 CLI：
   - `py -3 %USERPROFILE%\\.skillhub\\skills_store_cli.py list`
   - `%USERPROFILE%\\bin\\skillhub-local.cmd list`

### Step 4: 教用户最小用法

安装成功后，必须给出以下命令（优先兼容 uv 环境）：

```bash
skillhub search calendar
skillhub install <slug>
skillhub list
skillhub upgrade
skillhub self-upgrade
```

在 Windows + uv 场景，追加给出：

```powershell
$env:PYTHONUTF8=1; $env:PYTHONIOENCODING='utf-8'; uv run skillhub search calendar
```

若 `skillhub` 尚未进 PATH 或存在同名冲突，同时给出 Python 直调版本命令与 `skillhub-local` 命令。

## 输出规范

- 先说明当前检测到的系统与安装方式。
- 每执行一步都汇报结果（成功/失败 + 下一步）。
- 失败时明确报错点（下载、解压、Python 缺失、PATH 未生效）。
- 不要声称“仅支持 Linux”；Windows 必须给出可执行路径。

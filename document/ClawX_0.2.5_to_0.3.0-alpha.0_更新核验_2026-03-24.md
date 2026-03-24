# ClawX 0.2.5 -> 0.3.0-alpha.0 更新核验（2026-03-24）

## 1. 核验背景

本次核验目标：

- 确认 Boom-Claw（基于 ClawX 二开）是否已经吸收上游 `v0.2.5` 到 `v0.3.0-alpha.0` 的关键修复；
- 识别是否存在“上游修复未应用、但本地自研替代”或“确实缺失”的情况；
- 给后续升级提供可追踪的审计记录。

参考比较页面（官方）：

- [ValueCell-ai/ClawX compare v0.2.5...v0.2.7](https://github.com/ValueCell-ai/ClawX/compare/v0.2.5...v0.2.7)

说明：

- 上游当前可见的 `v0.3` 标签为 `v0.3.0-alpha.0`，未发现稳定版 `v0.3.0` 标签。

---

## 2. 核验方法

使用本地仓库与上游远端 `github-origin` 进行提交级核验：

1. 获取上游标签与提交区间；
2. 统计 `v0.2.5..v0.3.0-alpha.0` 的提交；
3. 对关键修复 commit 执行 `merge-base --is-ancestor` 判断是否并入当前 `HEAD`；
4. 对未命中的 commit 做文件级 diff，判断是否“功能等价已在本地实现”。

---

## 3. 总体结果

- 区间（非 merge）提交总数：**30**
- 当前分支直接包含：**27**
- 未直接命中：**3**

未直接命中的 3 个提交中：

1. `e417778`：未按哈希并入，但对应逻辑在本地 `scripts/after-pack.cjs` 已存在（等价实现）
2. `776efb2`：未按哈希并入，但 `package.json` 中 `pnpm.supportedArchitectures` 已存在（等价实现）
3. `eaf2131`：`v0.3.0-alpha.0` 版本标记提交（仅版本元数据差异，属 fork 版本策略差异）

结论：**关键修复总体已吸收，未发现“实质修复缺失导致回退”的高风险项。**

---

## 4. 关键修复核验清单（重点）

以下为本次重点核验的上游修复项，均判定已生效（直接并入或等价实现）：

- `fix(linux): Can't change Chinese IMEs on Debian` (#582) -> 已并入
- `fix(models): useReducer token usage fetch state` (#586) -> 已并入
- `fix(windows): Gateway process install extension failed` (#587) -> 已并入
- `fix(windows): bundled openclaw CLI/TUI via node.exe` (#571) -> 已并入
- `fix(gateway): heartbeat timeout recovery` (#588) -> 已并入
- `fix gateway restart` (#593) -> 已并入
- `fix(processes): multiple process running concurrently` (#589) -> 已并入
- `fix(build): prevent node download deleting uv.exe` (#600) -> 已并入
- `fix(providers): model list empty in settings panel` (#591) -> 已并入
- `fix: sanitize stale nested plugin paths` (#608) -> 已并入
- `fix: preserve telegram proxy on gateway restart` (#546) -> 已并入
- `fix: fsPath prefix for Windows Unicode paths` (#612) -> 已并入
- `feat(ark): Code Plan preset` (#617) -> 已并入
- `upgrade wecom plugin to 2026.3.20` (#619) -> 已并入
- `feat(channel): support wechat` (#620) -> 已并入
- `chore(telemetry): stop gateway reconnect payloads` (#623) -> 已并入
- `changed feishu group code` (#630) -> 已并入

---

## 5. 未直接命中提交说明

### 5.1 `e417778`（wrong-arch native modules strip）

- 上游变更文件：`scripts/after-pack.cjs`
- 判定：**等价已实现**
- 依据：本地脚本已包含同类逻辑（平台别名、架构归一、针对 `@node-llama-cpp` / `@esbuild` / `sqlite-vec` 等跨平台 native 包清理）。

### 5.2 `776efb2`（supportedArchitectures）

- 上游变更文件：`package.json`
- 判定：**等价已实现**
- 依据：本地 `package.json` 已包含
  - `pnpm.supportedArchitectures.os = ["current"]`
  - `pnpm.supportedArchitectures.cpu = ["x64","arm64"]`

### 5.3 `eaf2131`（v0.3.0-alpha.0）

- 上游变更文件：`package.json`
- 判定：**可不跟**
- 依据：主要是版本标签/元数据提交；fork 项目采用独立版本号策略。

---

## 6. 结论与建议

### 6.1 当前结论

- 本地代码虽有较多二开改动，但对 `0.2.5 -> 0.3.0-alpha.0` 关键修复没有明显脱节；
- 风险主要不在“修复缺失”，而在后续升级时“重复实现 + 命名漂移”导致审计困难。

### 6.2 后续建议（升级管理）

1. 每次上游升级固定输出一份“提交级核验报告”（本文件即模板）；
2. 对“未按哈希并入但等价实现”的项，附最小代码证据（文件+关键函数名）；
3. 对版本标签提交（tag/version bump）单独归类为“可选同步项”；
4. 升级后追加回归 checklist（进程锁、Gateway 重连、插件安装、跨架构打包）。

---

## 7. 复查命令（留档）

```bash
git log --oneline --no-merges v0.2.5..v0.3.0-alpha.0
git diff --name-only v0.2.5..v0.3.0-alpha.0
git merge-base --is-ancestor <commit> HEAD
git show --name-only --oneline <commit>
```


# ClawX 0.2.5 -> 0.3.0 稳定版更新核验（2026-03-24）

> 说明：本文保持 `0.2.5 -> 0.3.0-alpha.0` 原核验内容不变，并在末尾新增“稳定版补充核验”章节。

## 1. 核验背景

本次核验目标：

- 确认 Boom-Claw（基于 ClawX 二开）是否已经吸收上游 `v0.2.5` 到 `v0.3.0-alpha.0` 的关键修复；
- 识别是否存在“上游修复未应用、但本地自研替代”或“确实缺失”的情况；
- 给后续升级提供可追踪的审计记录。

参考比较页面（官方）：

- [ValueCell-ai/ClawX compare v0.2.5...v0.2.7](https://github.com/ValueCell-ai/ClawX/compare/v0.2.5...v0.2.7)

说明：

- 上游当前可见的 `v0.3` 标签为 `v0.3.0-alpha.0`，未发现稳定版 `v0.3.0` 标签。（该结论为原核验当日状态）

---

## 2. 核验方法

使用本地仓库与上游远端 `github-origin` 进行提交级核验：

1. 获取上游标签与提交区间；
2. 统计 `v0.2.5..v0.3.0-alpha.0` 的提交；
3. 对关键修复 commit 执行 `merge-base --is-ancestor` 判断是否并入当前 `HEAD`；
4. 对未命中的 commit 做文件级 diff，判断是否“功能等价已在本地实现”。

---

## 3. 总体结果（原 alpha.0 核验结论）

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

以下为原核验重点项，均判定已生效（直接并入或等价实现）：

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

## 5. 未直接命中提交说明（原 alpha.0 核验）

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

## 6. 结论与建议（原 alpha.0 核验）

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

---

## 8. 本地命名迁移补充（2026-03-24）

为配合品牌命名统一，本地在不改变业务行为的前提下，将以下持久化文件从 `clawx-*` 迁移为 `storyclaw-*`：

- 设备身份文件：`clawx-device-identity.json` -> `storyclaw-device-identity.json`
- Provider 存储文件：`clawx-providers.json` -> `storyclaw-providers.json`

### 8.1 等价性保证（功能不变，仅改文件名）

1. **新用户路径**  
   首次启动仅创建并读取 `storyclaw-*` 文件，不依赖旧文件。

2. **老用户迁移路径**  
   - 若存在旧文件且新文件缺失：先复制旧数据到新文件，再按原流程加载；
   - 迁移完成后尝试删除旧文件，避免后续重复分叉。

3. **已迁移用户路径**  
   - 直接读取新文件；
   - 不再为“检查迁移”而主动初始化旧 store，避免意外重建 `clawx-providers.json`；
   - 若历史旧文件残留，启动时进行一次安全清理。

### 8.2 风险控制点

- 迁移/清理均为“尽力而为”（best effort）：清理失败不影响主流程可用性；
- 仅在主流程成功建立新文件后执行旧文件删除，避免因清理动作影响正常启动；
- `providerStore` 默认结构（`schemaVersion/providers/providerAccounts/apiKeys/providerSecrets/defaultProvider/defaultProviderAccountId`）保持不变，确保读写语义一致。

---

## 9. 稳定版补充核验（新增）

本章节为在原文基础上新增，用于补齐 `v0.3.0-alpha.0 -> v0.3.0` 稳定版区间。

### 9.1 稳定版提交覆盖结果

- 区间（非 merge）提交总数：**37**（`v0.2.5..v0.3.0`）
- 当前分支直接包含：**37**
- 未直接命中：**0**

结论：以提交祖先关系判断，`v0.2.5 -> v0.3.0` 非 merge 提交已全部进入当前 `HEAD`。

### 9.2 稳定版新增区间（`v0.3.0-alpha.0..v0.3.0`）应用状态

新增 10 条非 merge 提交，核验如下：

1. `fix: use openclaw.json as single source of truth for provider list` (#649)  
   - 状态：**已并入，但当前分支按本地策略回退为旧方案（未启用）**  
   - 说明：`electron/services/providers/provider-service.ts` 的 `listAccounts()` 已切回 `providerAccounts` 展示源；新方案代码以注释保留备用。

2. `Fix provider display` (#641) -> **已应用**
3. `feat(agents): add option to inherit main agent workspace` (#639) -> **已应用**
4. `chore: normalize structure and split ipc handlers` (#590) -> **已应用**
5. `fix: persist provider display state across restarts` (#633) -> **已应用**
6. `fix: clean up WhatsApp credentials on QR cancel` (#637) -> **已应用**
7. `fix(provider): preserve custom headers and add custom-provider User-Agent` (#635) -> **已应用**
8. `Fix discord channel native` (#634) -> **已应用**
9. `fix: persist theme setting to main process store` (#628) -> **已应用**
10. `v0.3.0` 版本标记提交 (#650) -> **已并入**

### 9.3 稳定版补充结论

- 原 alpha.0 文档结论继续有效；
- 稳定版新增提交已覆盖；
- 仅 provider 真源策略属于“上游并入但本地策略覆盖”，已留档，后续升级时需持续复核。

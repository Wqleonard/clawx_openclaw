# BoomClaw 上游 ClawX 更新流程（推荐新方案）

> 目标：以后从 GitHub 上游同步更新时，不再使用大量 `cherry-pick`，改为标准 `merge` 流程，降低冲突成本。

---

## 1. 一次性前置检查（只需确认）

确保远程配置固定如下：

- `origin`：单位 GitLab 仓库（你的主仓库）
- `github-origin`：上游 GitHub ClawX 仓库

检查命令：

```bash
git remote -v
```

如果缺少 `github-origin`，补充：

```bash
git remote add github-origin https://github.com/ValueCell-ai/ClawX.git
```

---

## 2. 每次同步上游的标准流程（以后都用这个）

在你的主开发分支（例如 `develop` 或你当前长期分支）执行：

```bash
git checkout <你的长期开发分支>
git fetch github-origin
git merge github-origin/main
```

说明：

- 这就是后续默认方案，不再逐条 `cherry-pick`。
- 只在真实冲突文件上解决一次即可。

---

## 3. 冲突处理建议（高频文件策略）

如果某些文件你长期希望保持上游版本（例如 `electron/main/ipc-handlers.ts`），冲突时直接：

```bash
git checkout github-origin/main -- electron/main/ipc-handlers.ts
git add electron/main/ipc-handlers.ts
```

然后继续完成 merge：

```bash
git add <其他已解决文件>
git commit
```

---

## 4. 推荐操作习惯（显著减少冲突）

- 缩短同步周期：每周或每几天同步一次上游
- 同步前保证工作区干净：`git status`
- 每次同步前打一个备份分支：

```bash
git branch backup-before-upstream-$(date +%Y%m%d)
```

---

## 5. 常用命令速查

查看当前分支状态：

```bash
git status -sb
```

查看是否仍有未解决冲突：

```bash
git diff --name-only --diff-filter=U
```

查看当前分支相对上游 main 的差异：

```bash
git log --oneline github-origin/main..HEAD
```

---

## 6. 禁用方案（仅作历史参考）

不再推荐以下方式作为常规更新手段：

- 大量 `cherry-pick` 上游或本地提交
- 每次更新都重建“replay 分支”

这些方式在提交变多后维护成本和冲突成本都会显著上升。

---

## 7. 本项目约定（建议）

- 以后统一在“已接上上游历史”的长期分支上开发
- 新功能从该长期分支切 feature 分支
- 不再从旧历史分支继续演进

---

## 8. 一条龙示例（可复制）

```bash
git checkout develop
git status -sb
git branch backup-before-upstream-$(date +%Y%m%d)
git fetch github-origin
git merge github-origin/main
```

若出现冲突，按第 3 节处理后提交，再推送到 GitLab。

# BOOM Lowpriv Executor 插件说明

本文档说明 `boom-lowpriv-executor` 的构建、部署、运行原理、权限边界与开关方式。

---

## 1. 组件关系

- 执行器插件目录：`resources/boom-lowpriv-executor-plugin`
- Rust 可执行文件目录：`boom-executor`
- 插件部署代码：`electron/services/boom-lowpriv-executor/plugin-deploy.ts`
- 主进程启动挂载：`electron/main/index.ts`

运行时链路：

1. Electron 启动后执行 `ensureBoomLowprivExecutorPlugin()`
2. 插件文件复制到 `~/.openclaw/extensions/boom-lowpriv-executor`
3. `before_tool_call` 拦截 `exec` 类工具调用
4. 将原命令重写为通过 `boom-executor.exe` 执行

---

## 2. `boom-executor` 环境与打包

### 2.1 开发环境（Windows）

同事首次在 Windows 机器上搭建环境，按下面步骤执行即可。

1) 安装 Rust 工具链（含 `rustup` / `cargo` / `rustc`）：

```powershell
winget install Rustlang.Rustup
```

2) 安装 Visual Studio C++ 构建工具：

```powershell
winget install Microsoft.VisualStudio.2022.BuildTools
```

3) 在 VS Build Tools 安装器中勾选：

- `Desktop development with C++`
- `MSVC v143 - VS 2022 C++ x64/x86 build tools`
- `Windows 10 SDK` 或 `Windows 11 SDK`（至少一个）

4) 重新打开终端后，执行环境校验：

```powershell
rustup --version
rustc --version
cargo --version
```

5) 首次编译验证（在仓库根目录）：

```powershell
cd boom-executor
cargo build --release
```

`Cargo.toml` 当前关键依赖：

- `clap = "=4.5.29"`（固定版本）
- `windows = "0.58"`（Win32 API 调用）

### 2.2 构建命令

在仓库根目录执行：

```powershell
cd boom-executor
cargo build --release
```

产物路径：

- `boom-executor/target/release/boom-executor.exe`

### 2.3 放置与打包

开发态建议同步到：

- `bin/boom-executor.exe`
- `resources/bin/win32-x64/boom-executor.exe`

Windows 安装包阶段，`electron-builder.yml` 会把：

- `resources/bin/win32-${arch}` -> 应用安装目录下 `bin`

因此生产环境下插件会优先在 `process.resourcesPath/bin` 找到 `boom-executor.exe`。

---

## 3. 插件工作原理

## 3.1 拦截范围

插件只处理以下工具名（大小写不敏感）：

- `exec`
- `bash`
- `bash_tool`
- `execute_command`
- `run_command`
- `shell`
- `powershell`

### 3.2 命令重写

原命令会被改写为：

```text
boom-executor.exe --low-il --restricted-token --job-object -- powershell.exe -NoProfile -NonInteractive -Command "<原命令>"
```

其中插件会自动解析 `boom-executor.exe` 路径，无需环境变量。

### 3.3 非 Windows 平台行为

插件在 `before_tool_call` 中有平台判断：

- `process.platform !== "win32"` 时直接跳过，不执行重写

即：非 Windows 下不会走 `.exe`，不会引入执行器错误。

---

## 4. 三层权限限制（当前实现）

当前是“降权执行”，不是命令黑名单，也不是目录白名单沙箱。

### 4.1 `restricted-token`

`boom-executor` 使用：

- `CreateRestrictedToken(DISABLE_MAX_PRIVILEGE | LUA_TOKEN, ...)`

效果：

- 去除高危特权
- 管理员语义降级（受限令牌）

### 4.2 `low-il`（低完整性级别）

`SetTokenInformation(TokenIntegrityLevel, S-1-16-4096)`

效果：

- 子进程运行在 Low Mandatory Level
- 对中/高完整性对象的写入类操作会被 MIC 限制

### 4.3 `job-object`

执行器会：

- 创建 Job
- `AssignProcessToJobObject`
- 启用 `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`

效果：

- 宿主退出时，Job 内子进程可被联动清理
- 可扩展为进程数等资源限制

---

## 5. 配置项说明

插件配置定义见 `resources/boom-lowpriv-executor-plugin/openclaw.plugin.json`。

- `enabled`（boolean，默认 `true`）
  - 插件总开关
  - `false` 时直接跳过重写
- `auditLog`（boolean，默认 `true`）
  - 是否输出输入/重写日志

运行时配置路由：

- `GET /plugins/boom-lowpriv-executor/config`：查看当前内存配置
- `POST/PUT /plugins/boom-lowpriv-executor/config`：更新当前内存配置

示例（网关端口按实际环境）：

```powershell
# 查看当前配置
curl http://127.0.0.1:18789/plugins/boom-lowpriv-executor/config

# 运行时临时关闭
curl -X POST http://127.0.0.1:18789/plugins/boom-lowpriv-executor/config `
  -H "Content-Type: application/json" `
  -d "{\"enabled\":false}"

# 运行时重新开启
curl -X POST http://127.0.0.1:18789/plugins/boom-lowpriv-executor/config `
  -H "Content-Type: application/json" `
  -d "{\"enabled\":true}"
```

---

## 6. 如何禁用或跳过插件

### 6.1 临时禁用（不重启）

调用运行时配置路由将 `enabled=false`。

适合临时回退验证。

### 6.2 持久化禁用（代码侧）

通过 `electron/services/boom-lowpriv-executor/plugin-deploy.ts`：

- `setBoomLowprivExecutorEnabled(false)`

会写入 `openclaw.json` 的插件条目状态。

### 6.3 配置文件禁用（手工）

在 `~/.openclaw/openclaw.json` 中将：

- `plugins.entries["boom-lowpriv-executor"].enabled = false`
- 可选：`plugins.entries["boom-lowpriv-executor"].config.enabled = false`

如果项目启用了 `plugins.allow` 严格白名单，也需要确保该插件不在 allow 列表中。

### 6.4 自动跳过（非 Windows）

非 Windows 平台不做命令重写，等效“自动跳过执行器”。

---

## 7. 权限边界说明

当前策略只保证“降权执行”，不保证“禁止所有危险命令”。

- `exec del ...` 不会被命令层面拦截
- 能否删除成功取决于降权后 token + IL + 目标 ACL
- 低权目录可写时仍可能删除成功

如果目标是“彻底禁止某些命令或路径”，需要额外增加策略层（命令/路径规则），不属于本插件当前范围。


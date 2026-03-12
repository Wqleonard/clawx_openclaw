# Windows EXE 签名与加白指南

> 解决 Windows 安装包风险提示问题的完整操作手册。

---

## 1. 打包命令确认

```bash
pnpm package:win
```

完整执行链（[package.json:42](../package.json#L42)）：

```
vite build
  → bundle-openclaw.mjs
  → bundle-openclaw-plugins.mjs
  → bundle-preinstalled-skills.mjs
  → electron-builder --win
```

产物输出到 `release/` 目录，格式为 NSIS 安装包（`.exe`），支持 x64 和 arm64。

---

## 2. 风险提示的根本原因

Windows SmartScreen 和企业 EDR/杀毒软件会对以下情况弹出警告：

- exe **未签名**（最常见）
- 签名证书为新证书，**信誉分不足**（OV 证书初期）
- 企业内网有**额外安全策略**拦截未知程序

---

## 3. 跟安全中心李威沟通

需要解决两件独立的事：**代码签名** 和 **加白（白名单）**。

### 3.1 申请代码签名证书

对话模板：

> "我们有一个 Electron 桌面应用需要打包成 Windows exe 安装包对外发布，需要申请一个**代码签名证书（Code Signing Certificate）**来签名 exe，避免 SmartScreen 风险提示。请问公司是否有 EV 证书或 OV 证书可以使用，或者需要我们自行购买？"

**李威需要提供给你的：**

| 内容 | 说明 |
|------|------|
| `.pfx` 证书文件 | 包含私钥的证书文件 |
| 证书密码 | 对应 `CSC_KEY_PASSWORD` 环境变量 |
| HSM/云签名接入方式 | EV 证书通常在硬件 token 上，需要特殊接入 |

### 3.2 申请内网加白

对话模板：

> "我们的应用在公司内网环境下安装时，会被终端安全软件拦截，需要将我们的应用加入白名单。请问需要提供什么信息？"

**你需要提供给李威的：**

| 信息 | 如何获取 |
|------|---------|
| 文件 SHA256 哈希 | `certutil -hashfile app.exe SHA256`（Windows）或 `shasum -a 256 app.exe`（macOS） |
| 发布者名称 | 证书中的 CN 字段，如 `CN=YourCompany Ltd` |
| 安装路径规则 | `%LOCALAPPDATA%\Programs\BoomClaw\*` |
| 签名后的 exe 样本 | 签名完成后提供一份安装包 |

---

## 4. 证书类型对比

| 证书类型 | SmartScreen 效果 | 价格参考 | 验证方式 | 推荐场景 |
|---------|----------------|---------|---------|---------|
| OV（组织验证） | 初期仍可能提示，积累信誉后消失 | $200–500/年 | 公司营业执照 | 内部分发 + 长期运营 |
| EV（扩展验证） | **立即消除提示** | $500–800/年 | 严格公司审核 + 硬件 token | 对外公开发布 |

> 如果是内部分发，加白比买证书更直接有效。
> 如果是对外公开发布，强烈建议申请 **EV 证书**。

---

## 5. 拿到证书后配置到项目

### 方式一：环境变量（推荐，不暴露证书路径）

```bash
# 打包时设置环境变量
CSC_LINK=/path/to/cert.pfx CSC_KEY_PASSWORD=yourpassword pnpm package:win
```

electron-builder 自动识别 `CSC_LINK` 和 `CSC_KEY_PASSWORD`，无需修改配置文件。

### 方式二：写入 electron-builder.yml（不推荐提交到 git）

在 [electron-builder.yml](../electron-builder.yml) 的 `win:` 段添加：

```yaml
win:
  verifyUpdateCodeSignature: false
  certificateFile: path/to/cert.pfx
  certificatePassword: ${CSC_KEY_PASSWORD}
  signingHashAlgorithms:
    - sha256
```

> **注意**：证书文件和密码不要提交到 git，建议通过 CI/CD 环境变量注入。

---

## 6. 当前项目配置说明

[electron-builder.yml:108](../electron-builder.yml#L108) 中已有：

```yaml
win:
  verifyUpdateCodeSignature: false   # 跳过更新包签名验证（因为目前没有证书）
```

拿到证书后，在此基础上补充签名配置即可，其余 NSIS 配置不需要改动。

---

## 7. 操作流程总结

```
1. 联系李威
   ├── 申请代码签名证书（.pfx + 密码）
   └── 申请内网安全白名单

2. 拿到证书后
   ├── 设置环境变量 CSC_LINK 和 CSC_KEY_PASSWORD
   └── 执行 pnpm package:win（签名自动完成）

3. 打包完成后
   ├── 计算 exe 的 SHA256 哈希
   ├── 将哈希 + 发布者名 + 安装路径提供给李威加白
   └── 验证安装时无风险提示
```

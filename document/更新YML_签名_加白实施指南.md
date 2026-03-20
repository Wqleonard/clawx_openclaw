# BoomClaw 更新 YML、签名、加白实施指南

> 适用场景：不走 GitHub 更新源，走自己后端（对象存储/CDN + 后端发布系统）。

---

## 1. 关键问题

## 1.1 “yml 文件是做什么的？”

`electron-updater` 会读取更新元数据 yml，来决定：

1. 有没有新版本；
2. 下载哪个安装包；
3. 下载后如何做完整性校验（`sha512`）；
4. 默认安装包入口是哪个（`path`）。

也就是说，**yml 是自动更新的“索引和校验清单”**。

## 1.2 “跟 release 下的 yml 是一回事吗？”

是，一回事。  
你现在 `release/latest.yml`、`release/latest-mac.yml` 就是标准更新元数据文件。  
后端需要接收的就是这类文件（按渠道目录放置）。

## 1.3 “哈希值和签名有关系吗？”

有直接关系：

1. 你对 `.exe/.dmg/.zip` 做签名后，文件二进制会变化；
2. 二进制变化会导致 `sha512` 改变；
3. yml 里如果还是旧的 `sha512`，客户端会校验失败（下载后报错，无法安装）。

结论：  
**签名完成后必须重新计算哈希并回写 yml**（至少 Windows 必做；mac 也建议最终产物统一复核）。

---

## 2. 你们当前流程的正确落地顺序

建议固定为下面顺序（不要打乱）：

1. 本地/CI 打包出安装包与初始 yml；
2. 将需签名文件上传 SDG 签名系统签名；
3. 下载签名后文件替换原文件（文件名建议带版本/日期，避免缓存）；
4. （建议）将签名产物提交 360 加白平台；
5. 重新计算签名后文件的 `sha512` 和 `size`；
6. 回填到 yml（`files[].sha512`、`files[].size`、`path/sha512`）；
7. 上传“最终安装包 + 最终 yml + blockmap”给后端；
8. 后端发布到 `latest/alpha/beta` 对应目录。

---

## 3. 文件命名与目录约定（给后端）

稳定版建议目录：

```text
latest/
  latest.yml              # Windows 元数据
  latest-mac.yml          # macOS 元数据
  StoryClaw-<ver>-win-x64.exe
  StoryClaw-<ver>-win-arm64.exe
  StoryClaw-<ver>-mac-x64.zip
  StoryClaw-<ver>-mac-arm64.zip
  StoryClaw-<ver>-*.blockmap
```

预发布目录：

```text
alpha/
  alpha.yml
  alpha-mac.yml
  ...
beta/
  beta.yml
  beta-mac.yml
  ...
```

说明：

- channel=latest 时，客户端会找 `latest*.yml`；
- channel=alpha 时，客户端会找 `alpha*.yml`；
- channel=beta 时，客户端会找 `beta*.yml`。

---

## 4. yml 字段说明（必须会）

以 Windows `latest.yml` 为例：

- `version`: 发布版本号（如 `0.2.6`）
- `files[]`:
  - `url`: 安装包文件名（或相对路径）
  - `sha512`: Base64 编码的 SHA-512
  - `size`: 文件字节数
- `path`: 默认安装包（一般指向主架构包）
- `sha512`: 对应 `path` 那个文件的哈希
- `releaseDate`: 发布时间（ISO8601）

mac `latest-mac.yml` 同理，通常默认 `path` 指向 `.zip`。

---

## 5. 签名与加白：你给的内网平台如何接入

你们给的流程可以直接纳入发布 SOP：

1. **SDG 签名平台**  
   - 上传待签名 PE 文件（`.exe`、`.dll`）；
   - 下载签名后文件；
   - 注意文件名唯一（加版本或日期后缀），避免浏览器缓存取错文件。

2. **360 加白平台**  
   - 对签名后的可执行文件发起加白；
   - 平台通过后作为外发包。

注意：

- Windows 自动更新最关键的是 `.exe` 签名后 yml 哈希回填；
- mac 侧如果走 Developer ID + notarize，也要保证最终分发文件和 yml 哈希一致。

---

## 6. 如何计算哈希、写到哪里、怎么用

## 6.1 计算哈希（macOS）

```bash
openssl dgst -sha512 -binary "StoryClaw-0.2.6-win-x64.exe" | openssl base64 -A
```

得到的字符串就是写入 yml 的 `sha512`。

文件大小（字节）：

```bash
stat -f%z "StoryClaw-0.2.6-win-x64.exe"
```

## 6.2 计算哈希（Windows PowerShell）

```powershell
$hash = Get-FileHash -Path "StoryClaw-0.2.6-win-x64.exe" -Algorithm SHA512
$bytes = [byte[]]::new($hash.Hash.Length / 2)
for ($i = 0; $i -lt $bytes.Length; $i++) { $bytes[$i] = [Convert]::ToByte($hash.Hash.Substring($i * 2, 2), 16) }
[Convert]::ToBase64String($bytes)
```

文件大小：

```powershell
(Get-Item "StoryClaw-0.2.6-win-x64.exe").Length
```

## 6.3 写在哪里

写入对应 yml 的两个位置：

1. `files` 数组里对应 `url` 的 `sha512` 和 `size`；
2. 如果这个文件也是 `path` 指向的默认包，同步更新顶层 `sha512`。

## 6.4 怎么使用

1. 客户端请求 yml；
2. 根据 `url` 下载对应安装包；
3. 用 yml 中 `sha512` 做校验；
4. 校验通过才安装。

---

## 7. 你可以直接给后端的 yml 文件

我已在 `document/update-yml-templates/` 下给你准备模板：

- `latest.yml`（Windows）
- `latest-mac.yml`（macOS）

使用方式：

1. 把版本号、文件名填成实际值；
2. 先签名（特别是 Windows）；
3. 按签名后文件计算 `sha512/size`；
4. 回填模板；
5. 上传给后端。

---

## 8. 发布前检查清单（务必执行）

1. `version` 与应用实际版本一致；
2. yml 的 `url` 文件都真实存在；
3. 每个文件 `sha512` 与 `size` 对应“最终发布文件”；
4. `path` 指向正确默认安装包；
5. 预发布包不会误放到 `latest/`；
6. Windows 签名与 360 加白流程已完成；
7. 用测试机实际执行一次更新流程（检查 -> 下载 -> 安装）。

---

## 9. 备注

- 你当前仓库里 `release/*.yml` 出现了部分重复 `url` 记录，正式交付后端前建议去重，保持每个产物一条记录，避免歧义。
- 后续如果你确认，我可以再给你补一个“自动回填 yml 的脚本”，把签名后的哈希更新步骤自动化，减少手工出错。

## 10. 生成yml脚本
- pnpm run update:yml:templates
默认行为：

从 release/ 读取包
自动识别最新版本（或你可手动指定）
计算每个包的 sha512 + size
写入：
document/update-yml-templates/latest.yml
document/update-yml-templates/latest-mac.yml
可选参数（更稳妥）
指定版本（推荐你当前测试用 0.2.6）：

- node scripts/generate-update-yml.mjs --version 0.2.6
指定 channel（例如 beta）：

- node scripts/generate-update-yml.mjs --version 0.2.6 --channel beta
会输出为：

document/update-yml-templates/beta.yml
document/update-yml-templates/beta-mac.yml
“读取 release 并写 yml”是怎么做到的
脚本做了这几步：

扫描 release/ 下符合命名规则的安装包
识别版本号（或使用你传入的 --version）
对每个包计算：
sha512（Base64）
size（字节）
组装成 electron-updater 需要的结构并写入两个 yml（Win/Mac 分开）
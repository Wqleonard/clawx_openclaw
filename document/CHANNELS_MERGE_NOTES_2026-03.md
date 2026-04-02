# Channels 合并说明（2026-03）

本文用于记录本轮 `Channels` 模块与上游的合并策略、当前行为、以及后续升级时的对比基线。

目标是：下次升级时先读本文，再做增量合并，避免重复踩坑（UI 混排、状态回退、绑定规则不一致）。

---

## 1. 本轮合并范围

本轮重点是把上游“多账号 + 绑定 Agent”能力并入当前版本，同时保留本地的页面结构和交互体验。

涉及文件：

- `src/pages/Channels/index.tsx`
- `src/components/channels/ChannelConfigModal.tsx`
- `src/pages/Preferences/sections/ChannelsSection.tsx`
- `src/stores/channels.ts`（前序冲突收敛）

---

## 2. 合并后的核心设计

### 2.1 UI 保留策略

- 保留本地 `Channels` 页面整体样式和结构（包含 `hideHeader` 视觉模式）。
- 上游的多账号能力不再以“替换页面”的方式接入，而是以“功能模块 + 参数开关”方式接入。

### 2.2 新增能力开关

`Channels` 组件参数：

- `hideHeader?: boolean`
- `enableAdvancedAccountsInHideHeader?: boolean`

行为约定：

- `hideHeader=true` 且 `enableAdvancedAccountsInHideHeader=false`
  - 单账号轻量模式（旧行为）
- `hideHeader=true` 且 `enableAdvancedAccountsInHideHeader=true`
  - 在 hideHeader UI 下启用多账号 + 绑定 Agent
- `hideHeader=false`
  - 默认完整能力（多账号 + 绑定 Agent）

当前 `Preferences` 场景已开启：

- `src/pages/Preferences/sections/ChannelsSection.tsx` 使用 `<Channels hideHeader enableAdvancedAccountsInHideHeader />`

---

## 3. 渠道展示规则（当前版本）

当前渠道展示只按四个入口渠道组织（hideHeader 场景）：

- `qqbot`
- `wechat`
- `feishu`
- `wecom`

展示规则：

1. 未配置前：在“配置入口列表”显示。
2. 渠道首次新增账号后：该渠道入口隐藏，转入“已配置渠道（configured）”模块。
3. 删除某个账号（该渠道仍有其它账号）：渠道仍在 configured 模块。
4. 删除整个渠道或删到无账号：渠道从 configured 消失，入口恢复显示。

为了避免 UI 错乱，开启高级账号模式后会关闭旧版“单账号已配置卡片”：

- `showLegacyConfiguredCards = !showAccountManagement`

即不会再出现“旧单账号卡片 + configured 多账号模块”并存。

---

## 4. Gateway 刷新与提示行为（保留本地优化）

本地原有的 Gateway 状态提示逻辑保留：

- 变更后立即设置 `pendingGatewayApply=true`
- 通过 `refreshAfterGatewaySettle()` 观察网关状态切换
- 顶部展示 `gatewayRestartingWarning`
- 等待回到 `running` 后刷新 channels/configured/accounts

这是当前版本里保证“改完立即有反馈 + 最终状态收敛”的关键。

---

## 5. 多账号与 Agent 绑定规则

### 5.1 后端约束（重要）

根据当前后端绑定逻辑（`electron/utils/agent-config.ts`）：

- 同一 Agent 在**同一渠道**不能同时绑定多个账号（后绑定会覆盖前绑定）。
- 同一 Agent 在**不同渠道**可复用绑定。

### 5.2 前端默认绑定策略（本轮新增）

新增账号保存成功后，自动绑定策略：

1. 获取最新渠道账号和 Agent 列表；
2. 排除 `main` Agent（不展示，也不参与自动绑定）；
3. 计算“已被绑定 Agent 集合”（跨渠道汇总）；
4. 从 Agent 列表尾部向前找“最后一个未被绑定”的 Agent；
5. 若找到，则绑定到本次新增账号；
6. 若全部都已绑定，则保持“未绑定”。

同时增加本地缓存：

- `localStorage['channels_bound_agent_ids_v1']`

用于在刷新时兜底同步“已绑定 Agent 集合”。

---

## 6. `main` Agent 处理

业务要求：不向用户暴露 `main` Agent。

当前实现：

- 绑定下拉中过滤 `main`
- 自动绑定策略也过滤 `main`

---

## 7. 上游能力吸收情况

已吸收：

- 账号级操作：新增账号、编辑账号、删除账号、删除整渠道
- 账号绑定/解绑 Agent
- 账号配置预取（编辑前拉取配置）
- 渠道账号视图接口接入（`/api/channels/accounts`）

有意保持本地方案（未采用上游原始页面结构）：

- 不直接采用上游整页 `configuredGroups` 风格替换
- 保持现有 hideHeader 页面风格与顶部提示体系

---

## 8. 后续升级（与新上游合并）建议流程

建议每次升级按以下顺序：

1. 先拉上游，仅对 `Channels/index.tsx` 和 `ChannelConfigModal.tsx` 做三方对比。
2. 优先核对接口契约是否变动：
   - `/api/channels/accounts`
   - `/api/agents`
   - `/api/channels/binding`
   - `/api/channels/config/...`
3. 再核对“展示规则”是否被破坏（是否出现入口/configured 重复）。
4. 最后核对“默认绑定策略”是否仍满足：
   - 排除 `main`
   - 选择最后一个未绑定 Agent
   - 全绑定时不绑定

建议重点检查关键词：

- `enableAdvancedAccountsInHideHeader`
- `showAccountManagement`
- `showLegacyConfiguredCards`
- `pendingGatewayApply`
- `refreshAfterGatewaySettle`
- `channels_bound_agent_ids_v1`

---

## 9. 回归测试最小清单

1. 首次配置某渠道：入口隐藏，渠道进入 configured。
2. 新增第二账号：账号追加成功，渠道仍在 configured。
3. 删除单账号：仅该账号消失。
4. 删除整渠道：渠道消失，入口恢复。
5. 绑定/解绑 Agent：生效并刷新。
6. 新增账号自动绑定：
   - 有可用未绑定 Agent -> 自动绑定成功
   - 所有 Agent 已绑定 -> 保持未绑定
7. 下拉与自动绑定均不出现 `main`。
8. Gateway 重连提示在变更后可见，最终回稳。

---

## 10. 备注

如果未来要支持“同一 Agent 在同一渠道绑定多个账号”，需要先调整后端 `upsertBindingsForChannel` 语义，再同步更新前端默认绑定策略与 UI 文案。


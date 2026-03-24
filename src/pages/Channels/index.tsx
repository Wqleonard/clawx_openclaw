/**
 * Channels Page
 * Manage messaging channel connections with configuration UI
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Trash2, AlertCircle, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useChannelsStore } from '@/stores/channels';
import { useGatewayStore } from '@/stores/gateway';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { hostApiFetch } from '@/lib/host-api';
import { subscribeHostEvent } from '@/lib/host-events';
import { ChannelConfigModal } from '@/components/channels/ChannelConfigModal';
import { cn } from '@/lib/utils';
import { usesPluginManagedQrAccounts } from '@/lib/channel-alias';
import {
  CHANNEL_ICONS,
  CHANNEL_NAMES,
  CHANNEL_META,
  getPrimaryChannels,
  type ChannelType,
  type Channel,
} from '@/types/channel';
import { useTranslation } from 'react-i18next';

import telegramIcon from '@/assets/channels/telegram.svg';
import discordIcon from '@/assets/channels/discord.svg';
import whatsappIcon from '@/assets/channels/whatsapp.svg';
import wechatIcon from '@/assets/channels/wechat.svg';
import dingtalkIcon from '@/assets/channels/dingtalk.svg';
import feishuIcon from '@/assets/channels/feishu.svg';
import wecomIcon from '@/assets/channels/wecom.svg';
import qqIcon from '@/assets/channels/qq.svg';

interface ChannelAccountItem {
  accountId: string;
  name: string;
  configured: boolean;
  status: 'connected' | 'connecting' | 'disconnected' | 'error';
  lastError?: string;
  isDefault: boolean;
  agentId?: string;
}

interface ChannelGroupItem {
  channelType: string;
  defaultAccountId: string;
  status: 'connected' | 'connecting' | 'disconnected' | 'error';
  accounts: ChannelAccountItem[];
}

interface AgentItem {
  id: string;
  name: string;
}

interface DeleteTarget {
  channelType: string;
  accountId?: string;
}

const BOUND_AGENT_IDS_STORAGE_KEY = 'channels_bound_agent_ids_v1';

function normalizeAgentId(agentId: string | undefined): string {
  return String(agentId || '').trim().toLowerCase();
}

function loadStoredBoundAgentIds(): Set<string> {
  try {
    const raw = localStorage.getItem(BOUND_AGENT_IDS_STORAGE_KEY);
    if (!raw) return new Set<string>();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set<string>();
    return new Set(parsed.map((item) => normalizeAgentId(String(item))).filter(Boolean));
  } catch {
    return new Set<string>();
  }
}

function saveStoredBoundAgentIds(agentIds: Set<string>): void {
  try {
    localStorage.setItem(BOUND_AGENT_IDS_STORAGE_KEY, JSON.stringify(Array.from(agentIds)));
  } catch {
    // Ignore storage failures.
  }
}

function collectBoundAgentIds(groups: ChannelGroupItem[]): Set<string> {
  const bound = new Set<string>();
  for (const group of groups) {
    for (const account of group.accounts) {
      const normalized = normalizeAgentId(account.agentId);
      if (normalized && normalized !== 'main') {
        bound.add(normalized);
      }
    }
  }
  return bound;
}

interface ChannelsProps {
  hideHeader?: boolean;
  enableAdvancedAccountsInHideHeader?: boolean;
}

export function Channels({ hideHeader = false, enableAdvancedAccountsInHideHeader = false }: ChannelsProps = {}) {
  const { t } = useTranslation('channels');
  const { channels, loading, error, fetchChannels, deleteChannel } = useChannelsStore();
  const gatewayStatus = useGatewayStore((state) => state.status);

  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [selectedChannelType, setSelectedChannelType] = useState<ChannelType | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<string | undefined>(undefined);
  const [allowExistingConfigInModal, setAllowExistingConfigInModal] = useState(true);
  const [allowEditAccountIdInModal, setAllowEditAccountIdInModal] = useState(false);
  const [existingAccountIdsForModal, setExistingAccountIdsForModal] = useState<string[]>([]);
  const [initialConfigValuesForModal, setInitialConfigValuesForModal] = useState<Record<string, string> | undefined>(undefined);
  const [configuredTypes, setConfiguredTypes] = useState<string[]>([]);
  const [channelGroups, setChannelGroups] = useState<ChannelGroupItem[]>([]);
  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [channelToDelete, setChannelToDelete] = useState<{ id: string; type: ChannelType } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [pendingGatewayApply, setPendingGatewayApply] = useState(false);
  const previousGatewayStateRef = useRef(gatewayStatus.state);
  const channelGroupsRef = useRef<ChannelGroupItem[]>([]);
  const agentsRef = useRef<AgentItem[]>([]);
  const blurActiveElement = () => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  };

  useEffect(() => {
    void fetchChannels();
  }, [fetchChannels]);

  const fetchConfiguredTypes = useCallback(async () => {
    try {
      const result = await hostApiFetch<{
        success: boolean;
        channels?: string[];
      }>('/api/channels/configured');
      if (result.success && result.channels) {
        setConfiguredTypes(result.channels);
      }
    } catch {
      // Ignore refresh errors here and keep the last known state.
    }
  }, []);

  const fetchChannelAccounts = useCallback(async () => {
    try {
      const [channelsRes, agentsRes] = await Promise.all([
        hostApiFetch<{ success: boolean; channels?: ChannelGroupItem[] }>('/api/channels/accounts'),
        hostApiFetch<{ success: boolean; agents?: AgentItem[] }>('/api/agents'),
      ]);

      let nextGroups = channelGroupsRef.current;
      let nextAgents = agentsRef.current;
      if (channelsRes.success) {
        nextGroups = Array.isArray(channelsRes.channels) ? channelsRes.channels : [];
        setChannelGroups(nextGroups);
        channelGroupsRef.current = nextGroups;
      }
      if (agentsRes.success) {
        nextAgents = Array.isArray(agentsRes.agents) ? agentsRes.agents : [];
        setAgents(nextAgents);
        agentsRef.current = nextAgents;
      }

      saveStoredBoundAgentIds(collectBoundAgentIds(nextGroups));
      return { groups: nextGroups, agents: nextAgents };
    } catch {
      // Ignore account refresh errors; main channel list still renders.
      return { groups: channelGroupsRef.current, agents: agentsRef.current };
    }
  }, []);

  const refreshChannelsState = useCallback(async () => {
    await Promise.all([fetchChannels(), fetchConfiguredTypes(), fetchChannelAccounts()]);
  }, [fetchChannels, fetchConfiguredTypes, fetchChannelAccounts]);

  const refreshAfterGatewaySettle = useCallback(async () => {
    try {
      // 配置文件的落盘结果可以立即读取，先刷新一次“已配置类型”以确保入口状态尽快正确。
      await fetchConfiguredTypes();

      const readGatewayState = () => useGatewayStore.getState().status.state;
      let observedTransition = readGatewayState() !== 'running';

      // 后端使用 debounced restart，状态切换可能晚于配置接口返回。
      // 先短暂等待状态从 running 进入过渡态，避免提示提前消失。
      if (!observedTransition) {
        for (let attempt = 0; attempt < 8; attempt += 1) {
          await new Promise((resolve) => {
            window.setTimeout(resolve, 250);
          });
          if (readGatewayState() !== 'running') {
            observedTransition = true;
            break;
          }
        }
      }

      if (!observedTransition) {
        await refreshChannelsState();
        return;
      }

      // 已观察到过渡态后，等待回到 running 再刷新。
      for (let attempt = 0; attempt < 12; attempt += 1) {
        await new Promise((resolve) => {
          window.setTimeout(resolve, 1000);
        });
        if (readGatewayState() === 'running') {
          await refreshChannelsState();
          return;
        }
      }

      // 超时后兜底再拉一次，避免极端情况下 UI 长时间不更新。
      await refreshChannelsState();
    } finally {
      setPendingGatewayApply(false);
    }
  }, [fetchConfiguredTypes, refreshChannelsState]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void Promise.all([fetchConfiguredTypes(), fetchChannelAccounts()]);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchConfiguredTypes, fetchChannelAccounts]);

  useEffect(() => {
    const unsubscribe = subscribeHostEvent('gateway:channel-status', () => {
      void fetchChannels();
      void fetchConfiguredTypes();
      void fetchChannelAccounts();
    });
    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [fetchChannels, fetchConfiguredTypes, fetchChannelAccounts]);

  useEffect(() => {
    const previous = previousGatewayStateRef.current;
    if (previous !== gatewayStatus.state && gatewayStatus.state === 'running') {
      previousGatewayStateRef.current = gatewayStatus.state;
      const timer = window.setTimeout(() => {
        void refreshChannelsState();
      }, 0);
      return () => window.clearTimeout(timer);
    }
    previousGatewayStateRef.current = gatewayStatus.state;
    return undefined;
  }, [gatewayStatus.state, refreshChannelsState]);

  useEffect(() => {
    channelGroupsRef.current = channelGroups;
    saveStoredBoundAgentIds(collectBoundAgentIds(channelGroups));
  }, [channelGroups]);

  useEffect(() => {
    agentsRef.current = agents;
  }, [agents]);

  const displayedChannelTypes = getPrimaryChannels();
  const channelTypesForCurrentView = useMemo<ChannelType[]>(
    () => (hideHeader ? ['qqbot', 'wechat', 'feishu', 'wecom'] : displayedChannelTypes),
    [hideHeader, displayedChannelTypes],
  );
  const groupedByType = useMemo(
    () => Object.fromEntries(channelGroups.map((group) => [group.channelType, group])),
    [channelGroups],
  );
  const configuredGroups = useMemo(() => {
    const known = channelTypesForCurrentView
      .map((type) => groupedByType[type])
      .filter((group): group is ChannelGroupItem => Boolean(group));
    const unknown = hideHeader
      ? []
      : channelGroups.filter((group) => !channelTypesForCurrentView.includes(group.channelType as ChannelType));
    return [...known, ...unknown];
  }, [channelGroups, channelTypesForCurrentView, groupedByType, hideHeader]);

  const createNewAccountId = useCallback((channelType: string, existingAccounts: string[]): string => {
    let nextAccountId = `${channelType}-${crypto.randomUUID().slice(0, 8)}`;
    while (existingAccounts.includes(nextAccountId)) {
      nextAccountId = `${channelType}-${crypto.randomUUID().slice(0, 8)}`;
    }
    return nextAccountId;
  }, []);

  const handleBindAgent = useCallback(async (channelType: string, accountId: string, agentId: string) => {
    try {
      if (!agentId) {
        await hostApiFetch('/api/channels/binding', {
          method: 'DELETE',
          body: JSON.stringify({ channelType, accountId }),
        });
      } else {
        await hostApiFetch('/api/channels/binding', {
          method: 'PUT',
          body: JSON.stringify({ channelType, accountId, agentId }),
        });
      }
      setPendingGatewayApply(true);
      void refreshAfterGatewaySettle();
    } catch (bindError) {
      console.error('Failed to update channel binding:', bindError);
    }
  }, [refreshAfterGatewaySettle]);

  const findNewestUnboundAccountId = useCallback((groups: ChannelGroupItem[], channelType: string): string | undefined => {
    const group = groups.find((item) => item.channelType === channelType);
    if (!group || group.accounts.length === 0) return undefined;

    for (let i = group.accounts.length - 1; i >= 0; i -= 1) {
      const account = group.accounts[i];
      if (!normalizeAgentId(account.agentId)) {
        return account.accountId;
      }
    }

    return undefined;
  }, []);

  const pickAutoBindAgentId = useCallback((availableAgents: AgentItem[], usedAgentIds: Set<string>): string | undefined => {
    for (let i = availableAgents.length - 1; i >= 0; i -= 1) {
      const normalized = normalizeAgentId(availableAgents[i]?.id);
      if (!normalized || normalized === 'main') continue;
      if (!usedAgentIds.has(normalized)) {
        return availableAgents[i].id;
      }
    }
    return undefined;
  }, []);

  const autoBindAgentForNewAccount = useCallback(async (channelType: ChannelType, preferredAccountId?: string) => {
    const latest = await fetchChannelAccounts();
    const boundNow = collectBoundAgentIds(latest.groups);
    const boundFromStorage = loadStoredBoundAgentIds();
    const usedAgentIds = new Set<string>([...boundFromStorage, ...boundNow]);
    const candidateAgents = latest.agents.filter((agent) => normalizeAgentId(agent.id) !== 'main');
    const targetAgentId = pickAutoBindAgentId(candidateAgents, usedAgentIds);
    if (!targetAgentId) return;

    const targetAccountId = preferredAccountId || findNewestUnboundAccountId(latest.groups, channelType);
    if (!targetAccountId) return;

    try {
      await hostApiFetch('/api/channels/binding', {
        method: 'PUT',
        body: JSON.stringify({ channelType, accountId: targetAccountId, agentId: targetAgentId }),
      });
      usedAgentIds.add(normalizeAgentId(targetAgentId));
      saveStoredBoundAgentIds(usedAgentIds);
      setPendingGatewayApply(true);
      await refreshAfterGatewaySettle();
    } catch (error) {
      console.error('Failed to auto-bind agent for new account:', error);
    }
  }, [fetchChannelAccounts, findNewestUnboundAccountId, pickAutoBindAgentId, refreshAfterGatewaySettle]);

  // const handleRefresh = () => {
  //   void Promise.all([fetchChannels(), fetchConfiguredTypes()]);
  // };

  if (loading) {
    return (
      <div className={cn("flex flex-col dark:bg-background items-center justify-center", hideHeader ? "min-h-[200px]" : "-m-6 min-h-[calc(100vh-2.5rem)]")}>
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  // hideHeader 模式下仅展示精简渠道列表
  const visibleChannelTypes: ChannelType[] = channelTypesForCurrentView;
    /* 暂时注释掉的其他渠道（hideHeader 模式）：
       'telegram', 'discord', 'whatsapp', 'dingtalk', 'feishu', 'wecom'
    */

  const safeChannels = Array.isArray(channels) ? channels : [];
  const isGatewayUnavailable = gatewayStatus.state === 'stopped' || gatewayStatus.state === 'error';
  const isGatewayTransitioning = gatewayStatus.state === 'starting' || gatewayStatus.state === 'reconnecting';
  const shouldShowGatewayRestarting = pendingGatewayApply || isGatewayTransitioning;
  const showAccountManagement = !hideHeader || enableAdvancedAccountsInHideHeader;
  const showLegacyConfiguredCards = !showAccountManagement;
  const bindableAgents = agents.filter((agent) => normalizeAgentId(agent.id) !== 'main');
  const configuredPlaceholderChannels: Channel[] = visibleChannelTypes
    .filter((type) => configuredTypes.includes(type) && !safeChannels.some((channel) => channel.type === type))
    .map((type) => ({
      id: `${type}-default`,
      type,
      name: CHANNEL_NAMES[type] || CHANNEL_META[type].name,
      status: 'disconnected',
    }));
  const availableChannels = [
    ...safeChannels.filter((ch) => visibleChannelTypes.includes(ch.type)),
    ...configuredPlaceholderChannels,
  ];

  return (
    <div className={cn("flex flex-col dark:bg-background overflow-hidden", hideHeader ? "" : "-m-6 h-[calc(100vh-2.5rem)]")}>
      <div className={cn("w-full max-w-5xl mx-auto flex flex-col h-full", hideHeader ? "pt-0" : "p-10 pt-16")}>

        {/* 大标题 + 刷新按钮（hideHeader 时隐藏） */}
        {!hideHeader && (
          <div className="flex flex-col md:flex-row md:items-start justify-between mb-12 shrink-0 gap-4">
            <div>
              <h1 className="text-5xl md:text-6xl font-serif text-foreground mb-3 font-normal tracking-tight" style={{ fontFamily: 'Georgia, Cambria, "Times New Roman", Times, serif' }}>
                {t('title')}
              </h1>
              <p className="text-[17px] text-foreground/70 font-medium">
                {t('subtitle')}
              </p>
            </div>
            <div className="flex items-center gap-3 md:mt-2">
              {/* 刷新按钮（hideHeader 时注释掉）
              <Button
                variant="outline"
                onClick={handleRefresh}
                disabled={gatewayStatus.state !== 'running'}
                className="h-9 text-[13px] font-medium rounded-full px-4 border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5 shadow-none text-foreground/80 hover:text-foreground transition-colors"
              >
                <RefreshCw className={cn("h-3.5 w-3.5 mr-2", loading && "animate-spin")} />
                {t('refresh')}
              </Button>
              */}
            </div>
          </div>
        )}

        <div className={cn("flex-1 overflow-y-auto min-h-0", hideHeader ? "" : "pr-2 pb-10 -mr-2")}>
          {isGatewayUnavailable && (
            <div className="mb-4 p-4 rounded-xl border border-yellow-500/50 bg-yellow-500/10 flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
              <span className="text-yellow-700 dark:text-yellow-400 text-sm font-medium">
                {t('gatewayWarning')}
              </span>
            </div>
          )}

          {shouldShowGatewayRestarting && (
            <div className="mb-4 p-4 rounded-xl border border-blue-500/40 bg-blue-500/10 flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              <span className="text-blue-700 dark:text-blue-400 text-sm font-medium">
                {t('gatewayRestartingWarning')}
              </span>
            </div>
          )}

          {error && (
            <div className="mb-4 p-4 rounded-xl border border-destructive/50 bg-destructive/10 flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-destructive" />
              <span className="text-destructive text-sm font-medium">
                {error}
              </span>
            </div>
          )}

          {/* 旧版已配置卡片（仅单账号模式展示） */}
          {showLegacyConfiguredCards && availableChannels.length > 0 && (
            <div className={cn(hideHeader ? "mb-4" : "mb-12")}>
              {!hideHeader && (
                <h2 className="text-3xl font-serif text-foreground mb-6 font-normal tracking-tight" style={{ fontFamily: 'Georgia, Cambria, "Times New Roman", Times, serif' }}>
                  {t('availableChannels')}
                </h2>
              )}
              <div className={cn("rounded-2xl border border-black/5 dark:border-white/8 bg-black/[0.02] dark:bg-white/[0.03] overflow-hidden", !hideHeader && "grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 rounded-none border-0 bg-transparent")}>
                {availableChannels.map((channel) => (
                  <ChannelCard
                    key={channel.id}
                    channel={channel}
                    hideHeader={hideHeader}
                    onClick={() => {
                      blurActiveElement();
                      setSelectedChannelType(channel.type);
                      setShowAddDialog(true);
                    }}
                    onDelete={() => {
                      blurActiveElement();
                      setChannelToDelete({ id: channel.id, type: channel.type });
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {showAccountManagement && configuredGroups.length > 0 && (
            <div className={cn(hideHeader ? "mb-4" : "mb-12")}>
              <h2
                className={cn(
                  hideHeader ? "text-base font-semibold text-foreground mb-3" : "text-3xl font-serif text-foreground mb-6 font-normal tracking-tight"
                )}
                style={hideHeader ? undefined : { fontFamily: 'Georgia, Cambria, "Times New Roman", Times, serif' }}
              >
                {t('configured')}
              </h2>
              <div className={cn(hideHeader ? "space-y-3" : "space-y-4")}>
                {configuredGroups.map((group) => (
                  <div
                    key={group.channelType}
                    className={cn(
                      "rounded-2xl border border-black/10 dark:border-white/10 bg-transparent",
                      hideHeader ? "p-3" : "p-4"
                    )}
                  >
                    <div className={cn("flex items-center justify-between gap-2", hideHeader ? "mb-2" : "mb-3")}>
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={cn(
                          "shrink-0 flex items-center justify-center text-foreground bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/10 rounded-full shadow-sm",
                          hideHeader ? "h-8 w-8" : "h-[40px] w-[40px]"
                        )}>
                          <ChannelLogo type={group.channelType as ChannelType} />
                        </div>
                        <div className="min-w-0">
                          <h3 className={cn(hideHeader ? "text-[14px] font-semibold text-foreground truncate" : "text-[16px] font-semibold text-foreground truncate")}>
                            {CHANNEL_NAMES[group.channelType as ChannelType] || group.channelType}
                          </h3>
                          <p className={cn(hideHeader ? "text-[11px] text-muted-foreground" : "text-[12px] text-muted-foreground")}>{group.channelType}</p>
                        </div>
                        <div
                          className={cn(
                            'w-2 h-2 rounded-full shrink-0',
                            group.status === 'connected'
                              ? 'bg-green-500'
                              : group.status === 'connecting'
                                ? 'bg-yellow-500 animate-pulse'
                                : group.status === 'error'
                                  ? 'bg-destructive'
                                  : 'bg-muted-foreground'
                          )}
                        />
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <Button
                          size="sm"
                          variant="outline"
                          className={cn("text-xs rounded-full", hideHeader ? "h-7 px-2.5" : "h-8")}
                          onClick={() => {
                            const shouldUseGeneratedAccountId = !usesPluginManagedQrAccounts(group.channelType);
                            const nextAccountId = shouldUseGeneratedAccountId
                              ? createNewAccountId(
                                  group.channelType,
                                  group.accounts.map((item) => item.accountId),
                                )
                              : undefined;
                            setSelectedChannelType(group.channelType as ChannelType);
                            setSelectedAccountId(nextAccountId);
                            setAllowExistingConfigInModal(false);
                            setAllowEditAccountIdInModal(shouldUseGeneratedAccountId);
                            setExistingAccountIdsForModal(group.accounts.map((item) => item.accountId));
                            setInitialConfigValuesForModal(undefined);
                            setShowConfigModal(true);
                          }}
                        >
                          <Plus className="h-3.5 w-3.5 mr-1" />
                          {t('account.add')}
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className={cn("text-muted-foreground hover:text-destructive hover:bg-destructive/10", hideHeader ? "h-6 w-6" : "h-7 w-7")}
                          onClick={() => setDeleteTarget({ channelType: group.channelType })}
                          title={t('account.deleteChannel')}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    <div className={cn(hideHeader ? "space-y-1.5" : "space-y-2")}>
                      {group.accounts.map((account) => {
                        const displayName =
                          account.accountId === 'default' && account.name === account.accountId
                            ? t('account.mainAccount')
                            : account.name;
                        return (
                          <div key={`${group.channelType}-${account.accountId}`} className={cn("rounded-xl bg-black/5 dark:bg-white/5", hideHeader ? "px-2.5 py-2" : "px-3 py-2")}>
                            <div className={cn("flex items-center justify-between gap-3", hideHeader && "flex-wrap")}>
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <p className={cn(hideHeader ? "text-[12px] font-medium text-foreground truncate" : "text-[13px] font-medium text-foreground truncate")}>{displayName}</p>
                                </div>
                                {account.lastError && (
                                  <div className="text-[12px] text-destructive mt-1">{account.lastError}</div>
                                )}
                              </div>

                              <div className={cn("flex items-center gap-2", hideHeader && "w-full justify-end")}>
                                <span className="text-xs text-muted-foreground">{t('account.bindAgentLabel')}</span>
                                <select
                                  className={cn(
                                    "rounded-lg border border-black/10 dark:border-white/10 bg-background px-2 text-xs",
                                    hideHeader ? "h-7 min-w-[110px]" : "h-8"
                                  )}
                                  value={account.agentId || ''}
                                  onChange={(event) => {
                                    void handleBindAgent(group.channelType, account.accountId, event.target.value);
                                  }}
                                >
                                  <option value="">{t('account.unassigned')}</option>
                                  {bindableAgents.map((agent) => (
                                    <option key={agent.id} value={agent.id}>{agent.name}</option>
                                  ))}
                                </select>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className={cn("text-xs rounded-full", hideHeader ? "h-7 px-2.5" : "h-8")}
                                  onClick={() => {
                                    void (async () => {
                                      try {
                                        const accountParam = `?accountId=${encodeURIComponent(account.accountId)}`;
                                        const result = await hostApiFetch<{ success: boolean; values?: Record<string, string> }>(
                                          `/api/channels/config/${encodeURIComponent(group.channelType)}${accountParam}`
                                        );
                                        setInitialConfigValuesForModal(result.success ? (result.values || {}) : undefined);
                                      } catch {
                                        setInitialConfigValuesForModal(undefined);
                                      }
                                      setSelectedChannelType(group.channelType as ChannelType);
                                      setSelectedAccountId(account.accountId);
                                      setAllowExistingConfigInModal(true);
                                      setAllowEditAccountIdInModal(false);
                                      setExistingAccountIdsForModal([]);
                                      setShowConfigModal(true);
                                    })();
                                  }}
                                >
                                  {t('account.edit')}
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className={cn("text-muted-foreground hover:text-destructive hover:bg-destructive/10", hideHeader ? "h-6 w-6" : "h-7 w-7")}
                                  onClick={() => setDeleteTarget({ channelType: group.channelType, accountId: account.accountId })}
                                  title={t('account.delete')}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 未配置的渠道列表 */}
          <div className={cn(hideHeader ? "" : "mb-8")}>
            {!hideHeader && (
              <h2 className="text-3xl font-serif text-foreground mb-6 font-normal tracking-tight" style={{ fontFamily: 'Georgia, Cambria, "Times New Roman", Times, serif' }}>
                {t('supportedChannels')}
              </h2>
            )}
            <div className={cn(
              hideHeader
                ? "rounded-2xl border border-black/5 dark:border-white/8 bg-black/[0.02] dark:bg-white/[0.03] overflow-hidden"
                : "grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4"
            )}>
              {visibleChannelTypes.map((type) => {
                const meta = CHANNEL_META[type];
                const isAvailable = availableChannels.some((channel) => channel.type === type);
                if (isAvailable) return null;

                return (
                  <button
                    key={type}
                    onClick={() => {
                      blurActiveElement();
                      setSelectedChannelType(type);
                      setShowAddDialog(true);
                    }}
                    className={cn(
                      hideHeader
                        ? 'flex items-center justify-between w-full px-5 py-4 border-b border-black/5 dark:border-white/5 last:border-0 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors text-left'
                        : 'group flex items-start gap-4 p-4 rounded-2xl transition-all text-left border relative overflow-hidden bg-transparent border-transparent hover:bg-black/5 dark:hover:bg-white/5'
                    )}
                  >
                    {hideHeader ? (
                      <>
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 shrink-0 flex items-center justify-center bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/10 rounded-full">
                            <ChannelLogo type={type} />
                          </div>
                          <div>
                            <p className="text-[14px] font-medium text-foreground">{meta.name}</p>
                            <p className="text-[12px] text-muted-foreground mt-0.5">{t(meta.description.replace('channels:', ''))}</p>
                          </div>
                        </div>
                        <span className="text-[12px] text-muted-foreground shrink-0">{t('configure', '配置')}</span>
                      </>
                    ) : (
                      <>
                        <div className="h-[46px] w-[46px] shrink-0 flex items-center justify-center text-foreground bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/10 rounded-full shadow-sm mb-3">
                          <ChannelLogo type={type} />
                        </div>
                        <div className="flex flex-col flex-1 min-w-0 py-0.5 mt-1">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="text-[16px] font-semibold text-foreground truncate">{meta.name}</h3>
                            {meta.isPlugin && (
                              <Badge variant="secondary" className="font-mono text-[10px] font-medium px-2 py-0.5 rounded-full bg-black/[0.04] dark:bg-white/[0.08] border-0 shadow-none text-foreground/70">
                                {t('pluginBadge')}
                              </Badge>
                            )}
                          </div>
                          <p className="text-[13.5px] text-muted-foreground line-clamp-2 leading-[1.5]">
                            {t(meta.description.replace('channels:', ''))}
                          </p>
                        </div>
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {showAddDialog && (
        <ChannelConfigModal
          initialSelectedType={selectedChannelType}
          configuredTypes={configuredTypes}
          onClose={() => {
            setShowAddDialog(false);
            setSelectedChannelType(null);
          }}
          onChannelSaved={async (channelType) => {
            setPendingGatewayApply(true);
            setShowAddDialog(false);
            setSelectedChannelType(null);
            await refreshAfterGatewaySettle();
            await autoBindAgentForNewAccount(channelType);
          }}
        />
      )}

      {showConfigModal && (
        <ChannelConfigModal
          initialSelectedType={selectedChannelType}
          configuredTypes={configuredTypes}
          allowExistingConfig={allowExistingConfigInModal}
          allowEditAccountId={allowEditAccountIdInModal}
          existingAccountIds={existingAccountIdsForModal}
          initialConfigValues={initialConfigValuesForModal}
          accountId={selectedAccountId}
          onClose={() => {
            setShowConfigModal(false);
            setSelectedChannelType(null);
            setSelectedAccountId(undefined);
            setAllowExistingConfigInModal(true);
            setAllowEditAccountIdInModal(false);
            setExistingAccountIdsForModal([]);
            setInitialConfigValuesForModal(undefined);
          }}
          onChannelSaved={async (channelType) => {
            const preferredAccountId = allowEditAccountIdInModal ? selectedAccountId : undefined;
            setPendingGatewayApply(true);
            setShowConfigModal(false);
            setSelectedChannelType(null);
            setSelectedAccountId(undefined);
            setAllowExistingConfigInModal(true);
            setAllowEditAccountIdInModal(false);
            setExistingAccountIdsForModal([]);
            setInitialConfigValuesForModal(undefined);
            await refreshAfterGatewaySettle();
            await autoBindAgentForNewAccount(channelType, preferredAccountId);
          }}
        />
      )}

      <ConfirmDialog
        open={!!channelToDelete}
        title={t('common.confirm', 'Confirm')}
        message={t('deleteConfirm')}
        confirmLabel={t('common.delete', 'Delete')}
        cancelLabel={t('common.cancel', 'Cancel')}
        variant="destructive"
        onConfirm={async () => {
          if (channelToDelete) {
            setPendingGatewayApply(true);
            const targetChannelId = channelToDelete.id;
            setChannelToDelete(null);
            await deleteChannel(targetChannelId);
            void refreshAfterGatewaySettle();
          }
        }}
        onCancel={() => setChannelToDelete(null)}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        title={t('common.confirm', 'Confirm')}
        message={deleteTarget?.accountId ? t('account.deleteConfirm') : t('deleteConfirm')}
        confirmLabel={t('common.delete', 'Delete')}
        cancelLabel={t('common.cancel', 'Cancel')}
        variant="destructive"
        onConfirm={async () => {
          if (!deleteTarget) return;
          setPendingGatewayApply(true);
          const suffix = deleteTarget.accountId
            ? `?accountId=${encodeURIComponent(deleteTarget.accountId)}`
            : '';
          const requestPath = `/api/channels/config/${encodeURIComponent(deleteTarget.channelType)}${suffix}`;
          setDeleteTarget(null);
          try {
            await hostApiFetch(requestPath, { method: 'DELETE' });
          } finally {
            void refreshAfterGatewaySettle();
          }
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function ChannelLogo({ type }: { type: ChannelType }) {
  switch (type) {
    case 'telegram':
      return <img src={telegramIcon} alt="Telegram" className="w-[22px] h-[22px] dark:invert" />;
    case 'discord':
      return <img src={discordIcon} alt="Discord" className="w-[22px] h-[22px] dark:invert" />;
    case 'whatsapp':
      return <img src={whatsappIcon} alt="WhatsApp" className="w-[22px] h-[22px] dark:invert" />;
    case 'wechat':
      return <img src={wechatIcon} alt="WeChat" className="w-[22px] h-[22px] dark:invert" />;
    case 'dingtalk':
      return <img src={dingtalkIcon} alt="DingTalk" className="w-[22px] h-[22px] dark:invert" />;
    case 'feishu':
      return <img src={feishuIcon} alt="Feishu" className="w-[22px] h-[22px] dark:invert" />;
    case 'wecom':
      return <img src={wecomIcon} alt="WeCom" className="w-[22px] h-[22px] dark:invert" />;
    case 'qqbot':
      return <img src={qqIcon} alt="QQ" className="w-[22px] h-[22px] dark:invert" />;
    default:
      return <span className="text-[22px]">{CHANNEL_ICONS[type] || '💬'}</span>;
  }
}

interface ChannelCardProps {
  channel: Channel;
  hideHeader?: boolean;
  onClick: () => void;
  onDelete: () => void;
}

function ChannelCard({ channel, hideHeader = false, onClick, onDelete }: ChannelCardProps) {
  const { t } = useTranslation('channels');
  const meta = CHANNEL_META[channel.type];

  if (hideHeader) {
    return (
      <div
        onClick={onClick}
        className="group flex items-center justify-between px-5 py-4 border-b border-black/5 dark:border-white/5 last:border-0 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 shrink-0 flex items-center justify-center bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/10 rounded-full">
            <ChannelLogo type={channel.type} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <p className="text-[14px] font-medium text-foreground">{channel.name}</p>
              <div
                className={cn(
                  'w-2 h-2 rounded-full shrink-0',
                  channel.status === 'connected'
                    ? 'bg-green-500'
                    : channel.status === 'connecting'
                      ? 'bg-yellow-500 animate-pulse'
                      : channel.status === 'error'
                        ? 'bg-destructive'
                        : 'bg-muted-foreground'
                )}
                title={channel.status}
              />
            </div>
            {channel.error ? (
              <p className="text-[12px] text-destructive mt-0.5">{channel.error}</p>
            ) : (
              <p className="text-[12px] text-muted-foreground mt-0.5">
                {meta ? t(meta.description.replace('channels:', '')) : CHANNEL_NAMES[channel.type]}
              </p>
            )}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="opacity-0 group-hover:opacity-100 h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all shrink-0"
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <div
      onClick={onClick}
      className="group flex items-start gap-4 p-4 rounded-2xl transition-all text-left border relative overflow-hidden bg-transparent border-transparent hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
    >
      <div className="h-[46px] w-[46px] shrink-0 flex items-center justify-center text-foreground bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/10 rounded-full shadow-sm mb-3">
        <ChannelLogo type={channel.type} />
      </div>
      <div className="flex flex-col flex-1 min-w-0 py-0.5 mt-1">
        <div className="flex items-center justify-between gap-2 mb-1">
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="text-[16px] font-semibold text-foreground truncate">{channel.name}</h3>
            {meta?.isPlugin && (
              <Badge
                variant="secondary"
                className="font-mono text-[10px] font-medium px-2 py-0.5 rounded-full bg-black/[0.04] dark:bg-white/[0.08] border-0 shadow-none text-foreground/70"
              >
                {t('pluginBadge', 'Plugin')}
              </Badge>
            )}
            <div
              className={cn(
                'w-2 h-2 rounded-full shrink-0',
                channel.status === 'connected'
                  ? 'bg-green-500'
                  : channel.status === 'connecting'
                    ? 'bg-yellow-500 animate-pulse'
                    : channel.status === 'error'
                      ? 'bg-destructive'
                      : 'bg-muted-foreground'
              )}
              title={channel.status}
            />
          </div>

          <Button
            variant="ghost"
            size="icon"
            className="opacity-0 group-hover:opacity-100 h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all shrink-0 -mr-2"
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>

        {channel.error ? (
          <p className="text-[13.5px] text-destructive line-clamp-2 leading-[1.5]">
            {channel.error}
          </p>
        ) : (
          <p className="text-[13.5px] text-muted-foreground line-clamp-2 leading-[1.5]">
            {meta ? t(meta.description.replace('channels:', '')) : CHANNEL_NAMES[channel.type]}
          </p>
        )}
      </div>
    </div>
  );
}

export default Channels;

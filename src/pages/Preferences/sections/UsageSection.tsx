import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useGatewayStore } from '@/stores/gateway';
import { useSettingsStore } from '@/stores/settings';
import { hostApiFetch } from '@/lib/host-api';
import { FeedbackState } from '@/components/common/FeedbackState';
import {
  filterUsageHistoryByWindow,
  groupUsageHistory,
  type UsageGroupBy,
  type UsageHistoryEntry,
  type UsageWindow,
} from '@/pages/Models/usage-history';
import { cn } from '@/lib/utils';

const DEFAULT_USAGE_FETCH_MAX_ATTEMPTS = 6;
const WINDOWS_USAGE_FETCH_MAX_ATTEMPTS = 10;
const USAGE_FETCH_RETRY_DELAY_MS = 1500;

function formatTokenCount(value: number): string {
  return Intl.NumberFormat().format(value);
}

function formatUsageTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(date);
}

function UsageBarChart({ groups, emptyLabel, totalLabel, inputLabel, outputLabel, cacheLabel }: {
  groups: Array<{ label: string; totalTokens: number; inputTokens: number; outputTokens: number; cacheTokens: number }>;
  emptyLabel: string; totalLabel: string; inputLabel: string; outputLabel: string; cacheLabel: string;
}) {
  if (groups.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-black/10 dark:border-white/10 p-8 text-center text-[13px] font-medium text-muted-foreground">
        {emptyLabel}
      </div>
    );
  }
  const maxTokens = Math.max(...groups.map((g) => g.totalTokens), 1);
  return (
    <div className="space-y-4 p-5 rounded-2xl border border-black/5 dark:border-white/8 bg-black/[0.02] dark:bg-white/[0.03]">
      <div className="flex flex-wrap gap-4 text-[12px] font-medium text-muted-foreground mb-2">
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-sky-500" />{inputLabel}</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-violet-500" />{outputLabel}</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-500" />{cacheLabel}</span>
      </div>
      {groups.map((group) => (
        <div key={group.label} className="space-y-1.5">
          <div className="flex items-center justify-between gap-3 text-[13px]">
            <span className="truncate font-semibold text-foreground">{group.label}</span>
            <span className="text-muted-foreground text-[12px]">{totalLabel}: {formatTokenCount(group.totalTokens)}</span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-black/5 dark:bg-white/5">
            <div className="flex h-full overflow-hidden rounded-full" style={{ width: group.totalTokens > 0 ? `${Math.max((group.totalTokens / maxTokens) * 100, 6)}%` : '0%' }}>
              {group.inputTokens > 0 && <div className="h-full bg-sky-500" style={{ width: `${(group.inputTokens / group.totalTokens) * 100}%` }} />}
              {group.outputTokens > 0 && <div className="h-full bg-violet-500" style={{ width: `${(group.outputTokens / group.totalTokens) * 100}%` }} />}
              {group.cacheTokens > 0 && <div className="h-full bg-amber-500" style={{ width: `${(group.cacheTokens / group.totalTokens) * 100}%` }} />}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function UsageSection() {
  const { t, i18n } = useTranslation(['dashboard', 'settings']);
  const isZh = i18n.language?.startsWith('zh');
  const gatewayStatus = useGatewayStore((state) => state.status);
  const devModeUnlocked = useSettingsStore((state) => state.devModeUnlocked);
  const isGatewayRunning = gatewayStatus.state === 'running';
  const usageFetchMaxAttempts = window.electron.platform === 'win32' ? WINDOWS_USAGE_FETCH_MAX_ATTEMPTS : DEFAULT_USAGE_FETCH_MAX_ATTEMPTS;

  const [usageHistory, setUsageHistory] = useState<UsageHistoryEntry[]>([]);
  const [usageGroupBy, setUsageGroupBy] = useState<UsageGroupBy>('model');
  const [usageWindow, setUsageWindow] = useState<UsageWindow>('7d');
  const [usagePage, setUsagePage] = useState(1);
  const usageFetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const usageFetchGenerationRef = useRef(0);

  useEffect(() => {
    if (usageFetchTimerRef.current) { clearTimeout(usageFetchTimerRef.current); usageFetchTimerRef.current = null; }
    if (!isGatewayRunning) return;
    const generation = usageFetchGenerationRef.current + 1;
    usageFetchGenerationRef.current = generation;

    async function fetchWithRetry(attempt: number) {
      if (usageFetchGenerationRef.current !== generation) return;
      try {
        const result = await hostApiFetch<{ entries: UsageHistoryEntry[] }>('/api/usage/history');
        if (usageFetchGenerationRef.current !== generation) return;
        setUsageHistory(result.entries ?? []);
      } catch {
        if (usageFetchGenerationRef.current !== generation) return;
        if (attempt < usageFetchMaxAttempts) {
          usageFetchTimerRef.current = setTimeout(() => { void fetchWithRetry(attempt + 1); }, USAGE_FETCH_RETRY_DELAY_MS);
        }
      }
    }
    void fetchWithRetry(1);
    return () => { if (usageFetchTimerRef.current) { clearTimeout(usageFetchTimerRef.current); usageFetchTimerRef.current = null; } };
  }, [isGatewayRunning, gatewayStatus.connectedAt, gatewayStatus.pid, usageFetchMaxAttempts]);

  const visibleUsageHistory = isGatewayRunning ? usageHistory : [];
  const filteredUsageHistory = filterUsageHistoryByWindow(visibleUsageHistory, usageWindow);
  const usageGroups = groupUsageHistory(filteredUsageHistory, usageGroupBy);
  const usagePageSize = 5;
  const usageTotalPages = Math.max(1, Math.ceil(filteredUsageHistory.length / usagePageSize));
  const safeUsagePage = Math.min(usagePage, usageTotalPages);
  const pagedUsageHistory = filteredUsageHistory.slice((safeUsagePage - 1) * usagePageSize, safeUsagePage * usagePageSize);
  const usageLoading = isGatewayRunning && visibleUsageHistory.length === 0;

  const windowLabels: Record<UsageWindow, string> = {
    '7d': isZh ? '近 7 天' : 'Last 7 days',
    '30d': isZh ? '近 30 天' : 'Last 30 days',
    'all': isZh ? '全部' : 'All time',
  };

  return (
    <div className="p-8 space-y-6 max-w-2xl">
      <div>
        <h2 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider mb-1 px-1">
          {isZh ? '用量统计' : 'Usage'}
        </h2>
        <p className="text-[13px] text-muted-foreground px-1 mb-4">
          {isZh ? '本设备所有已保存对话的 Token 用量汇总。' : 'Aggregated token usage across all saved conversations on this device.'}
        </p>
      </div>

      {usageLoading ? (
        <div className="flex items-center justify-center py-12 rounded-2xl border border-dashed border-black/10 dark:border-white/10">
          <FeedbackState state="loading" title={t('dashboard:recentTokenHistory.loading')} />
        </div>
      ) : visibleUsageHistory.length === 0 ? (
        <div className="flex items-center justify-center py-12 rounded-2xl border border-dashed border-black/10 dark:border-white/10">
          <FeedbackState state="empty" title={t('dashboard:recentTokenHistory.empty')} />
        </div>
      ) : (
        <div className="space-y-5">
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Group by */}
            <div className="flex rounded-xl bg-transparent p-1 border border-black/10 dark:border-white/10">
              {(['model', 'day'] as UsageGroupBy[]).map((g) => (
                <button
                  key={g}
                  onClick={() => { setUsageGroupBy(g); setUsagePage(1); }}
                  className={cn(
                    'px-3 py-1 rounded-lg text-[12px] font-medium transition-colors',
                    usageGroupBy === g ? 'bg-black/8 dark:bg-white/10 text-foreground' : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {g === 'model' ? (isZh ? '按模型' : 'By Model') : (isZh ? '按时间' : 'By Time')}
                </button>
              ))}
            </div>
            {/* Window */}
            <div className="flex rounded-xl bg-transparent p-1 border border-black/10 dark:border-white/10">
              {(['7d', '30d', 'all'] as UsageWindow[]).map((w) => (
                <button
                  key={w}
                  onClick={() => { setUsageWindow(w); setUsagePage(1); }}
                  className={cn(
                    'px-3 py-1 rounded-lg text-[12px] font-medium transition-colors',
                    usageWindow === w ? 'bg-black/8 dark:bg-white/10 text-foreground' : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {windowLabels[w]}
                </button>
              ))}
            </div>
          </div>

          <UsageBarChart
            groups={usageGroups}
            emptyLabel={t('dashboard:recentTokenHistory.empty')}
            totalLabel={isZh ? '总计' : 'Total'}
            inputLabel={isZh ? '输入' : 'Input'}
            outputLabel={isZh ? '输出' : 'Output'}
            cacheLabel={isZh ? '缓存' : 'Cache'}
          />

          {/* Entry list */}
          <div className="space-y-2">
            {pagedUsageHistory.map((entry) => (
              <div key={`${entry.sessionId}-${entry.timestamp}`} className="rounded-2xl border border-black/5 dark:border-white/8 bg-black/[0.02] dark:bg-white/[0.03] p-4 hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-[14px] text-foreground truncate">{entry.model || (isZh ? '未知模型' : 'Unknown model')}</p>
                    <p className="text-[12px] text-muted-foreground truncate mt-0.5">{[entry.provider, entry.agentId].filter(Boolean).join(' · ')}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-bold text-[14px]">{formatTokenCount(entry.totalTokens)}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{formatUsageTimestamp(entry.timestamp)}</p>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[12px] font-medium text-muted-foreground">
                  <span className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-sky-500" />{isZh ? '输入' : 'In'}: {formatTokenCount(entry.inputTokens)}</span>
                  <span className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-violet-500" />{isZh ? '输出' : 'Out'}: ~{formatTokenCount(entry.outputTokens)}</span>
                  {typeof entry.costUsd === 'number' && Number.isFinite(entry.costUsd) && devModeUnlocked && (
                    <span className="ml-auto bg-black/5 dark:bg-white/5 px-2 py-0.5 rounded-md">${entry.costUsd.toFixed(4)}</span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between gap-3">
            <p className="text-[12px] text-muted-foreground">{safeUsagePage} / {usageTotalPages}</p>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setUsagePage((p) => Math.max(1, p - 1))} disabled={safeUsagePage <= 1} className="rounded-xl px-3 h-8 border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={() => setUsagePage((p) => Math.min(usageTotalPages, p + 1))} disabled={safeUsagePage >= usageTotalPages} className="rounded-xl px-3 h-8 border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

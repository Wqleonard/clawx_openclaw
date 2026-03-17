import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { getPointsConsumption } from '@/api/users';
import { useLoginStore } from '@/stores/loginStore';

const PAGE_SIZE = 20;

interface PointRecord {
  id: string;
  type: 'consume' | 'earn';
  descZh: string;
  descEn: string;
  points: number;
  date: string;
  model?: string;
  requestId?: string;
  spentPoints?: number;
  remainingPoints?: number;
}

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function toString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function formatDateLocal(isoOrDateText: string): string {
  if (!isoOrDateText) return '-';
  const date = new Date(isoOrDateText);
  if (Number.isNaN(date.getTime())) return isoOrDateText;
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

function formatPointValue(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 10000) {
    const w = abs / 10000;
    const fixed = Number(w.toFixed(1));
    return `${value < 0 ? '-' : ''}${fixed}w`;
  }
  return `${value}`;
}

function normalizeRecord(raw: Record<string, unknown>, index: number): PointRecord {
  const spentPoints = toNumber(raw.spent_points, 0);
  const remainingPoints = toNumber(raw.remaining_points, 0);
  const points = toNumber(
    // 当前接口主字段是 spent_points（消耗），后续如新增“获得积分”字段可继续扩展
    raw.points ?? raw.amount ?? raw.pointChange ?? raw.change ?? raw.delta ?? (spentPoints ? -spentPoints : 0),
    spentPoints ? -spentPoints : 0
  );
  const explicitType = toString(raw.type ?? raw.direction).toLowerCase();
  const type: PointRecord['type'] =
    explicitType === 'earn' || explicitType === 'income' || explicitType === 'add'
      ? 'earn'
      : explicitType === 'consume' || explicitType === 'expense' || explicitType === 'minus'
        ? 'consume'
        : points >= 0
          ? 'earn'
          : 'consume';

  const desc = toString(
    raw.description ?? raw.desc ?? raw.remark ?? raw.reason ?? raw.bizType ?? raw.type ?? raw.model
  );
  const date = toString(
    raw.createdAt ?? raw.createTime ?? raw.created_at ?? raw.timestamp ?? raw.time ?? raw.date
  );
  const model = toString(raw.model);

  return {
    id: toString(raw.id ?? raw.recordId ?? raw.consumptionId) || `record-${index}-${Date.now()}`,
    type,
    descZh: desc || (type === 'earn' ? '积分获得' : '积分消耗'),
    descEn: desc || (type === 'earn' ? 'Points earned' : 'Points consumed'),
    points,
    date: formatDateLocal(date || '-'),
    model: model || undefined,
    requestId: toString(raw.request_id) || undefined,
    spentPoints: spentPoints || undefined,
    remainingPoints: remainingPoints || undefined,
  };
}

function unpackPageResponse(
  payload: unknown,
  page: number,
  pageSize: number
): { items: Record<string, unknown>[]; hasMore: boolean } {
  if (Array.isArray(payload)) {
    return { items: payload as Record<string, unknown>[], hasMore: payload.length >= pageSize };
  }
  if (!payload || typeof payload !== 'object') {
    return { items: [], hasMore: false };
  }

  const obj = payload as Record<string, unknown>;
  const listCandidate =
    obj.list ?? obj.items ?? obj.records ?? obj.content ?? obj.data ?? obj.result;
  const items = Array.isArray(listCandidate) ? (listCandidate as Record<string, unknown>[]) : [];

  if (typeof obj.hasMore === 'boolean') return { items, hasMore: obj.hasMore };
  if (typeof obj.last === 'boolean') return { items, hasMore: !obj.last };
  if (typeof obj.totalPages === 'number') return { items, hasMore: page + 1 < obj.totalPages };

  const total = toNumber(obj.total ?? obj.totalCount ?? obj.count, -1);
  if (total >= 0) {
    return { items, hasMore: (page + 1) * pageSize < total };
  }
  return { items, hasMore: items.length >= pageSize };
}

export function PointsSection() {
  const { i18n } = useTranslation();
  const isZh = i18n.language?.startsWith('zh');
  const userInfo = useLoginStore((state) => state.userInfo);
  const [refreshing, setRefreshing] = useState(false);
  const [records, setRecords] = useState<PointRecord[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const didInitFetchRef = useRef(false);

  const filtered = useMemo(() => records, [records]);

  const total = records[0]?.remainingPoints ?? userInfo?.points ?? 0;

  const categoryCards = useMemo(
    () => [
      {
        labelZh: '总消耗',
        labelEn: 'Spent',
        value: records.reduce((sum, r) => sum + (r.spentPoints ?? Math.max(0, -r.points)), 0),
      },
      {
        labelZh: '总记录',
        labelEn: 'Records',
        value: records.length,
      },
      {
        labelZh: '本次页消耗',
        labelEn: 'Page Spent',
        value: records.reduce((sum, r) => sum + Math.max(0, -r.points), 0),
      },
      {
        labelZh: '可用积分',
        labelEn: 'Balance',
        value: total,
      },
    ],
    [records, total]
  );

  const fetchPage = useCallback(async (targetPage: number, append: boolean) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError(null);
    try {
      const resp = await getPointsConsumption({ page: targetPage, page_size: PAGE_SIZE });
      const { items, hasMore: nextHasMore } = unpackPageResponse(resp, targetPage, PAGE_SIZE);
      const normalized = items.map((item, idx) => normalizeRecord(item, targetPage * PAGE_SIZE + idx));
      setRecords((prev) => (append ? [...prev, ...normalized] : normalized));
      setPage(targetPage);
      setHasMore(nextHasMore);
      setInitialLoaded(true);
    } catch {
      setError(isZh ? '积分记录加载失败，请稍后重试' : 'Failed to load points records');
      if (!append) setInitialLoaded(true);
    } finally {
      setLoading(false);
      setLoadingMore(false);
      setRefreshing(false);
    }
  }, [isZh]);

  const handleRefresh = useCallback(async () => {
    if (refreshing || loading) return;
    setRefreshing(true);
    await fetchPage(1, false);
  }, [refreshing, loading, fetchPage]);

  const loadMore = useCallback(async () => {
    if (loading || loadingMore || !hasMore) return;
    await fetchPage(page + 1, true);
  }, [fetchPage, hasMore, loading, loadingMore, page]);

  useEffect(() => {
    // React StrictMode 开发环境会双执行 effect，这里做一次幂等保护
    if (didInitFetchRef.current) return;
    didInitFetchRef.current = true;
    void fetchPage(1, false);
  }, [fetchPage]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) {
        void loadMore();
      }
    }, { rootMargin: '120px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [loadMore]);

  return (
    <div className="p-8 space-y-6 max-w-2xl mx-auto">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider mb-1 px-1">
            {isZh ? '积分详情' : 'Points'}
          </h2>
          <p className="text-[13px] text-muted-foreground px-1">
            {isZh ? '查看积分余额和消耗记录。' : 'View your points balance and transaction history.'}
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="shrink-0 mt-1 h-8 w-8 flex items-center justify-center rounded-lg border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5 transition-colors disabled:opacity-50"
          title={isZh ? '刷新' : 'Refresh'}
        >
          <RefreshCw className={cn('h-3.5 w-3.5 text-muted-foreground', refreshing && 'animate-spin')} />
        </button>
      </div>

      {/* Total + recharge */}
      <div className="rounded-2xl border border-black/5 dark:border-white/8 bg-black/[0.02] dark:bg-white/[0.03] px-6 py-5 flex items-center justify-between">
        <div>
          <p className="text-[12px] text-muted-foreground mb-1">{isZh ? '总积分' : 'Total Points'}</p>
          <p className={cn('text-[32px] font-bold text-foreground leading-none transition-opacity', refreshing && 'opacity-40')}>
            {formatPointValue(total)}
          </p>
        </div>
        <button
          disabled
          className="h-8 px-4 rounded-xl text-[13px] font-medium bg-orange-500/80 text-white cursor-not-allowed opacity-60"
          title={isZh ? '充值接口待接入' : 'Top-up API coming soon'}
        >
          {/* TODO: 接入兑换接口 */}
          {isZh ? '去兑换' : 'Redeem'}
        </button>
      </div>

      {/* Category cards */}
      <div className={cn('grid grid-cols-4 gap-3 transition-opacity', (refreshing || loading) && 'opacity-40')}>
        {categoryCards.map((c) => (
          <div key={c.labelEn} className="rounded-2xl border border-black/5 dark:border-white/8 bg-black/[0.02] dark:bg-white/[0.03] px-3 py-3 text-center">
            <p className="text-[18px] font-bold text-foreground">{formatPointValue(c.value)}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">{isZh ? c.labelZh : c.labelEn}</p>
          </div>
        ))}
      </div>

      {/* Records */}
      <div className="space-y-3">
        {/* Tab switcher（后端暂未区分类型，先隐藏） */}

        <div className={cn('transition-opacity', (refreshing || loading) && 'opacity-40')}>
          {!initialLoaded || loading ? (
            <div className="flex items-center justify-center py-10 rounded-2xl border border-dashed border-black/10 dark:border-white/10">
              <p className="text-[13px] text-muted-foreground">{isZh ? '加载中...' : 'Loading...'}</p>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center py-10 rounded-2xl border border-dashed border-red-300/40 dark:border-red-500/30">
              <p className="text-[13px] text-red-500">{error}</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex items-center justify-center py-10 rounded-2xl border border-dashed border-black/10 dark:border-white/10">
              <p className="text-[13px] text-muted-foreground">{isZh ? '暂无记录' : 'No records'}</p>
            </div>
          ) : (
            <div className="rounded-2xl border border-black/5 dark:border-white/8 bg-black/[0.02] dark:bg-white/[0.03] overflow-hidden">
              {filtered.map((r, i) => (
                <div
                  key={r.id}
                  className={cn(
                    'flex items-center justify-between px-5 py-4',
                    i < filtered.length - 1 && 'border-b border-black/5 dark:border-white/5'
                  )}
                >
                  <div>
                    <p className="text-[14px] font-medium text-foreground">
                      {isZh ? (r.model ? `${r.model} 消耗` : r.descZh) : (r.model ? `${r.model} usage` : r.descEn)}
                    </p>
                    <p className="text-[12px] text-muted-foreground mt-0.5">{r.date}</p>
                  </div>
                  <p className={cn('text-[14px] font-bold', r.points > 0 ? 'text-emerald-500' : 'text-red-500')}>
                    {r.points > 0 ? `+${formatPointValue(r.points)}` : formatPointValue(r.points)}
                  </p>
                </div>
              ))}
              <div ref={sentinelRef} className="h-1" />
              {loadingMore && (
                <div className="px-5 py-3 border-t border-black/5 dark:border-white/5 text-center text-[12px] text-muted-foreground">
                  {isZh ? '加载更多中...' : 'Loading more...'}
                </div>
              )}
              {!hasMore && records.length > 0 && (
                <div className="px-5 py-3 border-t border-black/5 dark:border-white/5 text-center text-[12px] text-muted-foreground">
                  {isZh ? '没有更多了' : 'No more records'}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

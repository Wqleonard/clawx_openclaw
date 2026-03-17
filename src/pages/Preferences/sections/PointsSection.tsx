import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

type PointsTab = 'all' | 'consume' | 'earn';

// TODO: 接入积分接口后替换 mock 数据
const MOCK_RECORDS = [
  { id: '1', type: 'consume', descZh: '对话消耗', descEn: 'Chat usage',      points: -12,  date: '2026-03-16 14:32' },
  { id: '2', type: 'earn',    descZh: '每日签到',  descEn: 'Daily check-in', points: +10,  date: '2026-03-16 09:00' },
  { id: '3', type: 'consume', descZh: '对话消耗', descEn: 'Chat usage',      points: -8,   date: '2026-03-15 20:11' },
  { id: '4', type: 'earn',    descZh: '充值获得',  descEn: 'Top-up',         points: +100, date: '2026-03-15 10:00' },
  { id: '5', type: 'consume', descZh: '对话消耗', descEn: 'Chat usage',      points: -5,   date: '2026-03-14 18:44' },
];

const MOCK_CATEGORIES = [
  { labelZh: '通用积分', labelEn: 'General',      value: 85 },
  { labelZh: '订阅积分', labelEn: 'Subscription', value: 0 },
  { labelZh: '赠送积分', labelEn: 'Gift',          value: 10 },
  { labelZh: '促销积分', labelEn: 'Promo',         value: 0 },
];

export function PointsSection() {
  const { i18n } = useTranslation();
  const isZh = i18n.language?.startsWith('zh');
  const [tab, setTab] = useState<PointsTab>('all');
  const [refreshing, setRefreshing] = useState(false);

  const total = MOCK_CATEGORIES.reduce((s, c) => s + c.value, 0);
  const filtered = tab === 'all' ? MOCK_RECORDS : MOCK_RECORDS.filter((r) => r.type === tab);

  const tabs: { key: PointsTab; zh: string; en: string }[] = [
    { key: 'all',     zh: '全部', en: 'All' },
    { key: 'consume', zh: '消耗', en: 'Used' },
    { key: 'earn',    zh: '获得', en: 'Earned' },
  ];

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    // TODO: 接入积分接口
    // await fetchPoints();
    await new Promise((r) => setTimeout(r, 800));
    setRefreshing(false);
  };

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
            {total}
          </p>
        </div>
        <button
          disabled
          className="h-8 px-4 rounded-xl text-[13px] font-medium bg-orange-500/80 text-white cursor-not-allowed opacity-60"
          title={isZh ? '充值接口待接入' : 'Top-up API coming soon'}
        >
          {/* TODO: 接入充值接口 */}
          {isZh ? '去充值' : 'Top Up'}
        </button>
      </div>

      {/* Category cards */}
      <div className={cn('grid grid-cols-4 gap-3 transition-opacity', refreshing && 'opacity-40')}>
        {MOCK_CATEGORIES.map((c) => (
          <div key={c.labelEn} className="rounded-2xl border border-black/5 dark:border-white/8 bg-black/[0.02] dark:bg-white/[0.03] px-3 py-3 text-center">
            <p className="text-[18px] font-bold text-foreground">{c.value}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">{isZh ? c.labelZh : c.labelEn}</p>
          </div>
        ))}
      </div>

      {/* Records */}
      <div className="space-y-3">
        {/* Tab switcher */}
        <div className="flex items-center bg-black/5 dark:bg-white/5 rounded-full p-0.5 gap-0.5 w-fit">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'px-3 py-1 rounded-full text-[12px] font-medium transition-all',
                tab === t.key
                  ? 'bg-white dark:bg-white/15 text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {isZh ? t.zh : t.en}
            </button>
          ))}
        </div>

        <div className={cn('transition-opacity', refreshing && 'opacity-40')}>
          {filtered.length === 0 ? (
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
                    <p className="text-[14px] font-medium text-foreground">{isZh ? r.descZh : r.descEn}</p>
                    <p className="text-[12px] text-muted-foreground mt-0.5">{r.date}</p>
                  </div>
                  <p className={cn('text-[14px] font-bold', r.points > 0 ? 'text-emerald-500' : 'text-red-500')}>
                    {r.points > 0 ? `+${r.points}` : r.points}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

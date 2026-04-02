import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { PointsSection } from './PointsSection';
import { UsageSection } from './UsageSection';

type BillingTab = 'points' | 'usage';

export function BillingUsageSection() {
  const { t } = useTranslation('settings');
  const [tab, setTab] = useState<BillingTab>('points');

  return (
    <div className="space-y-0">
      <div className="sticky top-0 z-10 backdrop-blur-sm bg-background/80 border-b border-black/5 dark:border-white/5">
        <div className="max-w-2xl mx-auto px-8 py-4">
          <div className="inline-flex rounded-xl p-1 border border-black/10 dark:border-white/10">
            {(['points', 'usage'] as BillingTab[]).map((item) => (
              <button
                key={item}
                onClick={() => setTab(item)}
                className={cn(
                  'px-3 py-1 rounded-lg text-[12px] font-medium transition-colors',
                  tab === item ? 'bg-black/8 dark:bg-white/10 text-foreground' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {item === 'points' ? t('preferencesNav.items.points') : t('preferencesNav.items.usage')}
              </button>
            ))}
          </div>
        </div>
      </div>

      {tab === 'points' ? <PointsSection /> : <UsageSection />}
    </div>
  );
}

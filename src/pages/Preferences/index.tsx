import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { AccountSectionUnified } from './sections/AccountSectionUnified';
import { BillingUsageSection } from './sections/BillingUsageSection';
import { ModelsSection } from './sections/ModelsSection';
import { WorkspaceSection } from './sections/WorkspaceSection';
import { SkillsSection } from './sections/SkillsSection';
import { ChannelsSection } from './sections/ChannelsSection';
import { AboutSection } from './sections/AboutSection';
import { PrivacySection } from './sections/PrivacySection';
import { FeedbackSection } from './sections/FeedbackSection';

type SectionKey =
  | 'account'
  | 'billingUsage'
  | 'models'
  | 'skills'
  | 'channels'
  | 'workspace'
  | 'privacy'
  | 'feedback'
  | 'about';

interface NavItem {
  key: SectionKey;
  labelKey: string;
}

interface NavGroup {
  key: string;
  labelKey: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    key: 'myAccount',
    labelKey: 'preferencesNav.groups.myAccount',
    items: [
      { key: 'account', labelKey: 'preferencesNav.items.account' },
      { key: 'billingUsage', labelKey: 'preferencesNav.items.billingUsage' },
    ],
  },
  {
    key: 'aiCapabilities',
    labelKey: 'preferencesNav.groups.aiCapabilities',
    items: [
      { key: 'models', labelKey: 'preferencesNav.items.models' },
      { key: 'channels', labelKey: 'preferencesNav.items.channels' },
      { key: 'skills', labelKey: 'preferencesNav.items.skills' },
    ],
  },
  {
    key: 'workspacePrivacy',
    labelKey: 'preferencesNav.groups.workspacePrivacy',
    items: [
      { key: 'workspace', labelKey: 'preferencesNav.items.workspace' },
      { key: 'privacy', labelKey: 'preferencesNav.items.privacy' },
    ],
  },
  {
    key: 'helpInfo',
    labelKey: 'preferencesNav.groups.helpInfo',
    items: [
      { key: 'feedback', labelKey: 'preferencesNav.items.feedback' },
      { key: 'about', labelKey: 'preferencesNav.items.about' },
    ],
  },
];

function renderSection(key: SectionKey) {
  switch (key) {
    case 'account': return <AccountSectionUnified />;
    case 'billingUsage': return <BillingUsageSection />;
    case 'models':    return <ModelsSection />;
    case 'workspace': return <WorkspaceSection />;
    case 'skills':    return <SkillsSection />;
    case 'channels':  return <ChannelsSection />;
    case 'privacy':   return <PrivacySection />;
    case 'feedback':  return <FeedbackSection />;
    case 'about':     return <AboutSection />;
  }
}

function normalizeSectionKey(raw: string): SectionKey {
  const validKeys: SectionKey[] = [
    'account',
    'billingUsage',
    'models',
    'skills',
    'channels',
    'workspace',
    'privacy',
    'feedback',
    'about',
  ];
  const legacyKeyMap: Record<string, SectionKey> = {
    general: 'account',
    usage: 'billingUsage',
    points: 'billingUsage',
    billing: 'billingUsage',
    account: 'account',
    accountSecurity: 'account',
    appPreferences: 'account',
    app: 'account',
    mcp: 'models',
  };

  if (raw in legacyKeyMap) return legacyKeyMap[raw];
  return validKeys.includes(raw as SectionKey) ? (raw as SectionKey) : 'account';
}

export function Preferences() {
  const { t } = useTranslation('settings');
  const [active, setActive] = useState<SectionKey>(() => normalizeSectionKey('account'));

  return (
    <div className="flex h-full overflow-hidden bg-background">
      <div className="w-[180px] shrink-0 border-r border-black/5 dark:border-white/5 flex flex-col py-4 px-2 overflow-y-auto bg-black/[0.02] dark:bg-white/[0.02]">
        {NAV_GROUPS.map((group, idx) => (
          <div key={group.key} className={cn(idx > 0 && 'mt-3 pt-3 border-t border-black/5 dark:border-white/5')}>
            <p className="px-3 mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold">
              {t(group.labelKey)}
            </p>
            {group.items.map((item) => (
              <button
                key={item.key}
                onClick={() => setActive(item.key)}
                className={cn(
                  'flex items-center px-3 py-[7px] rounded-lg text-[13px] transition-colors text-left w-full mb-0.5',
                  active === item.key
                    ? 'bg-black/8 dark:bg-white/10 text-foreground font-medium'
                    : 'text-muted-foreground hover:bg-black/5 dark:hover:bg-white/5 hover:text-foreground'
                )}
              >
                {t(item.labelKey)}
              </button>
            ))}
          </div>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {renderSection(active)}
      </div>
    </div>
  );
}

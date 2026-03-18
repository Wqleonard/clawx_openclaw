import { Switch } from '@/components/ui/switch';
import { useSettingsStore } from '@/stores/settings';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { Moon, Sun } from 'lucide-react';

function SectionCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-black/5 dark:border-white/8 bg-black/[0.02] dark:bg-white/[0.03] overflow-hidden">
      {children}
    </div>
  );
}

function SettingRow({
  label,
  desc,
  control,
  last = false,
}: {
  label: string;
  desc?: string;
  control: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div className={cn(
      'flex items-center justify-between gap-4 px-5 py-4',
      !last && 'border-b border-black/5 dark:border-white/5'
    )}>
      <div className="min-w-0">
        <p className="text-[14px] font-medium text-foreground">{label}</p>
        {desc && <p className="text-[12px] text-muted-foreground mt-0.5 leading-relaxed">{desc}</p>}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

export function AppPreferencesSection() {
  const { i18n, t } = useTranslation('settings');
  const isZh = i18n.language?.startsWith('zh');
  const { theme, setTheme, launchAtStartup, setLaunchAtStartup, showToolCalls, setShowToolCalls } = useSettingsStore();

  return (
    <div className="p-8 space-y-6 max-w-2xl mx-auto">
      <div>
        <h2 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-1">
          {t('preferencesNav.items.appPreferences')}
        </h2>
        <SectionCard>
          <div className="px-5 py-4 border-b border-black/5 dark:border-white/5">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[14px] font-medium text-foreground">
                  {isZh ? '主题模式' : 'Theme'}
                </p>
                <p className="text-[12px] text-muted-foreground mt-0.5">
                  {isZh ? '开关开启为浅色，关闭为暗色。' : 'Switch on for light mode, off for dark mode.'}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
                  aria-label={isZh ? '切换主题模式' : 'Toggle theme mode'}
                  title={isZh ? '切换主题模式' : 'Toggle theme mode'}
                  className={cn(
                    'h-9 w-9 rounded-full border border-black/10 dark:border-white/10 flex items-center justify-center transition-colors',
                    theme === 'light'
                      ? 'bg-amber-100/80 text-amber-600 hover:bg-amber-100'
                      : 'bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/15'
                  )}
                >
                  {theme === 'light' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>

          <SettingRow
            label={isZh ? '开机自启' : 'Launch at Login'}
            desc={isZh ? '登录时自动启动 BoomClaw。' : 'Start BoomClaw automatically when you log in.'}
            control={<Switch checked={launchAtStartup} onCheckedChange={setLaunchAtStartup} />}
          />

          <SettingRow
            label={isZh ? '显示工具调用' : 'Show Tool Calls'}
            desc={isZh ? '在对话消息中展示模型的工具调用详情块。' : 'Display tool call detail blocks in assistant messages.'}
            control={<Switch checked={showToolCalls} onCheckedChange={setShowToolCalls} />}
            last
          />
        </SectionCard>
      </div>
    </div>
  );
}

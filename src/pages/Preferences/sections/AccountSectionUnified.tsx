import { useEffect, useState } from 'react';
import { LogOut, Moon, Sun } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useLoginStore } from '@/stores/loginStore';
import { useSettingsStore } from '@/stores/settings';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { logClientEvent } from '@/lib/client-log';
import { APP_DISPLAY_NAME } from '@electron/shared/app-brand';
import { getRuntimePluginToggles, setRuntimePluginToggle } from '@/lib/host-api';

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

function maskPhone(phone: string): string {
  if (!phone || phone.length < 7) return phone;
  return phone.slice(0, 3) + '****' + phone.slice(-4);
}

export function AccountSectionUnified() {
  const { i18n, t } = useTranslation('settings');
  const isZh = i18n.language?.startsWith('zh');
  const userInfo = useLoginStore((state) => state.userInfo);
  const logout = useLoginStore((state) => state.logout);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const { theme, setTheme, launchAtStartup, setLaunchAtStartup, showToolCalls, setShowToolCalls } = useSettingsStore();
  const [runtimePluginLoading, setRuntimePluginLoading] = useState(true);
  const [updatingPluginId, setUpdatingPluginId] = useState<'security-protection' | null>(null);
  const [aiExecAuditEnabled, setAiExecAuditEnabled] = useState(true);
  const [boomExecutorGuardEnabled, setBoomExecutorGuardEnabled] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const snapshot = await getRuntimePluginToggles();
        if (!alive) return;
        setAiExecAuditEnabled(snapshot.aiExecAudit?.enabled !== false);
        setBoomExecutorGuardEnabled(snapshot.boomExecutorGuard?.enabled !== false);
      } catch (error) {
        if (!alive) return;
        toast.error(isZh ? '读取插件开关失败' : 'Failed to load plugin toggles');
        console.error(error);
      } finally {
        if (alive) setRuntimePluginLoading(false);
      }
    };
    void load();
    return () => {
      alive = false;
    };
  }, [isZh]);

  const updateSecurityProtectionToggle = async (enabled: boolean) => {
    if (updatingPluginId) return;
    const previousAi = aiExecAuditEnabled;
    const previousExecutor = boomExecutorGuardEnabled;

    setAiExecAuditEnabled(enabled);
    setBoomExecutorGuardEnabled(enabled);
    setUpdatingPluginId('security-protection');

    try {
      await Promise.all([
        setRuntimePluginToggle('ai-exec-audit', enabled),
        setRuntimePluginToggle('boom-executor-guard', enabled),
      ]);
      toast.success(enabled ? 'StoryClaw安全防护已开启' : 'StoryClaw安全防护已关闭');
    } catch (error) {
      setAiExecAuditEnabled(previousAi);
      setBoomExecutorGuardEnabled(previousExecutor);
      toast.error(isZh ? 'StoryClaw安全防护开关更新失败' : 'Failed to update StoryClaw protection toggle');
      console.error(error);
    } finally {
      setUpdatingPluginId(null);
    }
  };

  return (
    <div className="p-8 space-y-6 max-w-2xl mx-auto">
      <div>
        <h2 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-1">
          {t('preferencesNav.items.account')}
        </h2>
        <SectionCard>
          <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-black/5 dark:border-white/5">
            <p className="text-[14px] font-medium text-foreground">
              {isZh ? '手机号' : 'Phone'}
            </p>
            <p className="text-[14px] text-muted-foreground">
              {userInfo?.username ? maskPhone(userInfo.username) : '—'}
            </p>
          </div>
          {/* <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-black/5 dark:border-white/5">
            <div className="min-w-0">
              <p className="text-[14px] font-medium text-foreground">
                {isZh ? '注销账号' : 'Delete Account'}
              </p>
              <p className="text-[12px] text-muted-foreground mt-0.5">
                {isZh ? '注销账号将删除您的账户和所有数据' : 'Permanently remove your account and all associated data'}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                toast.info(isZh ? '该功能暂未开放，敬请期待' : 'This feature is not available yet');
              }}
              className="rounded-lg h-8 px-4 text-[13px] text-red-500 border-red-200 hover:bg-red-50 hover:text-red-600 dark:border-red-900/50 dark:hover:bg-red-950/30 shrink-0"
            >
              {isZh ? '注销' : 'Delete'}
            </Button>
          </div> */}

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
            desc={isZh ? `登录时自动启动 ${APP_DISPLAY_NAME}。` : `Start ${APP_DISPLAY_NAME} automatically when you log in.`}
            control={<Switch checked={launchAtStartup} onCheckedChange={setLaunchAtStartup} />}
          />

          <SettingRow
            label={isZh ? '显示工具调用' : 'Show Tool Calls'}
            desc={isZh ? '在对话消息中展示模型的工具调用详情块。' : 'Display tool call detail blocks in assistant messages.'}
            control={<Switch checked={showToolCalls} onCheckedChange={setShowToolCalls} />}
          />

          <SettingRow
            label={isZh ? 'StoryClaw安全防护开关' : 'StoryClaw Security Protection'}
            desc={isZh ? '开启后AI将不能读取你的管理员权限文件，不能删除和修改敏感文件。' : 'When enabled, AI cannot access admin-protected files or delete/modify sensitive files.'}
            control={
              <Switch
                checked={aiExecAuditEnabled && boomExecutorGuardEnabled}
                disabled={runtimePluginLoading || updatingPluginId !== null}
                onCheckedChange={(checked) => {
                  void updateSecurityProtectionToggle(checked);
                }}
              />
            }
            last
          />
        </SectionCard>
      </div>

      <div className="pt-2">
        {showLogoutConfirm ? (
          <div className="flex items-center justify-center gap-3">
            <span className="text-[13px] text-muted-foreground">
              {isZh ? '确认退出登录？' : 'Confirm log out?'}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                logClientEvent('info', {
                  source: 'preferences.account.logout.confirm',
                  message: 'User clicked logout confirm',
                  data: { language: i18n.language },
                });
                void logout();
                setShowLogoutConfirm(false);
              }}
              className="h-7 px-3 text-[13px] text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
            >
              {isZh ? '确认' : 'Confirm'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowLogoutConfirm(false)}
              className="h-7 px-3 text-[13px] text-muted-foreground hover:text-foreground"
            >
              {isZh ? '取消' : 'Cancel'}
            </Button>
          </div>
        ) : (
          <div className="flex justify-center">
            <button
              onClick={() => setShowLogoutConfirm(true)}
              className="flex items-center gap-1.5 text-[13px] text-red-500 hover:text-red-600 transition-colors"
            >
              <LogOut className="h-3.5 w-3.5" />
              {isZh ? '退出登录' : 'Log out'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

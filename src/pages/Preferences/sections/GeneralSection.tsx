import { useState } from 'react';
import { LogOut } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useSettingsStore } from '@/stores/settings';
import { useLoginStore } from '@/stores/loginStore';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

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

export function GeneralSection() {
  const { i18n } = useTranslation();
  const isZh = i18n.language?.startsWith('zh');
  const { theme, setTheme, launchAtStartup, setLaunchAtStartup, showToolCalls, setShowToolCalls } = useSettingsStore();
  const userInfo = useLoginStore((state) => state.userInfo);
  const logout = useLoginStore((state) => state.logout);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  return (
    <div className="p-8 space-y-6 max-w-2xl mx-auto">

      {/* ── 账号与安全 ── */}
      <div>
        <h2 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-1">
          {isZh ? '账号与安全' : 'Account & Security'}
        </h2>
        <SectionCard>
          {/* 手机号 */}
          <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-black/5 dark:border-white/5">
            <p className="text-[14px] font-medium text-foreground">
              {isZh ? '手机号' : 'Phone'}
            </p>
            <p className="text-[14px] text-muted-foreground">
              {userInfo?.username ? maskPhone(userInfo.username) : '—'}
            </p>
          </div>
          {/* 注销账号 */}
          <div className="flex items-center justify-between gap-4 px-5 py-4">
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
          </div>
        </SectionCard>
      </div>

      {/* ── 外观与行为 ── */}
      <div>
        <h2 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-1">
          {isZh ? '外观与行为' : 'Appearance & Behavior'}
        </h2>
        <SectionCard>
          {/* 主题模式 */}
          <div className="px-5 py-4 border-b border-black/5 dark:border-white/5">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[14px] font-medium text-foreground">
                  {isZh ? '主题模式' : 'Theme'}
                </p>
                <p className="text-[12px] text-muted-foreground mt-0.5">
                  {isZh ? '选择橙白浅色或 Neon Noir 深色模式。' : 'Choose between Orange Cream light mode and Neon Noir dark mode.'}
                </p>
              </div>
              {/* 两个圆形色块 */}
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => setTheme('light')}
                  title="Orange Cream"
                  className={cn(
                    'w-8 h-8 rounded-full border-2 transition-all',
                    theme === 'light'
                      ? 'border-foreground/40 scale-110 shadow-md'
                      : 'border-transparent hover:border-foreground/20'
                  )}
                  style={{ background: 'linear-gradient(135deg, #f97316 0%, #fff7ed 60%, #ffffff 100%)' }}
                />
                <button
                  onClick={() => setTheme('dark')}
                  title="Neon Noir"
                  className={cn(
                    'w-8 h-8 rounded-full border-2 transition-all',
                    theme === 'dark'
                      ? 'border-foreground/40 scale-110 shadow-md'
                      : 'border-transparent hover:border-foreground/20'
                  )}
                  style={{ background: 'linear-gradient(135deg, #0f0f1a 0%, #1a0a2e 50%, #3b0764 100%)' }}
                />
              </div>
            </div>
          </div>

          {/* 开机自启 */}
          <SettingRow
            label={isZh ? '开机自启' : 'Launch at Login'}
            desc={isZh ? '登录时自动启动 BoomClaw。' : 'Start BoomClaw automatically when you log in.'}
            control={
              <Switch checked={launchAtStartup} onCheckedChange={setLaunchAtStartup} />
            }
          />

          {/* 显示工具调用 */}
          <SettingRow
            label={isZh ? '显示工具调用' : 'Show Tool Calls'}
            desc={isZh ? '在对话消息中展示模型的工具调用详情块。' : 'Display tool call detail blocks in assistant messages.'}
            control={
              <Switch checked={showToolCalls} onCheckedChange={setShowToolCalls} />
            }
            last
          />
        </SectionCard>
      </div>

      {/* ── 退出登录 ── */}
      <div className="pt-2">
        {showLogoutConfirm ? (
          <div className="flex items-center justify-center gap-3">
            <span className="text-[13px] text-muted-foreground">
              {isZh ? '确认退出登录？' : 'Confirm log out?'}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { void logout(); setShowLogoutConfirm(false); }}
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

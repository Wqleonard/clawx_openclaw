import { useState } from 'react';
import { LogOut } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useLoginStore } from '@/stores/loginStore';
import { useTranslation } from 'react-i18next';

function SectionCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-black/5 dark:border-white/8 bg-black/[0.02] dark:bg-white/[0.03] overflow-hidden">
      {children}
    </div>
  );
}

function maskPhone(phone: string): string {
  if (!phone || phone.length < 7) return phone;
  return phone.slice(0, 3) + '****' + phone.slice(-4);
}

export function AccountSecuritySection() {
  const { i18n, t } = useTranslation('settings');
  const isZh = i18n.language?.startsWith('zh');
  const userInfo = useLoginStore((state) => state.userInfo);
  const logout = useLoginStore((state) => state.logout);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  return (
    <div className="p-8 space-y-6 max-w-2xl mx-auto">
      <div>
        <h2 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-1">
          {t('preferencesNav.items.accountSecurity')}
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

// import { UpdateSettings } from '@/components/settings/UpdateSettings';
import { Switch } from '@/components/ui/switch';
// import { Button } from '@/components/ui/button';
import { useSettingsStore } from '@/stores/settings';
import { useUpdateStore } from '@/stores/update';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

function SectionCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-black/5 dark:border-white/8 bg-black/[0.02] dark:bg-white/[0.03] overflow-hidden">
      {children}
    </div>
  );
}

function SettingRow({ label, desc, control, last = false }: {
  label: string; desc?: string; control: React.ReactNode; last?: boolean;
}) {
  return (
    <div className={cn('flex items-center justify-between gap-4 px-5 py-4', !last && 'border-b border-black/5 dark:border-white/5')}>
      <div className="min-w-0">
        <p className="text-[14px] font-medium text-foreground">{label}</p>
        {desc && <p className="text-[12px] text-muted-foreground mt-0.5 leading-relaxed">{desc}</p>}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

export function AboutSection() {
  const { i18n } = useTranslation();
  const isZh = i18n.language?.startsWith('zh');
  const { autoCheckUpdate, setAutoCheckUpdate, autoDownloadUpdate, setAutoDownloadUpdate } = useSettingsStore();
  const currentVersion = useUpdateStore((state) => state.currentVersion);
  const updateSetAutoDownload = useUpdateStore((state) => state.setAutoDownload);

  return (
    <div className="p-8 space-y-6 max-w-2xl mx-auto">

      {/* App info */}
      <div>
        <h2 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-1">
          {isZh ? '关于' : 'About'}
        </h2>
        <SectionCard>
          <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-black/5 dark:border-white/5">
            <p className="text-[14px] font-medium text-foreground">BoomClaw</p>
            <p className="text-[13px] text-muted-foreground">{currentVersion || '—'}</p>
          </div>
          {/* <div className="flex items-center gap-3 px-5 py-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.electron.openExternal('https://claw-x.com')}
              className="rounded-xl h-8 px-4 text-[13px] border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5"
            >
              {isZh ? '文档' : 'Docs'}
            </Button>
           
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.electron.openExternal('https://github.com/ValueCell-ai/ClawX')}
              className="rounded-xl h-8 px-4 text-[13px] border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5"
            >
              GitHub
            </Button>
          </div> */}
        </SectionCard>
      </div>

      {/* Updates */}
      <div>
        <h2 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-1">
          {isZh ? '更新' : 'Updates'}
        </h2>
        <SectionCard>
          {/* 手动检查更新暂时隐藏
          <div className="px-5 py-4 border-b border-black/5 dark:border-white/5">
            <UpdateSettings />
          </div>
          */}
          <SettingRow
            label={isZh ? '自动检查更新' : 'Auto-check for Updates'}
            desc={isZh ? '启动时自动检查是否有新版本。' : 'Automatically check for updates on launch.'}
            control={<Switch checked={autoCheckUpdate} onCheckedChange={setAutoCheckUpdate} />}
          />
          <SettingRow
            label={isZh ? '自动下载更新' : 'Auto-download Updates'}
            desc={isZh ? '发现新版本时自动下载。' : 'Automatically download updates when available.'}
            control={
              <Switch
                checked={autoDownloadUpdate}
                onCheckedChange={(v) => { setAutoDownloadUpdate(v); updateSetAutoDownload(v); }}
              />
            }
            last
          />
        </SectionCard>
      </div>

      {/* Copyright */}
      <div className="pt-2 text-center space-y-1">
        <p className="text-[12px] text-muted-foreground/60">
          © {new Date().getFullYear()} BoomClaw. All rights reserved.
        </p>
        <p className="text-[11px] text-muted-foreground/40">
          v{currentVersion || '—'} · Built with ❤️
        </p>
      </div>

    </div>
  );
}

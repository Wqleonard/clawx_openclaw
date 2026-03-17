import { FolderPlus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
// import { Switch } from '@/components/ui/switch';
import { useSettingsStore } from '@/stores/settings';
import { invokeIpc } from '@/lib/api-client';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
// import { cn } from '@/lib/utils';

function SectionCard({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      {title && (
        <h3 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider px-1">
          {title}
        </h3>
      )}
      <div className="rounded-2xl border border-black/5 dark:border-white/8 bg-black/[0.02] dark:bg-white/[0.03] overflow-hidden">
        {children}
      </div>
    </div>
  );
}

// function SettingRow({ label, desc, control, last = false }: {
//   label: string; desc?: string; control: React.ReactNode; last?: boolean;
// }) {
//   return (
//     <div className={cn('flex items-center justify-between gap-4 px-5 py-4', !last && 'border-b border-black/5 dark:border-white/5')}>
//       <div className="min-w-0">
//         <p className="text-[14px] font-medium text-foreground">{label}</p>
//         {desc && <p className="text-[12px] text-muted-foreground mt-0.5 leading-relaxed">{desc}</p>}
//       </div>
//       <div className="shrink-0">{control}</div>
//     </div>
//   );
// }

export function WorkspaceSection() {
  const { i18n, t } = useTranslation('settings');
  const isZh = i18n.language?.startsWith('zh');
  const workspaceRoots = useSettingsStore((s) => s.workspaceRoots);
  const setWorkspaceRoots = useSettingsStore((s) => s.setWorkspaceRoots);

  const handlePickWorkspaceRoot = async () => {
    try {
      const result = await invokeIpc<{ canceled: boolean; filePaths?: string[] }>('dialog:open', {
        properties: ['openDirectory'],
        defaultPath: workspaceRoots[0],
      });
      if (result.canceled || !result.filePaths?.length) return;
      const selected = result.filePaths[0];
      const next = Array.from(new Set([...workspaceRoots, selected]));
      setWorkspaceRoots(next);
      toast.success(t('workspace.saved'));
    } catch {
      toast.error(t('workspace.saveFailed'));
    }
  };

  const handleRemoveWorkspaceRoot = (target: string) => {
    const next = workspaceRoots.filter((item) => item !== target);
    setWorkspaceRoots(next);
    toast.success(t('workspace.saved'));
  };

  return (
    <div className="p-8 space-y-6 max-w-2xl mx-auto">
      <div>
        <h2 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider mb-1 px-1">
          {isZh ? '工作区' : 'Workspace'}
        </h2>
        <p className="text-[13px] text-muted-foreground px-1 mb-4">
          {isZh ? '配置本地项目目录和上下文持久化方式。' : 'Configure the local projects directory and how context is persisted.'}
        </p>
      </div>

      {/* Block 1: Workspace Roots */}
      <SectionCard title={isZh ? '工作区根目录' : 'Workspace Roots'}>
        <div className="px-5 py-4 space-y-3">
          <p className="text-[12px] text-muted-foreground">
            {t('workspace.desc')}
          </p>
          <div className="space-y-2">
            {workspaceRoots.length === 0 ? (
              <p className="text-[12px] text-muted-foreground">{t('workspace.empty')}</p>
            ) : (
              workspaceRoots.map((root) => (
                <div
                  key={root}
                  className="flex items-center justify-between rounded-xl border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 px-3 py-2"
                >
                  <span className="text-[12px] font-mono text-foreground truncate flex-1 mr-2">{root}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemoveWorkspaceRoot(root)}
                    className="h-7 px-2 text-muted-foreground hover:text-red-500 hover:bg-red-500/10 shrink-0"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handlePickWorkspaceRoot()}
            className="rounded-xl h-9 px-4 border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5 text-[13px]"
          >
            <FolderPlus className="h-3.5 w-3.5 mr-1.5" />
            {t('workspace.pick')}
          </Button>
        </div>
      </SectionCard>

      {/* Block 2: Agent & File Settings */}
      {/* <SectionCard title={isZh ? 'Agent 与文件' : 'Agent & Files'}>
       
        <SettingRow
          label={isZh ? '限制文件访问范围' : 'Restrict File Access'}
          desc={isZh ? '启用后，Agent 的工作区将限制在工作目录内。禁用后可访问更广泛的范围，可能导致意外操作。' : "When enabled, Agent's workspace will be restricted to the working directory."}
          control={<Switch checked={false} onCheckedChange={() => {}} />}
        />

       
        <SettingRow
          label={isZh ? '自动保存上下文' : 'Auto-save Context'}
          desc={isZh ? '自动将聊天历史和提取的内容保存到本地工作区文件夹。' : 'Automatically save chat history and extracted artifacts to your local workspace folder.'}
          control={<Switch checked={true} onCheckedChange={() => {}} />}
        />

        
        <SettingRow
          label={isZh ? '文件监听' : 'File Watcher'}
          desc={isZh ? '监听本地文件变化，实时更新 Agent 上下文。' : 'Monitor local file changes to keep agent context up-to-date in real-time.'}
          control={<Switch checked={true} onCheckedChange={() => {}} />}
        />

        
        <SettingRow
          label={isZh ? 'Agent 心跳频率' : 'Agent Heartbeat Interval'}
          desc={isZh ? '检测 Agent 存活状态的心跳间隔（秒）。' : 'Interval in seconds for checking agent liveness.'}
          control={
            <div className="flex items-center gap-1.5">
              <div className="w-16 rounded-lg bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 px-2 py-1 text-[13px] text-center font-mono text-foreground">
                30
              </div>
              <span className="text-[12px] text-muted-foreground">{isZh ? '秒' : 's'}</span>
            </div>
          }
        />

       
        <SettingRow
          label={isZh ? '从 OpenClaw 迁移' : 'Migrate from OpenClaw'}
          desc={isZh ? '将 OpenClaw 的配置、技能和历史数据迁移到 BoomClaw。' : 'Import your OpenClaw configuration, skills, and history into BoomClaw.'}
          control={
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-3 text-[12px] rounded-lg border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5 shadow-none"
              onClick={() => {}}
            >
              {isZh ? '开始迁移' : 'Migrate'}
            </Button>
          }
          last
        /> 
      </SectionCard>*/}
    </div>
  );
}

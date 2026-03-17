import { FolderOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
// import { Switch } from '@/components/ui/switch';
import { useFileSystemStore } from '@/stores/filesystem';
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
  const { i18n } = useTranslation();
  const isZh = i18n.language?.startsWith('zh');
  const workspacePath = useFileSystemStore((s) => s.workspacePath);
  const openFolder = useFileSystemStore((s) => s.openFolder);

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

      {/* Block 1: Default Projects Directory */}
      <SectionCard title={isZh ? '默认项目目录' : 'Default Projects Directory'}>
        <div className="px-5 py-4">
          <p className="text-[12px] text-muted-foreground mb-3">
            {isZh ? 'BoomClaw 项目和上下文文件的保存位置。' : 'Where your projects and context files are saved.'}
          </p>
          <div className="flex items-center gap-2">
            <div className="flex-1 rounded-xl bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5 px-3 py-2 text-[12px] text-muted-foreground truncate font-mono">
              {workspacePath || (isZh ? '未选择工作区' : 'No workspace selected')}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={openFolder}
              className="rounded-xl h-9 px-4 border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5 shrink-0 text-[13px]"
            >
              <FolderOpen className="h-3.5 w-3.5 mr-1.5" />
              {isZh ? '浏览' : 'Browse'}
            </Button>
          </div>
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

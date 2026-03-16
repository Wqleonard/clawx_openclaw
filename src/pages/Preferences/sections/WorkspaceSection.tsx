import { FolderOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useFileSystemStore } from '@/stores/filesystem';
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

export function WorkspaceSection() {
  const { i18n } = useTranslation();
  const isZh = i18n.language?.startsWith('zh');
  const workspacePath = useFileSystemStore((s) => s.workspacePath);
  const openFolder = useFileSystemStore((s) => s.openFolder);

  return (
    <div className="p-8 space-y-6 max-w-2xl">
      <div>
        <h2 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-1">
          {isZh ? '工作区' : 'Workspace'}
        </h2>
        <p className="text-[13px] text-muted-foreground px-1 mb-4">
          {isZh ? '配置本地项目目录和上下文持久化方式。' : 'Configure the local projects directory and how context is persisted.'}
        </p>
      </div>

      <SectionCard>
        {/* Default Projects Directory */}
        <div className="px-5 py-4 border-b border-black/5 dark:border-white/5">
          <p className="text-[14px] font-medium text-foreground mb-1">
            {isZh ? '默认项目目录' : 'Default Projects Directory'}
          </p>
          <p className="text-[12px] text-muted-foreground mb-3">
            {isZh ? 'AutoClaw 项目和上下文文件的保存位置。' : 'Where your projects and context files are saved.'}
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

        {/* Auto-save Context */}
        <SettingRow
          label={isZh ? '自动保存上下文' : 'Auto-save Context'}
          desc={isZh ? '自动将聊天历史和提取的内容保存到本地工作区文件夹。' : 'Automatically save chat history and extracted artifacts to your local workspace folder.'}
          control={<Switch checked={true} onCheckedChange={() => {}} />}
        />

        {/* File Watcher */}
        <SettingRow
          label={isZh ? '文件监听' : 'File Watcher'}
          desc={isZh ? '监听本地文件变化，实时更新 Agent 上下文。' : 'Monitor local file changes to keep agent context up-to-date in real-time.'}
          control={<Switch checked={true} onCheckedChange={() => {}} />}
        />

        {/* Restrict File Access */}
        <SettingRow
          label={isZh ? '限制文件访问' : 'Restrict File Access'}
          desc={isZh ? '启用后，Agent 的工作区将限制在工作目录内。禁用后可访问更广泛的范围，可能导致意外操作。' : "When enabled, Agent's workspace will be restricted to the working directory."}
          control={<Switch checked={false} onCheckedChange={() => {}} />}
          last
        />
      </SectionCard>
    </div>
  );
}

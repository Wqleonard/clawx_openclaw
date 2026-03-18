import { useTranslation } from 'react-i18next';
import { Switch } from '@/components/ui/switch';
// import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settings';
import { useState } from 'react';

export function PrivacySection() {
  const { i18n } = useTranslation();
  const isZh = i18n.language?.startsWith('zh');
  const workspaceRoots = useSettingsStore((s) => s.workspaceRoots);
  const [joinProgram, setJoinProgram] = useState(true);

  return (
    <div className="p-8 space-y-6 max-w-2xl mx-auto">
      <div>
        <h2 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider mb-1 px-1">
          {isZh ? '数据存储' : 'Data Storage'}
        </h2>
        <p className="text-[13px] text-muted-foreground px-1 mb-4">
          {isZh
            ? '查看本地数据存储位置与数据相关设置。'
            : 'Review where your local data is stored and manage storage-related settings.'}
        </p>
      </div>

      {/* Block 1: Local Data */}
      <div className="space-y-2">
        <h3 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider px-1">
          {isZh ? '本地数据' : 'Local Data'}
        </h3>
        <div className="rounded-2xl border border-black/5 dark:border-white/8 bg-black/[0.02] dark:bg-white/[0.03] overflow-hidden">
          <div className="flex items-center justify-between gap-4 px-5 py-4">
            <div>
              <p className="text-[14px] font-medium text-foreground">
                {isZh ? '工作区路径' : 'Workspace Path'}
              </p>
              {!workspaceRoots ? (
                <p className="text-[12px] font-mono text-muted-foreground mt-0.5">{isZh ? '未设置' : 'Not set'}</p>
              ) : (
                <p className="text-[12px] font-mono text-muted-foreground mt-0.5 truncate">{workspaceRoots}</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Block 2: Privacy Options */}
      <div className="space-y-2">
        <h3 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider px-1">
          {isZh ? '优化计划' : 'Improvement Program'}
        </h3>
        <div className="rounded-2xl border border-black/5 dark:border-white/8 bg-black/[0.02] dark:bg-white/[0.03] overflow-hidden">
          <div className="flex items-center justify-between gap-4 px-5 py-4">
            <div>
              <p className="text-[14px] font-medium text-foreground">
                {isZh ? '加入用户体验改善计划' : 'Join User Experience Program'}
              </p>
              <p className="text-[12px] text-muted-foreground mt-0.5 leading-relaxed">
                {isZh
                  ? '发送匿名使用数据帮助我们改进产品，不包含任何个人信息或对话内容。'
                  : 'Send anonymous usage data to help us improve. No personal info or conversation content is included.'}
              </p>
            </div>
            <Switch checked={joinProgram} onCheckedChange={setJoinProgram} />
          </div>
        </div>
      </div>

    </div>
  );
}

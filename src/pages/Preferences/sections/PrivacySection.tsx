import { useTranslation } from 'react-i18next';
import { Switch } from '@/components/ui/switch';
// import { cn } from '@/lib/utils';
import { invokeIpc } from '@/lib/api-client';
import { useFileSystemStore } from '@/stores/filesystem';
import { useState } from 'react';

export function PrivacySection() {
  const { i18n } = useTranslation();
  const isZh = i18n.language?.startsWith('zh');
  const workspacePath = useFileSystemStore((s) => s.workspacePath);
  const [joinProgram, setJoinProgram] = useState(true);

  const openUrl = (url: string) => invokeIpc('shell:openExternal', url);

  return (
    <div className="p-8 space-y-6 max-w-2xl mx-auto">
      <div>
        <h2 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider mb-1 px-1">
          {isZh ? '数据与隐私' : 'Data & Privacy'}
        </h2>
        <p className="text-[13px] text-muted-foreground px-1 mb-4">
          {isZh
            ? '查看数据存储位置和隐私设置。'
            : 'Review where data is stored and manage your privacy settings.'}
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
              <p className="text-[12px] font-mono text-muted-foreground mt-0.5 truncate">
                {workspacePath || (isZh ? '未设置' : 'Not set')}
              </p>
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

      {/* Block 3: Legal — 备案 + 两个链接按钮在同一卡片内 */}
      <div className="space-y-2">
        <h3 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider px-1">
          {isZh ? '备案信息' : 'Compliance'}
        </h3>
        <div className="rounded-2xl border border-black/5 dark:border-white/8 bg-black/[0.02] dark:bg-white/[0.03] overflow-hidden">
          {[
            { label: isZh ? 'ICP 备案/许可证号' : 'ICP License', value: '沪ICP备XXXXXXXX号' },
            { label: isZh ? '算法备案' : 'Algorithm Registration', value: 'XXXXXXXXXXXXXXXXXX' },
            { label: isZh ? '大模型备案登记' : 'LLM Registration', value: 'XXXXXXXXXXXXXXXXXX' },
          ].map((item, _) => (
            <div
              key={item.label}
              className="flex items-center justify-between gap-4 px-5 py-4 border-b border-black/5 dark:border-white/5"
            >
              <p className="text-[14px] font-medium text-foreground">{item.label}</p>
              <p className="text-[12px] font-mono text-muted-foreground">{item.value}</p>
            </div>
          ))}

          {/* 分割线后横排两个链接按钮，靠左，无边框 */}
          <div className="px-5 py-3 flex gap-4">
            <button
              onClick={() => openUrl('https://boomclaw.com/privacy')}
              className="text-[13px] text-muted-foreground hover:text-foreground transition-colors"
            >
              {isZh ? '隐私政策' : 'Privacy Policy'}
            </button>
            <button
              onClick={() => openUrl('https://boomclaw.com/terms')}
              className="text-[13px] text-muted-foreground hover:text-foreground transition-colors"
            >
              {isZh ? '用户协议' : 'Terms of Service'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

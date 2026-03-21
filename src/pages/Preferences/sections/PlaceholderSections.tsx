import { Construction } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

function ComingSoon({ titleZh, titleEn, descZh, descEn }: { titleZh: string; titleEn: string; descZh?: string; descEn?: string }) {
  const { i18n } = useTranslation();
  const isZh = i18n.language?.startsWith('zh');
  return (
    <div className="p-8 space-y-6 max-w-2xl">
      <div>
        <h2 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-1">
          {isZh ? titleZh : titleEn}
        </h2>
        {(descZh || descEn) && (
          <p className="text-[13px] text-muted-foreground px-1 mb-4">
            {isZh ? descZh : descEn}
          </p>
        )}
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3 rounded-2xl border border-dashed border-black/10 dark:border-white/10">
          <Construction className="h-7 w-7 opacity-30" />
          <p className="text-[13px] font-medium opacity-50">Coming soon</p>
        </div>
      </div>
    </div>
  );
}

export function McpSection() {
  return (
    <ComingSoon
      titleZh="MCP 服务"
      titleEn="MCP Servers"
      descZh="MCP 服务器通过外部工具扩展 Agent 能力——文件系统、数据库、网络搜索等。"
      descEn="MCP servers extend the agent with external tools — file systems, databases, web search, and more."
    />
  );
}

export function PointsSection() {
  return (
    <ComingSoon
      titleZh="贝壳详情"
      titleEn="Points"
      descZh="查看贝壳余额和消耗记录。"
      descEn="View your points balance and transaction history."
    />
  );
}

export function PrivacySection() {
  return (
    <ComingSoon
      titleZh="数据与隐私"
      titleEn="Data & Privacy"
      descZh="查看数据存储位置和网络请求说明。"
      descEn="Review where data is stored and what outbound network requests are made."
    />
  );
}

export function FeedbackSection() {
  const { i18n } = useTranslation();
  const isZh = i18n.language?.startsWith('zh');
  const [message, setMessage] = useState('');
  const [contact, setContact] = useState('');
  const [includeLogs, setIncludeLogs] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!message.trim()) return;
    setSubmitting(true);
    await new Promise((r) => setTimeout(r, 1000));
    setSubmitting(false);
    setMessage('');
    setContact('');
  };

  return (
    <div className="p-8 space-y-6 max-w-2xl">
      <div>
        <h2 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-1">
          {isZh ? '提交反馈' : 'Send Feedback'}
        </h2>
        <p className="text-[13px] text-muted-foreground px-1 mb-4">
          {isZh
            ? '请描述你遇到的问题或建议。默认会附带本地日志，便于快速定位问题。'
            : 'Describe the issue or suggestion. Local logs are attached by default for faster debugging.'}
        </p>
        <div className="rounded-2xl border border-black/5 dark:border-white/8 bg-black/[0.02] dark:bg-white/[0.03] overflow-hidden space-y-0">
          <div className="px-5 py-4 border-b border-black/5 dark:border-white/5">
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={isZh ? '请尽量详细描述复现步骤、期望结果和实际结果' : 'Please include steps to reproduce, expected behavior, and actual behavior'}
              className="min-h-[120px] bg-transparent border-0 p-0 text-[13px] resize-none focus-visible:ring-0 placeholder:text-muted-foreground/50"
            />
          </div>
          <div className="px-5 py-4 border-b border-black/5 dark:border-white/5">
            <Input
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder={isZh ? '联系方式（可选，如手机号/邮箱）' : 'Contact (optional, e.g. phone/email)'}
              className="bg-transparent border-0 p-0 text-[13px] h-auto focus-visible:ring-0 placeholder:text-muted-foreground/50"
            />
          </div>
          <div className="flex items-center justify-between px-5 py-4">
            <p className="text-[13px] text-muted-foreground">
              {isZh ? '附带本地日志' : 'Attach local logs'}
            </p>
            <Switch checked={includeLogs} onCheckedChange={setIncludeLogs} />
          </div>
        </div>
        <Button
          onClick={handleSubmit}
          disabled={!message.trim() || submitting}
          className="w-full mt-4 rounded-2xl h-11 text-[14px] font-medium"
        >
          {submitting ? (isZh ? '提交中...' : 'Submitting...') : (isZh ? '提交' : 'Submit')}
        </Button>
      </div>
    </div>
  );
}

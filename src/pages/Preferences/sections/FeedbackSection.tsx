import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

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
    try {
      // TODO: 接入反馈接口
      // await submitFeedback({ message, contact, includeLogs });
      await new Promise((r) => setTimeout(r, 800));
      toast.success(isZh ? '反馈已提交，感谢你的反馈！' : 'Feedback submitted, thank you!');
      setMessage('');
      setContact('');
    } catch {
      toast.error(isZh ? '提交失败，请稍后重试' : 'Submission failed, please try again');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-8 space-y-6 max-w-2xl mx-auto">
      <div>
        <h2 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider mb-1 px-1">
          {isZh ? '提交反馈' : 'Send Feedback'}
        </h2>
        <p className="text-[13px] text-muted-foreground px-1 mb-4">
          {isZh
            ? '请描述你遇到的问题或建议。默认会附带本地日志，便于快速定位问题。'
            : 'Describe the issue or suggestion. Local logs are attached by default for faster debugging.'}
        </p>
      </div>

      <div className="rounded-2xl border border-black/5 dark:border-white/8 bg-black/[0.02] dark:bg-white/[0.03] overflow-hidden">
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

      <div className="flex justify-start">
        <Button
          onClick={handleSubmit}
          disabled={!message.trim() || submitting}
          className="rounded-xl h-9 px-8 text-[13px] font-medium"
        >
          {submitting ? (isZh ? '提交中...' : 'Submitting...') : (isZh ? '提交' : 'Submit')}
        </Button>
      </div>
    </div>
  );
}

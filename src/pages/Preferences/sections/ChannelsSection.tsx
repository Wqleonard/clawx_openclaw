import { Channels } from '@/pages/Channels';
import { useTranslation } from 'react-i18next';

export function ChannelsSection() {
  const { i18n } = useTranslation();
  const isZh = i18n.language?.startsWith('zh');

  return (
    <div className="p-8 space-y-4 max-w-2xl">
      <div>
        <h2 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider mb-1 px-1">
          {isZh ? 'IM 频道' : 'IM Channels'}
        </h2>
        <p className="text-[13px] text-muted-foreground px-1 mb-4">
          {isZh
            ? '将 BoomClaw 连接到各类 IM 平台，让 AI 助手直接进入沟通链路。'
            : 'Connect BoomClaw to Feishu, Telegram, and other messaging platforms.'}
        </p>
      </div>
      <Channels />
    </div>
  );
}

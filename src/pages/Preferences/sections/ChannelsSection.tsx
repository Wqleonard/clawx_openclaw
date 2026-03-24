import { Channels } from '@/pages/Channels';
import { useTranslation } from 'react-i18next';
import { APP_DISPLAY_NAME } from '@electron/shared/app-brand';

export function ChannelsSection() {
  const { i18n } = useTranslation();
  const isZh = i18n.language?.startsWith('zh');

  return (
    <div className="p-8 space-y-4 max-w-2xl mx-auto">
      <div>
        <h2 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider mb-1 px-1">
          {isZh ? '机器人IM' : 'Bot IM'}
        </h2>
        <p className="text-[13px] text-muted-foreground px-1 mb-4">
          {isZh
            ? `将 ${APP_DISPLAY_NAME} 连接到各类机器人 IM 平台，让 AI 助手直接进入沟通链路。`
            : `Connect ${APP_DISPLAY_NAME} to Feishu, Telegram, and other messaging platforms.`}
        </p>
      </div>
      <Channels hideHeader enableAdvancedAccountsInHideHeader />
    </div>
  );
}

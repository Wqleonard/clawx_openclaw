import { ProvidersSettings } from '@/components/settings/ProvidersSettings';
import { useTranslation } from 'react-i18next';

export function ModelsSection() {
  const { i18n } = useTranslation();
  const isZh = i18n.language?.startsWith('zh');

  return (
    <div className="p-8 space-y-6 max-w-2xl">
      <div>
        <h2 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-1">
          {isZh ? '模型与 API' : 'Models & API'}
        </h2>
        <p className="text-[13px] text-muted-foreground px-1 mb-4">
          {isZh ? '管理 AI 模型、API Key 和 Gateway 连接。' : 'Manage AI providers, API keys, and gateway connection.'}
        </p>
      </div>
      <ProvidersSettings />
    </div>
  );
}

import { useState } from 'react';
import { ProvidersSettings } from '@/components/settings/ProvidersSettings';
import { useTranslation } from 'react-i18next';
import { useGatewayStore } from '@/stores/gateway';
import { useSettingsStore } from '@/stores/settings';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { hostApiFetch } from '@/lib/host-api';

export function ModelsSection() {
  const { i18n, t } = useTranslation('settings');
  const isZh = i18n.language?.startsWith('zh');
  const gatewayStatus = useGatewayStore((state) => state.status);
  const restart = useGatewayStore((state) => state.restart);
  const gatewayPort = useSettingsStore((state) => state.gatewayPort);
  const setGatewayPort = useSettingsStore((state) => state.setGatewayPort);
  const activePort = gatewayStatus.port ?? gatewayPort;
  const gatewayUrl = `ws://127.0.0.1:${activePort}`;

  const [portDraft, setPortDraft] = useState(String(activePort));
  const [portError, setPortError] = useState('');
  const [savingPort, setSavingPort] = useState(false);

  const handleApplyPort = async () => {
    const num = parseInt(portDraft, 10);
    if (!Number.isInteger(num) || num < 1 || num > 65535) {
      setPortError(isZh ? '端口号无效，请输入 1-65535 之间的整数' : 'Invalid port number. Enter an integer between 1 and 65535.');
      return;
    }
    setPortError('');
    setSavingPort(true);
    try {
      await hostApiFetch('/api/settings/gatewayPort', {
        method: 'PUT',
        body: JSON.stringify({ value: num }),
      });
      setGatewayPort(num);
      toast.success(isZh ? '端口已更新，Gateway 正在重启...' : 'Port updated, Gateway is restarting...');
      void restart();
    } catch {
      toast.error(isZh ? '保存端口失败' : 'Failed to save port');
    } finally {
      setSavingPort(false);
    }
  };

  return (
    <div className="p-8 space-y-8 max-w-2xl mx-auto">
      {/* Providers */}
      <div>
        <h2 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-1">
          {isZh ? '模型与 API' : 'Models & API'}
        </h2>
        <p className="text-[13px] text-muted-foreground px-1 mb-4">
          {isZh ? '管理 AI 模型提供商和 API Key。' : 'Manage AI providers and API keys.'}
        </p>
        <ProvidersSettings />
      </div>

      {/* Gateway */}
      <div>
        <h2 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-1">
          {t('gateway.title')}
        </h2>
        <p className="text-[13px] text-muted-foreground px-1 mb-4">
          {t('gateway.description')}
        </p>
        <div className="rounded-2xl border border-black/5 dark:border-white/8 bg-black/[0.02] dark:bg-white/[0.03] overflow-hidden">
          {/* Gateway URL */}
          <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-black/5 dark:border-white/5">
            <p className="text-[14px] font-medium text-foreground shrink-0">Gateway URL</p>
            <div className="flex items-center gap-2 min-w-0">
              <div className={cn(
                'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-medium border shrink-0',
                gatewayStatus.state === 'running'
                  ? 'bg-green-500/10 text-green-600 dark:text-green-500 border-green-500/20'
                  : gatewayStatus.state === 'error'
                    ? 'bg-red-500/10 text-red-600 dark:text-red-500 border-red-500/20'
                    : 'bg-black/5 dark:bg-white/5 text-muted-foreground border-transparent'
              )}>
                <div className={cn('w-1.5 h-1.5 rounded-full shrink-0',
                  gatewayStatus.state === 'running' ? 'bg-green-500' :
                  gatewayStatus.state === 'error' ? 'bg-red-500' : 'bg-muted-foreground'
                )} />
                {gatewayStatus.state}
              </div>
              <input
                readOnly
                value={gatewayUrl}
                className="w-[200px] h-8 rounded-lg bg-black/5 dark:bg-white/5 border border-black/8 dark:border-white/8 px-3 text-[13px] font-mono text-muted-foreground focus:outline-none"
              />
              <button
                onClick={() => void restart()}
                className="shrink-0 h-8 px-3 rounded-lg text-[13px] font-medium border border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5 text-muted-foreground hover:text-foreground transition-colors"
              >
                {isZh ? '重新连接' : 'Reconnect'}
              </button>
            </div>
          </div>
          {/* Port */}
          <div className="px-5 py-4">
            <div className="flex items-center justify-between gap-4">
              <p className="text-[14px] font-medium text-foreground shrink-0">
                {t('gateway.port')}
              </p>
              <div className="flex items-center gap-2 shrink-0">
                <input
                  value={portDraft}
                  onChange={(e) => { setPortDraft(e.target.value); setPortError(''); }}
                  className="w-[80px] h-8 rounded-lg bg-black/5 dark:bg-white/5 border border-black/8 dark:border-white/8 px-3 text-[13px] font-mono text-foreground text-center focus:outline-none focus:ring-1 focus:ring-black/20 dark:focus:ring-white/20"
                />
                <button
                  onClick={() => void handleApplyPort()}
                  disabled={savingPort || portDraft === String(activePort)}
                  className="h-8 px-3 rounded-lg text-[13px] font-medium border border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
                >
                  {isZh ? '应用' : 'Apply'}
                </button>
              </div>
            </div>
            {portError && (
              <p className="text-[12px] text-red-500 mt-2">{portError}</p>
            )}
            <p className="text-[12px] text-muted-foreground mt-2">
              {isZh
                ? '修改端口后 Gateway 将自动重启。如果默认端口被占用，系统会自动尝试相邻端口。'
                : 'Gateway will restart automatically after changing the port. If the default port is occupied, the system will try adjacent ports.'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

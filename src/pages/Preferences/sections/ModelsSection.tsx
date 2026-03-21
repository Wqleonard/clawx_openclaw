import { useCallback, useEffect, useState } from 'react';
import { ProvidersSettings } from '@/components/settings/ProvidersSettings';
import { useTranslation } from 'react-i18next';
import { useGatewayStore } from '@/stores/gateway';
import { useSettingsStore } from '@/stores/settings';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { hostApiFetch } from '@/lib/host-api';
import { Button } from '@/components/ui/button';
import { ExternalLink } from 'lucide-react';
import { invokeIpc } from '@/lib/api-client';

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
  const [tab, setTab] = useState<'models' | 'gateway' | 'logs'>('models');
  const [logContent, setLogContent] = useState('');
  const [loadingLogs, setLoadingLogs] = useState(false);

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

  const handleShowLogs = useCallback(async () => {
    setLoadingLogs(true);
    try {
      const logs = await hostApiFetch<{ content: string }>('/api/logs?tailLines=100');
      setLogContent(logs.content);
    } catch {
      setLogContent(isZh ? '加载日志失败。' : 'Failed to load logs.');
    } finally {
      setLoadingLogs(false);
    }
  }, [isZh]);

  const handleOpenLogDir = async () => {
    try {
      const { dir: logDir } = await hostApiFetch<{ dir: string | null }>('/api/logs/dir');
      if (logDir) {
        await invokeIpc('shell:showItemInFolder', logDir);
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (tab === 'logs') {
      void handleShowLogs();
    }
  }, [tab, handleShowLogs]);

  return (
    <div className="space-y-0">
      <div className="sticky top-0 z-10 backdrop-blur-sm bg-background/80 border-b border-black/5 dark:border-white/5">
        <div className="max-w-2xl mx-auto px-8 py-4">
        <div className="inline-flex rounded-xl p-1 border border-black/10 dark:border-white/10">
          {(['models', 'gateway', 'logs'] as const).map((item) => (
            <button
              key={item}
              onClick={() => setTab(item)}
              className={cn(
                'px-3 py-1 rounded-lg text-[12px] font-medium transition-colors',
                tab === item ? 'bg-black/8 dark:bg-white/10 text-foreground' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {item === 'models'
                ? t('preferencesNav.tabs.models')
                : item === 'gateway'
                  ? t('preferencesNav.tabs.gateway')
                  : (isZh ? '日志' : 'Logs')}
            </button>
          ))}
        </div>
        </div>
      </div>

      <div className="p-8 space-y-6 max-w-2xl mx-auto">
        {tab === 'models' ? (
        <div>
          <p className="text-[13px] text-muted-foreground px-1 mb-4">
            {isZh ? '管理 AI 模型提供商和 API Key。' : 'Manage AI providers and API keys.'}
          </p>
          <ProvidersSettings />
        </div>
      ) : tab === 'gateway' ? (
        <div>
          <p className="text-[13px] text-muted-foreground px-1 mb-4">
            {t('gateway.description')}
          </p>
          <div className="rounded-2xl border border-black/5 dark:border-white/8 bg-black/[0.02] dark:bg-white/[0.03] overflow-hidden">
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
      ) : (
        <div>
          <p className="text-[13px] text-muted-foreground px-1 mb-4">
            {isZh ? '查看应用最近日志。' : 'View recent application logs.'}
          </p>
          <div className="p-4 rounded-2xl bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5">
            <div className="flex items-center justify-between mb-3">
              <p className="font-medium text-[14px]">{t('gateway.appLogs')}</p>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" className="h-7 text-[12px] rounded-full hover:bg-black/5 dark:hover:bg-white/10" onClick={() => void handleShowLogs()}>
                  {isZh ? '刷新' : 'Refresh'}
                </Button>
                <Button variant="ghost" size="sm" className="h-7 text-[12px] rounded-full hover:bg-black/5 dark:hover:bg-white/10" onClick={handleOpenLogDir}>
                  <ExternalLink className="h-3 w-3 mr-1.5" />
                  {t('gateway.openFolder')}
                </Button>
                <Button variant="ghost" size="sm" className="h-7 text-[12px] rounded-full hover:bg-black/5 dark:hover:bg-white/10" onClick={() => setTab('gateway')}>
                  {t('common:actions.close')}
                </Button>
              </div>
            </div>
            <pre className="text-[12px] text-muted-foreground bg-white dark:bg-card p-4 rounded-xl max-h-60 overflow-auto whitespace-pre-wrap font-mono border border-black/5 dark:border-white/5 shadow-inner">
              {loadingLogs ? (isZh ? '日志加载中...' : 'Loading logs...') : (logContent || t('chat:noLogs'))}
            </pre>
          </div>
        </div>
        )}
      </div>
    </div>
  );
}

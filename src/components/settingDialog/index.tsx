import { useState } from 'react';
import {
  Bot,
  Clock,
  Cpu,
  Network,
  PanelLeft,
  PanelLeftClose,
  Puzzle,
  Settings as SettingsIcon,
} from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, VisuallyHidden } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settings';
import { useSettingDialogStore } from '@/stores/setting-dialog';
import { useTranslation } from 'react-i18next';
import logoSvg from '@/assets/logo.svg';
import { Settings } from '@/pages/Settings';
import { APP_DISPLAY_NAME } from '@electron/shared/app-brand';
import { Models } from '@/pages/Models';
import { Agents } from '@/pages/Agents';
import { Channels } from '@/pages/Channels';
import { Skills } from '@/pages/Skills';
import { Cron } from '@/pages/Cron';

type SettingPanel = 'base' | 'models' | 'agents' | 'channels' | 'skills' | 'cron';

type PanelNavItem = {
  key: SettingPanel;
  icon: React.ReactNode;
  label: string;
};

export function SettingDialog() {
  const { t } = useTranslation(['common', 'chat']);
  const sidebarCollapsed = useSettingsStore((state) => state.sidebarCollapsed);
  const setSidebarCollapsed = useSettingsStore((state) => state.setSidebarCollapsed);
  const open = useSettingDialogStore((state) => state.open);
  const setOpen = useSettingDialogStore((state) => state.setOpen);
  const [activePanel, setActivePanel] = useState<SettingPanel>('base');

  const navItems: PanelNavItem[] = [
    {
      key: 'base',
      icon: <SettingsIcon className="h-[18px] w-[18px]" strokeWidth={2} />,
      label: t('common:sidebar.settings'),
    },
    {
      key: 'models',
      icon: <Cpu className="h-[18px] w-[18px]" strokeWidth={2} />,
      label: t('common:sidebar.models'),
    },
    {
      key: 'agents',
      icon: <Bot className="h-[18px] w-[18px]" strokeWidth={2} />,
      label: t('common:sidebar.agents'),
    },
    {
      key: 'channels',
      icon: <Network className="h-[18px] w-[18px]" strokeWidth={2} />,
      label: t('common:sidebar.channels'),
    },
    {
      key: 'skills',
      icon: <Puzzle className="h-[18px] w-[18px]" strokeWidth={2} />,
      label: t('common:sidebar.skills'),
    },
    {
      key: 'cron',
      icon: <Clock className="h-[18px] w-[18px]" strokeWidth={2} />,
      label: t('common:sidebar.cronTasks'),
    },
  ];

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
    >
      <DialogContent
        className="h-[min(86vh,860px)] w-[min(1200px,calc(100vw-2rem))] max-w-none overflow-hidden p-0"
      >
        <VisuallyHidden>
          <DialogTitle>Settings</DialogTitle>
        </VisuallyHidden>
        <div className="flex h-full w-full overflow-hidden">
          <aside
            className={cn(
              'flex shrink-0 flex-col border-r bg-[#eae8e1]/60 dark:bg-background transition-all duration-300',
              sidebarCollapsed ? 'w-16' : 'w-64'
            )}
          >
            <div
              className={cn(
                'flex items-center p-2 h-12',
                sidebarCollapsed ? 'justify-center' : 'justify-between'
              )}
            >
              {!sidebarCollapsed && (
                <div className="flex items-center gap-2 px-2 overflow-hidden">
                  <img src={logoSvg} alt={APP_DISPLAY_NAME} className="h-5 w-auto shrink-0" />
                  <span className="text-sm font-semibold truncate whitespace-nowrap text-foreground/90">
                    {APP_DISPLAY_NAME}
                  </span>
                </div>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10"
                onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              >
                {sidebarCollapsed ? (
                  <PanelLeft className="h-[18px] w-[18px]" />
                ) : (
                  <PanelLeftClose className="h-[18px] w-[18px]" />
                )}
              </Button>
            </div>
            <nav className="flex flex-col px-2 gap-0.5">
              {navItems.map((item) => {
                const isActive = activePanel === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setActivePanel(item.key)}
                    className={cn(
                      'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[14px] font-medium transition-colors',
                      'hover:bg-black/5 dark:hover:bg-white/5 text-foreground/80',
                      isActive ? 'bg-black/5 dark:bg-white/10 text-foreground' : '',
                      sidebarCollapsed && 'justify-center px-0'
                    )}
                  >
                    <div
                      className={cn(
                        'flex shrink-0 items-center justify-center',
                        isActive ? 'text-foreground' : 'text-muted-foreground'
                      )}
                    >
                      {item.icon}
                    </div>
                    {!sidebarCollapsed && (
                      <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-left">
                        {item.label}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
          </aside>
          <main className="flex-1 overflow-auto p-6">
            {activePanel === 'base' && <Settings />}
            {activePanel === 'models' && <Models />}
            {activePanel === 'agents' && <Agents />}
            {activePanel === 'channels' && <Channels />}
            {activePanel === 'skills' && <Skills />}
            {activePanel === 'cron' && <Cron />}
          </main>
        </div>
      </DialogContent>
    </Dialog>
  );
}

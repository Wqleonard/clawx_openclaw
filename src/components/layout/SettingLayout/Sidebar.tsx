/**
 * Sidebar Component
 * Navigation sidebar for settings pages.
 */
import { NavLink } from 'react-router-dom';
import {
  Network,
  Bot,
  Puzzle,
  Clock,
  PanelLeftClose,
  PanelLeft,
  Cpu,
  Settings as SettingsIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settings';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useTranslation } from 'react-i18next';
import logoSvg from '@/assets/logo.svg';

interface NavItemProps {
  to: string;
  icon: React.ReactNode;
  label: string;
  badge?: string;
  collapsed?: boolean;
  onClick?: () => void;
}

function NavItem({ to, icon, label, badge, collapsed, onClick }: NavItemProps) {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[14px] font-medium transition-colors',
          'hover:bg-black/5 dark:hover:bg-white/5 text-foreground/80',
          isActive ? 'bg-black/5 dark:bg-white/10 text-foreground' : '',
          collapsed && 'justify-center px-0'
        )
      }
    >
      {({ isActive }) => (
        <>
          <div
            className={cn(
              'flex shrink-0 items-center justify-center',
              isActive ? 'text-foreground' : 'text-muted-foreground'
            )}
          >
            {icon}
          </div>
          {!collapsed && (
            <>
              <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                {label}
              </span>
              {badge && (
                <Badge variant="secondary" className="ml-auto shrink-0">
                  {badge}
                </Badge>
              )}
            </>
          )}
        </>
      )}
    </NavLink>
  );
}

export function Sidebar() {
  const sidebarCollapsed = useSettingsStore((state) => state.sidebarCollapsed);
  const setSidebarCollapsed = useSettingsStore((state) => state.setSidebarCollapsed);

  const { t } = useTranslation(['common', 'chat']);

  const navItems = [
    {
      to: '/settings/base',
      icon: <SettingsIcon className="h-[18px] w-[18px]" strokeWidth={2} />,
      label: t('common:sidebar.settings'),
    },
    {
      to: '/settings/models',
      icon: <Cpu className="h-[18px] w-[18px]" strokeWidth={2} />,
      label: t('common:sidebar.models'),
    },
    {
      to: '/settings/agents',
      icon: <Bot className="h-[18px] w-[18px]" strokeWidth={2} />,
      label: t('common:sidebar.agents'),
    },
    {
      to: '/settings/channels',
      icon: <Network className="h-[18px] w-[18px]" strokeWidth={2} />,
      label: t('common:sidebar.channels'),
    },
    {
      to: '/settings/skills',
      icon: <Puzzle className="h-[18px] w-[18px]" strokeWidth={2} />,
      label: t('common:sidebar.skills'),
    },
    {
      to: '/settings/cron',
      icon: <Clock className="h-[18px] w-[18px]" strokeWidth={2} />,
      label: t('common:sidebar.cronTasks'),
    },
  ];

  return (
    <aside
      className={cn(
        'flex shrink-0 flex-col border-r bg-[#eae8e1]/60 dark:bg-background transition-all duration-300',
        sidebarCollapsed ? 'w-16' : 'w-64'
      )}
    >
      {/* Top Header Toggle */}
      <div
        className={cn(
          'flex items-center p-2 h-12',
          sidebarCollapsed ? 'justify-center' : 'justify-between'
        )}
      >
        {!sidebarCollapsed && (
          <div className="flex items-center gap-2 px-2 overflow-hidden">
            <img src={logoSvg} alt="BoomClaw" className="h-5 w-auto shrink-0" />
            <span className="text-sm font-semibold truncate whitespace-nowrap text-foreground/90">
              BoomClaw
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

      {/* Navigation */}
      <nav className="flex flex-col px-2 gap-0.5">
        {navItems.map((item) => (
          <NavItem key={item.to} {...item} collapsed={sidebarCollapsed} />
        ))}
      </nav>
    </aside>
  );
}

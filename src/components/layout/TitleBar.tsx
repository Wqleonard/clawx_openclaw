/**
 * TitleBar Component
 * macOS: empty drag region (native traffic lights handled by hiddenInset).
 * Windows: drag region with custom minimize/maximize/close controls.
 * Linux: use native window chrome (no custom title bar).
 */
import { useState, useEffect } from 'react';
import {
  Minus,
  Square,
  X,
  Copy,
  PanelLeftOpen,
  PanelLeftClose,
  PanelRightOpen,
  PanelRightClose,
  Server,
  ServerOff,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { invokeIpc } from '@/lib/api-client';
import { Button } from '../ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import {
  FILE_TREE_DRAWER_BREAKPOINT,
  SESSION_LIST_DRAWER_BREAKPOINT,
  useChatLayoutStore,
} from '@/stores/chat-layout';
import { useFileSystemStore } from '@/stores/filesystem';
import { useGatewayStore } from '@/stores/gateway';
import { cn } from '@/lib/utils';

export function TitleBar() {
  const platform = window.electron?.platform;

  if (platform === 'darwin') {
    // macOS: just a drag region, traffic lights are native
    return <MacTitleBar />;
    // return <div className="drag-region h-10 shrink-0 border-b bg-background" />;
  }

  // Linux keeps the native frame/title bar for better IME compatibility.
  if (platform !== 'win32') {
    return null;
  }

  return <WindowsTitleBar />;
}

function MacTitleBar() {
  const { t } = useTranslation('chat');
  const isSessionDrawerMode = useChatLayoutStore((s) => s.isSessionDrawerMode);
  const isFileTreeDrawerMode = useChatLayoutStore((s) => s.isFileTreeDrawerMode);
  const isFileTreeDrawerOpen = useChatLayoutStore((s) => s.isFileTreeDrawerOpen);
  const setSessionDrawerMode = useChatLayoutStore((s) => s.setSessionDrawerMode);
  const setFileTreeDrawerMode = useChatLayoutStore((s) => s.setFileTreeDrawerMode);
  const toggleFileTreeDrawer = useChatLayoutStore((s) => s.toggleFileTreeDrawer);
  const isSessionListCollapsed = useChatLayoutStore((s) => s.isSessionListCollapsed);
  const isSessionDrawerOpen = useChatLayoutStore((s) => s.isSessionDrawerOpen);
  const toggleSessionListCollapsed = useChatLayoutStore((s) => s.toggleSessionListCollapsed);
  const toggleSessionDrawer = useChatLayoutStore((s) => s.toggleSessionDrawer);
  const projectPath = useFileSystemStore((s) => s.projectPath);

  useEffect(() => {
    const handleResize = () => {
      setSessionDrawerMode(window.innerWidth < SESSION_LIST_DRAWER_BREAKPOINT);
      setFileTreeDrawerMode(window.innerWidth < FILE_TREE_DRAWER_BREAKPOINT);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [setFileTreeDrawerMode, setSessionDrawerMode]);

  const handleOpenFolder = () => {
    toggleFileTreeDrawer();
  };
  const handleToggleSessionPanel = () => {
    if (isSessionDrawerMode) {
      toggleSessionDrawer();
      return;
    }
    toggleSessionListCollapsed();
  };
  const isSessionPanelOpen = isSessionDrawerMode ? isSessionDrawerOpen : !isSessionListCollapsed;
  const isFileTreePanelOpen = isFileTreeDrawerMode ? isFileTreeDrawerOpen : isFileTreeDrawerOpen;

  return (
    <div className="drag-region flex h-10 shrink-0 items-center justify-end border-b bg-background pl-20 pr-3">
      {projectPath && (
        <div className="no-drag flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              'size-7 cursor-pointer',
              isSessionPanelOpen ? 'bg-accent' : 'text-muted-foreground'
            )}
            onClick={handleToggleSessionPanel}
            title={isSessionPanelOpen ? t('common:actions.close') : t('common:actions.open')}
          >
            {isSessionPanelOpen ? (
              <PanelLeftClose className="size-4" />
            ) : (
              <PanelLeftOpen className="size-4" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              'size-7 cursor-pointer',
              isFileTreePanelOpen ? 'bg-accent' : 'text-muted-foreground'
            )}
            onClick={handleOpenFolder}
            title={isFileTreePanelOpen ? t('common:actions.close') : t('fileTree.openFolder')}
          >
            {isFileTreePanelOpen ? (
              <PanelRightClose className="size-4" />
            ) : (
              <PanelRightOpen className="size-4" />
            )}
          </Button>
        </div>
      )}
    </div>
  );
}

function WindowsTitleBar() {
  const { t } = useTranslation('chat');
  const [maximized, setMaximized] = useState(false);
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const isSessionDrawerMode = useChatLayoutStore((s) => s.isSessionDrawerMode);
  const isFileTreeDrawerMode = useChatLayoutStore((s) => s.isFileTreeDrawerMode);
  const gatewayStatus = useGatewayStore((s) => s.status);
  const isGatewayRunning = gatewayStatus.state === 'running';
  const isFileTreeDrawerOpen = useChatLayoutStore((s) => s.isFileTreeDrawerOpen);
  const setSessionDrawerMode = useChatLayoutStore((s) => s.setSessionDrawerMode);
  const setFileTreeDrawerMode = useChatLayoutStore((s) => s.setFileTreeDrawerMode);
  const toggleFileTreeDrawer = useChatLayoutStore((s) => s.toggleFileTreeDrawer);
  const isSessionListCollapsed = useChatLayoutStore((s) => s.isSessionListCollapsed);
  const isSessionDrawerOpen = useChatLayoutStore((s) => s.isSessionDrawerOpen);
  const toggleSessionListCollapsed = useChatLayoutStore((s) => s.toggleSessionListCollapsed);
  const toggleSessionDrawer = useChatLayoutStore((s) => s.toggleSessionDrawer);
  const projectPath = useFileSystemStore((s) => s.projectPath);

  useEffect(() => {
    // Check initial state
    invokeIpc('window:isMaximized').then((val) => {
      setMaximized(val as boolean);
    });
  }, []);

  useEffect(() => {
    const handleResize = () => {
      setSessionDrawerMode(window.innerWidth < SESSION_LIST_DRAWER_BREAKPOINT);
      setFileTreeDrawerMode(window.innerWidth < FILE_TREE_DRAWER_BREAKPOINT);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [setFileTreeDrawerMode, setSessionDrawerMode]);

  const handleOpenFolder = () => {
    toggleFileTreeDrawer();
  };
  const handleToggleSessionPanel = () => {
    if (isSessionDrawerMode) {
      toggleSessionDrawer();
      return;
    }
    toggleSessionListCollapsed();
  };
  const isSessionPanelOpen = isSessionDrawerMode ? isSessionDrawerOpen : !isSessionListCollapsed;
  const isFileTreePanelOpen = isFileTreeDrawerMode ? isFileTreeDrawerOpen : isFileTreeDrawerOpen;

  const handleMinimize = () => {
    invokeIpc('window:minimize');
  };

  const handleMaximize = () => {
    invokeIpc('window:maximize').then(() => {
      invokeIpc('window:isMaximized').then((val) => {
        setMaximized(val as boolean);
      });
    });
  };

  const handleClose = () => {
    invokeIpc('window:close');
  };

  return (
    <div className="drag-region flex h-10 shrink-0 items-center justify-between bg-background">
      <div className="no-drag flex h-full items-center justify-center px-4">
        {projectPath && (
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              'size-7 cursor-pointer',
              isSessionPanelOpen ? 'bg-black/5 dark:hover:bg-white/10' : 'text-muted-foreground'
            )}
            onClick={handleToggleSessionPanel}
            title={isSessionPanelOpen ? t('common:actions.close') : t('common:actions.open')}
          >
            {isSessionPanelOpen ? (
              <PanelLeftClose className="size-4" />
            ) : (
              <PanelLeftOpen className="size-4" />
            )}
          </Button>
        )}
      </div>
      {/* Right: Window Controls */}
      <div className="no-drag flex h-full">
        <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
          <PopoverTrigger asChild>
            <div className="flex h-full items-center justify-center">
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  'mr-1 relative flex size-7 items-center justify-center transition-colors',
                  isPopoverOpen ? 'bg-black/5 dark:hover:bg-white/10' : 'text-muted-foreground'
                )}
                title='状态'
              >
                {
                  isGatewayRunning ? <Server className="h-4 w-4" /> : <ServerOff className="h-4 w-4" />
                }
                <span
                className={cn(
                  'absolute right-1 top-1 h-2 w-2 rounded-full ring-2 ring-background',
                  isGatewayRunning ? 'bg-green-500' : 'bg-red-500'
                )}
              />
              </Button>
            </div>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-auto min-w-60">
            <p className="text-xs text-muted-foreground">
              {t('composer.gatewayStatus', {
                state: isGatewayRunning ? t('composer.gatewayConnected') : gatewayStatus.state,
                port: gatewayStatus.port,
                pid: gatewayStatus.pid ? `| pid: ${gatewayStatus.pid}` : '',
              })}
            </p>
          </PopoverContent>
        </Popover>
        {projectPath && (
          <div className="flex h-full items-center justify-center">
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                'size-7 cursor-pointer',
                isFileTreePanelOpen ? 'bg-black/5 dark:hover:bg-white/10' : 'text-muted-foreground'
              )}
              onClick={handleOpenFolder}
              title={isFileTreePanelOpen ? t('common:actions.close') : t('fileTree.openFolder')}
            >
              {isFileTreePanelOpen ? (
                <PanelRightClose className="size-4" />
              ) : (
                <PanelRightOpen className="size-4" />
              )}
            </Button>
          </div>
        )}
        <button
          onClick={handleMinimize}
          className="flex h-full w-11 items-center justify-center text-muted-foreground hover:bg-accent transition-colors"
          title="Minimize"
        >
          <Minus className="h-4 w-4" />
        </button>
        <button
          onClick={handleMaximize}
          className="flex h-full w-11 items-center justify-center text-muted-foreground hover:bg-accent transition-colors"
          title={maximized ? 'Restore' : 'Maximize'}
        >
          {maximized ? <Copy className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
        </button>
        <button
          onClick={handleClose}
          className="flex h-full w-11 items-center justify-center text-muted-foreground hover:bg-red-500 hover:text-white transition-colors"
          title="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

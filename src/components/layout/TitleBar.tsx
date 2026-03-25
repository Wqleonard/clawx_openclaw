/**
 * TitleBar Component
 * macOS: empty drag region (native traffic lights handled by hiddenInset).
 * Windows: drag region with custom minimize/maximize/close controls.
 * Linux: use native window chrome (no custom title bar).
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Minus,
  Square,
  X,
  Copy,
  SlidersHorizontal,
  Terminal,
  PanelLeftOpen,
  PanelLeftClose,
  PanelRightOpen,
  PanelRightClose,
  Server,
  ServerOff,
  ChevronDown,
  FolderClosed,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { invokeIpc } from '@/lib/api-client';
import { hostApiFetch } from '@/lib/host-api';
import { Button } from '../ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Dialog, DialogContent, DialogTitle, VisuallyHidden } from '../ui/dialog';
import {
  FILE_TREE_DRAWER_BREAKPOINT,
  SESSION_LIST_DRAWER_BREAKPOINT,
  useChatLayoutStore,
} from '@/stores/chat-layout';
import { useFileSystemStore } from '@/stores/filesystem';
import { useGatewayStore } from '@/stores/gateway';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Preferences } from '@/pages/Preferences';

interface TitleBarProps {
  showPanelToggles?: boolean;
}

function getWorkspaceName(workspacePath: string): string {
  const normalized = workspacePath.replace(/[\\/]+$/, '');
  const segments = normalized.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] || workspacePath;
}

export function TitleBar({ showPanelToggles = true }: TitleBarProps) {
  const platform = window.electron?.platform;

  if (platform === 'darwin') {
    // macOS: just a drag region, traffic lights are native
    return <MacTitleBar showPanelToggles={showPanelToggles} />;
    // return <div className="drag-region h-10 shrink-0 border-b bg-background" />;
  }

  // Linux keeps the native frame/title bar for better IME compatibility.
  if (platform !== 'win32') {
    return null;
  }

  return <WindowsTitleBar showPanelToggles={showPanelToggles} />;
}

function MacTitleBar({ showPanelToggles }: { showPanelToggles: boolean }) {
  const { t, i18n } = useTranslation('chat');
  const isZh = i18n.language?.startsWith('zh');
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const isFileTreeDrawerMode = useChatLayoutStore((s) => s.isFileTreeDrawerMode);
  const gatewayStatus = useGatewayStore((s) => s.status);
  const isGatewayRunning = gatewayStatus.state === 'running';
  const isFileTreeDrawerOpen = useChatLayoutStore((s) => s.isFileTreeDrawerOpen);
  const setSessionDrawerMode = useChatLayoutStore((s) => s.setSessionDrawerMode);
  const setFileTreeDrawerMode = useChatLayoutStore((s) => s.setFileTreeDrawerMode);
  const toggleFileTreeDrawer = useChatLayoutStore((s) => s.toggleFileTreeDrawer);
  const isChatPanelCollapsed = useChatLayoutStore((s) => s.isChatPanelCollapsed);
  const toggleChatPanelCollapsed = useChatLayoutStore((s) => s.toggleChatPanelCollapsed);
  const projectPath = useFileSystemStore((s) => s.projectPath);
  const projectShortcuts = useFileSystemStore((s) => s.projectShortcuts);

  const projectItems = useMemo(
    () =>
      projectShortcuts.map((path) => ({
        path,
        name: getWorkspaceName(path),
        isActive: path === projectPath,
      })),
    [projectPath, projectShortcuts]
  );

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
  const handleToggleChatPanel = () => {
    toggleChatPanelCollapsed();
  };
  const openDevConsole = useCallback(async () => {
    try {
      const result = await hostApiFetch<{
        success: boolean;
        url?: string;
        error?: string;
      }>('/api/gateway/control-ui');
      if (result.success && result.url) {
        window.electron.openExternal(result.url);
      } else {
        toast.error(result.error || 'Failed to open debug console');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(message || 'Failed to open debug console');
    }
  }, []);
  const handleSwitchProject = useCallback((targetPath: string) => {
    if (!targetPath) return;
    const isOnChatRoute = location.pathname === '/' || location.pathname === '/chat';
    if (!isOnChatRoute) {
      navigate('/chat');
      window.setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent('project:switch-request', {
            detail: { path: targetPath },
          }),
        );
      }, 0);
      setProjectMenuOpen(false);
      return;
    }
    window.dispatchEvent(
      new CustomEvent('project:switch-request', {
        detail: { path: targetPath },
      }),
    );
    setProjectMenuOpen(false);
  }, [location.pathname, navigate]);

  const handleCreateProject = useCallback(() => {
    const isOnChatRoute = location.pathname === '/' || location.pathname === '/chat';
    if (!isOnChatRoute) {
      navigate('/chat');
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent('project:create-request'));
      }, 0);
      setProjectMenuOpen(false);
      return;
    }
    window.dispatchEvent(new CustomEvent('project:create-request'));
    setProjectMenuOpen(false);
  }, [location.pathname, navigate]);

  const handleOpenProject = useCallback(() => {
    window.dispatchEvent(new CustomEvent('project:open-request'));
    setProjectMenuOpen(false);
  }, []);
  const isChatPanelOpen = !isChatPanelCollapsed;
  const isFileTreePanelOpen = isFileTreeDrawerMode ? isFileTreeDrawerOpen : isFileTreeDrawerOpen;

  return (
    <>
      <div className="drag-region flex h-10 shrink-0 items-center justify-between border-b bg-background pl-20 pr-3">
        <div className="no-drag flex h-full items-center justify-center px-1">
          {showPanelToggles && projectPath && (
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  'size-7 cursor-pointer',
                  isChatPanelOpen ? 'bg-black/5 dark:hover:bg-white/10' : 'text-muted-foreground'
                )}
                onClick={handleToggleChatPanel}
                title={isChatPanelOpen ? t('common:actions.close') : t('common:actions.open')}
              >
                {isChatPanelOpen ? (
                  <PanelLeftClose className="size-4" />
                ) : (
                  <PanelLeftOpen className="size-4" />
                )}
              </Button>
              <Popover open={projectMenuOpen} onOpenChange={setProjectMenuOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-8 max-w-[220px] border truncate"
                    title={projectPath}
                  >
                    <FolderClosed className="size-4 mr-1 shrink-0" />
                    <span className="truncate">{getWorkspaceName(projectPath)}</span>
                    <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-64 p-1">
                  <button
                    type="button"
                    className="w-full rounded-md px-2 py-1.5 text-left text-sm font-medium hover:bg-black/5 dark:hover:bg-white/10"
                    onClick={handleCreateProject}
                  >
                    + {t('common:projectDialog.title')}
                  </button>
                  <button
                    type="button"
                    className="w-full rounded-md px-2 py-1.5 text-left text-sm font-medium hover:bg-black/5 dark:hover:bg-white/10"
                    onClick={handleOpenProject}
                  >
                    {isZh ? '打开项目' : 'Open Project'}
                  </button>
                  <div className="my-1 border-t"></div>
                  <div className="max-h-[420px] overflow-y-auto space-y-1">
                    {projectItems.length === 0 && (
                      <p className="px-2 py-1.5 text-xs text-muted-foreground">
                        {isZh ? '暂无已保存项目' : 'No saved projects'}
                      </p>
                    )}
                    {projectItems.map((project) => (
                      <button
                        key={project.path}
                        type="button"
                        title={project.path}
                        onClick={() => handleSwitchProject(project.path)}
                        className={cn(
                          'w-full rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                          'hover:bg-black/5 dark:hover:bg-white/10',
                          project.isActive ? 'bg-black/5 dark:bg-white/10 font-medium' : 'text-foreground/80'
                        )}
                      >
                        <div className="truncate">{project.name}</div>
                        <div className="truncate text-[11px] text-muted-foreground">{project.path}</div>
                      </button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          )}
        </div>

        <div className="no-drag flex h-full items-center gap-1">
          {showPanelToggles && projectPath && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10"
                onClick={() => setPreferencesOpen(true)}
                title={t('common:sidebar.preferences')}
              >
                <SlidersHorizontal className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10"
                onClick={() => void openDevConsole()}
                title="Open OpenClaw"
              >
                <Terminal className="h-4 w-4" />
              </Button>
            </>
          )}
          <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  'relative size-7 text-muted-foreground transition-colors',
                  isPopoverOpen ? 'bg-black/5 dark:hover:bg-white/10' : ''
                )}
                title="Gateway Status"
              >
                {isGatewayRunning ? <Server className="h-4 w-4" /> : <ServerOff className="h-4 w-4" />}
                <span
                  className={cn(
                    'absolute right-1 top-1 h-2 w-2 rounded-full ring-2 ring-background',
                    isGatewayRunning ? 'bg-green-500' : 'bg-red-500'
                  )}
                />
              </Button>
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
          {showPanelToggles && projectPath && (
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
          )}
        </div>
      </div>
      <Dialog open={preferencesOpen} onOpenChange={setPreferencesOpen}>
        <DialogContent
          className="max-w-[900px] w-[90vw] h-[80vh] p-0 gap-0 overflow-hidden rounded-2xl bg-white dark:bg-[#1a1a1a] border border-black/10 dark:border-white/10"
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <VisuallyHidden>
            <DialogTitle>{t('common:sidebar.settings')}</DialogTitle>
          </VisuallyHidden>
          <Preferences />
        </DialogContent>
      </Dialog>
    </>
  );
}

function WindowsTitleBar({ showPanelToggles }: { showPanelToggles: boolean }) {
  const { t, i18n } = useTranslation('chat');
  const isZh = i18n.language?.startsWith('zh');
  const [maximized, setMaximized] = useState(false);
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const isFileTreeDrawerMode = useChatLayoutStore((s) => s.isFileTreeDrawerMode);
  const gatewayStatus = useGatewayStore((s) => s.status);
  const isGatewayRunning = gatewayStatus.state === 'running';
  const isFileTreeDrawerOpen = useChatLayoutStore((s) => s.isFileTreeDrawerOpen);
  const setSessionDrawerMode = useChatLayoutStore((s) => s.setSessionDrawerMode);
  const setFileTreeDrawerMode = useChatLayoutStore((s) => s.setFileTreeDrawerMode);
  const toggleFileTreeDrawer = useChatLayoutStore((s) => s.toggleFileTreeDrawer);
  const isChatPanelCollapsed = useChatLayoutStore((s) => s.isChatPanelCollapsed);
  const toggleChatPanelCollapsed = useChatLayoutStore((s) => s.toggleChatPanelCollapsed);
  const projectPath = useFileSystemStore((s) => s.projectPath);
  const projectShortcuts = useFileSystemStore((s) => s.projectShortcuts);

  const projectItems = useMemo(
    () =>
      projectShortcuts.map((path) => ({
        path,
        name: getWorkspaceName(path),
        isActive: path === projectPath,
      })),
    [projectPath, projectShortcuts]
  );

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
  const handleToggleChatPanel = () => {
    toggleChatPanelCollapsed();
  };
  const isChatPanelOpen = !isChatPanelCollapsed;
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

  const openDevConsole = useCallback(async () => {
    try {
      const result = await hostApiFetch<{
        success: boolean;
        url?: string;
        error?: string;
      }>('/api/gateway/control-ui');
      if (result.success && result.url) {
        window.electron.openExternal(result.url);
      } else {
        toast.error(result.error || 'Failed to open debug console');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(message || 'Failed to open debug console');
    }
  }, []);

  const handleSwitchProject = useCallback((targetPath: string) => {
    if (!targetPath) return;
    const isOnChatRoute = location.pathname === '/' || location.pathname === '/chat';
    if (!isOnChatRoute) {
      navigate('/chat');
      window.setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent('project:switch-request', {
            detail: { path: targetPath },
          }),
        );
      }, 0);
      setProjectMenuOpen(false);
      return;
    }
    window.dispatchEvent(
      new CustomEvent('project:switch-request', {
        detail: { path: targetPath },
      }),
    );
    setProjectMenuOpen(false);
  }, [location.pathname, navigate]);

  const handleCreateProject = useCallback(() => {
    const isOnChatRoute = location.pathname === '/' || location.pathname === '/chat';
    if (!isOnChatRoute) {
      navigate('/chat');
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent('project:create-request'));
      }, 0);
      setProjectMenuOpen(false);
      return;
    }
    window.dispatchEvent(new CustomEvent('project:create-request'));
    setProjectMenuOpen(false);
  }, [location.pathname, navigate]);

  const handleOpenProject = useCallback(() => {
    window.dispatchEvent(new CustomEvent('project:open-request'));
    setProjectMenuOpen(false);
  }, []);

  return (
    <>
      <div className="drag-region flex h-10 shrink-0 items-center justify-between bg-background">
        <div className="no-drag flex h-full items-center justify-center px-4">
          {showPanelToggles && projectPath && (
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  'size-7 cursor-pointer',
                  isChatPanelOpen ? 'bg-black/5 dark:hover:bg-white/10' : 'text-muted-foreground'
                )}
                onClick={handleToggleChatPanel}
                title={isChatPanelOpen ? t('common:actions.close') : t('common:actions.open')}
              >
                {isChatPanelOpen ? (
                  <PanelLeftClose className="size-4" />
                ) : (
                  <PanelLeftOpen className="size-4" />
                )}
              </Button>
              <Popover open={projectMenuOpen} onOpenChange={setProjectMenuOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant='ghost'
                    className={cn(
                      'h-8 max-w-[220px] border truncate',
                    )}
                    title={projectPath}
                  >
                    <FolderClosed className="size-4 mr-1 shrink-0" />
                    <span className="truncate">{getWorkspaceName(projectPath)}</span>
                    <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-64 p-1">
                  <button
                    type="button"
                    className="w-full rounded-md px-2 py-1.5 text-left text-sm font-medium hover:bg-black/5 dark:hover:bg-white/10"
                    onClick={handleCreateProject}
                  >
                    + {t('common:projectDialog.title')}
                  </button>
                  <button
                    type="button"
                    className="w-full rounded-md px-2 py-1.5 text-left text-sm font-medium hover:bg-black/5 dark:hover:bg-white/10"
                    onClick={handleOpenProject}
                  >
                    {isZh ? '打开项目' : 'Open Project'}
                  </button>
                  <div className="my-1 border-t"></div>
                  <div className="max-h-[420px] overflow-y-auto space-y-1">
                    {projectItems.map((project) => (
                      <button
                        key={project.path}
                        type="button"
                        title={project.path}
                        onClick={() => handleSwitchProject(project.path)}
                        className={cn(
                          'w-full rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                          'hover:bg-black/5 dark:hover:bg-white/10',
                          project.isActive ? 'bg-black/5 dark:bg-white/10 font-medium' : 'text-foreground/80'
                        )}
                      >
                        <div className="truncate">{project.name}</div>
                        <div className="truncate text-[11px] text-muted-foreground">{project.path}</div>
                      </button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          )}
        </div>
        <div className="no-drag flex h-full">
          {showPanelToggles && projectPath && (
            <div className="mr-1 flex h-full items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10"
                onClick={() => setPreferencesOpen(true)}
                title={t('common:sidebar.preferences')}
              >
                <SlidersHorizontal className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10"
                onClick={() => void openDevConsole()}
                title="Open OpenClaw"
              >
                <Terminal className="h-4 w-4" />
              </Button>
            </div>
          )}
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
                  {isGatewayRunning ? <Server className="h-4 w-4" /> : <ServerOff className="h-4 w-4" />}
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
          {showPanelToggles && projectPath && (
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
      <Dialog open={preferencesOpen} onOpenChange={setPreferencesOpen}>
        <DialogContent
          className="max-w-[900px] w-[90vw] h-[80vh] p-0 gap-0 overflow-hidden rounded-2xl bg-white dark:bg-[#1a1a1a] border border-black/10 dark:border-white/10"
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <VisuallyHidden>
            <DialogTitle>{t('common:sidebar.settings')}</DialogTitle>
          </VisuallyHidden>
          <Preferences />
        </DialogContent>
      </Dialog>
    </>
  );
}

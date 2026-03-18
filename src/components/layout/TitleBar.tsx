/**
 * TitleBar Component
 * macOS: empty drag region (native traffic lights handled by hiddenInset).
 * Windows/Linux: drag region on left, minimize/maximize/close on right.
 */
import { useState, useEffect } from 'react';
import { Minus, Square, X, Copy, PanelLeftOpen, PanelLeftClose, PanelRightOpen, PanelRightClose } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { invokeIpc } from '@/lib/api-client';
import { Button } from '../ui/button';
import { useChatLayoutStore } from '@/stores/chat-layout';
import { useFileSystemStore } from '@/stores/filesystem';
import { cn } from '@/lib/utils';

const isMac = window.electron?.platform === 'darwin';

export function TitleBar() {
  if (isMac) {
    return <MacTitleBar />;
  }

  return <WindowsTitleBar />;
}

function MacTitleBar() {
  const { t } = useTranslation('chat');
  const isFileTreeDrawerOpen = useChatLayoutStore((s) => s.isFileTreeDrawerOpen);
  const toggleFileTreeDrawer = useChatLayoutStore((s) => s.toggleFileTreeDrawer);
  const isSessionListCollapsed = useChatLayoutStore((s) => s.isSessionListCollapsed);
  const toggleSessionListCollapsed = useChatLayoutStore((s) => s.toggleSessionListCollapsed);
  const projectPath = useFileSystemStore((s) => s.projectPath);

  const handleOpenFolder = () => {
    toggleFileTreeDrawer();
  };
  const handleToggleSessionPanel = () => {
    toggleSessionListCollapsed();
  };

  return (
    <div className="drag-region flex h-10 shrink-0 items-center justify-end border-b bg-background pl-20 pr-3">
      {projectPath && (
        <div className="no-drag flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className={cn('size-7 cursor-pointer', !isSessionListCollapsed ? 'bg-accent' : 'text-muted-foreground')}
            onClick={handleToggleSessionPanel}
            title={isSessionListCollapsed ? t('common:actions.open') : t('common:actions.close')}
          >
            {isSessionListCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={cn('size-7 cursor-pointer', isFileTreeDrawerOpen ? 'bg-accent' : 'text-muted-foreground')}
            onClick={handleOpenFolder}
            title={isFileTreeDrawerOpen ? t('common:actions.close') : t('fileTree.openFolder')}
          >
            {isFileTreeDrawerOpen ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}
          </Button>
        </div>
      )}
    </div>
  );
}

function WindowsTitleBar() {
  const { t } = useTranslation('chat');
  const [maximized, setMaximized] = useState(false);
  const isFileTreeDrawerOpen = useChatLayoutStore((s) => s.isFileTreeDrawerOpen);
  const toggleFileTreeDrawer = useChatLayoutStore((s) => s.toggleFileTreeDrawer);
  const isSessionListCollapsed = useChatLayoutStore((s) => s.isSessionListCollapsed);
  const toggleSessionListCollapsed = useChatLayoutStore((s) => s.toggleSessionListCollapsed);
  const projectPath = useFileSystemStore((s) => s.projectPath);

  useEffect(() => {
    // Check initial state
    invokeIpc('window:isMaximized').then((val) => {
      setMaximized(val as boolean);
    });
  }, []);

  const handleOpenFolder = () => {
    toggleFileTreeDrawer();
  };
  const handleToggleSessionPanel = () => {
    toggleSessionListCollapsed();
  };

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
      {projectPath && (
        <div className="no-drag flex h-full items-center justify-center px-4">
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              'size-7 cursor-pointer',
              !isSessionListCollapsed ? 'bg-accent' : 'text-muted-foreground'
            )}
            onClick={handleToggleSessionPanel}
            title={isSessionListCollapsed ? t('common:actions.open') : t('common:actions.close')}
          >
            {isSessionListCollapsed ? (
              <PanelLeftOpen className="size-4" />
            ) : (
              <PanelLeftClose className="size-4" />
            )}
          </Button>
        </div>
      )}
      {/* Right: Window Controls */}
      <div className="no-drag flex h-full">
        {projectPath && (
          <div className="flex h-full items-center justify-center">
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                'size-7 cursor-pointer ',
                isFileTreeDrawerOpen ? 'bg-accent' : 'text-muted-foreground'
              )}
              onClick={handleOpenFolder}
              title={isFileTreeDrawerOpen ? t('common:actions.close') : t('fileTree.openFolder')}
            >
              {isFileTreeDrawerOpen ? (
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

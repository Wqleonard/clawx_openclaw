import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Settings as SettingsIcon } from 'lucide-react';
import { Button } from '../ui/button';
import { cn } from '@/lib/utils';
import { useSettingDialogStore } from '@/stores/setting-dialog';

export type WorkspaceItem = {
  path: string;
  initial: string;
  name: string;
  theme: {
    bg: string;
    text: string;
    border: string;
  };
  isActive: boolean;
};

type ContextMenuState = {
  workspacePath: string;
  x: number;
  y: number;
};

type WorkspaceRailProps = {
  workspaceItems: WorkspaceItem[];
  isAddingWorkspace: boolean;
  onAddWorkspace: () => Promise<void>;
  onSwitchWorkspace: (workspacePath: string) => Promise<void>;
  onEditWorkspace: (workspacePath: string) => Promise<void>;
  onCloseWorkspace: (workspacePath: string) => Promise<void>;
};

type WorkspaceShortcutButtonProps = {
  workspace: WorkspaceItem;
  onActivate: (workspacePath: string) => Promise<void>;
  onContextMenu: (event: React.MouseEvent, workspacePath: string) => void;
};

function WorkspaceShortcutButton({
  workspace,
  onActivate,
  onContextMenu,
}: WorkspaceShortcutButtonProps) {
  return (
    <button
      key={workspace.path}
      title={workspace.path}
      type="button"
      aria-label={`Switch to workspace ${workspace.name}`}
      onClick={() => void onActivate(workspace.path)}
      onContextMenu={(event) => onContextMenu(event, workspace.path)}
      className={cn(
        'size-10 rounded-lg p-0.5 flex items-center justify-center border-2',
        workspace.isActive ? 'border-[var(--workspace-active-border)]' : 'border-transparent'
      )}
    >
      <div
        className="size-full rounded-md border text-sm font-semibold flex items-center justify-center"
        style={{
          backgroundColor: workspace.theme.bg,
          color: workspace.theme.text,
          borderColor: workspace.theme.border,
        }}
      >
        {workspace.initial}
      </div>
    </button>
  );
}

export function WorkspaceRail({
  workspaceItems,
  isAddingWorkspace,
  onAddWorkspace,
  onSwitchWorkspace,
  onEditWorkspace: _onEditWorkspace,
  onCloseWorkspace,
}: WorkspaceRailProps) {
  const navigate = useNavigate();
  const openSettingDialog = useSettingDialogStore((state) => state.openDialog);
  const [menuState, setMenuState] = useState<ContextMenuState | null>(null);

  useEffect(() => {
    const closeMenu = () => setMenuState(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuState(null);
      }
    };

    window.addEventListener('mousedown', closeMenu);
    window.addEventListener('scroll', closeMenu, true);
    window.addEventListener('resize', closeMenu);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', closeMenu);
      window.removeEventListener('scroll', closeMenu, true);
      window.removeEventListener('resize', closeMenu);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const handleContextMenu = (event: React.MouseEvent, workspacePath: string) => {
    event.preventDefault();
    event.stopPropagation();
    setMenuState({
      workspacePath,
      x: event.clientX,
      y: event.clientY,
    });
  };

  const handleEdit = async () => {
    // if (!menuState) return;
    // const target = menuState.workspacePath;
    // setMenuState(null);
    // await onEditWorkspace(target);
  };

  const handleClose = async () => {
    if (!menuState) return;
    const target = menuState.workspacePath;
    setMenuState(null);
    await onCloseWorkspace(target);
  };

  const handleActivateWorkspace = async (workspacePath: string) => {
    await onSwitchWorkspace(workspacePath);
    navigate('/chat');
  };

  return (
    <>
      <div className="flex w-16 h-full flex-col items-center gap-3 py-3">
        {workspaceItems.map((workspace) => (
          <WorkspaceShortcutButton
            key={workspace.path}
            workspace={workspace}
            onActivate={handleActivateWorkspace}
            onContextMenu={handleContextMenu}
          />
        ))}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10"
          disabled={isAddingWorkspace}
          onClick={() => void onAddWorkspace()}
          title="Add workspace"
          aria-label="Add workspace"
        >
          +
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className={cn(
            'mt-auto flex h-8 w-8 items-center justify-center rounded-lg border transition-colors',
            'border-transparent text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10'
          )}
          onClick={openSettingDialog}
          title="settings"
          aria-label="Open settings"
        >
          <SettingsIcon className="h-4 w-4" strokeWidth={2} />
        </Button>
      </div>

      {menuState && (
        <div
          className="fixed z-[100] min-w-[110px] rounded-md border border-black/10 dark:border-white/10 bg-popover p-1 shadow-lg"
          style={{ left: menuState.x, top: menuState.y }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => void handleEdit()}
            className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-black/5 dark:hover:bg-white/10"
          >
            编辑
          </button>
          <button
            type="button"
            onClick={() => void handleClose()}
            className="w-full rounded px-2 py-1.5 text-left font-bold text-sm hover:bg-black/5 dark:hover:bg-white/10"
          >
            关闭
          </button>
        </div>
      )}
    </>
  );
}

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const SESSION_LIST_DRAWER_BREAKPOINT = 1400;
export const FILE_TREE_DRAWER_BREAKPOINT = 1020;
export const CHAT_PANEL_SIZE = {
  list: {
    min: 220,
    max: 520,
    default: 280,
  },
  editor: {
    min: 260,
    max: 1600,
    default: 560,
  },
  fileTree: {
    min: 220,
    max: 520,
    default: 260,
  },
  chatMinWidth: 320,
} as const;

type ChatLayoutState = {
  listWidth: number;
  editorWidth: number;
  fileTreeWidth: number;
  isFileTreeDrawerOpen: boolean;
  isProjectSwitching: boolean;
  isSessionListCollapsed: boolean;
  isSessionDrawerOpen: boolean;
  isSessionDrawerMode: boolean;
  isFileTreeDrawerMode: boolean;
  setListWidth: (width: number) => void;
  setEditorWidth: (width: number) => void;
  setFileTreeWidth: (width: number) => void;
  resetPanelWidths: () => void;
  setFileTreeDrawerOpen: (open: boolean) => void;
  setProjectSwitching: (switching: boolean) => void;
  setSessionListCollapsed: (collapsed: boolean) => void;
  setSessionDrawerOpen: (open: boolean) => void;
  setSessionDrawerMode: (enabled: boolean) => void;
  setFileTreeDrawerMode: (enabled: boolean) => void;
  toggleFileTreeDrawer: () => void;
  toggleSessionListCollapsed: () => void;
  toggleSessionDrawer: () => void;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function loadLegacyPanelWidths() {
  const fallback = {
    listWidth: CHAT_PANEL_SIZE.list.default,
    editorWidth: CHAT_PANEL_SIZE.editor.default,
    fileTreeWidth: CHAT_PANEL_SIZE.fileTree.default,
  };
  try {
    if (typeof window === 'undefined') return fallback;
    const raw = window.localStorage.getItem('chat-style-store');
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as {
      state?: { listWidth?: number; editorWidth?: number; fileTreeWidth?: number };
    };
    return {
      listWidth: clamp(
        parsed.state?.listWidth ?? fallback.listWidth,
        CHAT_PANEL_SIZE.list.min,
        CHAT_PANEL_SIZE.list.max
      ),
      editorWidth: clamp(
        parsed.state?.editorWidth ?? fallback.editorWidth,
        CHAT_PANEL_SIZE.editor.min,
        CHAT_PANEL_SIZE.editor.max
      ),
      fileTreeWidth: clamp(
        parsed.state?.fileTreeWidth ?? fallback.fileTreeWidth,
        CHAT_PANEL_SIZE.fileTree.min,
        CHAT_PANEL_SIZE.fileTree.max
      ),
    };
  } catch {
    return fallback;
  }
}

const legacyPanelWidths = loadLegacyPanelWidths();

export const useChatLayoutStore = create<ChatLayoutState>()(
  persist(
    (set) => ({
      listWidth: legacyPanelWidths.listWidth,
      editorWidth: legacyPanelWidths.editorWidth,
      fileTreeWidth: legacyPanelWidths.fileTreeWidth,
      isFileTreeDrawerOpen: true,
      isProjectSwitching: false,
      isSessionListCollapsed: false,
      isSessionDrawerOpen: false,
      isSessionDrawerMode: window.innerWidth < SESSION_LIST_DRAWER_BREAKPOINT,
      isFileTreeDrawerMode: window.innerWidth < FILE_TREE_DRAWER_BREAKPOINT,
      setListWidth: (width) => {
        set({
          listWidth: clamp(width, CHAT_PANEL_SIZE.list.min, CHAT_PANEL_SIZE.list.max),
        });
      },
      setEditorWidth: (width) => {
        set({
          editorWidth: clamp(width, CHAT_PANEL_SIZE.editor.min, CHAT_PANEL_SIZE.editor.max),
        });
      },
      setFileTreeWidth: (width) => {
        set({
          fileTreeWidth: clamp(width, CHAT_PANEL_SIZE.fileTree.min, CHAT_PANEL_SIZE.fileTree.max),
        });
      },
      resetPanelWidths: () => {
        set({
          listWidth: CHAT_PANEL_SIZE.list.default,
          editorWidth: CHAT_PANEL_SIZE.editor.default,
          fileTreeWidth: CHAT_PANEL_SIZE.fileTree.default,
        });
      },
      setFileTreeDrawerOpen: (open) => {
        set((state) => (state.isFileTreeDrawerOpen === open ? state : { isFileTreeDrawerOpen: open }));
      },
      setProjectSwitching: (switching) => {
        set((state) => (state.isProjectSwitching === switching ? state : { isProjectSwitching: switching }));
      },
      setSessionListCollapsed: (collapsed) => {
        set((state) => (state.isSessionListCollapsed === collapsed ? state : { isSessionListCollapsed: collapsed }));
      },
      setSessionDrawerOpen: (open) => {
        set((state) => (state.isSessionDrawerOpen === open ? state : { isSessionDrawerOpen: open }));
      },
      setSessionDrawerMode: (enabled) => {
        set((state) => (state.isSessionDrawerMode === enabled ? state : { isSessionDrawerMode: enabled }));
      },
      setFileTreeDrawerMode: (enabled) => {
        set((state) => (state.isFileTreeDrawerMode === enabled ? state : { isFileTreeDrawerMode: enabled }));
      },
      toggleFileTreeDrawer: () => {
        set((state) => ({ isFileTreeDrawerOpen: !state.isFileTreeDrawerOpen }));
      },
      toggleSessionListCollapsed: () => {
        set((state) => ({ isSessionListCollapsed: !state.isSessionListCollapsed }));
      },
      toggleSessionDrawer: () => {
        set((state) => ({ isSessionDrawerOpen: !state.isSessionDrawerOpen }));
      },
    }),
    {
      name: 'chat-layout-store',
      version: 2,
      partialize: (state) => ({
        listWidth: state.listWidth,
        editorWidth: state.editorWidth,
        fileTreeWidth: state.fileTreeWidth,
        isFileTreeDrawerOpen: state.isFileTreeDrawerOpen,
        isSessionListCollapsed: state.isSessionListCollapsed,
      }),
    }
  )
);

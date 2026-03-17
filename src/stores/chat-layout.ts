import { create } from 'zustand';

type ChatLayoutState = {
  isFileTreeDrawerOpen: boolean;
  isProjectSwitching: boolean;
  isSessionListCollapsed: boolean;
  setFileTreeDrawerOpen: (open: boolean) => void;
  setProjectSwitching: (switching: boolean) => void;
  setSessionListCollapsed: (collapsed: boolean) => void;
  toggleFileTreeDrawer: () => void;
  toggleSessionListCollapsed: () => void;
};

export const useChatLayoutStore = create<ChatLayoutState>((set) => ({
  isFileTreeDrawerOpen: false,
  isProjectSwitching: false,
  isSessionListCollapsed: false,
  setFileTreeDrawerOpen: (open) => {
    set({ isFileTreeDrawerOpen: open });
  },
  setProjectSwitching: (switching) => {
    set({ isProjectSwitching: switching });
  },
  setSessionListCollapsed: (collapsed) => {
    set({ isSessionListCollapsed: collapsed });
  },
  toggleFileTreeDrawer: () => {
    set((state) => ({ isFileTreeDrawerOpen: !state.isFileTreeDrawerOpen }));
  },
  toggleSessionListCollapsed: () => {
    set((state) => ({ isSessionListCollapsed: !state.isSessionListCollapsed }));
  },
}));

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type ChatLayoutState = {
  isFileTreeDrawerOpen: boolean;
  isProjectSwitching: boolean;
  isSessionListCollapsed: boolean;
  isSessionDrawerOpen: boolean;
  isSessionDrawerMode: boolean;
  isFileTreeDrawerMode: boolean;
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

export const useChatLayoutStore = create<ChatLayoutState>()(
  persist(
    (set) => ({
      isFileTreeDrawerOpen: false,
      isProjectSwitching: false,
      isSessionListCollapsed: false,
      isSessionDrawerOpen: false,
      isSessionDrawerMode: window.innerWidth < 1300,
      isFileTreeDrawerMode: window.innerWidth < 1020,
      setFileTreeDrawerOpen: (open) => {
        set({ isFileTreeDrawerOpen: open });
      },
      setProjectSwitching: (switching) => {
        set({ isProjectSwitching: switching });
      },
      setSessionListCollapsed: (collapsed) => {
        set({ isSessionListCollapsed: collapsed });
      },
      setSessionDrawerOpen: (open) => {
        set({ isSessionDrawerOpen: open });
      },
      setSessionDrawerMode: (enabled) => {
        set({ isSessionDrawerMode: enabled });
      },
      setFileTreeDrawerMode: (enabled) => {
        set({ isFileTreeDrawerMode: enabled });
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
      version: 1,
      partialize: (state) => ({
        isFileTreeDrawerOpen: state.isFileTreeDrawerOpen,
        isSessionListCollapsed: state.isSessionListCollapsed,
      }),
    }
  )
);

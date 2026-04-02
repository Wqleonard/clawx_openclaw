/**
 * Main Layout Component
 * TitleBar at top, then sidebar + content below.
 */
import { Outlet } from 'react-router-dom';
import { TitleBar } from './TitleBar';
import { SettingDialog } from '@/components/settingDialog';
// import { LoadingSpinner } from '@/components/common/LoadingSpinner.tsx';
// import { useChatLayoutStore } from '@/stores/chat-layout.ts';

export function MainLayout() {
  // const isProjectSwitching = useChatLayoutStore((state) => state.isProjectSwitching);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background relative">
      {/* {isProjectSwitching && (
        <div
          className="absolute inset-0 z-[100] flex items-center justify-center bg-background/55 backdrop-blur-[1px] pointer-events-auto select-none cursor-wait"
          aria-busy="true"
          aria-live="polite"
        >
          <LoadingSpinner size="lg" />
        </div>
      )} */}
      {/* Title bar: drag region on macOS, icon + controls on Windows */}
      <TitleBar />

      {/* Below the title bar: sidebar + content */}
      <main className="flex-1 flex overflow-hidden">
        <Outlet />
      </main>
      <SettingDialog />
    </div>
  );
}

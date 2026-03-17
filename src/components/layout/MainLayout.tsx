/**
 * Main Layout Component
 * TitleBar at top, then sidebar + content below.
 */
import { Outlet } from 'react-router-dom';
import { TitleBar } from './TitleBar';
import { ProjectsRail } from './ProjectsRail';
import { SettingDialog } from '@/components/settingDialog';

export function MainLayout() {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      {/* Title bar: drag region on macOS, icon + controls on Windows */}
      <TitleBar />

      {/* Below the title bar: sidebar + content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Workspace Rail */}
        <ProjectsRail />

        {/* <Sidebar /> */}
        <main className="flex-1 overflow-auto border rounded-ss-xl">
          <Outlet />
        </main>
      </div>
      <SettingDialog />
    </div>
  );
}

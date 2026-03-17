import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';

const SettingLayout = () => {
  return (
    <div className="flex w-full h-full overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-auto p-6">
        <Outlet />
      </main>
    </div>
  );
};

export default SettingLayout;

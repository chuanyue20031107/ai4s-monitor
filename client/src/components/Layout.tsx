import { Outlet } from 'react-router-dom';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import AppSidebar from '@/components/AppSidebar';
import Header from '@/components/Header';
import { Ai4sProvider } from '@/store/Ai4sStore';

export function Layout() {
  return (
    <Ai4sProvider>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset className="flex min-w-0 flex-col overflow-x-hidden">
          <Header />
          <main className="w-full flex-1 overflow-y-auto px-4 py-6 md:px-6 lg:px-8">
            <Outlet />
          </main>
        </SidebarInset>
      </SidebarProvider>
    </Ai4sProvider>
  );
}

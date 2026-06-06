import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/session';
import Sidebar from './_components/Sidebar';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();

  // Redirect unauthenticated users to login
  if (!user) {
    redirect('/auth/login?callbackUrl=/dashboard');
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar user={user} />

      {/* Main content area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex h-16 shrink-0 items-center border-b border-line/60 bg-white/92 px-6 backdrop-blur-[12px] shadow-[0_2px_12px_rgba(15,23,42,0.03)] lg:px-8">
          {/* Spacer for mobile hamburger */}
          <div className="w-12 lg:hidden" />
          <h1 className="text-lg font-semibold text-foreground">
            控制台
          </h1>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}

import type { ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { NotificationsBell } from './NotificationsBell';

/** Общий каркас страниц приложения: боковая панель + шапка + контент. */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-end border-b border-[#232833] bg-surface/40 px-4 md:px-8">
          <NotificationsBell />
        </header>
        <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}

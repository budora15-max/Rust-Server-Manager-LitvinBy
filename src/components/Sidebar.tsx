import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LayoutDashboard, LogOut, Server, Shield, User } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { LANGS } from '@/i18n';
import { cn } from '@/lib/utils';

export function Sidebar() {
  const { user, logout } = useAuth();
  const { t, i18n } = useTranslation();

  const currentLang = i18n.language.startsWith('en') ? 'en' : 'ru';

  const changeLang = (code: string) => {
    if (code !== currentLang) i18n.changeLanguage(code);
  };

  const NAV = [
    { to: '/', label: t('sidebar.dashboard'), icon: LayoutDashboard, end: true },
    { to: '/servers', label: t('sidebar.servers'), icon: Server, end: false },
    { to: '/account', label: t('sidebar.account'), icon: User, end: false },
  ];

  return (
    <aside className="sticky top-0 flex h-screen w-16 shrink-0 flex-col border-r border-[#232833] bg-surface/60 md:w-60">
      {/* Бренд */}
      <div className="flex h-16 items-center gap-3 border-b border-[#232833] px-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent shadow-sm shadow-accent/25">
          <Shield className="h-5 w-5 text-white" />
        </div>
        <div className="hidden md:block">
          <p className="text-sm font-bold leading-tight text-textMain">Rust Server</p>
          <p className="text-xs leading-tight text-textMuted">{t('sidebar.manager')}</p>
        </div>
      </div>

      {/* Навигация */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-4 md:px-3">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            title={label}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-accent/15 text-accent'
                  : 'text-textMuted hover:bg-[#1d212b] hover:text-textMain'
              )
            }
          >
            <Icon className="h-5 w-5 shrink-0" />
            <span className="hidden md:inline">{label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Переключатель языка */}
      <div className="border-t border-[#232833] px-3 py-2">
        <div className="flex items-center justify-center gap-1 rounded-lg bg-[#1a1e26] p-1">
          {LANGS.map(({ code, flag, label }) => (
            <button
              key={code}
              onClick={() => changeLang(code)}
              title={label}
              className={cn(
                'flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md text-xs font-semibold transition-colors',
                currentLang === code
                  ? 'bg-accent/20 text-accent'
                  : 'text-textMuted hover:text-textMain'
              )}
            >
              <span className="hidden sm:inline">{flag}</span>
              {code.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Пользователь */}
      <div className="border-t border-[#232833] p-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#2a2f3a] text-sm font-bold text-textMain">
            {user?.username.slice(0, 2).toUpperCase()}
          </div>
          <div className="hidden min-w-0 flex-1 md:block">
            <p className="truncate text-sm font-semibold text-textMain">{user?.username}</p>
            <p className="truncate text-xs text-textMuted">{user?.license} plan</p>
          </div>
          <button
            onClick={logout}
            title={t('sidebar.logout')}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-textMuted transition-colors hover:bg-red-500/10 hover:text-red-400"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}


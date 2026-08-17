import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BadgeCheck, CalendarDays, LogOut, Mail, MonitorUp, Server, Users, User as UserIcon } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { Button } from '@/components/Button';
import { useAuth } from '@/context/AuthContext';
import { useServer } from '@/context/ServerContext';
import { cn, formatDate } from '@/lib/utils';
import type { LicenseType } from '@/types';

const LICENSE_STYLES: Record<LicenseType, string> = {
  Free: 'text-slate-300 bg-slate-500/10 border-slate-500/30',
  Pro: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
  Enterprise: 'text-purple-400 bg-purple-500/10 border-purple-500/30',
};

export default function Account() {
  const { user, logout } = useAuth();
  const { servers } = useServer();
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [autoLaunch, setAutoLaunch] = useState(false);
  const [autoLaunchBusy, setAutoLaunchBusy] = useState(false);

  useEffect(() => {
    window.rustManager
      ?.appGetAutoLaunch()
      .then((r) => setAutoLaunch(r.openAtLogin))
      .catch(() => undefined);
  }, []);

  const toggleAutoLaunch = async (value: boolean) => {
    setAutoLaunchBusy(true);
    try {
      const res = await window.rustManager?.appSetAutoLaunch(value);
      if (res) setAutoLaunch(res.openAtLogin);
    } finally {
      setAutoLaunchBusy(false);
    }
  };

  if (!user) return null;

  const online = servers.filter((s) => s.status === 'online').length;
  const playersOnline = servers.reduce(
    (acc, s) => acc + (s.status === 'online' ? s.onlinePlayers : 0),
    0
  );

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  const stats = [
    { label: t('account.servers'), value: String(servers.length), Icon: Server },
    { label: t('account.online'), value: String(online), Icon: BadgeCheck },
    { label: t('account.players'), value: String(playersOnline), Icon: Users },
  ];

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-textMain">{t('account.title')}</h1>
        <p className="mt-0.5 text-sm text-textMuted">{t('account.subtitle')}</p>
      </div>

      <div className="grid max-w-4xl gap-4 lg:grid-cols-3">
        {/* Профиль */}
        <div className="rounded-xl border border-[#232833] bg-surface p-6 lg:col-span-2">
          <div className="flex flex-wrap items-center gap-5">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-accent to-[#c94a2e] text-2xl font-bold text-white shadow-lg shadow-accent/20">
              {user.username.slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 text-xl font-bold text-textMain">
                {user.username}
                <span
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold',
                    LICENSE_STYLES[user.license]
                  )}
                >
                  <BadgeCheck className="h-3.5 w-3.5" />
                  {user.license} {t('account.licenseType')}
                </span>
              </h2>
              <p className="mt-1 text-sm text-textMuted">{t('account.welcome')}</p>
            </div>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg bg-[#1a1e26] p-4">
              <div className="flex items-center gap-2 text-xs text-textMuted">
                <UserIcon className="h-4 w-4" /> {t('account.username')}
              </div>
              <p className="mt-1 font-semibold text-textMain">{user.username}</p>
            </div>
            <div className="rounded-lg bg-[#1a1e26] p-4">
              <div className="flex items-center gap-2 text-xs text-textMuted">
                <Mail className="h-4 w-4" /> {t('account.email')}
              </div>
              <p className="mt-1 font-semibold text-textMain">{user.email}</p>
            </div>
            <div className="rounded-lg bg-[#1a1e26] p-4">
              <div className="flex items-center gap-2 text-xs text-textMuted">
                <BadgeCheck className="h-4 w-4" /> {t('account.licenseType')}
              </div>
              <p className="mt-1 font-semibold text-textMain">{user.license}</p>
            </div>
            <div className="rounded-lg bg-[#1a1e26] p-4">
              <div className="flex items-center gap-2 text-xs text-textMuted">
                <CalendarDays className="h-4 w-4" /> {t('account.registered')}
              </div>
              <p className="mt-1 font-semibold text-textMain">{formatDate(user.registeredAt)}</p>
            </div>
          </div>
        </div>

        {/* Статистика и выход */}
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-[#232833] bg-surface p-6">
            <h3 className="text-sm font-semibold text-textMain">{t('account.yourStats')}</h3>
            <div className="mt-4 space-y-3">
              {stats.map(({ label, value, Icon }) => (
                <div
                  key={label}
                  className="flex items-center justify-between rounded-lg bg-[#1a1e26] px-4 py-3"
                >
                  <span className="flex items-center gap-2 text-sm text-textMuted">
                    <Icon className="h-4 w-4" /> {label}
                  </span>
                  <span className="font-bold text-textMain">{value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-[#232833] bg-surface p-6">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-textMain">
              <MonitorUp className="h-4 w-4 text-accent" /> {t('account.autoLaunch')}
            </h3>
            <p className="mt-1 text-xs text-textMuted">{t('account.autoLaunchHint')}</p>
            <button
              type="button"
              onClick={() => void toggleAutoLaunch(!autoLaunch)}
              disabled={autoLaunchBusy}
              aria-pressed={autoLaunch}
              className={cn(
                'mt-4 flex h-8 w-14 items-center rounded-full p-1 transition-colors disabled:opacity-50',
                autoLaunch ? 'bg-accent' : 'bg-[#2a2f3a]'
              )}
            >
              <span
                className={cn(
                  'h-6 w-6 rounded-full bg-white shadow transition-transform',
                  autoLaunch ? 'translate-x-6' : 'translate-x-0'
                )}
              />
            </button>
            <p className="mt-2 text-xs text-textMuted">
              {autoLaunch ? t('account.autoLaunchOn') : t('account.autoLaunchOff')}
            </p>
          </div>

          <div className="rounded-xl border border-[#232833] bg-surface p-6">
            <h3 className="text-sm font-semibold text-textMain">{t('account.session')}</h3>
            <p className="mt-1 text-xs text-textMuted">
              {t('account.sessionHint')}
            </p>
            <Button variant="danger" className="mt-4 w-full" onClick={handleLogout}>
              <LogOut className="h-4 w-4" /> {t('account.logout')}
            </Button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Lock, Mail, Shield } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [forgotHint, setForgotHint] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setForgotHint(false);

    if (!identifier.trim() || !password) {
      setError(t('auth.errorRequired'));
      return;
    }

    setLoading(true);
    try {
      await login(identifier, password, remember);
      navigate('/', { replace: true });
    } catch {
      setError(t('auth.errorInvalid'));
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background p-4">
      {/* Декоративный фон */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-accent/10 blur-3xl" />
        <div className="absolute -bottom-40 -right-32 h-[28rem] w-[28rem] rounded-full bg-[#2a3a5e]/20 blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        {/* Бренд */}
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent shadow-lg shadow-accent/25">
            <Shield className="h-7 w-7 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-textMain">{t('app.name')}</h1>
            <p className="mt-1 text-sm text-textMuted">{t('app.tagline')}</p>
          </div>
        </div>

        {/* Форма */}
        <div className="rounded-2xl border border-[#232833] bg-surface p-8 shadow-2xl">
          <h2 className="text-lg font-semibold text-textMain">{t('auth.signIn')}</h2>
          <p className="mt-1 text-sm text-textMuted">{t('auth.signInSubtitle')}</p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <Input
              label={t('auth.emailOrLogin')}
              icon={<Mail className="h-4 w-4" />}
              placeholder={t('auth.emailOrLoginPlaceholder')}
              autoComplete="username"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
            />
            <Input
              label={t('auth.password')}
              type="password"
              togglePassword
              icon={<Lock className="h-4 w-4" />}
              placeholder={t('auth.passwordPlaceholder')}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />

            <div className="flex items-center justify-between">
              <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-textMuted">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  className="h-4 w-4 rounded border-[#3a4150] bg-[#1a1e26] accent-accent"
                />
                {t('auth.rememberMe')}
              </label>
              <button
                type="button"
                onClick={() => setForgotHint((v) => !v)}
                className="text-sm font-medium text-accent transition-colors hover:underline"
              >
                {t('auth.forgotPassword')}
              </button>
            </div>

            {forgotHint && (
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-400">
                {t('auth.forgotHint')}
              </p>
            )}
            {error && (
              <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
                {error}
              </p>
            )}

            <Button type="submit" size="lg" className="w-full" loading={loading}>
              {t('auth.signInButton')}
            </Button>
          </form>

          <div className="my-6 flex items-center gap-3 text-xs uppercase tracking-wide text-textMuted">
            <div className="h-px flex-1 bg-[#232833]" />
            {t('auth.or')}
            <div className="h-px flex-1 bg-[#232833]" />
          </div>

          <p className="text-center text-sm text-textMuted">
            {t('auth.noAccount')}{' '}
            <Link to="/register" className="font-semibold text-accent hover:underline">
              {t('auth.createOne')}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}


import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AtSign, Lock, Shield, User } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';

interface FormState {
  username: string;
  email: string;
  password: string;
  confirm: string;
}

const INITIAL: FormState = { username: '', email: '', password: '', confirm: '' };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [form, setForm] = useState<FormState>(INITIAL);
  const [errors, setErrors] = useState<Partial<FormState>>({});
  const [loading, setLoading] = useState(false);

  const set = (key: keyof FormState) => (value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  const validate = (): boolean => {
    const next: Partial<FormState> = {};
    if (!form.username.trim()) next.username = t('auth.errors.usernameRequired');
    else if (form.username.trim().length < 3) next.username = t('auth.errors.usernameMin');

    if (!form.email.trim()) next.email = t('auth.errors.emailRequired');
    else if (!EMAIL_RE.test(form.email.trim())) next.email = t('auth.errors.emailInvalid');

    if (!form.password) next.password = t('auth.errors.passwordRequired');
    else if (form.password.length < 6) next.password = t('auth.errors.passwordMin');

    if (!form.confirm) next.confirm = t('auth.errors.confirmRequired');
    else if (form.confirm !== form.password) next.confirm = t('auth.errors.confirmMismatch');

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setLoading(true);
    try {
      await register(form.username.trim(), form.email.trim(), form.password);
      navigate('/', { replace: true });
    } catch {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background p-4">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-accent/10 blur-3xl" />
        <div className="absolute -bottom-40 -right-32 h-[28rem] w-[28rem] rounded-full bg-[#2a3a5e]/20 blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent shadow-lg shadow-accent/25">
            <Shield className="h-7 w-7 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-textMain">{t('app.name')}</h1>
            <p className="mt-1 text-sm text-textMuted">{t('auth.createAccountSubtitle')}</p>
          </div>
        </div>

        <div className="rounded-2xl border border-[#232833] bg-surface p-8 shadow-2xl">
          <h2 className="text-lg font-semibold text-textMain">{t('auth.createAccount')}</h2>
          <p className="mt-1 text-sm text-textMuted">{t('auth.createAccountSubtitle')}</p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <Input
              label={t('auth.username')}
              icon={<User className="h-4 w-4" />}
              placeholder={t('auth.usernamePlaceholder')}
              autoComplete="username"
              value={form.username}
              onChange={(e) => set('username')(e.target.value)}
              error={errors.username}
            />
            <Input
              label={t('auth.email')}
              icon={<AtSign className="h-4 w-4" />}
              placeholder={t('auth.emailPlaceholder')}
              type="email"
              autoComplete="email"
              value={form.email}
              onChange={(e) => set('email')(e.target.value)}
              error={errors.email}
            />
            <Input
              label={t('auth.password')}
              type="password"
              togglePassword
              icon={<Lock className="h-4 w-4" />}
              placeholder={t('auth.passwordPlaceholder')}
              autoComplete="new-password"
              value={form.password}
              onChange={(e) => set('password')(e.target.value)}
              error={errors.password}
              hint={t('auth.errors.passwordHint')}
            />
            <Input
              label={t('auth.confirmPassword')}
              type="password"
              togglePassword
              icon={<Lock className="h-4 w-4" />}
              placeholder={t('auth.passwordPlaceholder')}
              autoComplete="new-password"
              value={form.confirm}
              onChange={(e) => set('confirm')(e.target.value)}
              error={errors.confirm}
            />

            <Button type="submit" size="lg" className="w-full" loading={loading}>
              {t('auth.createAccountButton')}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-textMuted">
            {t('auth.haveAccount')}{' '}
            <Link to="/login" className="font-semibold text-accent hover:underline">
              {t('auth.signInLink')}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}


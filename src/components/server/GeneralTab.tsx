import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2, Download, FileCode2, FolderOpen, HardDrive, KeyRound, RefreshCw, Save, ShieldAlert, Upload } from 'lucide-react';
import type { RustServer, ServerConfigResult } from '@/types';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { formatUptime } from '@/lib/utils';

/** Пароли, которые Rust считает «очень небезопасными» и полностью отключает RCON. */
const INSECURE_RCON_PASSWORDS = ['changeme', 'password', '123456', 'admin', 'qwerty', 'test', 'server', 'rust'];

const isInsecureRconPassword = (p: string): boolean =>
  p.length < 8 || INSECURE_RCON_PASSWORDS.includes(p.toLowerCase().trim());

interface GeneralTabProps {
  server: RustServer;
  onSave: (patch: Partial<RustServer>) => void;
}

interface GeneralForm {
  identity: string;
  seed: string;
  worldSize: string;
  port: string;
  maxPlayers: string;
  rconPassword: string;
  installPath: string;
  rconHost: string;
  rconPort: string;
  autoRestartOnCrash: boolean;
  autoRestartOnHang: boolean;
  hangTimeoutMinutes: string;
  startWithManager: boolean;
}

export function GeneralTab({ server, onSave }: GeneralTabProps) {
  const { t } = useTranslation();
  const [form, setForm] = useState<GeneralForm>({
    identity: server.identity,
    seed: String(server.seed),
    worldSize: String(server.worldSize),
    port: String(server.port),
    maxPlayers: String(server.maxPlayers),
    rconPassword: server.rconPassword,
    installPath: server.installPath,
    rconHost: server.rconHost,
    rconPort: String(server.rconPort),
    autoRestartOnCrash: server.autoRestartOnCrash !== false,
    autoRestartOnHang: server.autoRestartOnHang === true,
    hangTimeoutMinutes: String(server.hangTimeoutMinutes || 10),
    startWithManager: server.startWithManager === true,
  });
  const [errors, setErrors] = useState<Partial<GeneralForm>>({});
  const [saved, setSaved] = useState(false);
  const [configInfo, setConfigInfo] = useState<ServerConfigResult | null>(null);
  const [configBusy, setConfigBusy] = useState(false);
  const [pathCheck, setPathCheck] = useState<
    { state: 'idle' | 'checking' | 'ok' | 'bad'; exe?: string } | undefined
  >(undefined);

  const set = (key: keyof GeneralForm) => (value: string) => {
    // При смене игрового порта автоматически сдвигаем RCON-порт (игра + 2),
    // если он ещё не был изменён пользователем вручную.
    if (key === 'port') {
      const oldPort = Number(form.port);
      const newPort = Number(value);
      if (newPort > 0 && form.rconPort === String(oldPort + 2)) {
        setForm((prev) => ({ ...prev, port: value, rconPort: String(newPort + 2) }));
        setErrors((prev) => ({ ...prev, port: undefined, rconPort: undefined }));
        setSaved(false);
        return;
      }
    }
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
    setSaved(false);
  };

  const setBool =
    (key: 'autoRestartOnCrash' | 'autoRestartOnHang' | 'startWithManager') => (value: boolean) => {
      setForm((prev) => ({ ...prev, [key]: value }));
      setSaved(false);
    };

  const browseInstallPath = async () => {
    const picked = await window.rustManager?.pickFolder();
    if (picked) set('installPath')(picked);
  };

  /** Применение импортированного сервера к форме. */
  const applyServer = (s: RustServer) => {
    setForm({
      identity: s.identity,
      seed: String(s.seed),
      worldSize: String(s.worldSize),
      port: String(s.port),
      maxPlayers: String(s.maxPlayers),
      rconPassword: s.rconPassword,
      installPath: s.installPath,
      rconHost: s.rconHost,
      rconPort: String(s.rconPort),
      autoRestartOnCrash: s.autoRestartOnCrash !== false,
      autoRestartOnHang: s.autoRestartOnHang === true,
      hangTimeoutMinutes: String(s.hangTimeoutMinutes || 10),
      startWithManager: s.startWithManager === true,
    });
  };

  const doExportConfig = async () => {
    const bridge = window.rustManager;
    if (!bridge) return;
    try {
      const res = await bridge.serverExportConfig(server);
      if (res.ok && res.path) {
        setConfigInfo((prev) => ({
          ...(prev ?? { ok: true, exists: true, path: '', config: {}, rawLines: [] }),
          message: t('general.exportedTo', { path: res.path }),
        }));
      } else if (!res.canceled) {
        setConfigInfo((prev) => ({
          ...(prev ?? { ok: true, exists: true, path: '', config: {}, rawLines: [] }),
          message: res.error ?? t('general.exportFailed'),
        }));
      }
    } catch {
      // IPC недоступен
    }
  };

  const doImportConfig = async () => {
    const bridge = window.rustManager;
    if (!bridge) return;
    try {
      const res = await bridge.serverImportConfig(server);
      if (res.ok && res.server) {
        onSave(res.server);
        applyServer(res.server);
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
        void loadConfig(true);
      } else if (!res.canceled) {
        setConfigInfo((prev) => ({
          ...(prev ?? { ok: true, exists: true, path: '', config: {}, rawLines: [] }),
          message: res.error ?? t('general.importFailed'),
        }));
      }
    } catch {
      // IPC недоступен
    }
  };

  // Чтение/заполнение формы из server.cfg
  const loadConfig = async (silent = false) => {
    const bridge = window.rustManager;
    if (!bridge) return;
    if (!silent) setConfigBusy(true);
    try {
      const res = await bridge.configRead(server);
      setConfigInfo(res);
      if (res.ok) {
        setForm((prev) => ({
          ...prev,
          identity: res.config['server.identity'] ?? prev.identity,
          seed: res.config['server.seed'] ?? prev.seed,
          worldSize: res.config['server.worldsize'] ?? prev.worldSize,
          port: res.config['server.port'] ?? prev.port,
          maxPlayers: res.config['server.maxplayers'] ?? prev.maxPlayers,
          rconPassword: res.config['rcon.password'] ?? prev.rconPassword,
          rconPort: res.config['rcon.port'] ?? prev.rconPort,
        }));
      }
    } catch {
      setConfigInfo({
        ok: false,
        exists: false,
        path: '',
        config: {},
        rawLines: [],
        message: 'Failed to read server.cfg.',
      });
    } finally {
      setConfigBusy(false);
    }
  };

  useEffect(() => {
    loadConfig(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Проверка наличия исполняемого файла сервера в указанной папке
  useEffect(() => {
    const path = form.installPath.trim();
    const bridge = window.rustManager;
    if (!path || !bridge?.serverFindExe) {
      setPathCheck(undefined);
      return;
    }
    let stale = false;
    setPathCheck({ state: 'checking' });
    const timer = setTimeout(async () => {
      try {
        const res = await bridge.serverFindExe(path);
        if (!stale) {
          setPathCheck(res.found ? { state: 'ok', exe: res.exePath } : { state: 'bad' });
        }
      } catch {
        if (!stale) setPathCheck(undefined);
      }
    }, 400);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [form.installPath]);

  const validate = (): boolean => {
    const next: Partial<GeneralForm> = {};

    if (!form.identity.trim()) next.identity = t('general.errors.identityRequired');

    const seed = Number(form.seed);
    if (!form.seed || !Number.isInteger(seed) || seed <= 0)
      next.seed = t('general.errors.seedInvalid');

    const worldSize = Number(form.worldSize);
    if (!form.worldSize || !Number.isInteger(worldSize) || worldSize < 500 || worldSize > 8000)
      next.worldSize = t('general.errors.worldSizeInvalid');

    const port = Number(form.port);
    if (!form.port || !Number.isInteger(port) || port < 1024 || port > 65535)
      next.port = t('general.errors.portInvalid');

    const maxPlayers = Number(form.maxPlayers);
    if (!form.maxPlayers || !Number.isInteger(maxPlayers) || maxPlayers < 1 || maxPlayers > 500)
      next.maxPlayers = t('general.errors.maxPlayersInvalid');

    if (form.rconPassword.length < 6) next.rconPassword = t('general.errors.rconPasswordMin');

    if (!form.rconHost.trim()) next.rconHost = t('general.errors.rconHostRequired');

    const rconPort = Number(form.rconPort);
    if (!form.rconPort || !Number.isInteger(rconPort) || rconPort < 1 || rconPort > 65535)
      next.rconPort = t('general.errors.rconPortInvalid');

    const hangMin = Number(form.hangTimeoutMinutes);
    if (!form.hangTimeoutMinutes || !Number.isInteger(hangMin) || hangMin < 1 || hangMin > 120)
      next.hangTimeoutMinutes = t('general.errors.hangTimeoutInvalid');

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    onSave({
      identity: form.identity.trim(),
      seed: Number(form.seed),
      worldSize: Number(form.worldSize),
      port: Number(form.port),
      maxPlayers: Number(form.maxPlayers),
      rconPassword: form.rconPassword,
      installPath: form.installPath.trim(),
      rconHost: form.rconHost.trim(),
      rconPort: Number(form.rconPort),
      autoRestartOnCrash: form.autoRestartOnCrash,
      autoRestartOnHang: form.autoRestartOnHang,
      hangTimeoutMinutes: Number(form.hangTimeoutMinutes) || 10,
      startWithManager: form.startWithManager,
    });

    // Дублируем ключевые настройки в server.cfg
    if (window.rustManager) {
      const cfg: Record<string, string> = {
        'server.identity': form.identity.trim(),
        'server.seed': form.seed.trim(),
        'server.worldsize': form.worldSize.trim(),
        'server.port': form.port.trim(),
        'server.maxplayers': form.maxPlayers.trim(),
        'rcon.password': form.rconPassword,
        'rcon.port': form.rconPort.trim(),
      };
      window.rustManager.configSave(server, cfg).then((res) => {
        setConfigInfo((prev) => ({
          ...(prev ?? { ok: true, exists: true, path: '', config: {}, rawLines: [] }),
          message: res.ok
            ? t('general.savedTo', { path: res.path || '' })
            : t('general.saveFailed', { error: res.error }),
        }));
      });
    }

    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const configLabel = configInfo
    ? configInfo.ok
      ? configInfo.message ?? t('general.settingsLoaded', { count: Object.keys(configInfo.config).length })
      : configInfo.message ?? t('general.unavailable')
    : t('general.notLoaded');

  const info = [
    { label: t('general.map'), value: server.map },
    { label: t('general.seed'), value: String(server.seed) },
    { label: t('general.worldSize'), value: String(server.worldSize) },
    { label: t('general.port'), value: String(server.port) },
    { label: t('general.rconPort'), value: String(server.rconPort) },
    { label: t('general.rconHost'), value: server.rconHost || '127.0.0.1' },
    { label: t('general.uptime'), value: formatUptime(server.uptimeSeconds) },
    { label: t('general.plugins'), value: String(server.installedPlugins) },
  ];

  return (
    <div>
      {/* Статус server.cfg */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#232833] bg-surface px-4 py-3">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <FileCode2 className="h-4 w-4 shrink-0 text-accent" />
          <span className="shrink-0 font-semibold text-textMain">{t('general.cfgStatus')}</span>
          <span className="truncate text-textMuted">
            {configBusy ? t('general.reading') : configLabel}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {configInfo?.path && (
            <span className="hidden max-w-xs truncate font-mono text-xs text-textMuted lg:inline">
              {configInfo.path}
            </span>
          )}
          <Button type="button" size="sm" variant="secondary" onClick={() => void doExportConfig()}>
            <Download className="h-3.5 w-3.5" /> {t('general.exportConfig')}
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => void doImportConfig()}>
            <Upload className="h-3.5 w-3.5" /> {t('general.importConfig')}
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => loadConfig(false)} disabled={configBusy}>
            <RefreshCw className="h-3.5 w-3.5" /> {t('general.reload')}
          </Button>
        </div>
      </div>

      <div className="grid max-w-5xl gap-4 lg:grid-cols-3">
      {/* Текущие параметры сервера */}
      <div className="rounded-xl border border-[#232833] bg-surface p-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-textMain">
          <HardDrive className="h-4 w-4 text-accent" /> {t('general.properties')}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          {info.map(({ label, value }) => (
            <div key={label} className="rounded-lg bg-[#1a1e26] p-3">
              <p className="text-xs text-textMuted">{label}</p>
              <p className="mt-0.5 truncate font-semibold text-textMain">{value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Форма конфигурации */}
      <form
        onSubmit={handleSubmit}
        className="rounded-xl border border-[#232833] bg-surface p-5 lg:col-span-2"
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-textMain">
          <KeyRound className="h-4 w-4 text-accent" /> {t('general.configuration')}
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Input
            label={t('general.identityLabel')}
            hint={t('general.identityHint')}
            value={form.identity}
            onChange={(e) => set('identity')(e.target.value)}
            error={errors.identity}
          />
          <Input
            label={t('general.seedLabel')}
            hint={t('general.seedHint')}
            value={form.seed}
            onChange={(e) => set('seed')(e.target.value)}
            error={errors.seed}
          />
          <Input
            label={t('general.worldSizeLabel')}
            hint={t('general.worldSizeHint')}
            value={form.worldSize}
            onChange={(e) => set('worldSize')(e.target.value)}
            error={errors.worldSize}
          />
          <Input
            label={t('general.portLabel')}
            hint={t('general.portHint')}
            value={form.port}
            onChange={(e) => set('port')(e.target.value)}
            error={errors.port}
          />
          <Input
            label={t('general.maxPlayersLabel')}
            hint={t('general.maxPlayersHint')}
            value={form.maxPlayers}
            onChange={(e) => set('maxPlayers')(e.target.value)}
            error={errors.maxPlayers}
          />
          <Input
            label={t('general.rconPasswordLabel')}
            type="password"
            togglePassword
            hint={t('general.rconPasswordHint')}
            value={form.rconPassword}
            onChange={(e) => set('rconPassword')(e.target.value)}
            error={errors.rconPassword}
          />
          {isInsecureRconPassword(form.rconPassword) && (
            <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-400">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              {t('general.rconInsecureWarning')}
            </p>
          )}
          <div className="sm:col-span-2">
            <div className="flex gap-2">
              <Input
                label={t('general.installPathLabel')}
                hint={t('general.installPathHint')}
                placeholder={t('general.installPathPlaceholder')}
                value={form.installPath}
                onChange={(e) => set('installPath')(e.target.value)}
                className="flex-1"
              />
              <div className="flex items-end">
                <Button type="button" variant="secondary" onClick={browseInstallPath}>
                  <FolderOpen className="h-4 w-4" /> {t('general.browse')}
                </Button>
              </div>
            </div>
            {pathCheck?.state === 'checking' && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-textMuted">
                <RefreshCw className="h-3 w-3 animate-spin" /> {t('general.installPathChecking')}
              </p>
            )}
            {pathCheck?.state === 'ok' && pathCheck.exe && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-emerald-400">
                <CheckCircle2 className="h-3 w-3" />
                {t('general.installPathValid', { exe: pathCheck.exe })}
              </p>
            )}
            {pathCheck?.state === 'bad' && (
              <p className="mt-2 flex items-start gap-1.5 text-xs text-red-400">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                {t('general.installPathInvalid')}
              </p>
            )}
          </div>
          <Input
            label={t('general.rconHostLabel')}
            hint={t('general.rconHostHint')}
            value={form.rconHost}
            onChange={(e) => set('rconHost')(e.target.value)}
            error={errors.rconHost}
          />
          <Input
            label={t('general.rconPortLabel')}
            hint={t('general.rconPortHint')}
            value={form.rconPort}
            onChange={(e) => set('rconPort')(e.target.value)}
            error={errors.rconPort}
          />
        </div>

        {/* Защита сервера: автоперезапуск при падении / зависании */}
        <div className="mt-6 rounded-xl border border-[#232833] bg-[#1a1e26] p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-textMain">
            <ShieldAlert className="h-4 w-4 text-accent" /> {t('general.watchdogTitle')}
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="flex cursor-pointer items-start gap-2.5 rounded-lg bg-[#0f1115] p-3 text-sm">
              <input
                type="checkbox"
                checked={form.autoRestartOnCrash}
                onChange={(e) => setBool('autoRestartOnCrash')(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-accent"
              />
              <span>
                <span className="font-medium text-textMain">{t('general.autoRestartCrash')}</span>
                <span className="mt-0.5 block text-xs text-textMuted">
                  {t('general.autoRestartCrashHint')}
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2.5 rounded-lg bg-[#0f1115] p-3 text-sm">
              <input
                type="checkbox"
                checked={form.autoRestartOnHang}
                onChange={(e) => setBool('autoRestartOnHang')(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-accent"
              />
              <span>
                <span className="font-medium text-textMain">{t('general.autoRestartHang')}</span>
                <span className="mt-0.5 block text-xs text-textMuted">
                  {t('general.autoRestartHangHint')}
                </span>
              </span>
            </label>
            <div className="sm:col-span-2">
              <Input
                label={t('general.hangTimeoutLabel')}
                hint={t('general.hangTimeoutHint')}
                value={form.hangTimeoutMinutes}
                onChange={(e) => set('hangTimeoutMinutes')(e.target.value)}
                error={errors.hangTimeoutMinutes}
                className="max-w-xs"
              />
            </div>
            <label className="sm:col-span-2 flex cursor-pointer items-start gap-2.5 rounded-lg bg-[#0f1115] p-3 text-sm">
              <input
                type="checkbox"
                checked={form.startWithManager}
                onChange={(e) => setBool('startWithManager')(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-accent"
              />
              <span>
                <span className="font-medium text-textMain">{t('general.startWithManager')}</span>
                <span className="mt-0.5 block text-xs text-textMuted">
                  {t('general.startWithManagerHint')}
                </span>
              </span>
            </label>
          </div>
        </div>

        <div className="mt-6 flex items-center gap-3">
          <Button type="submit">
            <Save className="h-4 w-4" /> {t('general.save')}
          </Button>
          {saved && (
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-400">
              <CheckCircle2 className="h-4 w-4" /> {t('general.saved')}
            </span>
          )}
        </div>
      </form>
      </div>
    </div>
  );
}


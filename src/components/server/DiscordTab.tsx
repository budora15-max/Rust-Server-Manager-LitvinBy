import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Bell, Eraser, Play, Save, Send, Square } from 'lucide-react';
import type { RustServer, WebhookConfig } from '@/types';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { cn } from '@/lib/utils';

const DEFAULT_CONFIG: WebhookConfig = {
  url: '',
  notifyStart: true,
  notifyStop: true,
  notifyCrash: true,
  notifyWipe: true,
};

interface Notice {
  type: 'ok' | 'err';
  text: string;
}

interface DiscordTabProps {
  server: RustServer;
}

const TOGGLES: Array<{
  key: 'notifyStart' | 'notifyStop' | 'notifyCrash' | 'notifyWipe';
  labelKey: string;
  Icon: typeof Play;
  color: string;
}> = [
  { key: 'notifyStart', labelKey: 'discord.serverStarted', Icon: Play, color: 'text-emerald-400' },
  { key: 'notifyStop', labelKey: 'discord.serverStopped', Icon: Square, color: 'text-red-400' },
  { key: 'notifyCrash', labelKey: 'discord.serverCrashed', Icon: AlertTriangle, color: 'text-amber-400' },
  { key: 'notifyWipe', labelKey: 'discord.wipeCompleted', Icon: Eraser, color: 'text-purple-400' },
];

export function DiscordTab({ server }: DiscordTabProps) {
  const bridge = window.rustManager;
  const { t } = useTranslation();

  const [config, setConfig] = useState<WebhookConfig>(DEFAULT_CONFIG);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const pushNotice = (type: Notice['type'], text: string) => {
    setNotice({ type, text });
    setTimeout(() => setNotice((n) => (n?.text === text ? null : n)), 6000);
  };

  useEffect(() => {
    if (!bridge) {
      setLoaded(true);
      return;
    }
    bridge.webhookGetConfig(server.id).then((cfg) => {
      setConfig({ ...DEFAULT_CONFIG, ...cfg });
      setLoaded(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, server.id]);

  const handleSave = async () => {
    if (!bridge) {
      pushNotice('err', t('discord.bridgeRequired'));
      return;
    }
    setSaving(true);
    try {
      const res = await bridge.webhookSaveConfig(server.id, config);
      if (res.ok) pushNotice('ok', t('discord.saved'));
      else pushNotice('err', t('discord.saveFailed', { error: res.error }));
    } catch (e) {
      pushNotice('err', String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!bridge) {
      pushNotice('err', t('discord.bridgeRequired'));
      return;
    }
    if (!config.url.trim()) {
      pushNotice('err', t('discord.urlRequired'));
      return;
    }
    setTesting(true);
    try {
      const res = await bridge.webhookTest(config);
      if (res.ok) pushNotice('ok', t('discord.testSent'));
      else {
        pushNotice(
          'err',
          t('discord.testFailed', {
            status: res.status ? ` (HTTP ${res.status})` : '',
            error: res.error ?? '?',
          })
        );
      }
    } catch (e) {
      pushNotice('err', String(e));
    } finally {
      setTesting(false);
    }
  };


  return (
    <div className="max-w-3xl">
      {notice && (
        <p
          className={cn(
            'mb-4 rounded-lg border px-3 py-2 text-sm',
            notice.type === 'ok'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
              : 'border-red-500/30 bg-red-500/10 text-red-400'
          )}
        >
          {notice.text}
        </p>
      )}

      {!bridge && (
        <p className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-400">
          {t('discord.browserDemo')}
        </p>
      )}

      <div className="rounded-xl border border-[#232833] bg-surface p-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-textMain">
          <Bell className="h-4 w-4 text-accent" /> {t('discord.title')}
        </div>
        <p className="mt-1 text-xs leading-relaxed text-textMuted">
          {t('discord.description')}
        </p>

        <div className="mt-4">
          <Input
            label={t('discord.webhookUrl')}
            type="url"
            placeholder={t('discord.urlPlaceholder')}
            value={config.url}
            onChange={(e) => setConfig((prev) => ({ ...prev, url: e.target.value }))}
          />
        </div>

        <div className="mt-4">
          <span className="mb-2 block text-sm font-medium text-textMain">{t('discord.notificationTypes')}</span>
          <div className="grid gap-2 sm:grid-cols-2">
            {TOGGLES.map(({ key, labelKey, Icon, color }) => (
              <label
                key={key}
                className="flex cursor-pointer select-none items-center justify-between gap-3 rounded-lg border border-[#2a2f3a] bg-[#1a1e26] px-4 py-3 transition-colors hover:border-[#3a4150]"
              >
                <span className="flex items-center gap-2 text-sm text-textMain">
                  <Icon className={cn('h-4 w-4', color)} /> {t(labelKey)}
                </span>
                <input
                  type="checkbox"
                  checked={config[key]}
                  onChange={(e) =>
                    setConfig((prev) => ({ ...prev, [key]: e.target.checked }))
                  }
                  className="h-4 w-4 rounded border-[#3a4150] bg-[#1a1e26] accent-accent"
                />
              </label>
            ))}
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Button onClick={handleSave} loading={saving} disabled={!bridge}>
            <Save className="h-4 w-4" /> {t('discord.saveSettings')}
          </Button>
          <Button
            variant="secondary"
            onClick={handleTest}
            loading={testing}
            disabled={!bridge || !config.url.trim()}
          >
            <Send className="h-4 w-4" /> {t('discord.testWebhook')}
          </Button>
          {!loaded && <span className="text-sm text-textMuted">{t('discord.loading')}</span>}
        </div>
      </div>
    </div>
  );
}

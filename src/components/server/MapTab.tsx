import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Camera, ExternalLink, ImageOff, Map as MapIcon, MapPinned, RefreshCw } from 'lucide-react';
import { Button } from '@/components/Button';
import type { RustServer } from '@/types';

interface Preview {
  dataUrl: string;
  fileName: string;
}

/** Автообновление превью (карта меняется по мере исследования мира). */
const REFRESH_MS = 60_000;
/** Пауза после write.png, пока сервер пишет PNG. */
const CAPTURE_DELAY_MS = 4_000;

export function MapTab({ server }: { server: RustServer }) {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [captured, setCaptured] = useState(false);

  const [rustedit, setRustedit] = useState<{
    fileName: string;
    size?: number;
    seed?: number;
  } | null>(null);
  const [rusteditOpening, setRusteditOpening] = useState(false);
  const [rusteditOpenError, setRusteditOpenError] = useState<string | null>(null);
  const [extInstalled, setExtInstalled] = useState<boolean | null>(null);
  const [extBusy, setExtBusy] = useState<'install' | 'remove' | null>(null);
  const [extMsg, setExtMsg] = useState<string | null>(null);

  // Кастомная карта RustEdit (custommap.*.map) в identity-папке сервера.
  useEffect(() => {
    const bridge = window.rustManager;
    if (!bridge?.mapRusteditInfo) return;
    let cancelled = false;
    bridge
      .mapRusteditInfo(server)
      .then((res) => {
        if (!cancelled && res.ok && res.isCustom) {
          setRustedit({ fileName: res.fileName ?? '', size: res.size, seed: res.seed });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [server]);

  const openInRustedit = async () => {
    const bridge = window.rustManager;
    if (!bridge?.mapOpenInRustedit) return;
    setRusteditOpening(true);
    setRusteditOpenError(null);
    try {
      const res = await bridge.mapOpenInRustedit(server);
      if (!res.ok) setRusteditOpenError(t('serverPage.map.rusteditNotFound'));
    } catch {
      setRusteditOpenError(t('serverPage.map.rusteditNotFound'));
    } finally {
      setRusteditOpening(false);
    }
  };

  // Статус расширения Oxide.Ext.RustEdit.dll на сервере (нужно для кастомных карт).
  useEffect(() => {
    const bridge = window.rustManager;
    if (!bridge?.rusteditExtensionStatus || !rustedit) return;
    let cancelled = false;
    bridge
      .rusteditExtensionStatus(server)
      .then((res) => {
        if (!cancelled) setExtInstalled(res.installed);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [server, rustedit]);

  const installExtension = async () => {
    const bridge = window.rustManager;
    if (!bridge?.rusteditExtensionInstall) return;
    setExtBusy('install');
    setExtMsg(null);
    try {
      const res = await bridge.rusteditExtensionInstall(server);
      if (res.ok) {
        setExtInstalled(true);
        setExtMsg(t('serverPage.map.rusteditExtInstallOk'));
      } else {
        setExtMsg(t('serverPage.map.rusteditExtInstallErr', { error: res.error }));
      }
    } catch {
      setExtMsg(t('serverPage.map.rusteditExtInstallErr', { error: '?' }));
    } finally {
      setExtBusy(null);
    }
  };

  const removeExtension = async () => {
    const bridge = window.rustManager;
    if (!bridge?.rusteditExtensionRemove) return;
    setExtBusy('remove');
    setExtMsg(null);
    try {
      const res = await bridge.rusteditExtensionRemove(server);
      if (res.ok) setExtInstalled(false);
      else setExtMsg(t('serverPage.map.rusteditExtInstallErr', { error: res.error }));
    } catch {
      setExtMsg(t('serverPage.map.rusteditExtInstallErr', { error: '?' }));
    } finally {
      setExtBusy(null);
    }
  };

  const load = useCallback(async () => {
    const bridge = window.rustManager;
    if (!bridge?.mapGetPreview) {
      setError(t('serverPage.map.error', { error: 'no-bridge' }));
      return;
    }
    setLoading(true);
    try {
      const res = await bridge.mapGetPreview(server);
      if (res.ok && res.dataUrl) {
        setPreview({ dataUrl: res.dataUrl, fileName: res.fileName ?? '' });
        setError(null);
      } else {
        setPreview(null);
        setError(res.error ?? 'not-found');
      }
    } finally {
      setLoading(false);
    }
  }, [server, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const capture = async () => {
    const bridge = window.rustManager;
    if (!bridge?.mapCapture) return;
    setCapturing(true);
    setCaptured(false);
    try {
      const res = await bridge.mapCapture(server);
      if (res.ok) {
        setCaptured(true);
        setTimeout(() => void load(), CAPTURE_DELAY_MS);
      } else {
        setError(res.error ?? 'rcon-failed');
      }
    } finally {
      setCapturing(false);
    }
  };

  const errorText = (): string | null => {
    if (!error) return null;
    switch (error) {
      case 'no-install-path':
        return t('serverPage.map.noInstall');
      case 'not-found':
        return t('serverPage.map.empty');
      case 'server-offline':
        return t('serverPage.map.offline');
      default:
        return t('serverPage.map.error', { error });
    }
  };

  const isOnline = server.status === 'online' || server.status === 'sim';

  // Полноценная карта мира по сиду доступна на rustmaps.com (рендер ландшафта).
  // Работает для Procedural Map; локально Rust такой PNG не сохраняет.
  // Формат URL rustmaps.com: /map/<worldsize>_<seed> (например /map/2600_456123).
  const isProcedural = !server.map || /procedural/i.test(server.map);
  const rustmapsUrl =
    isProcedural && server.seed > 0
      ? `https://rustmaps.com/map/${server.worldSize > 0 ? server.worldSize : 4000}_${server.seed}`
      : null;

  const openExternal = (url: string) => {
    window.rustManager?.openExternal(url).catch(() => {});
  };

  return (
    <div className="rounded-xl border border-[#232833] bg-surface p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <MapIcon className="h-4 w-4 text-textMuted" />
          <h3 className="text-sm font-semibold text-textMain">
            {server.map || server.identity}
          </h3>
          {preview && <span className="text-xs text-textMuted">{preview.fileName}</span>}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" disabled={loading} onClick={() => void load()}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            {t('serverPage.map.refresh')}
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={!isOnline || capturing}
            loading={capturing}
            onClick={() => void capture()}
          >
            <Camera className="h-3.5 w-3.5" />
            {t('serverPage.map.capture')}
          </Button>
        </div>
      </div>

      {captured && (
        <p className="mb-3 rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-400">
          {t('serverPage.map.captured')}
        </p>
      )}

      {preview ? (
        <img
          src={preview.dataUrl}
          alt="world map"
          className="max-h-[600px] w-full rounded-lg border border-[#232833] object-contain"
        />
      ) : (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-[#2a2f3a] bg-[#1a1e26] px-6 py-16 text-center">
          <ImageOff className="h-8 w-8 text-textMuted" />
          <div>
            <p className="text-sm font-medium text-textMain">
              {t('serverPage.map.empty')}
            </p>
            <p className="mt-1 max-w-md text-xs text-textMuted">
              {t('serverPage.map.emptyHint')}
            </p>
          </div>
          {errorText() && <p className="text-xs text-amber-400">{errorText()}</p>}
        </div>
      )}

      {rustedit && (
        <div className="mt-4 rounded-xl border border-[#232833] bg-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-textMain">
                <MapPinned className="h-4 w-4 text-accent" />
                {t('serverPage.map.rusteditTitle')}
              </h3>
              <p className="mt-0.5 truncate text-xs text-textMuted">
                {rustedit.fileName}
                {rustedit.size ? ` · ${rustedit.size}` : ''}
                {rustedit.seed ? ` · seed ${rustedit.seed}` : ''}
              </p>
            </div>
            <Button
              size="sm"
              variant="secondary"
              loading={rusteditOpening}
              onClick={() => void openInRustedit()}
            >
              <MapPinned className="h-3.5 w-3.5" />
              {t('serverPage.map.rusteditOpen')}
            </Button>
          </div>
          {rusteditOpenError && (
            <p className="mt-2 text-xs text-amber-400">{rusteditOpenError}</p>
          )}
          {extInstalled !== null && (
            <div className="mt-3 border-t border-[#232833] pt-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className={extInstalled ? 'text-xs text-emerald-400' : 'text-xs text-amber-400'}>
                  {extInstalled
                    ? t('serverPage.map.rusteditExtInstalled')
                    : t('serverPage.map.rusteditExtMissing')}
                </p>
                {extInstalled ? (
                  <Button
                    size="sm"
                    variant="danger"
                    loading={extBusy === 'remove'}
                    onClick={() => void removeExtension()}
                  >
                    {t('serverPage.map.rusteditExtRemove')}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="primary"
                    loading={extBusy === 'install'}
                    onClick={() => void installExtension()}
                  >
                    {t('serverPage.map.rusteditExtInstall')}
                  </Button>
                )}
              </div>
              {extMsg && <p className="mt-2 text-xs text-textMuted">{extMsg}</p>}
            </div>
          )}
        </div>
      )}

      {rustmapsUrl && (
        <div className="mt-4 flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-[#2a2f3a] bg-[#1a1e26] px-6 py-10 text-center">
          <MapIcon className="h-8 w-8 text-textMuted" />
          <div>
            <p className="text-sm font-medium text-textMain">
              {t('serverPage.map.worldMap')}
            </p>
            <p className="mt-1 max-w-md text-xs text-textMuted">
              {t('serverPage.map.worldMapHint')}
            </p>
          </div>
          <Button size="sm" variant="secondary" onClick={() => openExternal(rustmapsUrl)}>
            <ExternalLink className="h-3.5 w-3.5" />
            {t('serverPage.map.openExternal')}
          </Button>
        </div>
      )}
    </div>
  );
}

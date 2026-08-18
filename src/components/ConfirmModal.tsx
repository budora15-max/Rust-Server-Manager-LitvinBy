import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Modal } from './Modal';
import { Button } from './Button';
import { cn } from '@/lib/utils';

interface ConfirmModalProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  loading?: boolean;
  /** Дополнительный контент (например, поле ввода имени для подтверждения). */
  children?: ReactNode;
  /** Блокировать кнопку подтверждения (например, пока имя не совпало). */
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Модалка подтверждения для деструктивных действий
 * (остановка сервера, вайп, удаление плагина) — "защита от дурака".
 */
export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  danger = true,
  loading,
  children,
  confirmDisabled,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const { t } = useTranslation();
  return (
    <Modal open={open} onClose={onCancel} title={title}>
      <div className="flex items-start gap-4">
        <div
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
            danger ? 'bg-red-500/10 text-red-400' : 'bg-amber-500/10 text-amber-400'
          )}
        >
          <AlertTriangle className="h-5 w-5" />
        </div>
        <p className="text-sm leading-relaxed text-textMuted">{message}</p>
      </div>
      {children && <div className="mt-4">{children}</div>}
      <div className="mt-6 flex justify-end gap-3">
        <Button variant="secondary" onClick={onCancel} disabled={loading}>
          {cancelLabel ?? t('confirm.cancel')}
        </Button>
        <Button
          variant={danger ? 'danger' : 'primary'}
          onClick={onConfirm}
          loading={loading}
          disabled={confirmDisabled}
        >
          {confirmLabel ?? t('confirm.confirm')}
        </Button>
      </div>
    </Modal>
  );
}


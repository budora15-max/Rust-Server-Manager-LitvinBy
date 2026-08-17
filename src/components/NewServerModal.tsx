import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { useServer, type NewServerInput } from '@/context/ServerContext';

interface NewServerModalProps {
  open: boolean;
  onClose: () => void;
}

interface NewServerForm {
  name: string;
  identity: string;
  port: string;
  maxPlayers: string;
  seed: string;
  worldSize: string;
  map: string;
}

const INITIAL: NewServerForm = {
  name: '',
  identity: '',
  port: '28015',
  maxPlayers: '100',
  seed: '',
  worldSize: '4000',
  map: 'Procedural Map',
};

/** Модальное окно создания нового сервера в менеджере. */
export function NewServerModal({ open, onClose }: NewServerModalProps) {
  const { t } = useTranslation();
  const { addServer } = useServer();
  const [form, setForm] = useState<NewServerForm>(INITIAL);
  const [errors, setErrors] = useState<Partial<NewServerForm>>({});

  const set = (key: keyof NewServerForm) => (value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  const validate = (): boolean => {
    const next: Partial<NewServerForm> = {};
    if (!form.name.trim()) next.name = t('dashboard.modal.nameRequired');
    if (!form.identity.trim()) next.identity = t('dashboard.modal.identityRequired');

    const port = Number(form.port);
    if (!form.port || !Number.isInteger(port) || port < 1024 || port > 65535)
      next.port = t('general.errors.portInvalid');

    const maxPlayers = Number(form.maxPlayers);
    if (!form.maxPlayers || !Number.isInteger(maxPlayers) || maxPlayers < 1 || maxPlayers > 500)
      next.maxPlayers = t('general.errors.maxPlayersInvalid');

    const worldSize = Number(form.worldSize);
    if (!form.worldSize || !Number.isInteger(worldSize) || worldSize < 500 || worldSize > 8000)
      next.worldSize = t('general.errors.worldSizeInvalid');

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    const input: NewServerInput = {
      name: form.name.trim(),
      identity: form.identity.trim(),
      port: Number(form.port),
      maxPlayers: Number(form.maxPlayers),
      worldSize: Number(form.worldSize),
      map: form.map.trim(),
      seed: form.seed ? Number(form.seed) : undefined,
    };
    addServer(input);
    setForm(INITIAL);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={t('dashboard.newServerTitle')}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label={t('dashboard.modal.name')}
          placeholder="My Rust Server"
          value={form.name}
          onChange={(e) => set('name')(e.target.value)}
          error={errors.name}
        />
        <Input
          label={t('dashboard.modal.identity')}
          hint={t('dashboard.modal.identityHint')}
          placeholder="my_server"
          value={form.identity}
          onChange={(e) => set('identity')(e.target.value)}
          error={errors.identity}
        />
        <div className="grid grid-cols-2 gap-3">
          <Input
            label={t('dashboard.modal.port')}
            value={form.port}
            onChange={(e) => set('port')(e.target.value)}
            error={errors.port}
          />
          <Input
            label={t('dashboard.modal.maxPlayers')}
            value={form.maxPlayers}
            onChange={(e) => set('maxPlayers')(e.target.value)}
            error={errors.maxPlayers}
          />
          <Input
            label={t('dashboard.modal.seed')}
            placeholder={t('dashboard.modal.seedRandom')}
            value={form.seed}
            onChange={(e) => set('seed')(e.target.value)}
          />
          <Input
            label={t('dashboard.modal.worldSize')}
            value={form.worldSize}
            onChange={(e) => set('worldSize')(e.target.value)}
            error={errors.worldSize}
          />
        </div>
        <Input
          label={t('dashboard.modal.map')}
          value={form.map}
          onChange={(e) => set('map')(e.target.value)}
        />

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('confirm.cancel')}
          </Button>
          <Button type="submit">
            <Plus className="h-4 w-4" /> {t('dashboard.createServer')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

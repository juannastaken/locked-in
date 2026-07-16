import { useState } from 'react';
import * as e2e from '../lib/e2e';
import { t } from '../lib/i18n';
import { Mascot } from './Mascot';

type Mode = 'backup' | 'restore';

interface KeyBackupProps {
  mode: Mode;
  onClose: () => void;
  /** restore mode only: the user gave up and wants a brand-new key */
  onRotated?: () => void;
  onDone: () => void;
  onError: (m: string) => void;
}

/**
 * Backup: encrypts the private message key with a passphrase (Argon2id) and
 * stores the ciphertext in the cloud. Restore (new PC): decrypts it back.
 */
export function KeyBackupModal({ mode, onClose, onRotated, onDone, onError }: KeyBackupProps) {
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmRotate, setConfirmRotate] = useState(false);

  async function doBackup() {
    setErr(null);
    if (pass.length < 8) return setErr(t('key.badpass'));
    if (pass !== pass2) return setErr(t('login.mismatch'));
    setBusy(true);
    try {
      const e = await e2e.backupKeyToCloud(pass);
      if (e) return setErr(e);
      onDone();
    } finally {
      setBusy(false);
    }
  }

  async function doRestore() {
    setErr(null);
    if (!pass) return;
    setBusy(true);
    try {
      const r = await e2e.restoreKeyFromCloud(pass);
      if (r === 'ok') return onDone();
      if (r === 'wrong-pass') setErr(t('key.wrongpass'));
      else if (r === 'no-backup') setErr(t('key.nobackup'));
      else setErr(t('fr.err.generic'));
    } finally {
      setBusy(false);
    }
  }

  async function doRotate() {
    if (!confirmRotate) return setConfirmRotate(true);
    setBusy(true);
    try {
      const e = await e2e.rotateKeys();
      if (e) return onError(e);
      onRotated?.();
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="animate-fade-in fixed inset-0 z-[60] flex items-center justify-center bg-black/85 px-6 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="chunk animate-scale-in w-full max-w-sm p-6 text-center">
        <Mascot mood={mode === 'backup' ? 'focus' : 'think'} size={64} />
        <h2 className="mt-3 text-lg font-extrabold text-text">
          {mode === 'backup' ? t('key.backup.title') : t('key.restore.title')}
        </h2>
        <p className="mt-1.5 text-xs font-medium leading-relaxed text-text-dim">
          {mode === 'backup' ? t('key.backup.body') : t('key.restore.body')}
        </p>

        <input
          type="password"
          value={pass}
          onChange={(e) => {
            setPass(e.target.value);
            setErr(null);
          }}
          placeholder={t('key.pass.placeholder')}
          autoFocus
          onKeyDown={(e) =>
            e.key === 'Enter' && (mode === 'restore' ? doRestore() : undefined)
          }
          className="chunk-input mt-4 w-full px-4 py-3 text-center text-[15px] font-bold text-text placeholder:font-medium placeholder:text-text-faint"
        />
        {mode === 'backup' && (
          <input
            type="password"
            value={pass2}
            onChange={(e) => {
              setPass2(e.target.value);
              setErr(null);
            }}
            placeholder={t('login.confirm')}
            onKeyDown={(e) => e.key === 'Enter' && doBackup()}
            className="chunk-input mt-2.5 w-full px-4 py-3 text-center text-[15px] font-bold text-text placeholder:font-medium placeholder:text-text-faint"
          />
        )}

        {err && <div className="mt-2.5 text-xs font-bold text-danger">{err}</div>}

        <button
          type="button"
          disabled={busy || (mode === 'restore' ? !pass : pass.length < 8)}
          onClick={mode === 'backup' ? doBackup : doRestore}
          className="chunk-btn chunk-btn-accent mt-4 w-full py-3 text-sm"
        >
          {busy ? '…' : mode === 'backup' ? t('key.backup.cta') : t('key.restore.cta')}
        </button>

        {mode === 'restore' && (
          <button
            type="button"
            disabled={busy}
            onClick={doRotate}
            className={`mt-2.5 w-full rounded-xl border-2 py-3 text-sm font-bold ${
              confirmRotate
                ? 'border-danger bg-danger/10 text-danger'
                : 'border-border-strong text-text-dim hover:text-text'
            }`}
          >
            {confirmRotate ? t('key.rotate.confirm') : t('key.rotate')}
          </button>
        )}

        <button
          type="button"
          onClick={onClose}
          className="mt-3 text-xs font-bold text-text-faint hover:text-text"
        >
          {t('misc.cancel')}
        </button>
      </div>
    </div>
  );
}

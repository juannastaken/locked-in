import { useEffect } from 'react';
import { t } from '../lib/i18n';
import { Mascot } from './Mascot';

/** Full confirmation popup — replaces every tiny two-click inline confirm. */
export function ConfirmModal({
  title,
  body,
  confirmLabel,
  danger = true,
  onConfirm,
  onClose,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="animate-fade-in fixed inset-0 z-[70] flex items-center justify-center bg-black/80 px-6 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="chunk animate-scale-in w-full max-w-sm p-6 text-center">
        <Mascot mood={danger ? 'sad' : 'think'} size={56} />
        <h2 className="mt-3 text-lg font-extrabold text-text">{title}</h2>
        <p className="mt-1.5 text-sm font-medium leading-relaxed text-text-dim">{body}</p>
        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={() => {
              onConfirm();
              onClose();
            }}
            className={`flex-1 rounded-xl py-3 text-sm font-extrabold transition-transform ${
              danger ? 'bg-danger text-white' : 'bg-accent text-bg'
            }`}
          >
            {confirmLabel}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="chunk-btn flex-1 py-3 text-sm text-text"
          >
            {t('misc.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}

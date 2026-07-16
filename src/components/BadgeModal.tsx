import type { Badge } from '../lib/badges';
import { getLang, t } from '../lib/i18n';

interface BadgeModalProps {
  badge: Badge;
  unlocked: boolean;
  onClose: () => void;
}

/** Click-a-badge info popup: what it is and how to earn it. */
export function BadgeModal({ badge, unlocked, onClose }: BadgeModalProps) {
  const label = getLang() === 'en' ? badge.labelEn : badge.labelPt;
  return (
    <div
      className="animate-fade-in fixed inset-0 z-[70] flex items-center justify-center bg-black/75 px-6 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="chunk animate-scale-in w-full max-w-xs p-6 text-center">
        <div
          className={`mx-auto flex h-20 w-20 items-center justify-center rounded-2xl text-4xl ${
            unlocked ? 'bg-accent-dim' : 'bg-bg opacity-50 grayscale'
          }`}
        >
          {badge.icon}
        </div>
        <h2 className="mt-3 text-lg font-extrabold text-text">{label}</h2>
        <p className="mt-1 text-xs font-medium leading-relaxed text-text-dim">
          {t('badges.desc', label)}
        </p>
        <div
          className={`mt-3 inline-block rounded-full px-3 py-1 text-[11px] font-extrabold ${
            unlocked ? 'bg-accent text-bg' : 'border border-border text-text-faint'
          }`}
        >
          {unlocked ? t('badges.unlocked') : t('badges.locked')}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="chunk-btn mt-4 w-full py-2.5 text-sm text-text"
        >
          {t('misc.close')}
        </button>
      </div>
    </div>
  );
}

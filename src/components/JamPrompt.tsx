import { useEffect, useState } from 'react';
import { t } from '../lib/i18n';
import { formatDurationShort } from '../lib/time';
import type { JamPrompt } from '../hooks/useJam';
import { Mascot } from './Mascot';

interface JamPromptProps {
  prompt: JamPrompt;
  /** 'invite' needs me idle to join; 'request' needs me still focusing to host */
  canAccept: boolean;
  onAccept: () => void;
  onDecline: () => void;
}

/** Fullscreen jam call — the custom "X is calling you" screen. */
export function JamPromptOverlay({ prompt, canAccept, onAccept, onDecline }: JamPromptProps) {
  // live "started Xs ago"
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  const ago = Math.max(0, (Date.now() - new Date(prompt.session_started_at).getTime()) / 1000);
  const isInvite = prompt.kind === 'invite';

  return (
    <div className="animate-fade-in fixed inset-0 z-[65] flex items-center justify-center bg-black/90 px-6 backdrop-blur-md">
      <div className="animate-scale-in flex w-full max-w-md flex-col items-center text-center">
        <span className="mb-5 animate-pulse text-xs font-extrabold uppercase tracking-[0.3em] text-accent">
          🎧 {t('jam.incoming')}
        </span>

        <div className="relative">
          <div className="flex h-28 w-28 items-center justify-center overflow-hidden rounded-full border-4 border-accent bg-surface text-3xl font-extrabold uppercase text-text shadow-[0_0_40px_-4px_var(--color-accent)]">
            {prompt.avatar ? (
              <img src={prompt.avatar} alt="" className="h-full w-full object-cover" />
            ) : (
              prompt.username.slice(0, 2)
            )}
          </div>
          <div className="absolute -bottom-2 -right-2">
            <Mascot mood="hyped" size={44} />
          </div>
        </div>

        <h2 className="mt-5 text-2xl font-extrabold tracking-tight text-text">
          @{prompt.username}
        </h2>
        <p className="mt-2 max-w-sm text-sm font-semibold leading-relaxed text-text-dim">
          {isInvite ? t('jam.calling', prompt.task) : t('jam.wantsin', prompt.task)}
        </p>
        <p className="mt-1 font-mono text-xs font-bold tabular-nums text-text-faint">
          {t('jam.started', formatDurationShort(ago))}
        </p>

        {!canAccept && (
          <p className="mt-4 max-w-xs text-xs font-bold text-warn">
            {isInvite ? t('jam.busy') : t('jam.over')}
          </p>
        )}

        <div className="mt-7 flex w-full max-w-xs gap-3">
          <button
            type="button"
            disabled={!canAccept}
            onClick={onAccept}
            className="chunk-btn chunk-btn-accent glow-pulse flex-1 py-3.5 text-sm disabled:animate-none"
          >
            {isInvite ? t('jam.accept') : t('jam.let.in')}
          </button>
          <button
            type="button"
            onClick={onDecline}
            className="chunk-btn flex-1 py-3.5 text-sm text-text"
          >
            {t('jam.decline')}
          </button>
        </div>
      </div>
    </div>
  );
}

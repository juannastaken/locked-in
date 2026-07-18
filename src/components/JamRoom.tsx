import { useState } from 'react';
import { parsePomo } from '../hooks/useFocusSession';
import { t } from '../lib/i18n';
import { CoffeeIcon, FlameIcon, HeadphonesIcon, TimerIcon } from './Icons';

export interface JamRoomMember {
  username: string;
  avatar: string | null;
  userId: string | null;
  isMe: boolean;
  /** presence says they're focusing right now (me = always true) */
  live: boolean;
}

interface JamRoomProps {
  members: JamRoomMember[];
  /** shared jam clock, seconds */
  sharedSec: number;
  /** "25/5" rhythm or null */
  pomo: string | null;
  /** fire a cheer at a member (server rate-limited) */
  onCheer: (userId: string) => void;
}

/**
 * The living jam card on the Focus screen: everyone in the session with a
 * pulsing focus ring, the shared pomodoro phase, and an in-room 🔥 button.
 */
export function JamRoom({ members, sharedSec, pomo, onCheer }: JamRoomProps) {
  // uid → timestamp of my last cheer (drives the flame burst + a soft cooldown)
  const [flames, setFlames] = useState<Record<string, number>>({});

  const p = parsePomo(pomo);
  let phase: 'work' | 'break' | null = null;
  let phaseLeft = 0;
  if (p) {
    const cycle = p.workSec + p.breakSec;
    const pos = ((sharedSec % cycle) + cycle) % cycle;
    phase = pos < p.workSec ? 'work' : 'break';
    phaseLeft = phase === 'work' ? p.workSec - pos : cycle - pos;
  }
  const mm = Math.floor(phaseLeft / 60);
  const ss = String(Math.floor(phaseLeft % 60)).padStart(2, '0');

  function cheer(m: JamRoomMember) {
    if (!m.userId || m.isMe) return;
    const last = flames[m.userId] ?? 0;
    if (Date.now() - last < 3000) return; // don't machine-gun the button
    setFlames((f) => ({ ...f, [m.userId as string]: Date.now() }));
    onCheer(m.userId);
  }

  return (
    <div
      className={`animate-scale-in w-full max-w-md rounded-2xl border-2 bg-surface/70 px-5 pb-4 pt-3 ${
        phase === 'break' ? 'border-sky-400/50' : 'border-accent/60'
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wide text-accent">
          <HeadphonesIcon size={13} /> JAM · {members.length}
        </span>
        {p && phase && (
          <span
            className={`flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-mono text-[11px] font-bold tabular-nums ${
              phase === 'work'
                ? 'border-danger/50 text-danger'
                : 'border-sky-400/60 text-sky-400'
            }`}
          >
            {phase === 'work' ? <TimerIcon size={11} /> : <CoffeeIcon size={11} />} {mm}:{ss}
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-start justify-center gap-4">
        {members.map((m) => {
          const flaming = m.userId && Date.now() - (flames[m.userId] ?? 0) < 1100;
          return (
            <div key={m.username.toLowerCase()} className="animate-scale-in group/jm relative flex w-16 flex-col items-center">
              <div className="relative">
                <div
                  className={`flex h-12 w-12 items-center justify-center overflow-hidden rounded-full border-2 text-[12px] font-extrabold uppercase ${
                    m.live
                      ? 'jam-ring border-accent text-accent'
                      : 'border-border-strong bg-bg text-text-dim'
                  }`}
                >
                  {m.avatar ? (
                    <img src={m.avatar} alt="" className="h-full w-full object-cover" />
                  ) : (
                    m.username.slice(0, 2)
                  )}
                </div>
                {flaming && (
                  <span className="flame-burst pointer-events-none absolute -top-2 left-1/2 -translate-x-1/2 text-base">
                    🔥
                  </span>
                )}
                {!m.isMe && m.userId && (
                  <button
                    type="button"
                    title={t('jamroom.cheer')}
                    onClick={() => cheer(m)}
                    className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border border-border-strong bg-bg text-warn opacity-0 transition-opacity group-hover/jm:opacity-100"
                  >
                    <FlameIcon size={11} />
                  </button>
                )}
              </div>
              <span
                className={`mt-1.5 max-w-full truncate text-[10px] font-bold ${
                  m.isMe ? 'text-accent' : 'text-text-dim'
                }`}
              >
                {m.isMe ? t('fr.me') : `@${m.username}`}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

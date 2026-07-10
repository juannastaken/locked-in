import { useEffect, useRef, useState } from 'react';
import { emit, listen } from '@tauri-apps/api/event';
import { LogicalSize, PhysicalPosition } from '@tauri-apps/api/dpi';
import { currentMonitor } from '@tauri-apps/api/window';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { setLang, t } from '../lib/i18n';
import { formatDurationShort, formatHms } from '../lib/time';
import type { OverlaySize, OverlayState } from '../types';
import { Mascot } from './Mascot';
import type { MascotMood } from './Mascot';

const INITIAL: OverlayState = {
  phase: 'idle',
  task: null,
  elapsedSec: 0,
  breakRemainingSec: 0,
  breakOverrunSec: 0,
  goalProgress: 0,
  todaySec: 0,
  cfg: { opacity: 40, size: 'md', showTask: true, showGoal: true, accent: '#d4ff3f', lang: 'pt' },
};

const SIZES: Record<
  OverlaySize,
  { w: number; h: number; timer: string; sub: string; btn: string; pad: string; mascot: number }
> = {
  sm: { w: 200, h: 58, timer: 'text-sm', sub: 'text-[9px]', btn: 'h-6 w-6', pad: 'px-2.5 gap-2', mascot: 36 },
  md: { w: 270, h: 84, timer: 'text-lg', sub: 'text-[10px]', btn: 'h-8 w-8', pad: 'px-3.5 gap-3', mascot: 56 },
  lg: { w: 370, h: 110, timer: 'text-3xl', sub: 'text-xs', btn: 'h-10 w-10', pad: 'px-5 gap-4', mascot: 74 },
};

const POS_KEY = 'overlay-position';

function sendCmd(cmd: 'pause' | 'resume' | 'open-main' | 'end-break') {
  emit('overlay:cmd', { cmd }).catch(() => {});
}

function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return `rgba(212, 255, 63, ${alpha})`;
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
}

export function Overlay() {
  const [s, setS] = useState<OverlayState>(INITIAL);
  const [hovered, setHovered] = useState(false);
  const appliedSize = useRef<OverlaySize | null>(null);

  useEffect(() => {
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';

    const win = getCurrentWebviewWindow();

    // restore last dragged position
    try {
      const saved = localStorage.getItem(POS_KEY);
      if (saved) {
        const { x, y } = JSON.parse(saved) as { x: number; y: number };
        if (Number.isFinite(x) && Number.isFinite(y)) {
          win.setPosition(new PhysicalPosition(x, y)).catch(() => {});
        }
      }
    } catch {
      // corrupted saved position — ignore, window opens at default spot
    }

    const unlisteners: (() => void)[] = [];
    listen<OverlayState>('overlay:state', (e) => setS(e.payload)).then((u) => unlisteners.push(u));
    // auto-track opened the overlay: first time ever (never dragged) → top-right corner
    listen('overlay:autoshow', async () => {
      if (localStorage.getItem(POS_KEY)) return;
      try {
        const mon = await currentMonitor();
        if (!mon) return;
        const size = await win.outerSize();
        await win.setPosition(
          new PhysicalPosition(
            mon.position.x + mon.size.width - size.width - 16,
            mon.position.y + 16,
          ),
        );
      } catch {
        // monitor info unavailable — keep default position
      }
    }).then((u) => unlisteners.push(u));
    win
      .onMoved((pos) => {
        localStorage.setItem(POS_KEY, JSON.stringify({ x: pos.payload.x, y: pos.payload.y }));
      })
      .then((u) => unlisteners.push(u));

    emit('overlay:ready').catch(() => {});
    return () => unlisteners.forEach((u) => u());
  }, []);

  // apply accent color + language from settings
  useEffect(() => {
    document.documentElement.style.setProperty('--color-accent', s.cfg.accent);
    document.documentElement.style.setProperty('--color-accent-dim', hexToRgba(s.cfg.accent, 0.12));
    setLang(s.cfg.lang);
  }, [s.cfg.accent, s.cfg.lang]);

  // resize window when size setting changes
  useEffect(() => {
    if (appliedSize.current === s.cfg.size) return;
    appliedSize.current = s.cfg.size;
    const { w, h } = SIZES[s.cfg.size];
    getCurrentWebviewWindow().setSize(new LogicalSize(w, h)).catch(() => {});
  }, [s.cfg.size]);

  const sz = SIZES[s.cfg.size];
  const overdue = s.phase === 'break' && s.breakRemainingSec < 0;
  const baseOpacity = Math.max(0.15, Math.min(1, s.cfg.opacity / 100));

  // mascot: sleeps when idle, focused in session, chills on break — and the longer
  // the session runs, the happier it gets (duolingo-style): bursts of joy get more
  // frequent after 30min, permanent hype past 90min
  const [burst, setBurst] = useState(false);
  const sessionMinRef = useRef(0);
  sessionMinRef.current = s.elapsedSec / 60;
  useEffect(() => {
    let timeout: number | undefined;
    const id = window.setInterval(() => {
      const p = sessionMinRef.current >= 30 ? 0.6 : 0.35;
      if (Math.random() < p) {
        setBurst(true);
        timeout = window.setTimeout(() => setBurst(false), 2500);
      }
    }, 20_000);
    return () => {
      window.clearInterval(id);
      if (timeout) window.clearTimeout(timeout);
    };
  }, []);
  const sessionMin = s.elapsedSec / 60;
  const mascotMood: MascotMood =
    s.phase === 'focusing'
      ? sessionMin >= 90
        ? 'hyped'
        : burst
          ? 'happy'
          : 'focus'
      : s.phase === 'paused'
        ? 'sleep'
        : s.phase === 'break'
          ? overdue
            ? 'sad'
            : 'relax'
          : burst
            ? 'happy'
            : 'sleep';

  return (
    <div
      data-tauri-drag-region
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`relative flex h-screen w-screen cursor-default items-center overflow-hidden rounded-2xl border border-border bg-surface/95 ${sz.pad}`}
      style={{ opacity: hovered ? 1 : baseOpacity, transition: 'opacity 200ms ease' }}
    >
      <div data-tauri-drag-region className="shrink-0">
        <Mascot mood={mascotMood} size={sz.mascot} />
      </div>

      {s.phase === 'focusing' && (
        <>
          <div data-tauri-drag-region className="min-w-0 flex-1">
            <div
              data-tauri-drag-region
              className={`font-mono leading-tight tabular-nums text-text ${sz.timer}`}
            >
              {formatHms(s.elapsedSec)}
            </div>
            {s.cfg.showTask && s.task && (
              <div
                data-tauri-drag-region
                className={`truncate leading-tight text-text-dim ${sz.sub}`}
              >
                {s.task}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => sendCmd('pause')}
            title={t('ov.pause')}
            className={`flex shrink-0 items-center justify-center gap-[3px] rounded-lg border border-border text-text-dim hover:border-warn/40 hover:bg-warn-dim hover:text-warn ${sz.btn}`}
          >
            <span className="block h-2.5 w-[3px] rounded-[1px] bg-current" />
            <span className="block h-2.5 w-[3px] rounded-[1px] bg-current" />
          </button>
        </>
      )}

      {s.phase === 'paused' && (
        <>
          <div data-tauri-drag-region className="min-w-0 flex-1">
            <div
              data-tauri-drag-region
              className={`font-mono leading-tight tabular-nums text-text-faint ${sz.timer}`}
            >
              {formatHms(s.elapsedSec)}
            </div>
            <div data-tauri-drag-region className={`leading-tight text-warn ${sz.sub}`}>
              {t('ov.paused')}
            </div>
          </div>
          <button
            type="button"
            onClick={() => sendCmd('resume')}
            title={t('ov.resume')}
            className={`flex shrink-0 items-center justify-center rounded-lg border border-accent/40 bg-accent-dim text-accent hover:bg-accent hover:text-bg ${sz.btn}`}
          >
            <span className="ml-0.5 block h-0 w-0 border-y-[5px] border-l-[8px] border-y-transparent border-l-current" />
          </button>
        </>
      )}

      {s.phase === 'break' && (
        <>
          <div data-tauri-drag-region className="min-w-0 flex-1">
            <div
              data-tauri-drag-region
              className={`font-mono leading-tight tabular-nums ${sz.timer} ${
                overdue ? 'text-warn' : 'text-text'
              }`}
            >
              {overdue ? `+${formatHms(s.breakOverrunSec)}` : formatHms(s.breakRemainingSec)}
            </div>
            <div data-tauri-drag-region className={`leading-tight text-text-dim ${sz.sub}`}>
              {overdue ? t('ov.overrun') : t('ov.break')}
            </div>
          </div>
          <button
            type="button"
            onClick={() => sendCmd('end-break')}
            title={t('ov.back')}
            className={`flex shrink-0 items-center justify-center rounded-lg border border-border text-text-dim hover:border-accent/40 hover:bg-accent-dim hover:text-accent ${sz.btn}`}
          >
            <span className="ml-0.5 block h-0 w-0 border-y-[5px] border-l-[8px] border-y-transparent border-l-current" />
          </button>
        </>
      )}

      {s.phase === 'idle' && (
        <>
          <div data-tauri-drag-region className="min-w-0 flex-1">
            <div
              data-tauri-drag-region
              className={`font-semibold leading-tight text-text ${
                s.cfg.size === 'lg' ? 'text-base' : 'text-[13px]'
              }`}
            >
              Locked In
            </div>
            <div data-tauri-drag-region className={`leading-tight text-text-dim ${sz.sub}`}>
              {s.todaySec > 0 ? t('ov.today', formatDurationShort(s.todaySec)) : t('ov.none')}
            </div>
          </div>
          <button
            type="button"
            onClick={() => sendCmd('open-main')}
            title={t('ov.open')}
            className={`flex shrink-0 items-center justify-center rounded-lg border border-border text-sm text-text-dim hover:border-border-strong hover:bg-surface-hover hover:text-text ${sz.btn}`}
          >
            ↗
          </button>
        </>
      )}

      {s.cfg.showGoal && (
        <div
          className="absolute bottom-0 left-0 h-[3px] rounded-full bg-accent"
          style={{
            width: `${Math.min(1, s.goalProgress) * 100}%`,
            transition: 'width 600ms cubic-bezier(0.16,1,0.3,1)',
          }}
        />
      )}
    </div>
  );
}

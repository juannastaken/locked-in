import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import * as db from '../lib/db';
import { setLang, t } from '../lib/i18n';
import { randomQuote } from '../lib/quotes';
import type { Quote } from '../lib/quotes';
import { playCheckinChime, playNudgeSound } from '../lib/sound';
import type { PopupPayload } from '../types';
import { Mascot } from './Mascot';
import type { MascotMood } from './Mascot';

const CHECKIN_AUTO_SKIP_MS = 75_000;
const NUDGE_AUTO_HIDE_MS = 18_000;
const NOTICE_AUTO_HIDE_MS = 12_000;

const MOODS: MascotMood[] = ['sleep', 'relax', 'happy', 'think', 'focus', 'sad', 'hyped'];
function asMood(m: string): MascotMood {
  return (MOODS as string[]).includes(m) ? (m as MascotMood) : 'happy';
}

function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return `rgba(212, 255, 63, ${alpha})`;
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
}

export function Popup() {
  const [payload, setPayload] = useState<PopupPayload | null>(null);
  const [text, setText] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [leaving, setLeaving] = useState(false);
  const answeredRef = useRef(false);
  const autoTimer = useRef<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    // baseline language straight from the db — even if a payload ever arrives
    // without lang, the popup already speaks the user's language
    db.getAllSettings()
      .then((s) => setLang(s.language === 'en' ? 'en' : 'pt'))
      .catch(() => {});
    let unlisten: (() => void) | undefined;
    listen<PopupPayload>('popup:show', (e) => {
      setPayload(e.payload);
      setText('');
      if (e.payload.kind === 'quote') setQuote(randomQuote());
      setLeaving(false);
      answeredRef.current = false;
    }).then((u) => {
      unlisten = u;
    });
    return () => unlisten?.();
  }, []);

  // language applies during render so even the very first paint is translated;
  // an empty lang in the payload keeps the db baseline instead of forcing pt
  if (payload && (payload.lang === 'en' || payload.lang === 'pt')) setLang(payload.lang);

  // theme + entrance sound
  useEffect(() => {
    if (!payload) return;
    document.documentElement.style.setProperty('--color-accent', payload.accent);
    document.documentElement.style.setProperty(
      '--color-accent-dim',
      hexToRgba(payload.accent, 0.12),
    );
    if (payload.sound) {
      if (payload.kind === 'checkin') playCheckinChime();
      else playNudgeSound();
    }
  }, [payload]);

  function hide(delayForExitAnim = true) {
    if (autoTimer.current) window.clearTimeout(autoTimer.current);
    if (!delayForExitAnim) {
      getCurrentWebviewWindow().hide().catch(() => {});
      setPayload(null);
      return;
    }
    setLeaving(true);
    window.setTimeout(() => {
      getCurrentWebviewWindow().hide().catch(() => {});
      setPayload(null);
      setLeaving(false);
    }, 260);
  }

  async function answerCheckin(skipped: boolean) {
    if (!payload || payload.kind !== 'checkin' || answeredRef.current) return;
    answeredRef.current = true;
    const trimmed = text.trim();
    if (!payload.test) {
      try {
        await db.addHourlyLog(
          payload.day,
          payload.periodStart,
          payload.periodEnd,
          skipped || !trimmed ? null : trimmed,
          skipped || !trimmed,
        );
        emit('checkin:changed').catch(() => {});
      } catch {
        // db hiccup — the popup still closes; next check-in tries again
      }
    }
    hide();
  }

  // auto-close: unanswered check-in counts as skipped; nudges/notices just leave
  useEffect(() => {
    if (!payload) return;
    if (autoTimer.current) window.clearTimeout(autoTimer.current);
    const ms =
      payload.kind === 'checkin'
        ? CHECKIN_AUTO_SKIP_MS
        : payload.kind === 'update'
          ? 60_000
          : payload.kind === 'quote'
            ? 14_000
            : payload.kind === 'nudge'
              ? NUDGE_AUTO_HIDE_MS
              : NOTICE_AUTO_HIDE_MS;
    autoTimer.current = window.setTimeout(() => {
      if (payload.kind === 'checkin') answerCheckin(true);
      else hide();
    }, ms);
    return () => {
      if (autoTimer.current) window.clearTimeout(autoTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload]);

  async function nudgeAck(graceMin: number) {
    invoke('nudge_ack', { graceMin }).catch(() => {});
    hide();
  }

  if (!payload) return <div className="h-screen w-screen" />;

  if (payload.kind === 'checkin') {
    return (
      <div className="flex h-screen w-screen items-end justify-end p-2">
        <div
          className={`popup-glow w-full rounded-2xl border border-border bg-surface p-4 ${
            leaving ? 'animate-popup-out' : 'animate-popup-in'
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Mascot mood="think" size={34} />
              <span className="text-sm font-semibold text-text">{t('ci.popup.title')}</span>
            </div>
            <span className="font-mono text-lg font-semibold tabular-nums text-accent">
              {payload.periodEnd}
            </span>
          </div>

          <p className="mt-2.5 text-[13px] text-text-dim">
            {t('ci.popup.q.pre')}{' '}
            <span className="font-semibold text-accent">
              {payload.periodStart} – {payload.periodEnd}
            </span>
            ?
          </p>

          <textarea
            ref={textareaRef}
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                answerCheckin(false);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                answerCheckin(true);
              }
            }}
            placeholder={t('ci.popup.placeholder')}
            className="mt-2.5 h-16 w-full resize-none rounded-xl border border-accent/50 bg-bg p-2.5 text-[13px] text-text placeholder:text-text-faint focus:border-accent focus:outline-none"
          />

          <div className="mt-2.5 flex gap-2">
            <button
              type="button"
              onClick={() => answerCheckin(true)}
              className="rounded-xl border border-border px-4 py-2 text-[13px] text-text-dim hover:bg-surface-hover hover:text-text"
            >
              {t('ci.popup.skip')}
            </button>
            <button
              type="button"
              onClick={() => answerCheckin(false)}
              className="flex-1 rounded-xl bg-accent py-2 text-[13px] font-semibold text-bg hover:brightness-110"
            >
              {t('ci.popup.save')}
            </button>
          </div>

          <div className="mt-2 text-center text-[10px] text-text-faint">
            <kbd className="rounded border border-border bg-bg px-1">Ctrl</kbd> +{' '}
            <kbd className="rounded border border-border bg-bg px-1">Enter</kbd>{' '}
            {t('ci.popup.hint.save')} ·{' '}
            <kbd className="rounded border border-border bg-bg px-1">Esc</kbd>{' '}
            {t('ci.popup.hint.skip')}
          </div>
        </div>
      </div>
    );
  }

  // mascot quote — pixel speech bubble to the mascot's left
  if (payload.kind === 'quote') {
    const q = quote ?? randomQuote();
    const en = payload.lang === 'en';
    const txt = en ? q.en : q.pt;
    const author = en ? (q.authorEn ?? q.author) : q.author;
    // aggressive quotes get an angry mascot and a red bubble
    const angry = q.mood === 'angry';
    const edge = angry ? 'var(--color-danger)' : 'var(--color-accent)';
    return (
      <div className="flex h-screen w-screen items-end justify-end p-2">
        <button
          type="button"
          onClick={() => hide()}
          className={`w-full cursor-pointer bg-transparent text-left ${
            leaving ? 'animate-popup-out' : 'animate-popup-in'
          }`}
        >
          <div className="flex items-end gap-0">
            <div
              className="pixel-bubble animate-bubble-pop min-w-0 flex-1"
              style={{ borderColor: edge }}
            >
              <p className="text-[14px] font-medium leading-snug text-text">“{txt}”</p>
              <p
                className="mt-1.5 text-right font-mono text-[11px]"
                style={{ color: edge }}
              >
                — {author}
              </p>
            </div>
            <div className="pixel-bubble-tail" style={{ borderLeftColor: edge }} />
            <div className="shrink-0 pb-1">
              <Mascot mood={q.mood} size={62} />
            </div>
          </div>
        </button>
      </div>
    );
  }

  // update available
  if (payload.kind === 'update') {
    return (
      <div className="flex h-screen w-screen items-end justify-end p-2">
        <div
          className={`popup-glow w-full rounded-2xl border border-border bg-surface p-4 ${
            leaving ? 'animate-popup-out' : 'animate-popup-in'
          }`}
        >
          <div className="flex items-start gap-3">
            <Mascot mood="hyped" size={44} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold tracking-tight text-text">
                {t('up.title')}{' '}
                <span className="font-mono text-accent">v{payload.version}</span>
              </div>
              <p className="mt-1 text-[13px] leading-snug text-text-dim">{t('up.body')}</p>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => {
                emit('update:install').catch(() => {});
                hide();
              }}
              className="flex-1 rounded-xl bg-accent py-2 text-[13px] font-semibold text-bg hover:brightness-110"
            >
              {t('up.get')}
            </button>
            <button
              type="button"
              onClick={() => hide()}
              className="rounded-xl border border-border px-4 py-2 text-[13px] text-text-dim hover:bg-surface-hover hover:text-text"
            >
              {t('up.later')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // generic notice (milestones, burnout, auto-end, break end)
  if (payload.kind === 'notice') {
    return (
      <div className="flex h-screen w-screen items-end justify-end p-2">
        <button
          type="button"
          onClick={() => hide()}
          className={`w-full cursor-pointer rounded-2xl border border-border bg-surface p-4 text-left shadow-2xl shadow-black/60 hover:border-border-strong ${
            leaving ? 'animate-popup-out' : 'animate-popup-in'
          }`}
        >
          <div className="flex items-start gap-3">
            <Mascot mood={asMood(payload.mood)} size={44} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                <span className="text-sm font-bold tracking-tight text-text">{payload.title}</span>
              </div>
              <p className="mt-1 text-[13px] leading-snug text-text-dim">{payload.body}</p>
            </div>
          </div>
        </button>
      </div>
    );
  }

  // nudge
  return (
    <div className="flex h-screen w-screen items-end justify-end p-2">
      <div
        className={`w-full rounded-2xl border border-warn/40 bg-surface p-4 shadow-2xl shadow-black/60 ${
          leaving ? 'animate-popup-out' : 'animate-popup-in'
        }`}
      >
        <div className="flex items-start gap-3">
          <Mascot mood="sad" size={44} />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold tracking-tight text-text">{t('nudge.title')}</div>
            <p className="mt-1 text-[13px] leading-snug text-text-dim">
              {t('nudge.body', payload.app, String(payload.minutes))}
            </p>
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => nudgeAck(5)}
            className="flex-1 rounded-xl bg-accent py-2 text-[13px] font-semibold text-bg hover:brightness-110"
          >
            {t('nudge.back')}
          </button>
          <button
            type="button"
            onClick={() => nudgeAck(5)}
            className="rounded-xl border border-border px-4 py-2 text-[13px] text-text-dim hover:bg-surface-hover hover:text-text"
          >
            {t('nudge.5more')}
          </button>
        </div>
      </div>
    </div>
  );
}

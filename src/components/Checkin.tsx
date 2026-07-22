import { useCallback, useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import * as db from '../lib/db';
import { dateLocale, t } from '../lib/i18n';
import { checkinPeriod, todayKey } from '../lib/time';
import type { HourlyLog, Settings } from '../types';
import { Mascot } from './Mascot';

interface CheckinProps {
  settings: Settings | null;
  onError: (message: string) => void;
}

export function CheckinPage({ settings, onError }: CheckinProps) {
  const [logs, setLogs] = useState<HourlyLog[]>([]);
  const [streak, setStreak] = useState(0);
  const [input, setInput] = useState('');
  const [now, setNow] = useState(() => new Date());
  const [confirmingClear, setConfirmingClear] = useState(false);
  const clearTimer = useRef<number | null>(null);

  const enabled = settings?.checkin_enabled ?? true;
  const intervalMin = settings?.checkin_interval_min ?? 60;

  const reload = useCallback(() => {
    Promise.all([db.listHourlyLogs(todayKey()), db.getCheckinStreak()])
      .then(([l, s]) => {
        setLogs(l);
        setStreak(s);
      })
      .catch((err) => onError(String(err)));
  }, [onError]);

  useEffect(reload, [reload]);

  // popup saves land in the db from another window — refresh on its signal
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen('checkin:changed', reload).then((u) => {
      unlisten = u;
    });
    return () => unlisten?.();
  }, [reload]);

  // clock for "this hour" header + next check-in countdown
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    return () => {
      if (clearTimer.current) window.clearTimeout(clearTimer.current);
    };
  }, []);

  const period = checkinPeriod(intervalMin, now);
  const nextInMin = Math.max(1, Math.ceil((period.endMs - now.getTime()) / 60_000));
  const nextAt = new Date(period.endMs).toLocaleTimeString(dateLocale(), {
    hour: '2-digit',
    minute: '2-digit',
  });

  const loggedToday = logs.filter((l) => !l.skipped).length;
  const skippedToday = logs.filter((l) => l.skipped).length;

  async function saveNow() {
    const trimmed = input.trim();
    if (!trimmed) return;
    try {
      await db.addHourlyLog(todayKey(), period.startLabel, period.endLabel, trimmed, false);
      setInput('');
      reload();
    } catch (err) {
      onError(String(err));
    }
  }

  async function exportLogs() {
    try {
      const all = await db.listAllHourlyLogs();
      const lines = all.map(
        (l) =>
          `${l.day} ${l.period_start} – ${l.period_end}  ${l.skipped ? `(${t('ci.skippedrow').toLowerCase()})` : l.text ?? ''}`,
      );
      const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `locked-in-hourly-${todayKey()}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      onError(String(err));
    }
  }

  function requestClear() {
    if (confirmingClear) {
      if (clearTimer.current) window.clearTimeout(clearTimer.current);
      setConfirmingClear(false);
      db.clearHourlyLogs().then(reload).catch((err) => onError(String(err)));
      return;
    }
    setConfirmingClear(true);
    if (clearTimer.current) window.clearTimeout(clearTimer.current);
    clearTimer.current = window.setTimeout(() => setConfirmingClear(false), 3000);
  }

  const createdTime = (iso: string) =>
    new Date(iso).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="flex h-full flex-col">
      {/* page-level scroller like Habits — same scrollbar gutter, so the
          centered column lands at the SAME x as the Habits tab */}
      <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="cascade mx-auto w-full max-w-2xl px-4 pt-6 sm:px-6 xl:max-w-3xl">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-text">
              {t('ci.thishour')} <span className="text-accent">{period.startLabel}</span>
            </h1>
            <p className="mt-1 text-xs text-text-faint">
              {enabled ? (
                <>
                  {t('ci.next')} <span className="text-accent">{nextAt}</span>
                  <span className="text-text-faint"> · {nextInMin}min</span>
                  {settings?.checkin_only_session && (
                    <span className="text-text-faint"> · {t('ci.onlysession')}</span>
                  )}
                </>
              ) : (
                t('ci.off')
              )}
            </p>
          </div>
          <Mascot mood={loggedToday > 0 ? 'happy' : 'relax'} size={52} />
        </div>

        <div className="mt-5 grid grid-cols-3 gap-3">
          <div
            className={`rounded-2xl p-4 ${
              loggedToday > 0 ? 'bg-accent text-bg' : 'border border-border bg-surface'
            }`}
          >
            <div className="font-mono text-2xl font-bold tabular-nums">{loggedToday}</div>
            <div
              className={`mt-0.5 text-[10px] font-semibold tracking-[0.1em] ${
                loggedToday > 0 ? 'text-bg/70' : 'text-text-faint'
              }`}
            >
              {t('ci.logged')}
            </div>
          </div>
          <div className="rounded-2xl border border-border bg-surface p-4">
            <div className="font-mono text-2xl font-bold tabular-nums text-text">{streak}</div>
            <div className="mt-0.5 text-[10px] font-semibold tracking-[0.1em] text-text-faint">
              {t('ci.streak')}
            </div>
          </div>
          <div className="rounded-2xl border border-border bg-surface p-4">
            <div className="font-mono text-2xl font-bold tabular-nums text-text">
              {skippedToday}
            </div>
            <div className="mt-0.5 text-[10px] font-semibold tracking-[0.1em] text-text-faint">
              {t('ci.skipped')}
            </div>
          </div>
        </div>

        <h2 className="mb-2 mt-6 text-xs font-medium uppercase tracking-[0.12em] text-text-faint">
          {t('ci.todaylog')}
        </h2>
        <div className="space-y-1.5 pb-3">
          {logs.length === 0 && (
            <div className="rounded-2xl border border-dashed border-border py-8 text-center text-xs text-text-faint">
              {t('ci.empty')}
            </div>
          )}
          {logs.map((l) => (
            <div
              key={l.id}
              className="flex items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2 font-mono text-[11px] font-semibold tabular-nums text-text-dim">
                {l.period_start.slice(0, 2)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-mono text-[11px] tabular-nums text-text-faint">
                  {l.period_start} – {l.period_end}
                </div>
                {l.skipped ? (
                  <div className="text-[13px] italic text-text-faint">{t('ci.skippedrow')}</div>
                ) : (
                  <div className="break-words text-[13px] text-text">{l.text}</div>
                )}
              </div>
              <span className="shrink-0 font-mono text-[10px] tabular-nums text-text-faint">
                {createdTime(l.created_at)}
              </span>
            </div>
          ))}
        </div>
      </div>
      </div>

      <div className="border-t border-border bg-bg/80">
        <div className="mx-auto w-full max-w-2xl px-4 py-3 sm:px-6 xl:max-w-3xl">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              saveNow();
            }}
            className="flex items-center gap-2"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t('ci.input.placeholder')}
              className="min-w-0 flex-1 rounded-full border border-border bg-surface px-4 py-2.5 text-sm text-text placeholder:text-text-faint focus:border-accent"
            />
            <button
              type="submit"
              disabled={!input.trim()}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-bg hover:brightness-110 disabled:opacity-30"
              aria-label={t('misc.save')}
            >
              →
            </button>
          </form>
          <div className="mt-2 flex items-center justify-between text-[11px] text-text-faint">
            <span>
              {streak >= 2 ? (
                <span className="text-accent">{t('ci.streakon', String(streak))}</span>
              ) : (
                t('ci.nostreak')
              )}
            </span>
            <span className="flex gap-1.5">
              <button
                type="button"
                onClick={exportLogs}
                className="rounded-full border border-border px-3 py-1 text-text-dim hover:border-border-strong hover:text-text"
              >
                {t('ci.export')}
              </button>
              <button
                type="button"
                onClick={requestClear}
                className={`rounded-full px-3 py-1 ${
                  confirmingClear
                    ? 'bg-danger/15 font-medium text-danger'
                    : 'border border-border text-text-dim hover:border-border-strong hover:text-danger'
                }`}
              >
                {confirmingClear ? t('ci.clear.confirm') : t('ci.clear')}
              </button>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

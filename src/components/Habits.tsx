import { useCallback, useEffect, useRef, useState } from 'react';
import * as db from '../lib/db';
import { dateLocale, t, weekdayLetters } from '../lib/i18n';
import { localDayKey, todayKey } from '../lib/time';
import type { Habit, HabitLog } from '../types';

const LOOKBACK_WEEKS = 26;

function dateKeyNDaysAgo(n: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return localDayKey(d);
}

/** Monday-based week start for a yyyy-mm-dd key. */
export function weekStartOf(dateKey: string): string {
  const d = new Date(dateKey + 'T00:00:00');
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diff);
  return localDayKey(d);
}

function weekStartNWeeksAgo(n: number): string {
  const current = weekStartOf(todayKey());
  const d = new Date(current + 'T00:00:00');
  d.setDate(d.getDate() - n * 7);
  return localDayKey(d);
}

function weekDates(weekStart: string): string[] {
  const start = new Date(weekStart + 'T00:00:00');
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return localDayKey(d);
  });
}

interface HabitData {
  habits: Habit[];
  logSet: Set<string>;
  reload: () => void;
}

function useHabitData(onError: (m: string) => void): HabitData {
  const [habits, setHabits] = useState<Habit[]>([]);
  const [logs, setLogs] = useState<HabitLog[]>([]);

  const reload = useCallback(() => {
    Promise.all([db.listHabits(), db.getHabitLogsSince(weekStartNWeeksAgo(LOOKBACK_WEEKS))])
      .then(([h, l]) => {
        setHabits(h);
        setLogs(l);
      })
      .catch((err) => onError(String(err)));
  }, [onError]);

  useEffect(reload, [reload]);

  return { habits, logSet: new Set(logs.map((l) => `${l.habit_id}:${l.date}`)), reload };
}

function weekCount(logSet: Set<string>, habitId: number, weekStart: string): number {
  return weekDates(weekStart).filter((d) => logSet.has(`${habitId}:${d}`)).length;
}

function flameStreak(logSet: Set<string>, habit: Habit): number {
  let streak = 0;
  for (let w = 0; w <= LOOKBACK_WEEKS; w++) {
    const count = weekCount(logSet, habit.id, weekStartNWeeksAgo(w));
    if (count >= habit.weekly_target) streak++;
    else if (w === 0) continue; // current week still in progress
    else break;
  }
  return streak;
}

// ---------- Home strip: quick chips ----------

export function HabitChips({
  onError,
  onOpenHabits,
}: {
  onError: (m: string) => void;
  onOpenHabits: () => void;
}) {
  const { habits, logSet, reload } = useHabitData(onError);
  const today = todayKey();
  const yesterday = dateKeyNDaysAgo(1);
  const currentWeek = weekStartOf(today);

  async function toggle(habit: Habit, date: string) {
    try {
      await db.toggleHabitLog(habit.id, date);
      reload();
    } catch (err) {
      onError(String(err));
    }
  }

  return (
    <div className="flex w-full max-w-xl flex-wrap items-center justify-center gap-1.5">
      {habits.map((habit) => {
        const doneToday = logSet.has(`${habit.id}:${today}`);
        const count = weekCount(logSet, habit.id, currentWeek);
        const flame = flameStreak(logSet, habit);
        return (
          <button
            key={habit.id}
            type="button"
            onClick={() => toggle(habit, today)}
            onContextMenu={(e) => {
              e.preventDefault();
              toggle(habit, yesterday);
            }}
            title={t('hab.chip.title', habit.name, String(count), String(habit.weekly_target))}
            className={`flex items-center gap-2 rounded-full border px-3.5 py-2 text-xs ${
              doneToday
                ? 'border-accent bg-accent-dim text-text'
                : 'border-border bg-surface text-text-dim hover:border-border-strong hover:text-text'
            }`}
          >
            <span className="text-sm leading-none">{habit.emoji}</span>
            <span>{habit.name}</span>
            <span className="flex items-center gap-[3px]">
              {Array.from({ length: habit.weekly_target }, (_, i) => (
                <span
                  key={i}
                  className={`h-[5px] w-[5px] rounded-full ${
                    i < count ? 'bg-accent' : 'bg-border-strong'
                  }`}
                />
              ))}
            </span>
            {flame >= 2 && <span className="text-[10px] text-accent">🔥{flame}</span>}
          </button>
        );
      })}
      <button
        type="button"
        onClick={onOpenHabits}
        title={t('hab.manage')}
        className={`flex items-center justify-center rounded-full border border-dashed border-border text-text-faint hover:border-border-strong hover:text-text ${
          habits.length === 0 ? 'gap-1.5 px-3.5 py-2 text-xs' : 'h-8 w-8 text-sm'
        }`}
      >
        {habits.length === 0 ? <>{t('hab.chips.add')}</> : '+'}
      </button>
    </div>
  );
}

// ---------- Full tab ----------

function ProgressRing({ count, target }: { count: number; target: number }) {
  const R = 20;
  const C = 2 * Math.PI * R;
  const frac = Math.min(1, count / target);
  const over = count > target;
  return (
    <div className="relative h-14 w-14 shrink-0">
      <svg viewBox="0 0 48 48" className="h-full w-full -rotate-90">
        <circle cx="24" cy="24" r={R} fill="none" stroke="var(--color-surface-2)" strokeWidth="5" />
        <circle
          cx="24"
          cy="24"
          r={R}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - frac)}
          style={{ transition: 'stroke-dashoffset 500ms cubic-bezier(0.16,1,0.3,1)' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`font-mono text-sm font-semibold leading-none ${over ? 'text-accent' : 'text-text'}`}>
          {count}
        </span>
        <span className="text-[9px] leading-none text-text-faint">/{target}</span>
      </div>
    </div>
  );
}

export function HabitsPage({ onError }: { onError: (m: string) => void }) {
  const { habits, logSet, reload } = useHabitData(onError);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmoji, setNewEmoji] = useState('');
  const [newTarget, setNewTarget] = useState(3);
  const [confirmingArchive, setConfirmingArchive] = useState<number | null>(null);
  const confirmTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (confirmTimer.current) window.clearTimeout(confirmTimer.current);
    };
  }, []);

  const today = todayKey();
  const currentWeek = weekStartOf(today);
  const days = weekDates(currentWeek);

  async function toggle(habitId: number, date: string) {
    if (date > today) return;
    try {
      await db.toggleHabitLog(habitId, date);
      reload();
    } catch (err) {
      onError(String(err));
    }
  }

  function requestArchive(id: number) {
    if (confirmingArchive === id) {
      if (confirmTimer.current) window.clearTimeout(confirmTimer.current);
      setConfirmingArchive(null);
      db.archiveHabit(id)
        .then(reload)
        .catch((err) => onError(String(err)));
      return;
    }
    setConfirmingArchive(id);
    if (confirmTimer.current) window.clearTimeout(confirmTimer.current);
    confirmTimer.current = window.setTimeout(() => setConfirmingArchive(null), 3000);
  }

  async function saveNew() {
    const name = newName.trim();
    if (!name) return;
    try {
      await db.createHabit(name, newEmoji.trim() || '✅', newTarget);
      setNewName('');
      setNewEmoji('');
      setNewTarget(3);
      setAdding(false);
      reload();
    } catch (err) {
      onError(String(err));
    }
  }

  const weekDone = habits.filter(
    (h) => weekCount(logSet, h.id, currentWeek) >= h.weekly_target,
  ).length;

  return (
    <div className="h-full overflow-y-auto">
      <div className="cascade mx-auto max-w-2xl space-y-5 px-4 pb-10 pt-6 sm:px-6 xl:max-w-3xl">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-text">{t('hab.title')}</h1>
            <p className="mt-0.5 text-xs text-text-faint">{t('hab.sub')}</p>
          </div>
          {habits.length > 0 && (
            <div className="text-right">
              <div className="font-mono text-2xl font-medium tabular-nums text-accent">
                {weekDone}
                <span className="text-sm text-text-faint">/{habits.length}</span>
              </div>
              <div className="text-[10px] text-text-faint">{t('hab.hit')}</div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {habits.map((habit) => {
            const count = weekCount(logSet, habit.id, currentWeek);
            const flame = flameStreak(logSet, habit);
            const hit = count >= habit.weekly_target;
            return (
              <div
                key={habit.id}
                className={`group rounded-2xl border bg-surface p-4 transition-colors ${
                  hit ? 'border-accent/35' : 'border-border hover:border-border-strong'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="text-3xl leading-none">{habit.emoji}</span>
                    <div className="min-w-0">
                      <div className="truncate text-[15px] font-semibold text-text">
                        {habit.name}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[11px]">
                        {flame >= 2 ? (
                          <span className="text-accent">{t('hab.streak', String(flame))}</span>
                        ) : hit ? (
                          <span className="text-accent">{t('hab.done')}</span>
                        ) : (
                          <span className="text-text-faint">
                            {t('hab.left', String(habit.weekly_target - count))}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <ProgressRing count={count} target={habit.weekly_target} />
                </div>

                <div className="mt-3 flex items-center justify-between gap-1">
                  {days.map((date, i) => {
                    const done = logSet.has(`${habit.id}:${date}`);
                    const future = date > today;
                    const isToday = date === today;
                    return (
                      <button
                        key={date}
                        type="button"
                        disabled={future}
                        onClick={() => toggle(habit.id, date)}
                        title={new Date(date + 'T00:00:00').toLocaleDateString(dateLocale())}
                        className={`flex h-9 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg border text-[10px] font-medium leading-none transition-all ${
                          done
                            ? 'border-accent bg-accent-dim text-accent'
                            : future
                              ? 'cursor-default border-border/40 text-text-faint/60'
                              : 'border-border text-text-faint hover:border-border-strong hover:text-text'
                        } ${isToday && !done ? 'border-dashed border-text-dim' : ''}`}
                      >
                        <span>{weekdayLetters()[i]}</span>
                        {done && <span className="text-[8px] leading-none">✓</span>}
                      </button>
                    );
                  })}
                </div>

                <div className="mt-3 flex items-center justify-between">
                  <div className="flex items-center gap-[3px]" title={t('hab.last8')}>
                    {Array.from({ length: 8 }, (_, i) => {
                      const w = 7 - i;
                      const c = weekCount(logSet, habit.id, weekStartNWeeksAgo(w));
                      const wHit = c >= habit.weekly_target;
                      return (
                        <span
                          key={w}
                          title={`${c}/${habit.weekly_target}`}
                          className={`h-2 w-3 rounded-[2px] ${
                            wHit ? 'bg-accent' : c > 0 ? 'bg-accent/25' : 'bg-surface-2'
                          }`}
                        />
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    onClick={() => requestArchive(habit.id)}
                    className={`rounded-md px-2 py-0.5 text-[11px] transition-opacity ${
                      confirmingArchive === habit.id
                        ? 'bg-danger/15 font-medium text-danger opacity-100'
                        : 'text-text-faint opacity-0 hover:text-danger group-hover:opacity-100'
                    }`}
                  >
                    {confirmingArchive === habit.id ? t('misc.sure') : t('hab.archive')}
                  </button>
                </div>
              </div>
            );
          })}

          {adding ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                saveNew();
              }}
              className="animate-scale-in flex flex-col gap-2.5 rounded-2xl border border-accent/40 bg-surface p-4"
            >
              <div className="flex items-center gap-2">
                <input
                  value={newEmoji}
                  onChange={(e) => setNewEmoji(e.target.value)}
                  placeholder="✅"
                  title={t('hab.emoji.title')}
                  className="w-12 rounded-lg border border-border bg-bg py-2 text-center text-lg transition-colors focus:border-accent"
                />
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder={t('hab.new.placeholder')}
                  className="min-w-0 flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text transition-colors placeholder:text-text-faint focus:border-accent"
                />
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-0.5 rounded-lg border border-border bg-bg p-0.5">
                  <button
                    type="button"
                    onClick={() => setNewTarget(Math.max(1, newTarget - 1))}
                    className="h-7 w-7 rounded-md text-text-dim hover:bg-surface-hover hover:text-text"
                  >
                    −
                  </button>
                  <span className="min-w-16 text-center font-mono text-[13px] tabular-nums text-text">
                    {newTarget}x<span className="text-text-faint">{t('hab.perweek')}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setNewTarget(Math.min(7, newTarget + 1))}
                    className="h-7 w-7 rounded-md text-text-dim hover:bg-surface-hover hover:text-text"
                  >
                    +
                  </button>
                </div>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => setAdding(false)}
                    className="rounded-lg px-3 py-1.5 text-xs text-text-faint hover:text-text"
                  >
                    {t('misc.cancel').toLowerCase()}
                  </button>
                  <button
                    type="submit"
                    disabled={!newName.trim()}
                    className="rounded-lg bg-accent px-4 py-1.5 text-xs font-semibold text-bg hover:brightness-110 disabled:opacity-30"
                  >
                    {t('hab.create')}
                  </button>
                </div>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="flex min-h-32 flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-border text-text-faint transition-colors hover:border-border-strong hover:text-text"
            >
              <span className="text-2xl">+</span>
              <span className="text-xs">{t('hab.new')}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useToast } from '../hooks/useToast';
import { parseAppUsage } from '../lib/apps';
import * as db from '../lib/db';
import { dateLocale, t, weekdayShort } from '../lib/i18n';
import { generateWeekCard } from '../lib/sharecard';
import { dateKey, formatDurationShort, localDayKey, todayKey } from '../lib/time';
import type { Break, Session } from '../types';
import { weekStartOf } from './Habits';
import { DayTimeline } from './Timeline';

interface WeekProps {
  onError: (message: string) => void;
  refreshKey: number;
  dailyGoalHours: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function addDays(key: string, n: number): string {
  const d = new Date(key + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return localDayKey(d);
}

export function Week({ onError, refreshKey, dailyGoalHours }: WeekProps) {
  const { pushToast } = useToast();
  const [weekOffset, setWeekOffset] = useState(0);
  const [sharing, setSharing] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [breaks, setBreaks] = useState<Break[]>([]);
  const [historyTotals, setHistoryTotals] = useState<Map<string, number>>(new Map());

  const today = todayKey();
  const currentWeekStart = weekStartOf(today);
  const weekStart = addDays(currentWeekStart, -7 * weekOffset);
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const weekEndExclusive = addDays(weekStart, 7);

  useEffect(() => {
    Promise.all([
      db.listSessions({
        fromIso: new Date(weekStart + 'T00:00:00').toISOString(),
        toIso: new Date(weekEndExclusive + 'T00:00:00').toISOString(),
      }),
      db.listBreaksSince(new Date(weekStart + 'T00:00:00').toISOString()),
      db.getDailyTotals(new Date(Date.now() - 70 * DAY_MS).toISOString()),
    ])
      .then(([s, b, totals]) => {
        setSessions(s);
        setBreaks(b.filter((br) => dateKey(br.started_at) < weekEndExclusive));
        setHistoryTotals(new Map(totals.map((t) => [t.date, t.total_sec])));
      })
      .catch((err) => onError(String(err)));
  }, [weekStart, weekEndExclusive, onError, refreshKey]);

  const daySec = (key: string) =>
    sessions
      .filter((s) => dateKey(s.started_at) === key)
      .reduce((acc, s) => acc + (s.duration_sec ?? 0), 0);

  const weekTotal = weekDays.reduce((acc, d) => acc + daySec(d), 0);

  // average of the 8 previous full weeks (from daily totals history)
  let prevWeeksSum = 0;
  let prevWeeksCount = 0;
  for (let w = 1; w <= 8; w++) {
    const ws = addDays(currentWeekStart, -7 * w);
    let sum = 0;
    let any = false;
    for (let i = 0; i < 7; i++) {
      const sec = historyTotals.get(addDays(ws, i));
      if (sec !== undefined) any = true;
      sum += sec ?? 0;
    }
    if (any) {
      prevWeeksSum += sum;
      prevWeeksCount++;
    }
  }
  const avgWeekSec = prevWeeksCount > 0 ? prevWeeksSum / prevWeeksCount : 0;
  const vsAvgPct =
    avgWeekSec > 0 ? Math.round(((weekTotal - avgWeekSec) / avgWeekSec) * 100) : null;

  // per-weekday average over the previous 8 weeks
  function weekdayAvg(dayIndex: number): number {
    let sum = 0;
    let count = 0;
    for (let w = 1; w <= 8; w++) {
      const key = addDays(addDays(currentWeekStart, -7 * w), dayIndex);
      const sec = historyTotals.get(key);
      if (sec !== undefined && sec > 0) {
        sum += sec;
        count++;
      }
    }
    return count > 0 ? sum / count : 0;
  }

  // apps of the week
  const appTotals = new Map<string, number>();
  for (const s of sessions) {
    for (const a of parseAppUsage(s.app_usage)) {
      appTotals.set(a.name, (appTotals.get(a.name) ?? 0) + a.sec);
    }
  }
  const topApps = [...appTotals.entries()]
    .map(([name, sec]) => ({ name, sec }))
    .sort((a, b) => b.sec - a.sec)
    .slice(0, 5);
  const maxAppSec = Math.max(1, ...topApps.map((a) => a.sec));

  // shared timeline window: 6h → 24h unless data goes earlier
  let windowStartHour = 6;
  for (const s of sessions) {
    const h = new Date(s.started_at).getHours();
    if (h < windowStartHour) windowStartHour = h;
  }

  // per-day extras
  const dayStats = (key: string) => {
    const list = sessions.filter((s) => dateKey(s.started_at) === key);
    const rated = list.filter((s) => s.focus_rating != null);
    return {
      blocks: list.length,
      rating:
        rated.length > 0
          ? rated.reduce((a, s) => a + (s.focus_rating ?? 0), 0) / rated.length
          : null,
    };
  };

  const goalSec = dailyGoalHours * 3600;
  const daysGoalMet = weekDays.filter((d) => daySec(d) >= goalSec).length;
  const pastOrToday = weekDays.filter((d) => d <= today).length;
  let bestDayKey: string | null = null;
  let bestDaySec = 0;
  for (const d of weekDays) {
    const sec = daySec(d);
    if (sec > bestDaySec) {
      bestDaySec = sec;
      bestDayKey = d;
    }
  }
  const weekRated = sessions.filter((s) => s.focus_rating != null);
  const weekAvgRating =
    weekRated.length > 0
      ? weekRated.reduce((a, s) => a + (s.focus_rating ?? 0), 0) / weekRated.length
      : null;

  const axisMarks: number[] = [];
  for (let h = windowStartHour; h <= 24; h += 3) axisMarks.push(h);

  // goal streak (same rule as Stats): consecutive days hitting the goal,
  // today only counts if already hit — capped by the 70d history window
  function goalStreak(): number {
    let streak = 0;
    for (let i = 0; i < 70; i++) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      const sec = historyTotals.get(localDayKey(d)) ?? 0;
      if (i === 0 && sec < goalSec) continue;
      if (sec >= goalSec) streak++;
      else break;
    }
    return streak;
  }

  async function shareCard() {
    setSharing(true);
    try {
      const settings = await db.getAllSettings();
      const blob = await generateWeekCard({
        weekLabel,
        totalSec: weekTotal,
        days: weekDays.map((day, i) => ({
          label: WEEKDAY_NAMES[i],
          sec: daySec(day),
          isToday: day === today,
        })),
        bestDayLabel: bestDayKey ? WEEKDAY_NAMES[weekDays.indexOf(bestDayKey)] : null,
        bestDaySec,
        blocks: sessions.length,
        avgRating: weekAvgRating,
        goalStreakDays: goalStreak(),
        vsAvgPct: weekOffset === 0 ? vsAvgPct : null,
        goalHitDays: daysGoalMet,
        userName: settings.user_name?.trim() ?? '',
      });

      // clipboard first (instant Discord paste), download as the keeper
      let copied = false;
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        copied = true;
      } catch {
        // clipboard image unsupported — the download still happens
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `locked-in-week-${weekStart}.png`;
      a.click();
      URL.revokeObjectURL(url);
      pushToast(copied ? t('card.done.copied') : t('card.done'), 'info');
    } catch (err) {
      onError(String(err));
    } finally {
      setSharing(false);
    }
  }

  const WEEKDAY_NAMES = weekdayShort();
  const weekLabel =
    weekOffset === 0
      ? t('week.this')
      : weekOffset === 1
        ? t('week.last')
        : `${new Date(weekStart + 'T00:00:00').toLocaleDateString(dateLocale(), { day: '2-digit', month: '2-digit' })} – ${new Date(addDays(weekStart, 6) + 'T00:00:00').toLocaleDateString(dateLocale(), { day: '2-digit', month: '2-digit' })}`;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-6 px-4 pb-10 pt-6 sm:px-6 xl:max-w-4xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setWeekOffset(weekOffset + 1)}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-text-dim hover:border-border-strong hover:text-text"
            >
              ‹
            </button>
            <button
              type="button"
              disabled={weekOffset === 0}
              onClick={() => setWeekOffset(Math.max(0, weekOffset - 1))}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-text-dim hover:border-border-strong hover:text-text disabled:opacity-30"
            >
              ›
            </button>
            <h1 className="ml-2 text-lg font-semibold tracking-tight text-text">{weekLabel}</h1>
            <button
              type="button"
              onClick={shareCard}
              disabled={sharing || weekTotal === 0}
              title={t('card.btn.hint')}
              className="ml-1 rounded-full border border-border px-3 py-1 text-xs text-text-dim hover:border-accent/50 hover:bg-accent-dim hover:text-accent disabled:opacity-30"
            >
              {sharing ? '…' : t('card.btn')}
            </button>
          </div>
          <div className="text-right">
            <div className="font-mono text-2xl font-medium tabular-nums text-accent">
              {formatDurationShort(weekTotal)}
            </div>
            {vsAvgPct !== null && weekOffset === 0 && (
              <div
                className={`text-xs ${vsAvgPct >= 0 ? 'text-accent' : 'text-text-dim'}`}
                title={t('week.avgtitle', String(prevWeeksCount), formatDurationShort(avgWeekSec))}
              >
                {t('week.vsavg', `${vsAvgPct >= 0 ? '+' : ''}${vsAvgPct}`)}
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-2xl border border-border bg-surface p-4">
            <div
              className={`font-mono text-xl font-medium tabular-nums ${daysGoalMet > 0 ? 'text-accent' : 'text-text'}`}
            >
              {daysGoalMet}
              <span className="text-xs text-text-faint">/{pastOrToday}</span>
            </div>
            <div className="mt-0.5 text-[11px] text-text-dim">
              {t('week.goaldays', String(dailyGoalHours))}
            </div>
          </div>
          <div className="rounded-2xl border border-border bg-surface p-4">
            <div className="font-mono text-xl font-medium tabular-nums text-text">
              {bestDayKey ? WEEKDAY_NAMES[weekDays.indexOf(bestDayKey)] : '—'}
              {bestDayKey && (
                <span className="ml-1.5 text-xs text-text-faint">
                  {formatDurationShort(bestDaySec)}
                </span>
              )}
            </div>
            <div className="mt-0.5 text-[11px] text-text-dim">{t('week.bestday')}</div>
          </div>
          <div className="rounded-2xl border border-border bg-surface p-4">
            <div className="font-mono text-xl font-medium tabular-nums text-text">
              {weekAvgRating !== null ? `★${weekAvgRating.toFixed(1)}` : '—'}
            </div>
            <div className="mt-0.5 text-[11px] text-text-dim">{t('week.avgfocus')}</div>
          </div>
        </div>

        <div className="space-y-1.5 rounded-2xl border border-border bg-surface p-4">
          <div className="flex items-center gap-3 pb-1">
            <div className="w-9 shrink-0" />
            <div className="relative h-3 min-w-0 flex-1">
              {axisMarks.map((h) => (
                <span
                  key={h}
                  className="absolute -translate-x-1/2 text-[9px] tabular-nums text-text-faint"
                  style={{ left: `${((h - windowStartHour) / (24 - windowStartHour)) * 100}%` }}
                >
                  {h}h
                </span>
              ))}
            </div>
            <div className="w-24 shrink-0" />
          </div>
          {weekDays.map((day, i) => {
            const isFuture = day > today;
            const sec = daySec(day);
            const avg = weekdayAvg(i);
            const vsDay =
              !isFuture && avg > 0 && sec > 0 ? Math.round(((sec - avg) / avg) * 100) : null;
            const dayStart = new Date(day + 'T00:00:00');
            dayStart.setHours(windowStartHour, 0, 0, 0);
            const dayEnd = new Date(day + 'T00:00:00');
            dayEnd.setHours(24, 0, 0, 0);
            return (
              <div key={day} className={`flex items-center gap-3 ${isFuture ? 'opacity-35' : ''}`}>
                <div className="w-9 shrink-0 text-right">
                  <div
                    className={`text-xs ${day === today ? 'font-semibold text-accent' : 'text-text-dim'}`}
                  >
                    {WEEKDAY_NAMES[i]}
                  </div>
                </div>
                <div className="min-w-0 flex-1">
                  <DayTimeline
                    sessions={sessions.filter((s) => dateKey(s.started_at) === day)}
                    breaks={breaks.filter((b) => dateKey(b.started_at) === day)}
                    isToday={day === today}
                    windowStart={dayStart.getTime()}
                    windowEnd={dayEnd.getTime()}
                    compact
                  />
                </div>
                <div className="w-24 shrink-0 text-right">
                  <div>
                    <span
                      className={`font-mono text-xs tabular-nums ${sec >= goalSec ? 'text-accent' : 'text-text'}`}
                    >
                      {sec > 0 ? formatDurationShort(sec) : '—'}
                    </span>
                    {vsDay !== null && Math.abs(vsDay) >= 15 && (
                      <span
                        className={`ml-1 text-[10px] ${vsDay > 0 ? 'text-accent' : 'text-text-faint'}`}
                        title={t('week.dayavgtitle', WEEKDAY_NAMES[i], formatDurationShort(avg))}
                      >
                        {vsDay > 0 ? '↑' : '↓'}
                      </span>
                    )}
                  </div>
                  {(() => {
                    const st = dayStats(day);
                    return st.blocks > 0 ? (
                      <div className="text-[9px] text-text-faint">
                        {st.blocks} {st.blocks === 1 ? t('home.block') : t('home.blocks')}
                        {st.rating !== null && ` · ★${st.rating.toFixed(1)}`}
                      </div>
                    ) : null;
                  })()}
                </div>
              </div>
            );
          })}
        </div>

        {topApps.length > 0 && (
          <section>
            <h2 className="mb-3 text-xs font-medium uppercase tracking-[0.12em] text-text-faint">
              {t('week.apps')}
            </h2>
            <div className="space-y-3 rounded-2xl border border-border bg-surface p-5">
              {topApps.map((a) => (
                <div key={a.name} className="flex items-center gap-3">
                  <div className="w-32 shrink-0 truncate text-[13px] text-text">{a.name}</div>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-bg">
                    <div
                      className="h-full rounded-full bg-accent"
                      style={{
                        width: `${(a.sec / maxAppSec) * 100}%`,
                        transition: 'width 600ms cubic-bezier(0.16,1,0.3,1)',
                      }}
                    />
                  </div>
                  <div className="w-14 shrink-0 text-right font-mono text-xs tabular-nums text-text-dim">
                    {formatDurationShort(a.sec)}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

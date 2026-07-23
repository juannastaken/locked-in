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
const HEATMAP_WEEKS = 53; // full GitHub-style year

function addDays(key: string, n: number): string {
  const d = new Date(key + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return localDayKey(d);
}

function isoDateNDaysAgo(n: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return localDayKey(d);
}

function heatColor(hours: number): string {
  if (hours <= 0) return 'var(--color-surface-2)';
  if (hours < 1) return 'rgba(212, 255, 63, 0.22)';
  if (hours < 2) return 'rgba(212, 255, 63, 0.42)';
  if (hours < 4) return 'rgba(212, 255, 63, 0.68)';
  return 'var(--color-accent)';
}

export function Week({ onError, refreshKey, dailyGoalHours }: WeekProps) {
  const { pushToast } = useToast();
  const [mode, setMode] = useState<'week' | 'month'>('week');
  const [weekOffset, setWeekOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [breaks, setBreaks] = useState<Break[]>([]);
  const [historyTotals, setHistoryTotals] = useState<Map<string, number>>(new Map());
  // click a day row → its blocks expand below the chart
  const [expandedDay, setExpandedDay] = useState<string | null>(null);

  const today = todayKey();
  const currentWeekStart = weekStartOf(today);
  const weekStart = addDays(currentWeekStart, -7 * weekOffset);

  function monthStartKey(offset: number): string {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(1);
    d.setMonth(d.getMonth() - offset);
    return localDayKey(d);
  }

  const rangeStart = mode === 'week' ? weekStart : monthStartKey(weekOffset);
  const rangeDays =
    mode === 'week'
      ? Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
      : (() => {
          const d0 = new Date(rangeStart + 'T00:00:00');
          const n = new Date(d0.getFullYear(), d0.getMonth() + 1, 0).getDate();
          return Array.from({ length: n }, (_, i) => addDays(rangeStart, i));
        })();
  const rangeEndExclusive = addDays(rangeStart, rangeDays.length);
  const weekDays = rangeDays;

  useEffect(() => {
    setLoading(true);
    Promise.all([
      db.listSessions({
        fromIso: new Date(rangeStart + 'T00:00:00').toISOString(),
        toIso: new Date(rangeEndExclusive + 'T00:00:00').toISOString(),
      }),
      db.listBreaksSince(new Date(rangeStart + 'T00:00:00').toISOString()),
      // one year of daily totals: feeds the weekday averages AND the heatmap
      db.getDailyTotals(new Date(Date.now() - HEATMAP_WEEKS * 7 * DAY_MS).toISOString()),
    ])
      .then(([s, b, totals]) => {
        setSessions(s);
        setBreaks(b.filter((br) => dateKey(br.started_at) < rangeEndExclusive));
        setHistoryTotals(new Map(totals.map((t) => [t.date, t.total_sec])));
      })
      .catch((err) => onError(String(err)))
      .finally(() => setLoading(false));
  }, [rangeStart, rangeEndExclusive, onError, refreshKey]);

  const daySec = (key: string) =>
    sessions
      .filter((s) => dateKey(s.started_at) === key)
      .reduce((acc, s) => acc + (s.duration_sec ?? 0), 0);

  const weekTotal = weekDays.reduce((acc, d) => acc + daySec(d), 0);

  // average of the 8 previous full weeks (from daily totals history);
  // month mode compares against the previous month instead
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
  let vsAvgPct: number | null =
    avgWeekSec > 0 ? Math.round(((weekTotal - avgWeekSec) / avgWeekSec) * 100) : null;
  if (mode === 'month') {
    const prevStart = monthStartKey(weekOffset + 1);
    const prevEnd = rangeStart;
    let prevTotal = 0;
    for (const [key, sec] of historyTotals) {
      if (key >= prevStart && key < prevEnd) prevTotal += sec;
    }
    vsAvgPct = prevTotal > 0 ? Math.round(((weekTotal - prevTotal) / prevTotal) * 100) : null;
  }

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
        subtitle: mode === 'week' ? t('card.subtitle') : t('card.subtitle.month'),
        totalSec: weekTotal,
        days: weekDays.map((day, i) => ({
          label:
            mode === 'week'
              ? WEEKDAY_NAMES[i]
              : i === 0 || (i + 1) % 5 === 0
                ? String(i + 1)
                : '',
          sec: daySec(day),
          isToday: day === today,
        })),
        bestDayLabel: bestDayKey
          ? mode === 'week'
            ? WEEKDAY_NAMES[weekDays.indexOf(bestDayKey)]
            : t('month.day', String(parseInt(bestDayKey.slice(8, 10), 10)))
          : null,
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
      a.download = `locked-in-${mode}-${rangeStart}.png`;
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
    mode === 'month'
      ? weekOffset === 0
        ? t('month.this')
        : weekOffset === 1
          ? t('month.last')
          : new Date(rangeStart + 'T00:00:00').toLocaleDateString(dateLocale(), {
              month: 'long',
              year: 'numeric',
            })
      : weekOffset === 0
        ? t('week.this')
        : weekOffset === 1
          ? t('week.last')
          : `${new Date(weekStart + 'T00:00:00').toLocaleDateString(dateLocale(), { day: '2-digit', month: '2-digit' })} – ${new Date(addDays(weekStart, 6) + 'T00:00:00').toLocaleDateString(dateLocale(), { day: '2-digit', month: '2-digit' })}`;

  return (
    <div className="h-full overflow-y-auto">
      <div className="cascade mx-auto max-w-3xl space-y-6 px-4 pb-10 pt-6 sm:px-6 xl:max-w-4xl">
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
            <div className="ml-1 flex items-center gap-0.5 rounded-full border border-border bg-surface p-0.5">
              {(['week', 'month'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setMode(m);
                    setWeekOffset(0);
                  }}
                  className={`rounded-full px-3 py-1 text-xs font-medium ${
                    mode === m ? 'bg-surface-hover text-text shadow-sm' : 'text-text-dim hover:text-text'
                  }`}
                >
                  {t(m === 'week' ? 'range.week' : 'range.month')}
                </button>
              ))}
            </div>
            <h1 className="ml-2 text-lg font-semibold capitalize tracking-tight text-text">
              {weekLabel}
            </h1>
            <button
              type="button"
              onClick={shareCard}
              disabled={sharing || weekTotal === 0}
              title={t('card.btn.hint')}
              className="ml-2 flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-[13px] font-bold text-bg shadow-lg shadow-accent/20 hover:brightness-110 disabled:opacity-30 disabled:shadow-none"
            >
              {sharing ? '…' : t('card.btn')}
            </button>
          </div>
          <div className="text-right">
            <div className="flex items-baseline justify-end gap-2.5">
              {weekAvgRating !== null && (
                <span
                  className="font-mono text-sm font-medium tabular-nums text-text-dim"
                  title={t('week.avgfocus')}
                >
                  ★{weekAvgRating.toFixed(1)}
                </span>
              )}
              <span className="font-mono text-2xl font-medium tabular-nums text-accent">
                {formatDurationShort(weekTotal)}
              </span>
            </div>
            {/* always render this line (empty when there's nothing to compare)
                so the header height is identical in Week and Month — otherwise
                it shrinks and the whole page jumps up when switching modes */}
            <div
              className={`h-4 text-xs ${vsAvgPct !== null && vsAvgPct >= 0 ? 'text-accent' : 'text-text-dim'}`}
              title={
                vsAvgPct !== null
                  ? t('week.avgtitle', String(prevWeeksCount), formatDurationShort(avgWeekSec))
                  : undefined
              }
            >
              {vsAvgPct !== null && weekOffset === 0
                ? t('week.vsavg', `${vsAvgPct >= 0 ? '+' : ''}${vsAvgPct}`)
                : ' '}
            </div>
          </div>
        </div>

        {/* fixed-height stage: week rows, month bars and the loading skeleton all
            share the exact same box, so switching modes never shifts the page */}
        <div className="h-[300px]">
        {loading && (
          <div className="flex h-full flex-col items-center justify-center gap-3 rounded-2xl border border-border bg-surface">
            <div className="flex gap-1.5">
              <span className="animate-pulse-dot h-2.5 w-2.5 bg-accent" />
              <span className="animate-pulse-dot h-2.5 w-2.5 bg-accent" style={{ animationDelay: '0.2s' }} />
              <span className="animate-pulse-dot h-2.5 w-2.5 bg-accent" style={{ animationDelay: '0.4s' }} />
            </div>
          </div>
        )}
        {!loading && mode === 'month' && (
          <div className="flex h-full flex-col rounded-2xl border border-border bg-surface p-4">
            <div className="flex min-h-0 flex-1 items-end gap-[3px]">
              {rangeDays.map((day) => {
                const sec = daySec(day);
                const max = Math.max(1, ...rangeDays.map((d) => daySec(d)));
                const future = day > today;
                return (
                  <div
                    key={day}
                    title={`${new Date(day + 'T00:00:00').toLocaleDateString(dateLocale())} · ${sec > 0 ? formatDurationShort(sec) : '0'}`}
                    className={`min-w-0 flex-1 rounded-t-[4px] ${
                      day === today
                        ? 'bg-accent'
                        : sec > 0
                          ? 'bg-accent/70'
                          : future
                            ? 'bg-transparent'
                            : 'bg-surface-2'
                    }`}
                    style={{ height: `${Math.max(sec > 0 ? 6 : 2, (sec / max) * 100)}%` }}
                  />
                );
              })}
            </div>
            <div className="mt-1.5 flex gap-[3px]">
              {rangeDays.map((day, i) => (
                <div
                  key={day}
                  className={`min-w-0 flex-1 text-center text-[9px] tabular-nums ${
                    day === today ? 'font-semibold text-accent' : 'text-text-faint'
                  }`}
                >
                  {i === 0 || (i + 1) % 5 === 0 ? i + 1 : ''}
                </div>
              ))}
            </div>
          </div>
        )}

        {!loading && mode === 'week' && (
        <div className="h-full space-y-1.5 overflow-hidden rounded-2xl border border-border bg-surface p-4">
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
            const expanded = expandedDay === day;
            return (
              <div
                key={day}
                role="button"
                tabIndex={0}
                onClick={() => !isFuture && setExpandedDay(expanded ? null : day)}
                onKeyDown={(e) =>
                  e.key === 'Enter' && !isFuture && setExpandedDay(expanded ? null : day)
                }
                title={undefined}
                className={`-mx-1.5 flex cursor-pointer items-center gap-3 rounded-lg px-1.5 py-px transition-colors ${
                  isFuture ? 'cursor-default opacity-35' : expanded ? 'bg-surface-hover' : 'hover:bg-surface-hover/60'
                }`}
              >
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
        )}
        </div>

        {/* clicked day → its blocks, right under the chart */}
        {expandedDay && mode === 'week' && (
          <section className="animate-fade-up">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-xs font-medium uppercase tracking-[0.12em] text-text-faint">
                {new Date(expandedDay + 'T00:00:00').toLocaleDateString(dateLocale(), {
                  weekday: 'long',
                  day: '2-digit',
                  month: '2-digit',
                })}
              </h2>
              <button
                type="button"
                onClick={() => setExpandedDay(null)}
                className="text-xs font-semibold text-text-faint hover:text-text"
              >
                ✕
              </button>
            </div>
            <div className="cascade space-y-1.5">
              {sessions
                .filter((s) => dateKey(s.started_at) === expandedDay)
                .map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3"
                  >
                    <span className="w-24 shrink-0 font-mono text-xs tabular-nums text-text-faint">
                      {new Date(s.started_at).toLocaleTimeString(dateLocale(), {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                      {s.ended_at &&
                        ` – ${new Date(s.ended_at).toLocaleTimeString(dateLocale(), {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}`}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-text">
                      {s.task}
                      {s.project && (
                        <span className="ml-1.5 font-medium text-text-faint">· {s.project}</span>
                      )}
                    </span>
                    {s.focus_rating != null && (
                      <span className="shrink-0 text-xs text-text-dim">★{s.focus_rating}</span>
                    )}
                    <span className="w-14 shrink-0 text-right font-mono text-xs font-semibold tabular-nums text-text">
                      {s.duration_sec ? formatDurationShort(s.duration_sec) : '—'}
                    </span>
                  </div>
                ))}
              {sessions.filter((s) => dateKey(s.started_at) === expandedDay).length === 0 && (
                <div className="rounded-2xl border border-border bg-surface px-4 py-3 text-center text-xs text-text-faint">
                  {t('ov.none')}
                </div>
              )}
            </div>
          </section>
        )}

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

        {/* GitHub-style year heatmap (merged in from the old Stats tab) */}
        <section>
          <h2 className="mb-3 text-xs font-medium uppercase tracking-[0.12em] text-text-faint">
            {t('stats.6months')}
          </h2>
          <div className="rounded-2xl border border-border bg-surface p-4">
            {(() => {
              const wd = WEEKDAY_NAMES;
              const WEEKDAY_LABELS = ['', wd[0], '', wd[2], '', wd[4], ''];
              const totalDays = HEATMAP_WEEKS * 7;
              const days: { date: string; hours: number }[] = [];
              for (let i = totalDays - 1; i >= 0; i--) {
                const key = isoDateNDaysAgo(i);
                days.push({ date: key, hours: (historyTotals.get(key) ?? 0) / 3600 });
              }
              const padStart = new Date(days[0].date + 'T00:00:00').getDay();
              const cells: ({ date: string; hours: number } | null)[] = [
                ...Array.from({ length: padStart }, () => null),
                ...days,
              ];
              while (cells.length % 7 !== 0) cells.push(null);
              const weekCols: (typeof cells)[] = [];
              for (let i = 0; i < cells.length; i += 7) {
                weekCols.push(cells.slice(i, i + 7));
              }
              return (
                <>
                  <div className="flex gap-[3px] overflow-x-auto pb-1">
                    <div className="mr-1 flex shrink-0 flex-col gap-[3px]">
                      {WEEKDAY_LABELS.map((label, i) => (
                        <span
                          key={i}
                          className="flex h-[13px] w-6 items-center text-[9px] leading-none text-text-faint"
                        >
                          {label}
                        </span>
                      ))}
                    </div>
                    {weekCols.map((week, wi) => (
                      <div key={wi} className="flex shrink-0 flex-col gap-[3px]">
                        {week.map((cell, di) =>
                          cell ? (
                            <div
                              key={cell.date}
                              title={`${new Date(cell.date + 'T00:00:00').toLocaleDateString(dateLocale())} · ${cell.hours.toFixed(1)}h`}
                              className={`h-[13px] w-[13px] rounded-[3px] ${
                                cell.date === today ? 'ring-1 ring-text-dim' : ''
                              }`}
                              style={{ backgroundColor: heatColor(cell.hours) }}
                            />
                          ) : (
                            <div key={`pad-${wi}-${di}`} className="h-[13px] w-[13px]" />
                          ),
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 flex items-center justify-end gap-1.5 text-[10px] text-text-faint">
                    <span>{t('stats.less')}</span>
                    {[0, 0.5, 1.5, 3, 5].map((h) => (
                      <span
                        key={h}
                        className="h-[10px] w-[10px] rounded-[2px]"
                        style={{ backgroundColor: heatColor(h) }}
                      />
                    ))}
                    <span>{t('stats.more')}</span>
                  </div>
                </>
              );
            })()}
          </div>
        </section>
      </div>
    </div>
  );
}

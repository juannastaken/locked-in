import { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { parseAppUsage } from '../lib/apps';
import * as db from '../lib/db';
import { computeInsight } from '../lib/insights';
import type { Insight } from '../lib/insights';
import { computeDayScore } from '../lib/score';
import type { DayScore } from '../lib/score';
import { dateLocale, getLang, t, weekdayShort } from '../lib/i18n';
import { Mascot } from './Mascot';
import { formatDurationShort, localDayKey, todayKey } from '../lib/time';
import type { ProjectBreakdown, Session, Settings } from '../types';

interface StatsProps {
  settings: Settings | null;
  onError: (message: string) => void;
  refreshKey: number;
}

const HEATMAP_WEEKS = 53; // full GitHub-style year
const DAY_MS = 24 * 60 * 60 * 1000;

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

export function Stats({ settings, onError, refreshKey }: StatsProps) {
  // heatmap rows are sun..sat; label mon/wed/fri
  const wd = weekdayShort();
  const WEEKDAY_LABELS = ['', wd[0], '', wd[2], '', wd[4], ''];
  const [daily, setDaily] = useState<{ date: string; total_sec: number }[]>([]);
  const [projects, setProjects] = useState<ProjectBreakdown[]>([]);
  const [avgOverrun, setAvgOverrun] = useState(0);
  const [sessions, setSessions] = useState<Session[]>([]);

  // loaded flags keep the slots rendered (fixed height) from the very first
  // paint — the cards fill in without shoving the page around
  const [insight, setInsight] = useState<Insight | null>(null);
  const [insightLoaded, setInsightLoaded] = useState(false);
  useEffect(() => {
    computeInsight(settings?.daily_goal_hours ?? 4)
      .then(setInsight)
      .catch(() => setInsight(null))
      .finally(() => setInsightLoaded(true));
  }, [refreshKey, settings?.daily_goal_hours]);

  const [dayScore, setDayScore] = useState<DayScore | null>(null);
  const [scoreLoaded, setScoreLoaded] = useState(false);
  useEffect(() => {
    computeDayScore(todayKey(), settings?.daily_goal_hours ?? 4, settings?.nudge_apps ?? '')
      .then(setDayScore)
      .catch(() => setDayScore(null))
      .finally(() => setScoreLoaded(true));
  }, [refreshKey, settings?.daily_goal_hours, settings?.nudge_apps]);

  useEffect(() => {
    const sinceIso = new Date(Date.now() - HEATMAP_WEEKS * 7 * DAY_MS).toISOString();
    Promise.all([
      db.getDailyTotals(sinceIso),
      db.getProjectBreakdown(sinceIso),
      db.getAverageBreakOverrunSec(),
      db.listSessions({ fromIso: sinceIso, limit: 1000 }),
    ])
      .then(([d, p, o, s]) => {
        setDaily(d);
        setProjects(p);
        setAvgOverrun(o);
        setSessions(s);
      })
      .catch((err) => onError(String(err)));
  }, [onError, refreshKey]);

  const totalsByDate = new Map(daily.map((d) => [d.date, d.total_sec]));
  const dailyGoalHours = settings?.daily_goal_hours ?? 4;
  const today = todayKey();

  // streak: consecutive days hitting the goal (today only counts if already hit)
  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const key = isoDateNDaysAgo(i);
    const sec = totalsByDate.get(key) ?? 0;
    if (i === 0 && sec / 3600 < dailyGoalHours) continue;
    if (sec / 3600 >= dailyGoalHours) streak++;
    else break;
  }

  const todaySec = totalsByDate.get(today) ?? 0;
  const weekSec = Array.from({ length: 7 }, (_, i) =>
    totalsByDate.get(isoDateNDaysAgo(i)),
  ).reduce<number>((acc, v) => acc + (v ?? 0), 0);

  // heatmap: columns = weeks, rows = weekday (dom..sab), aligned
  const totalDays = HEATMAP_WEEKS * 7;
  const days: { date: string; hours: number }[] = [];
  for (let i = totalDays - 1; i >= 0; i--) {
    const key = isoDateNDaysAgo(i);
    days.push({ date: key, hours: (totalsByDate.get(key) ?? 0) / 3600 });
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

  const barData = Array.from({ length: 7 }, (_, i) => {
    const key = isoDateNDaysAgo(6 - i);
    const sec = totalsByDate.get(key) ?? 0;
    return {
      day: new Date(key + 'T00:00:00').toLocaleDateString(dateLocale(), { weekday: 'short' }),
      horas: Math.round((sec / 3600) * 100) / 100,
    };
  });

  const maxProjectSec = Math.max(1, ...projects.map((p) => p.total_sec));

  // distraction profile: avg rating of blocks where each app was present (>=10% share)
  const distraction = (() => {
    const byApp = new Map<string, { ratings: number[]; blocks: number }>();
    for (const s of sessions) {
      if (s.focus_rating == null) continue;
      const apps = parseAppUsage(s.app_usage);
      const total = apps.reduce((acc, a) => acc + a.sec, 0);
      if (total === 0) continue;
      for (const a of apps) {
        if (a.sec / total < 0.1) continue;
        const entry = byApp.get(a.name) ?? { ratings: [], blocks: 0 };
        entry.ratings.push(s.focus_rating);
        entry.blocks++;
        byApp.set(a.name, entry);
      }
    }
    return [...byApp.entries()]
      .filter(([, v]) => v.blocks >= 3)
      .map(([name, v]) => ({
        name,
        avgRating: v.ratings.reduce((a, b) => a + b, 0) / v.ratings.length,
        blocks: v.blocks,
      }))
      .sort((a, b) => a.avgRating - b.avgRating)
      .slice(0, 6);
  })();

  // best hour per project: distribute session durations across hour buckets
  const bestHours = (() => {
    const buckets = new Map<string, number[]>();
    for (const s of sessions) {
      if (!s.ended_at || !s.duration_sec) continue;
      const project = s.project ?? 'Sem projeto';
      const arr = buckets.get(project) ?? Array.from({ length: 24 }, () => 0);
      let cur = new Date(s.started_at).getTime();
      const end = new Date(s.ended_at).getTime();
      while (cur < end) {
        const d = new Date(cur);
        const hourEnd = new Date(d);
        hourEnd.setMinutes(60, 0, 0);
        const sliceEnd = Math.min(hourEnd.getTime(), end);
        arr[d.getHours()] += (sliceEnd - cur) / 1000;
        cur = sliceEnd;
      }
      buckets.set(project, arr);
    }
    const topProjects = projects
      .filter((p) => p.project !== 'Sem projeto')
      .slice(0, 5)
      .map((p) => p.project);
    return topProjects
      .map((project) => {
        const arr = buckets.get(project);
        if (!arr) return null;
        // best contiguous 2h window
        let bestStart = 0;
        let bestSum = -1;
        for (let h = 0; h < 23; h++) {
          const sum = arr[h] + arr[h + 1];
          if (sum > bestSum) {
            bestSum = sum;
            bestStart = h;
          }
        }
        const total = arr.reduce((a, b) => a + b, 0);
        if (total < 3600) return null; // need at least 1h of data
        return { project, from: bestStart, to: bestStart + 2, share: bestSum / total };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  })();

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-8 px-4 pb-10 pt-6 sm:px-6 xl:max-w-4xl">
        {(!insightLoaded || insight) && (
          <div className="flex min-h-[58px] items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3">
            {insight ? (
              <>
                <div className="shrink-0">
                  <Mascot mood={insight.mood} size={34} />
                </div>
                <p className="min-w-0 flex-1 text-[13px] leading-relaxed">
                  <span className="font-bold text-text">
                    {getLang() === 'en' ? insight.headlineEn : insight.headlinePt}
                  </span>
                  <span className="text-text-dim">
                    {' — '}
                    {getLang() === 'en' ? insight.tipEn : insight.tipPt}
                  </span>
                </p>
              </>
            ) : (
              <>
                <span className="skeleton h-9 w-9 shrink-0 !rounded-full">.</span>
                <span className="skeleton h-4 w-3/4">.</span>
              </>
            )}
          </div>
        )}

        {(!scoreLoaded || dayScore) && (
          <div className="flex min-h-[96px] items-center gap-4 rounded-2xl border border-border bg-surface p-4">
            {dayScore ? (
              <>
                <div
                  className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border-4 font-mono text-xl font-bold tabular-nums ${
                    dayScore.score >= 70
                      ? 'border-accent text-accent'
                      : dayScore.score >= 40
                        ? 'border-warn text-warn'
                        : 'border-border-strong text-text-dim'
                  }`}
                >
                  {dayScore.score}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-bold text-text">{t('score.title')}</div>
                  <div className="mt-0.5 text-xs leading-relaxed text-text-dim">
                    {t(
                      'score.parts',
                      String(dayScore.goalPart),
                      String(dayScore.purityPart),
                      String(dayScore.ratingPart),
                    )}
                  </div>
                </div>
              </>
            ) : (
              <>
                <span className="skeleton h-16 w-16 shrink-0 !rounded-2xl">.</span>
                <span className="skeleton h-4 w-1/2">.</span>
              </>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            value={formatDurationShort(todaySec)}
            label={t('stats.today')}
            accent={todaySec > 0}
          />
          <StatCard value={formatDurationShort(weekSec)} label={t('stats.7days')} />
          <StatCard
            value={String(streak)}
            label={streak === 1 ? t('stats.goalstreak.one') : t('stats.goalstreak.many')}
            accent={streak > 0}
          />
          <StatCard
            value={avgOverrun > 0 ? `+${formatDurationShort(avgOverrun)}` : '—'}
            label={t('stats.overrun')}
          />
        </div>

        <section>
          <h2 className="mb-3 text-xs font-medium uppercase tracking-[0.12em] text-text-faint">
            {t('stats.6months')}
          </h2>
          <div className="rounded-2xl border border-border bg-surface p-4">
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
                        className={`h-[13px] w-[13px] rounded-[3px] transition-transform ${
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
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-xs font-medium uppercase tracking-[0.12em] text-text-faint">
            {t('stats.hoursperday')}
          </h2>
          <div className="h-52 rounded-2xl border border-border bg-surface p-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barData} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--color-border)"
                  vertical={false}
                />
                <XAxis
                  dataKey="day"
                  stroke="var(--color-text-faint)"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  stroke="var(--color-text-faint)"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                  contentStyle={{
                    background: 'var(--color-bg)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 10,
                    fontSize: 12,
                    color: 'var(--color-text)',
                  }}
                  formatter={(value) => [`${value}h`, t('stats.focus')]}
                />
                <Bar
                  dataKey="horas"
                  fill="var(--color-accent)"
                  radius={[5, 5, 0, 0]}
                  animationDuration={600}
                  animationEasing="ease-out"
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        {bestHours.length > 0 && (
          <section>
            <h2 className="mb-3 text-xs font-medium uppercase tracking-[0.12em] text-text-faint">
              {t('stats.besthour')}
            </h2>
            <div className="space-y-2.5 rounded-2xl border border-border bg-surface p-5">
              {bestHours.map((b) => (
                <div key={b.project} className="flex items-center justify-between gap-3">
                  <span className="truncate text-[13px] text-text">{b.project}</span>
                  <span className="shrink-0 font-mono text-xs tabular-nums text-accent">
                    {String(b.from).padStart(2, '0')}h–{String(b.to).padStart(2, '0')}h
                    <span className="ml-1.5 text-text-faint">
                      {t('stats.focusshare', String(Math.round(b.share * 100)))}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {distraction.length > 0 && (
          <section>
            <h2 className="mb-3 text-xs font-medium uppercase tracking-[0.12em] text-text-faint">
              {t('stats.distraction')}
            </h2>
            <div className="space-y-2.5 rounded-2xl border border-border bg-surface p-5">
              <div className="mb-1 text-xs text-text-faint">{t('stats.distraction.hint')}</div>
              {distraction.map((d) => (
                <div key={d.name} className="flex items-center justify-between gap-3">
                  <span className="truncate text-[13px] text-text">{d.name}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="flex items-center gap-[3px]">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <span
                          key={n}
                          className={`h-[5px] w-[5px] rounded-full ${
                            n <= Math.round(d.avgRating)
                              ? d.avgRating < 3
                                ? 'bg-warn'
                                : 'bg-accent'
                              : 'bg-border-strong'
                          }`}
                        />
                      ))}
                    </span>
                    <span className="font-mono text-xs tabular-nums text-text-dim">
                      {d.avgRating.toFixed(1)}
                    </span>
                    <span className="text-[10px] text-text-faint">
                      {t('stats.blocks', String(d.blocks))}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        <section>
          <h2 className="mb-3 text-xs font-medium uppercase tracking-[0.12em] text-text-faint">
            {t('stats.byproject')}
          </h2>
          <div className="space-y-3 rounded-2xl border border-border bg-surface p-5">
            {projects.length === 0 && (
              <div className="py-2 text-center text-sm text-text-faint">{t('stats.nodata')}</div>
            )}
            {projects.map((p) => (
              <div key={p.project} className="flex items-center gap-3">
                <div className="w-32 shrink-0 truncate text-[13px] text-text">
                  {p.project === 'Sem projeto' ? t('misc.noproject') : p.project}
                </div>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-bg">
                  <div
                    className="h-full rounded-full bg-accent"
                    style={{
                      width: `${(p.total_sec / maxProjectSec) * 100}%`,
                      transition: 'width 600ms cubic-bezier(0.16,1,0.3,1)',
                    }}
                  />
                </div>
                <div className="w-14 shrink-0 text-right font-mono text-xs tabular-nums text-text-dim">
                  {formatDurationShort(p.total_sec)}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function StatCard({ value, label, accent }: { value: string; label: string; accent?: boolean }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4 transition-colors hover:border-border-strong">
      <div
        className={`font-mono text-[26px] font-medium leading-tight tabular-nums ${
          accent ? 'text-accent' : 'text-text'
        }`}
      >
        {value}
      </div>
      <div className="mt-1 text-xs text-text-dim">{label}</div>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { parseAppUsage } from '../lib/apps';
import * as db from '../lib/db';
import { dateLocale, t } from '../lib/i18n';
import { dateKey, formatDurationShort, localDayKey, todayKey } from '../lib/time';
import type { Break, Session } from '../types';
import { DayTimeline } from './Timeline';

interface LogProps {
  onError: (message: string) => void;
  refreshKey: number;
}

interface DayGroup {
  date: string;
  label: string;
  sessions: Session[];
}

function jamMembers(s: Session): string[] {
  if (!s.jam_members) return [];
  try {
    const arr = JSON.parse(s.jam_members) as unknown;
    return Array.isArray(arr) ? arr.filter((m): m is string => typeof m === 'string') : [];
  } catch {
    return [];
  }
}

function yesterdayKey(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return localDayKey(d);
}

function dayLabel(date: string, today: string, yesterday: string): string {
  if (date === today) return t('log.today');
  if (date === yesterday) return t('log.yesterday');
  return new Date(date + 'T00:00:00').toLocaleDateString(dateLocale(), {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
  });
}

function daySummaryLine(sessions: Session[]): string {
  const totalSec = sessions.reduce((acc, s) => acc + (s.duration_sec ?? 0), 0);
  const byProject = new Map<string, number>();
  let best = sessions[0];
  for (const s of sessions) {
    const key = s.project ?? t('misc.noproject');
    byProject.set(key, (byProject.get(key) ?? 0) + (s.duration_sec ?? 0));
    if ((s.duration_sec ?? 0) > (best.duration_sec ?? 0)) best = s;
  }
  let topProject: string | null = null;
  let topSec = -1;
  for (const [proj, sec] of byProject) {
    if (sec > topSec) {
      topProject = proj;
      topSec = sec;
    }
  }
  const blocksWord = sessions.length === 1 ? t('home.block') : t('home.blocks');
  const parts = [t('log.in', formatDurationShort(totalSec), `${sessions.length} ${blocksWord}`)];
  if (topProject && topProject !== t('misc.noproject')) parts.push(t('log.main', topProject));
  if (best && sessions.length > 1)
    parts.push(t('log.best', formatDurationShort(best.duration_sec ?? 0)));
  return parts.join(' · ');
}

function startTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' });
}

function RatingDots({ rating }: { rating: number }) {
  return (
    <span className="flex items-center gap-[3px]" title={t('log.focus5', String(rating))}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          className={`h-[5px] w-[5px] rounded-full ${n <= rating ? 'bg-accent' : 'bg-border-strong'}`}
        />
      ))}
    </span>
  );
}

function ratingColor(rating: number | null): string {
  if (rating == null) return 'var(--color-border-strong)';
  if (rating <= 2) return 'var(--color-danger)';
  if (rating === 3) return 'var(--color-warn)';
  return 'var(--color-accent)';
}

function AppMirror({ session, expanded }: { session: Session; expanded?: boolean }) {
  const apps = parseAppUsage(session.app_usage);
  if (apps.length === 0) return null;
  const total = apps.reduce((acc, a) => acc + a.sec, 0);
  if (total === 0) return null;

  if (expanded) {
    const max = Math.max(1, ...apps.map((a) => a.sec));
    return (
      <div className="space-y-1.5">
        {apps.map((a) => (
          <div key={a.name} className="flex items-center gap-2.5">
            <span className="w-28 shrink-0 truncate text-[11px] text-text">{a.name}</span>
            <div className="h-[5px] flex-1 overflow-hidden rounded-full bg-bg">
              <div
                className="h-full rounded-full bg-accent/80"
                style={{ width: `${(a.sec / max) * 100}%` }}
              />
            </div>
            <span className="w-16 shrink-0 text-right font-mono text-[10px] tabular-nums text-text-dim">
              {formatDurationShort(a.sec)} · {Math.round((a.sec / total) * 100)}%
            </span>
          </div>
        ))}
      </div>
    );
  }

  const top = apps.slice(0, 3);
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
      <div className="flex h-[5px] w-24 overflow-hidden rounded-full bg-bg">
        {top.map((a, i) => (
          <div
            key={a.name}
            title={`${a.name} · ${Math.round((a.sec / total) * 100)}%`}
            className="h-full"
            style={{
              width: `${(a.sec / total) * 100}%`,
              backgroundColor: `color-mix(in srgb, var(--color-accent) ${100 - i * 35}%, transparent)`,
            }}
          />
        ))}
      </div>
      <span className="text-[11px] text-text-faint">
        {top.map((a) => `${a.name} ${Math.round((a.sec / total) * 100)}%`).join(' · ')}
      </span>
      {session.afk_sec > 0 && (
        <span
          className="text-[11px] text-warn/70"
          title={t('log.afkdiscount', formatDurationShort(session.afk_sec))}
        >
          −{formatDurationShort(session.afk_sec)} afk
        </span>
      )}
    </div>
  );
}


export function Log({ onError, refreshKey }: LogProps) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [breaks, setBreaks] = useState<Break[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTask, setEditTask] = useState('');
  const [editProject, setEditProject] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const confirmTimer = useRef<number | null>(null);

  useEffect(() => {
    db.listSessions({ limit: 200 })
      .then((rows) => {
        setSessions(rows);
        if (rows.length > 0) {
          const oldest = rows[rows.length - 1].started_at.slice(0, 10) + 'T00:00:00';
          return db.listBreaksSince(oldest).then(setBreaks);
        }
        setBreaks([]);
      })
      .catch((err) => onError(String(err)));
  }, [onError, refreshKey]);

  useEffect(() => {
    return () => {
      if (confirmTimer.current) window.clearTimeout(confirmTimer.current);
    };
  }, []);

  const today = todayKey();
  const yesterday = yesterdayKey();
  const groups: DayGroup[] = [];
  for (const s of sessions) {
    const key = dateKey(s.started_at);
    let group = groups.find((g) => g.date === key);
    if (!group) {
      group = { date: key, label: dayLabel(key, today, yesterday), sessions: [] };
      groups.push(group);
    }
    group.sessions.push(s);
  }

  function startEdit(s: Session) {
    setEditingId(s.id);
    setEditTask(s.task);
    setEditProject(s.project ?? '');
    setEditNotes(s.notes ?? '');
  }

  async function saveEdit(id: number) {
    try {
      await db.updateSession(id, {
        task: editTask.trim(),
        project: editProject.trim() || null,
        notes: editNotes.trim() || null,
      });
      setSessions((prev) =>
        prev.map((s) =>
          s.id === id
            ? {
                ...s,
                task: editTask.trim(),
                project: editProject.trim() || null,
                notes: editNotes.trim() || null,
              }
            : s,
        ),
      );
      setEditingId(null);
    } catch (err) {
      onError(String(err));
    }
  }

  function requestDelete(id: number) {
    if (confirmingId === id) {
      if (confirmTimer.current) window.clearTimeout(confirmTimer.current);
      setConfirmingId(null);
      db.deleteSession(id)
        .then(() => setSessions((prev) => prev.filter((s) => s.id !== id)))
        .catch((err) => onError(String(err)));
      return;
    }
    setConfirmingId(id);
    if (confirmTimer.current) window.clearTimeout(confirmTimer.current);
    confirmTimer.current = window.setTimeout(() => setConfirmingId(null), 3000);
  }

  if (sessions.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1.5">
        <span className="text-sm text-text-dim">{t('log.empty')}</span>
        <span className="text-xs text-text-faint">{t('log.empty.sub')}</span>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl space-y-7 px-4 pb-10 pt-4 sm:px-6 xl:max-w-3xl">
        {groups.map((group) => (
          <section key={group.date}>
            <div className="sticky top-0 z-10 -mx-2 bg-bg/90 px-2 py-2.5 backdrop-blur">
              <div className="flex items-baseline justify-between">
                <h2 className="text-[15px] font-semibold capitalize tracking-tight text-text">
                  {group.label}
                </h2>
                <span className="text-xs text-text-faint">{daySummaryLine(group.sessions)}</span>
              </div>
              {(() => {
                const rated = group.sessions.filter((s) => s.focus_rating != null);
                const avgR =
                  rated.length > 0
                    ? rated.reduce((a, s) => a + (s.focus_rating ?? 0), 0) / rated.length
                    : null;
                const afkTotal = group.sessions.reduce((a, s) => a + (s.afk_sec ?? 0), 0);
                if (avgR === null && afkTotal === 0) return null;
                return (
                  <div className="mt-1 flex gap-1.5">
                    {avgR !== null && (
                      <span
                        className="rounded-full border border-border px-2 py-px text-[10px]"
                        style={{ color: ratingColor(Math.round(avgR)) }}
                      >
                        {t('log.focusavg', avgR.toFixed(1))}
                      </span>
                    )}
                    {afkTotal > 0 && (
                      <span className="rounded-full border border-border px-2 py-px text-[10px] text-warn/80">
                        {t('log.afkdiscount', formatDurationShort(afkTotal))}
                      </span>
                    )}
                  </div>
                );
              })()}
            </div>

            <DayTimeline
              sessions={[...group.sessions].reverse()}
              breaks={breaks.filter((b) => dateKey(b.started_at) === group.date)}
              isToday={group.date === today}
            />

            <div className="space-y-1.5">
              {group.sessions.map((s) => (
                <div
                  key={s.id}
                  className={`group rounded-xl border bg-surface p-4 ${
                    editingId === s.id
                      ? 'border-border-strong'
                      : 'border-border hover:border-border-strong'
                  }`}
                >
                  {editingId === s.id ? (
                    <div className="space-y-2">
                      <input
                        autoFocus
                        value={editTask}
                        onChange={(e) => setEditTask(e.target.value)}
                        className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text focus:border-accent focus:outline-none"
                      />
                      <input
                        value={editProject}
                        onChange={(e) => setEditProject(e.target.value)}
                        placeholder={t('log.project')}
                        className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-text-faint focus:border-accent focus:outline-none"
                      />
                      <textarea
                        value={editNotes}
                        onChange={(e) => setEditNotes(e.target.value)}
                        placeholder={t('log.notes')}
                        className="h-16 w-full resize-none rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-text-faint focus:border-accent focus:outline-none"
                      />
                      <div className="flex gap-2 pt-0.5">
                        <button
                          type="button"
                          onClick={() => saveEdit(s.id)}
                          className="rounded-lg bg-accent px-4 py-1.5 text-[13px] font-semibold text-bg hover:brightness-110"
                        >
                          {t('misc.save')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="rounded-lg border border-border px-4 py-1.5 text-[13px] text-text-dim hover:bg-surface-hover hover:text-text"
                        >
                          {t('misc.cancel')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-stretch gap-3">
                      <div
                        className="w-1 shrink-0 self-stretch rounded-full"
                        style={{ backgroundColor: ratingColor(s.focus_rating) }}
                        title={
                          s.focus_rating
                            ? t('log.focus5', String(s.focus_rating))
                            : t('log.norating')
                        }
                      />
                      <div className="min-w-0 flex-1">
                        <button
                          type="button"
                          onClick={() => setExpandedId(expandedId === s.id ? null : s.id)}
                          className="block w-full text-left"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-2.5">
                              <span className="truncate text-[15px] text-text">{s.task}</span>
                              {s.project && (
                                <span className="shrink-0 rounded-full border border-border px-2 py-px text-[11px] text-text-dim">
                                  {s.project}
                                </span>
                              )}
                              {jamMembers(s).length > 0 && (
                                <span
                                  className="shrink-0 rounded-full border border-accent/50 bg-accent-dim px-2 py-px text-[11px] font-bold text-accent"
                                  title={jamMembers(s)
                                    .map((m) => `@${m}`)
                                    .join(', ')}
                                >
                                  🎧 {jamMembers(s).map((m) => `@${m}`).join(' ')}
                                </span>
                              )}
                            </div>
                            <div className="flex shrink-0 items-center gap-2.5">
                              <span className="font-mono text-sm font-medium tabular-nums text-text">
                                {formatDurationShort(s.duration_sec ?? 0)}
                              </span>
                              <span
                                className={`text-[10px] text-text-faint transition-transform ${
                                  expandedId === s.id ? 'rotate-90' : ''
                                }`}
                              >
                                ▸
                              </span>
                            </div>
                          </div>
                          <div className="mt-1 flex items-center gap-3 text-xs text-text-faint">
                            <span className="font-mono tabular-nums">
                              {startTime(s.started_at)}
                              {s.ended_at && ` – ${startTime(s.ended_at)}`}
                            </span>
                            {s.focus_rating != null && <RatingDots rating={s.focus_rating} />}
                            {s.afk_sec > 0 && (
                              <span className="text-warn/70">
                                −{formatDurationShort(s.afk_sec)} afk
                              </span>
                            )}
                            {(s.paused_sec ?? 0) > 0 && (
                              <span className="text-text-faint">
                                {t('log.paused', formatDurationShort(s.paused_sec))}
                              </span>
                            )}
                          </div>
                          {expandedId !== s.id && <AppMirror session={s} />}
                        </button>

                        {expandedId === s.id && (
                          <div className="animate-fade-in mt-3 space-y-3 border-t border-border pt-3">
                            <AppMirror session={s} expanded />
                            {s.notes && (
                              <div className="rounded-lg bg-surface-2 px-3 py-2 text-xs leading-relaxed text-text-dim">
                                {s.notes}
                              </div>
                            )}
                            <div className="flex gap-1.5">
                              <button
                                type="button"
                                onClick={() => startEdit(s)}
                                className="rounded-lg border border-border px-3 py-1.5 text-xs text-text-dim hover:bg-surface-hover hover:text-text"
                              >
                                {t('misc.edit')}
                              </button>
                              <button
                                type="button"
                                onClick={() => requestDelete(s.id)}
                                className={`rounded-lg px-3 py-1.5 text-xs ${
                                  confirmingId === s.id
                                    ? 'bg-danger/15 font-medium text-danger'
                                    : 'border border-border text-text-dim hover:bg-surface-hover hover:text-danger'
                                }`}
                              >
                                {confirmingId === s.id ? t('misc.confirm') : t('misc.delete')}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { UseFocusSession } from '../hooks/useFocusSession';
import * as db from '../lib/db';
import type { DayStat } from '../lib/db';
import { t } from '../lib/i18n';
import { formatDurationShort, formatHms, todayKey } from '../lib/time';
import type { Session, Settings } from '../types';
import { HabitChips } from './Habits';
import { Mascot } from './Mascot';
import type { MascotMood } from './Mascot';

interface HomeProps {
  focus: UseFocusSession;
  settings: Settings | null;
  onError: (message: string) => void;
  refreshKey: number;
  onOpenHabits: () => void;
}

const BREAK_OPTIONS = [
  { label: '5 min', sec: 5 * 60 },
  { label: '10 min', sec: 10 * 60 },
  { label: '15 min', sec: 15 * 60 },
];

export function Home({ focus, settings, onError, refreshKey, onOpenHabits }: HomeProps) {
  const [task, setTask] = useState('');
  const [project, setProject] = useState('');
  const [projects, setProjects] = useState<string[]>([]);
  const [today, setToday] = useState<DayStat | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [breakChoice, setBreakChoice] = useState<number | null>(BREAK_OPTIONS[0].sec);

  useEffect(() => {
    db.listProjects().then(setProjects).catch((err) => onError(String(err)));
  }, [onError, refreshKey]);

  useEffect(() => {
    if (focus.phase !== 'idle') return;
    db.getDaySummary(todayKey())
      .then(setToday)
      .catch((err) => onError(String(err)));
  }, [focus.phase, onError, refreshKey]);

  const [lastSession, setLastSession] = useState<Session | null>(null);
  useEffect(() => {
    if (focus.phase !== 'idle') return;
    db.listSessions({ limit: 1 })
      .then((rows) => setLastSession(rows[0] ?? null))
      .catch((err) => onError(String(err)));
  }, [focus.phase, onError, refreshKey]);

  const dailyGoalSec = (settings?.daily_goal_hours ?? 4) * 3600;
  const goalProgress = today ? Math.min(1, today.total_sec / dailyGoalSec) : 0;
  const remainingToGoal = today ? Math.max(0, dailyGoalSec - today.total_sec) : dailyGoalSec;

  function handleStart(e: FormEvent) {
    e.preventDefault();
    if (!task.trim()) return;
    focus.startSession(task.trim(), project.trim() || null);
    setTask('');
  }

  function formatAfk(sec: number): string {
    const min = Math.round(sec / 60);
    return min >= 60 ? `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}` : `${min}min`;
  }

  function saveAndReset() {
    focus.confirmStop({ focus_rating: rating, notes: notes.trim() || null }, breakChoice);
    setRating(null);
    setNotes('');
    setBreakChoice(BREAK_OPTIONS[0].sec);
  }

  // ---------- focusing / paused ----------
  if ((focus.phase === 'focusing' || focus.phase === 'paused') && focus.activeSession) {
    const paused = focus.phase === 'paused';
    const sessionMin = focus.elapsedSec / 60;
    const mascotMood: MascotMood = paused
      ? 'sleep'
      : sessionMin >= 90
        ? 'hyped'
        : sessionMin >= 30
          ? 'happy'
          : 'focus';
    return (
      <div className="animate-fade-up flex h-full flex-col items-center justify-center gap-6 px-6">
        {focus.isAbsurd && !paused && (
          <div className="animate-fade-in rounded-xl border border-warn/30 bg-warn-dim px-4 py-2 text-sm text-warn">
            {t('home.absurd')}
          </div>
        )}

        {focus.pendingAfkSec !== null && (
          <div className="animate-fade-in flex items-center gap-3 rounded-xl border border-border-strong bg-surface px-4 py-2.5">
            <span className="text-sm text-text">
              {t('home.afk.q', formatAfk(focus.pendingAfkSec))}
            </span>
            <button
              type="button"
              onClick={() => focus.resolveAfk(true)}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-bg hover:brightness-110"
            >
              {t('home.afk.yes')}
            </button>
            <button
              type="button"
              onClick={() => focus.resolveAfk(false)}
              className="rounded-lg border border-border px-3 py-1.5 text-xs text-text-dim hover:bg-surface-hover hover:text-text"
            >
              {t('home.afk.no')}
            </button>
          </div>
        )}

        <Mascot mood={mascotMood} size={72} />

        <div className="flex flex-col items-center gap-2.5">
          <span className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.15em] text-text-faint">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                paused ? 'bg-warn' : 'animate-pulse-dot bg-accent'
              }`}
            />
            {paused ? t('home.paused') : t('home.lockedin')}
          </span>
          <h1 className="max-w-lg text-center text-xl font-medium leading-snug text-text">
            {focus.activeSession.task}
          </h1>
          {focus.activeSession.project && (
            <span className="rounded-full border border-border bg-surface px-3 py-0.5 text-xs text-text-dim">
              {focus.activeSession.project}
            </span>
          )}
        </div>

        <div
          className={`font-mono text-[clamp(52px,11vw,96px)] font-medium leading-none tabular-nums tracking-tight ${
            paused ? 'text-text-faint' : 'text-accent'
          }`}
          style={paused ? undefined : { textShadow: '0 0 60px rgba(212,255,63,0.12)' }}
        >
          {formatHms(focus.elapsedSec)}
        </div>

        {paused && <span className="text-xs text-text-faint">{t('home.paused.hint')}</span>}

        <div className="flex items-center gap-2.5">
          {paused ? (
            <button
              type="button"
              onClick={focus.resumeSession}
              className="flex items-center gap-2.5 rounded-xl bg-accent px-8 py-3 text-[15px] font-semibold text-bg hover:brightness-110"
            >
              <span className="block h-0 w-0 border-y-[6px] border-l-[10px] border-y-transparent border-l-current" />
              {t('home.resume')}
            </button>
          ) : (
            <button
              type="button"
              onClick={focus.pauseSession}
              className="flex items-center gap-2.5 rounded-xl border border-border bg-surface px-8 py-3 text-[15px] font-medium text-text hover:border-warn/40 hover:bg-warn-dim hover:text-warn"
            >
              <span className="flex gap-[3px]">
                <span className="block h-3.5 w-1 rounded-[1px] bg-current" />
                <span className="block h-3.5 w-1 rounded-[1px] bg-current" />
              </span>
              {t('home.pause')}
            </button>
          )}
          <button
            type="button"
            onClick={focus.stopSession}
            className="rounded-xl border border-border bg-surface px-8 py-3 text-[15px] font-medium text-text-dim hover:border-danger/40 hover:bg-danger/10 hover:text-danger"
          >
            {t('home.stop')}
          </button>
        </div>
      </div>
    );
  }

  // ---------- rating ----------
  if (focus.phase === 'rating') {
    return (
      <div className="animate-fade-in flex h-full items-center justify-center bg-black/30 px-6">
        <div className="animate-scale-in w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-2xl shadow-black/40">
          <div className="mb-5 flex items-start justify-between">
            <div>
              <h2 className="text-base font-semibold text-text">{t('home.rating.title')}</h2>
              <p className="mt-0.5 text-sm text-text-dim">{t('home.rating.q')}</p>
            </div>
            <button
              type="button"
              onClick={focus.resumeFromRating}
              className="text-xs text-text-faint underline-offset-2 hover:text-text-dim hover:underline"
            >
              {t('home.rating.back')}
            </button>
          </div>

          <div className="mb-1.5 flex gap-1.5">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setRating(rating === n ? null : n)}
                className={`h-12 flex-1 rounded-xl border text-base font-medium ${
                  rating === n
                    ? 'border-accent bg-accent-dim text-accent'
                    : 'border-border text-text-dim hover:border-border-strong hover:text-text'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          <div className="mb-4 h-4 text-center text-xs text-text-faint">
            {rating ? t(`home.rating.${rating}`) : t('home.rating.optional')}
          </div>

          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t('home.notes.placeholder')}
            className="mb-5 h-20 w-full resize-none rounded-xl border border-border bg-bg p-3 text-sm text-text placeholder:text-text-faint focus:border-accent focus:outline-none"
          />

          <div className="mb-5">
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-text-faint">
              {t('home.break.q')}
            </div>
            <div className="flex gap-1.5">
              {BREAK_OPTIONS.map((opt) => (
                <button
                  key={opt.sec}
                  type="button"
                  onClick={() => setBreakChoice(opt.sec)}
                  className={`flex-1 rounded-lg border py-2 text-[13px] ${
                    breakChoice === opt.sec
                      ? 'border-accent bg-accent-dim text-accent'
                      : 'border-border text-text-dim hover:border-border-strong hover:text-text'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setBreakChoice(null)}
                className={`flex-1 rounded-lg border py-2 text-[13px] ${
                  breakChoice === null
                    ? 'border-accent bg-accent-dim text-accent'
                    : 'border-border text-text-dim hover:border-border-strong hover:text-text'
                }`}
              >
                {t('home.break.none')}
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={saveAndReset}
            className="w-full rounded-xl bg-accent py-3 text-sm font-semibold text-bg hover:brightness-110"
          >
            {t('home.save')}
          </button>
        </div>
      </div>
    );
  }

  // ---------- break ----------
  if (focus.phase === 'break' && focus.activeBreak) {
    const overdue = focus.breakRemainingSec < 0;
    const R = 120;
    const C = 2 * Math.PI * R;
    const frac = overdue
      ? 0
      : Math.max(0, Math.min(1, focus.breakRemainingSec / focus.activeBreak.plannedSec));

    return (
      <div className="animate-fade-up flex h-full flex-col items-center justify-center gap-7">
        <span className="text-xs font-medium uppercase tracking-[0.15em] text-text-faint">
          {overdue ? t('home.break.over') : t('home.break.label')}
        </span>

        <div className="relative w-[min(70vw,300px)]">
          <svg viewBox="0 0 300 300" className="h-auto w-full -rotate-90">
            <circle
              cx="150"
              cy="150"
              r={R}
              fill="none"
              stroke="var(--color-border)"
              strokeWidth="6"
            />
            {!overdue && (
              <circle
                cx="150"
                cy="150"
                r={R}
                fill="none"
                stroke="var(--color-accent)"
                strokeWidth="6"
                strokeLinecap="round"
                strokeDasharray={C}
                strokeDashoffset={C * (1 - frac)}
                style={{ transition: 'stroke-dashoffset 1s linear' }}
              />
            )}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
            <span
              className={`font-mono text-[clamp(28px,7vw,48px)] font-medium tabular-nums ${
                overdue ? 'text-warn' : 'text-text'
              }`}
            >
              {overdue
                ? `+${formatHms(focus.breakOverrunSec)}`
                : formatHms(focus.breakRemainingSec)}
            </span>
            <span className="text-xs text-text-faint">
              {overdue
                ? t('home.break.honest')
                : t('home.break.planned', formatDurationShort(focus.activeBreak.plannedSec))}
            </span>
          </div>
        </div>

        <div className="flex flex-col items-center gap-2">
          {overdue && <span className="text-sm text-text-dim">{t('home.break.more')}</span>}
          <button
            type="button"
            onClick={focus.endBreakNow}
            className="rounded-xl bg-accent px-8 py-3 text-[15px] font-semibold text-bg hover:brightness-110"
          >
            {t('home.break.backfocus')}
          </button>
        </div>
      </div>
    );
  }

  // ---------- idle ----------
  const hour = new Date().getHours();
  const greeting =
    hour < 5
      ? t('home.greeting.dawn')
      : hour < 12
        ? t('home.greeting.morning')
        : hour < 18
          ? t('home.greeting.afternoon')
          : t('home.greeting.evening');
  const name = settings?.user_name?.trim();

  return (
    <div className="flex h-full flex-col items-center justify-center px-6">
      <div className="mb-2 text-sm text-text-dim">
        {greeting}
        {name ? `, ${name}` : ''}
      </div>

      <div
        className="pointer-events-none mb-8 font-mono text-[clamp(40px,8vw,68px)] font-medium leading-none tabular-nums tracking-tight text-text-faint/40 select-none"
        aria-hidden
      >
        00:00:00
      </div>

      <form onSubmit={handleStart} className="flex w-full max-w-md flex-col items-center">
        <input
          autoFocus
          value={task}
          onChange={(e) => setTask(e.target.value)}
          placeholder={t('home.task.placeholder')}
          className="w-full border-b border-border bg-transparent px-2 pb-3 text-center text-xl text-text transition-colors placeholder:text-text-faint focus:border-accent"
        />

        <div className="mt-4 flex h-8 w-full flex-wrap items-center justify-center gap-1.5">
          {projects.slice(0, 5).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setProject(project === p ? '' : p)}
              className={`rounded-full border px-3 py-1 text-xs ${
                project === p
                  ? 'border-accent bg-accent-dim text-accent'
                  : 'border-border text-text-dim hover:border-border-strong hover:text-text'
              }`}
            >
              {p}
            </button>
          ))}
          <input
            value={projects.includes(project) ? '' : project}
            onChange={(e) => setProject(e.target.value)}
            placeholder={projects.length > 0 ? t('home.project.other') : t('home.project.placeholder')}
            className="w-32 rounded-full border border-transparent bg-transparent px-3 py-1 text-center text-xs text-text transition-colors placeholder:text-text-faint hover:border-border focus:border-border-strong"
          />
        </div>

        <button
          type="submit"
          disabled={!task.trim()}
          className="chunk-btn chunk-btn-accent mt-7 px-12 py-4 text-lg tracking-tight"
        >
          LOCK IN
        </button>

        <div className="mt-3 flex h-9 items-center">
          {lastSession && !task.trim() && (
            <button
              type="button"
              onClick={() => focus.startSession(lastSession.task, lastSession.project)}
              className="animate-fade-in flex max-w-md items-center gap-2 rounded-full border border-border bg-surface px-4 py-1.5 text-xs text-text-dim hover:border-border-strong hover:text-text"
              title={t('home.continue.title')}
            >
              <span className="text-accent">↻</span>
              <span className="shrink-0">{t('home.continue')}</span>
              <span className="truncate text-text">{lastSession.task}</span>
              {lastSession.project && (
                <span className="shrink-0 text-text-faint">· {lastSession.project}</span>
              )}
            </button>
          )}
        </div>
      </form>

      {today && (
        <div className="mt-8 w-full max-w-xl rounded-2xl border border-border bg-surface p-5">
          <div className="mb-3 flex items-baseline justify-between">
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-2xl font-medium tabular-nums text-text">
                {formatDurationShort(today.total_sec)}
              </span>
              <span className="text-xs text-text-dim">{t('home.today')}</span>
            </div>
            <span className="text-xs text-text-dim">
              {today.block_count === 0
                ? t('home.noblocks')
                : `${today.block_count} ${today.block_count === 1 ? t('home.block') : t('home.blocks')}${
                    today.best_block_sec > 0
                      ? ` · ${t('home.best')} ${formatDurationShort(today.best_block_sec)}`
                      : ''
                  }`}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg">
            <div
              className="h-full rounded-full bg-accent"
              style={{ width: `${goalProgress * 100}%`, transition: 'width 600ms cubic-bezier(0.16,1,0.3,1)' }}
            />
          </div>
          <div className="mt-2 flex justify-between text-[11px] text-text-faint">
            <span>
              {goalProgress >= 1
                ? t('home.goalhit')
                : t('home.goalleft', formatDurationShort(remainingToGoal))}
            </span>
            <span>{t('home.goal')} {settings?.daily_goal_hours ?? 4}h</span>
          </div>
        </div>
      )}

      <div className="mt-5">
        <HabitChips onError={onError} onOpenHabits={onOpenHabits} />
      </div>
    </div>
  );
}

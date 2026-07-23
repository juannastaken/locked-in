import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { parsePomo } from '../hooks/useFocusSession';
import type { UseFocusSession } from '../hooks/useFocusSession';
import { JamRoom } from './JamRoom';
import type { JamRoomMember } from './JamRoom';
import { CoffeeIcon, PaletteIcon, TimerIcon } from './Icons';
import * as db from '../lib/db';
import type { DayStat } from '../lib/db';
import { t } from '../lib/i18n';
import { formatDurationShort, formatHms, todayKey } from '../lib/time';
import type { Session, Settings } from '../types';
import type { UseSettings } from '../hooks/useSettings';
import { HabitChips } from './Habits';

interface HomeProps {
  focus: UseFocusSession;
  settings: Settings | null;
  updateSetting: UseSettings['update'];
  onError: (message: string) => void;
  refreshKey: number;
  onOpenHabits: () => void;
  /** members of my running jam with live/avatar info (null when not jamming) */
  jamRoom: JamRoomMember[] | null;
  onCheer: (userId: string) => void;
  /** a task sent over from the Tasks tab — lands in the "working on" input */
  prefillTask: string | null;
  onPrefillConsumed: () => void;
}

const BREAK_OPTIONS = [
  { label: '5 min', sec: 5 * 60 },
  { label: '10 min', sec: 10 * 60 },
  { label: '15 min', sec: 15 * 60 },
];

/** Focus-timer looks — Apple-clock inspired. Each is a preview class for the
 *  picker + the classes/color the live timer uses. */
const CLOCK_STYLES = [
  { id: 'classic', cls: 'font-mono font-medium tracking-tight', accent: true },
  { id: 'thin', cls: 'font-sans font-extralight tracking-tight', accent: false },
  { id: 'mono', cls: 'font-mono font-extrabold tracking-tight', accent: false },
  { id: 'serif', cls: 'font-serif font-light tracking-tight', accent: true },
  { id: 'stack', cls: 'font-sans font-extrabold tracking-tight', accent: true },
] as const;

export function Home({
  focus,
  settings,
  updateSetting,
  onError,
  refreshKey,
  onOpenHabits,
  jamRoom,
  onCheer,
  prefillTask,
  onPrefillConsumed,
}: HomeProps) {
  const [task, setTask] = useState('');
  const [project, setProject] = useState('');
  const [projects, setProjects] = useState<string[]>([]);
  const [today, setToday] = useState<DayStat | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [breakChoice, setBreakChoice] = useState<number | null>(BREAK_OPTIONS[0].sec);

  useEffect(() => {
    if (prefillTask) {
      setTask(prefillTask);
      onPrefillConsumed();
    }
  }, [prefillTask, onPrefillConsumed]);

  // clock customizer popover (focus screen)
  const [clockOpen, setClockOpen] = useState(false);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if ((e.target as Element | null)?.closest?.('[data-pop]')) return;
      setClockOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  useEffect(() => {
    // projects ARE the goals — a project exists by creating it in Goals, so
    // the chip row never piles up with historical one-off names
    db.listGoals()
      .then((goals) => {
        const seen = new Set<string>();
        const list: string[] = [];
        for (const g of goals) {
          const k = g.project.toLowerCase();
          if (!seen.has(k)) {
            seen.add(k);
            list.push(g.project);
          }
        }
        setProjects(list);
        // goal deleted while its chip was selected → don't tag sessions with a
        // project that no longer counts anywhere
        setProject((cur) =>
          list.some((p) => p.toLowerCase() === cur.toLowerCase()) ? cur : '',
        );
      })
      .catch((err) => onError(String(err)));
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
    const styleDef =
      CLOCK_STYLES.find((s) => s.id === (settings?.clock_style || 'classic')) ?? CLOCK_STYLES[0];
    const timerColor = paused
      ? 'text-text-faint'
      : styleDef.accent
        ? 'text-accent'
        : 'text-text';
    return (
      <div className="group/focus cascade relative isolate flex h-full flex-col items-center justify-center gap-6 px-6">
        {/* ambient accent glow, centered behind the running session */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              'radial-gradient(circle 63vh at 50% 46%, color-mix(in srgb, var(--color-accent) 6.5%, transparent), transparent 72%)',
          }}
        />
        {/* clock customizer — quiet corner button, revealed on hover */}
        <div className="absolute right-4 top-4 z-20" data-pop>
          <button
            type="button"
            title={t('home.clock.customize')}
            onClick={() => setClockOpen((o) => !o)}
            className={`flex h-8 w-8 items-center justify-center rounded-lg text-text-faint transition-opacity hover:bg-surface-hover hover:text-text ${
              clockOpen ? 'opacity-100' : 'opacity-0 group-hover/focus:opacity-100'
            }`}
          >
            <PaletteIcon size={15} />
          </button>
          {clockOpen && (
            <div className="animate-scale-in absolute right-0 top-10 z-30 w-60 rounded-xl border-2 border-border-strong bg-surface p-2 shadow-2xl shadow-black/50">
              <div className="px-1.5 pb-1 text-[10px] font-extrabold uppercase tracking-wide text-text-faint">
                {t('home.clock.title')}
              </div>
              {CLOCK_STYLES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => updateSetting('clock_style', s.id)}
                  className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left hover:bg-surface-hover ${
                    styleDef.id === s.id ? 'bg-surface-hover' : ''
                  }`}
                >
                  <span
                    className={`text-xs font-semibold ${styleDef.id === s.id ? 'text-accent' : 'text-text'}`}
                  >
                    {t(`home.clock.${s.id}`)}
                  </span>
                  <span className={`${s.cls} text-base leading-none text-text-dim tabular-nums`}>
                    {s.id === 'stack' ? '12·34' : '12:34'}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
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

        <div className="flex flex-col items-center gap-2.5">
          <h1 className="max-w-lg text-center text-xl font-medium leading-snug text-text">
            {focus.activeSession.task}
          </h1>
          {focus.activeSession.project && (
            <span className="rounded-full border border-border bg-surface px-3 py-0.5 text-xs text-text-dim">
              {focus.activeSession.project}
            </span>
          )}
          {(() => {
            // solo pomodoro chip — the full JamRoom below takes over at 2+
            const p = parsePomo(focus.jam?.pomo);
            if (!p || !focus.jam || (jamRoom && jamRoom.length >= 2)) return null;
            const cycle = p.workSec + p.breakSec;
            const pos = ((focus.displayElapsedSec % cycle) + cycle) % cycle;
            const inWork = pos < p.workSec;
            const left = inWork ? p.workSec - pos : cycle - pos;
            const mm = Math.floor(left / 60);
            const ss = String(Math.floor(left % 60)).padStart(2, '0');
            return (
              <span
                className={`flex items-center gap-1.5 rounded-full border-2 px-3 py-0.5 font-mono text-xs font-bold tabular-nums ${
                  inWork ? 'border-danger/50 text-danger' : 'border-sky-400/60 text-sky-400'
                }`}
              >
                {inWork ? <TimerIcon size={12} /> : <CoffeeIcon size={12} />} {mm}:{ss}
              </span>
            );
          })()}
        </div>

        {/* the living jam room — everyone in the session, rings + 🔥 */}
        {jamRoom && jamRoom.length >= 2 && (
          <div>
            <JamRoom
              members={jamRoom}
              sharedSec={focus.displayElapsedSec}
              pomo={focus.jam?.pomo ?? null}
              onCheer={onCheer}
            />
          </div>
        )}

        {/* fixed-em stage with an animated height: switching clock styles
            (esp. Stacked, which is two rows tall) GLIDES the layout around
            the timer instead of teleporting it */}
        <div
          className="flex flex-col items-center justify-center overflow-hidden transition-[height] duration-300 ease-out"
          style={{
            fontSize: 'clamp(52px,11vw,96px)',
            height: styleDef.id === 'stack' ? '1.9em' : '1.05em',
          }}
        >
          {styleDef.id === 'stack' ? (
            (() => {
              // Apple StandBy look: time stacked in two heavy rows
              const total = Math.floor(focus.displayElapsedSec);
              const h = Math.floor(total / 3600);
              const m = Math.floor((total % 3600) / 60);
              const s = total % 60;
              const top = h > 0 ? `${h}:${String(m).padStart(2, '0')}` : String(m).padStart(2, '0');
              return (
                <div className="flex flex-col items-center leading-[0.9] tabular-nums">
                  <span
                    className={`${styleDef.cls} transition-colors duration-300 ${paused ? 'text-text-faint' : 'text-text'}`}
                  >
                    {top}
                  </span>
                  <span className={`${styleDef.cls} ${timerColor} transition-colors duration-300`}>
                    {String(s).padStart(2, '0')}
                  </span>
                </div>
              );
            })()
          ) : (
            <div
              className={`${styleDef.cls} ${timerColor} leading-none tabular-nums transition-colors duration-300`}
            >
              {formatHms(focus.displayElapsedSec)}
            </div>
          )}
        </div>

        {/* paused hint: animated height+fade so the timer glides instead of jumping */}
        <div
          className={`overflow-hidden text-center transition-all duration-300 ease-out ${
            paused ? 'max-h-6 translate-y-0 opacity-100' : 'max-h-0 -translate-y-1 opacity-0'
          }`}
          aria-hidden={!paused}
        >
          <span className="text-xs text-text-faint">{t('home.paused.hint')}</span>
        </div>

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
      <div
        className="animate-fade-in flex h-full items-center justify-center px-6"
        style={{
          // vignette that dies out well before the edges — zero hard lines
          // against the titlebar or page borders
          background:
            'radial-gradient(ellipse 55% 52% at 50% 50%, rgba(0,0,0,0.5), transparent 76%)',
        }}
      >
        <div
          className="animate-scale-in cascade w-full max-w-md rounded-3xl border border-border bg-surface p-7 [border-top-color:rgba(255,255,255,0.13)]"
          style={{
            // strong top light so the card's upper edge blends into the scene
            // instead of reading as a cut line
            backgroundImage:
              'linear-gradient(180deg, rgba(255,255,255,0.065), rgba(255,255,255,0.02) 30%, transparent 60%)',
            boxShadow:
              '0 1px 2px rgba(0,0,0,0.4), 0 24px 70px -18px rgba(0,0,0,0.6), 0 60px 140px -30px rgba(0,0,0,0.45)',
          }}
        >
          <div className="mb-6 flex items-start justify-between">
            <div>
              <h2 className="text-lg font-bold tracking-tight text-text">{t('home.rating.title')}</h2>
              <p className="mt-1 text-sm text-text-dim">{t('home.rating.q')}</p>
            </div>
            <button
              type="button"
              onClick={focus.resumeFromRating}
              className="rounded-full px-3 py-1.5 text-xs font-semibold text-text-faint hover:bg-surface-hover hover:text-text"
            >
              {t('home.rating.back')}
            </button>
          </div>

          {/* rating — segmented control, one soft container */}
          <div className="flex rounded-2xl bg-bg p-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setRating(rating === n ? null : n)}
                className={`no-press h-11 flex-1 rounded-xl text-[15px] font-semibold transition-colors duration-200 ${
                  rating === n
                    ? 'bg-surface-hover text-accent'
                    : 'text-text-faint hover:text-text-dim'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          <div className="mb-5 mt-2 h-4 text-center text-xs font-medium text-text-faint">
            {rating ? t(`home.rating.${rating}`) : t('home.rating.optional')}
          </div>

          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t('home.notes.placeholder')}
            className="mb-6 h-20 w-full resize-none rounded-2xl bg-bg p-3.5 text-sm text-text placeholder:text-text-faint focus:outline-none focus:ring-1 focus:ring-accent/40"
          />

          <div className="mb-6">
            <div className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.1em] text-text-faint">
              {t('home.break.q')}
            </div>
            {/* break — same segmented language as the rating row */}
            <div className="flex rounded-2xl bg-bg p-1">
              {BREAK_OPTIONS.map((opt) => (
                <button
                  key={opt.sec}
                  type="button"
                  onClick={() => setBreakChoice(opt.sec)}
                  className={`no-press h-10 flex-1 rounded-xl text-[13px] font-semibold transition-colors duration-200 ${
                    breakChoice === opt.sec
                      ? 'bg-surface-hover text-accent'
                      : 'text-text-faint hover:text-text-dim'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setBreakChoice(null)}
                className={`no-press h-10 flex-1 rounded-xl text-[13px] font-semibold transition-colors duration-200 ${
                  breakChoice === null
                    ? 'bg-surface-hover text-accent'
                    : 'text-text-faint hover:text-text-dim'
                }`}
              >
                {t('home.break.none')}
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={saveAndReset}
            className="w-full rounded-2xl bg-accent py-3.5 text-sm font-bold text-bg hover:brightness-110"
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
      <div className="cascade relative flex h-full flex-col items-center justify-center gap-7 overflow-hidden">
        {/* same quiet glow as the focus screen — warn-tinted when overrun */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background: `radial-gradient(circle 63vh at 50% 46%, color-mix(in srgb, ${
              overdue ? 'var(--color-warn)' : 'var(--color-accent)'
            } 6.5%, transparent), transparent 72%)`,
            transition: 'background 600ms ease',
          }}
          aria-hidden
        />
        <span className="relative text-xs font-extrabold uppercase tracking-[0.15em] text-text-faint">
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
              className={`font-mono text-[clamp(28px,7vw,48px)] font-medium tabular-nums transition-colors duration-500 ${
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

        <div className="relative flex flex-col items-center gap-2.5">
          {overdue && (
            <span className="animate-fade-in text-sm font-medium text-text-dim">
              {t('home.break.more')}
            </span>
          )}
          <button
            type="button"
            onClick={focus.endBreakNow}
            className="rounded-2xl bg-accent px-8 py-3.5 text-[15px] font-extrabold text-bg"
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
    <div className="relative isolate h-full overflow-y-auto">
      {/* ambient accent glow, centered behind the whole Focus page */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            'radial-gradient(circle 63vh at 50% 46%, color-mix(in srgb, var(--color-accent) 6.5%, transparent), transparent 72%)',
        }}
      />
    <div className="cascade flex min-h-full flex-col items-center justify-center px-6 py-5">
      <div className="mb-2 text-sm text-text-dim">
        {greeting}
        {name ? `, ${name}` : ''}
      </div>

      <div
        className="pointer-events-none mb-6 font-mono text-[clamp(40px,8vw,68px)] font-medium leading-none tabular-nums tracking-tight text-text-faint/40 select-none"
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

        {projects.length > 0 && (
          <div className="mt-4 flex min-h-8 w-full flex-wrap items-center justify-center gap-1.5">
            {projects.map((p) => (
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
          </div>
        )}

        <button
          type="submit"
          disabled={!task.trim()}
          className="chunk-btn chunk-btn-accent glow-pulse mt-6 px-12 py-4 text-lg tracking-tight"
        >
          LOCK IN
        </button>

        <div className="mt-3 flex h-10 items-center">
          {lastSession && (
            <button
              type="button"
              onClick={() => focus.startSession(lastSession.task, lastSession.project)}
              className="group flex max-w-md items-center gap-2 px-2 py-1.5 text-[13px] font-medium text-text-faint transition-colors hover:text-text"
              title={t('home.continue.title')}
            >
              <svg
                className="shrink-0 opacity-70 transition-opacity group-hover:opacity-100 group-hover:text-accent"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M3 12a9 9 0 1 0 3-6.7" />
                <path d="M3 4v4h4" />
              </svg>
              <span className="truncate font-semibold text-text-dim transition-colors group-hover:text-text">
                {lastSession.task}
              </span>
              {lastSession.project && (
                <span className="shrink-0 text-text-faint">· {lastSession.project}</span>
              )}
            </button>
          )}
        </div>
      </form>

      {today && (
        <div className="mt-5 w-full max-w-xl rounded-2xl border border-border bg-surface p-5 xl:max-w-2xl">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-baseline gap-2.5">
              <span className="text-[28px] font-bold leading-none tracking-tight tabular-nums text-text">
                {formatDurationShort(today.total_sec)}
              </span>
              <span className="text-sm font-semibold text-text-dim">{t('home.today')}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[13px] font-semibold text-text-dim">
                {t('home.goal')} {settings?.daily_goal_hours ?? 4}h
              </span>
              <span className="rounded-full bg-accent-dim px-3 py-1.5 text-[13px] font-bold tabular-nums text-accent">
                {Math.min(100, Math.round(goalProgress * 100))}%
              </span>
            </div>
          </div>
          <div className="relative h-2.5 w-full rounded-full bg-bg">
            {/* quarter ticks */}
            {[25, 50, 75].map((p) => (
              <span
                key={p}
                className="absolute top-1/2 h-1.5 w-px -translate-y-1/2 bg-white/10"
                style={{ left: `${p}%` }}
              />
            ))}
            <div
              className="relative h-full min-w-2.5 rounded-full"
              style={{
                width: `${Math.min(100, goalProgress * 100)}%`,
                background:
                  'linear-gradient(90deg, color-mix(in srgb, var(--color-accent) 55%, transparent), var(--color-accent))',
                transition: 'width 600ms cubic-bezier(0.16,1,0.3,1)',
              }}
            >
              {/* bright tip */}
              <span className="absolute right-0 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-accent shadow-[0_0_10px_color-mix(in_srgb,var(--color-accent)_60%,transparent)]" />
            </div>
          </div>
          <div className="mt-3 flex justify-between text-[13px] font-semibold text-text-dim">
            <span className={goalProgress >= 1 ? 'font-bold text-accent' : ''}>
              {goalProgress >= 1
                ? t('home.goalhit')
                : t('home.goalleft', formatDurationShort(remainingToGoal))}
            </span>
            <span>
              {today.block_count === 0
                ? t('home.noblocks')
                : `${today.block_count} ${today.block_count === 1 ? t('home.block') : t('home.blocks')}${
                    today.best_block_sec > 0
                      ? ` · ${t('home.best')} ${formatDurationShort(today.best_block_sec)}`
                      : ''
                  }`}
            </span>
          </div>
        </div>
      )}

      <div className="mt-4">
        <HabitChips onError={onError} onOpenHabits={onOpenHabits} />
      </div>
    </div>
    </div>
  );
}

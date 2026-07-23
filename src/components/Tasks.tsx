import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as db from '../lib/db';
import type { TaskItem } from '../lib/db';
import { dateLocale, t } from '../lib/i18n';
import { ConfirmModal } from './Confirm';

interface TasksProps {
  onError: (m: string) => void;
  /** sends the task title to the Focus tab's "working on" input */
  onFocusTask: (title: string) => void;
}

function CheckIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m4.5 12.5 5 5L19.5 7" />
    </svg>
  );
}

function ClockIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}

function PlayIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 5.5v13a1 1 0 0 0 1.52.86l10.2-6.5a1 1 0 0 0 0-1.7L9.52 4.64A1 1 0 0 0 8 5.5z" />
    </svg>
  );
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const MINUTES = [0, 15, 30, 45];

/** "hoje 18:00" / "amanhã 09:00" / "23 jul 14:00" */
function fmtDue(iso: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' });
  const day = new Date(d);
  day.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((day.getTime() - today.getTime()) / 86_400_000);
  if (diffDays === 0) return `${t('tasks.due.today')} ${time}`;
  if (diffDays === 1) return `${t('tasks.due.tomorrow')} ${time}`;
  const date = d.toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short' });
  return `${date} ${time}`;
}

export function TasksPage({ onError, onFocusTask }: TasksProps) {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState('');
  const [dueOpen, setDueOpen] = useState(false);
  const [dueDay, setDueDay] = useState<Date | null>(null);
  const [dueHour, setDueHour] = useState(18);
  const [dueMinute, setDueMinute] = useState(0);
  // typed overrides: any minute ("34"), any date ("15/08")
  const [minText, setMinText] = useState('');
  const [dayText, setDayText] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<TaskItem | null>(null);
  // just-completed tasks linger in place briefly before moving to the done section
  const [holding, setHolding] = useState<Set<number>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);
  const [now, setNow] = useState(() => Date.now());

  const reload = useCallback(() => {
    db.listTasks()
      .then((rows) => {
        setTasks(rows);
        setLoaded(true);
      })
      .catch((err) => onError(String(err)));
  }, [onError]);

  useEffect(reload, [reload]);

  // overdue state flips on its own as time passes
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!dueOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDueOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dueOpen]);

  const doneCount = tasks.filter((task) => !!task.done_at).length;
  const open = tasks
    .filter((task) => !task.done_at || holding.has(task.id))
    .sort((a, b) => {
      if (a.due_at && b.due_at) return a.due_at.localeCompare(b.due_at);
      if (a.due_at) return -1;
      if (b.due_at) return 1;
      return a.created_at.localeCompare(b.created_at);
    });
  const done = tasks
    .filter((task) => !!task.done_at && !holding.has(task.id))
    .sort((a, b) => (b.done_at ?? '').localeCompare(a.done_at ?? ''));
  const total = tasks.length;
  const pct = total === 0 ? 0 : Math.round((doneCount / total) * 100);

  const dueValue = dueDay
    ? new Date(dueDay.getTime() + (dueHour * 60 + dueMinute) * 60_000)
    : null;

  const dayChips = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + i);
    const label =
      i === 0
        ? t('tasks.due.today')
        : i === 1
          ? t('tasks.due.tomorrow')
          : d.toLocaleDateString(dateLocale(), { weekday: 'short', day: 'numeric' });
    return { date: d, label };
  });

  async function add() {
    const title = draft.trim();
    if (!title) return;
    try {
      await db.createTask(title, dueValue ? dueValue.toISOString() : null);
      setDraft('');
      setDueDay(null);
      setDueHour(18);
      setDueMinute(0);
      setMinText('');
      setDayText('');
      setDueOpen(false);
      reload();
      inputRef.current?.focus();
    } catch (err) {
      onError(String(err));
    }
  }

  async function toggle(task: TaskItem) {
    const nowDone = !task.done_at;
    // optimistic: only this row changes — no list reload
    setTasks((prev) =>
      prev.map((row) =>
        row.id === task.id ? { ...row, done_at: nowDone ? new Date().toISOString() : null } : row,
      ),
    );
    if (nowDone) {
      setHolding((prev) => new Set(prev).add(task.id));
      window.setTimeout(() => {
        setHolding((prev) => {
          const next = new Set(prev);
          next.delete(task.id);
          return next;
        });
      }, 700);
    }
    try {
      await db.toggleTask(task.id, nowDone);
    } catch (err) {
      onError(String(err));
      reload();
    }
  }

  function row(task: TaskItem) {
    const isDone = !!task.done_at;
    const overdue = !isDone && !!task.due_at && new Date(task.due_at).getTime() < now;
    return (
      <div
        key={task.id}
        className="group flex items-center gap-3.5 rounded-2xl border bg-surface px-4 py-3.5"
      >
        <button
          type="button"
          onClick={() => toggle(task)}
          aria-label={task.title}
          className={`no-press flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-all duration-200 ${
            isDone
              ? 'border-accent bg-accent text-bg'
              : 'border-white/15 text-transparent hover:border-accent/60'
          }`}
        >
          <CheckIcon />
        </button>
        <span
          className={`min-w-0 flex-1 truncate text-[15px] font-medium transition-colors duration-200 ${
            isDone ? 'text-text-faint line-through' : 'text-text'
          }`}
        >
          {task.title}
        </span>
        {task.due_at && (
          <span
            className={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold tabular-nums ${
              overdue
                ? 'bg-danger/10 text-danger'
                : isDone
                  ? 'bg-bg/60 text-text-faint'
                  : 'bg-bg/60 text-text-dim'
            }`}
          >
            <ClockIcon size={12} />
            {overdue ? `${t('tasks.due.overdue')} · ${fmtDue(task.due_at)}` : fmtDue(task.due_at)}
          </span>
        )}
        {!isDone && (
          <button
            type="button"
            onClick={() => onFocusTask(task.title)}
            title={t('tasks.focus')}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-text-faint opacity-0 transition-all hover:bg-accent/10 hover:text-accent group-hover:opacity-100"
          >
            <PlayIcon />
          </button>
        )}
        <button
          type="button"
          onClick={() => setConfirmDelete(task)}
          title={t('misc.delete')}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-text-faint opacity-0 transition-all hover:bg-danger/10 hover:text-danger group-hover:opacity-100"
        >
          ✕
        </button>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="cascade mx-auto max-w-2xl space-y-5 px-4 pb-10 pt-8 sm:px-6 xl:max-w-3xl">
        <header>
          <h1 className="text-2xl font-extrabold text-text">{t('tab.tasks')}</h1>
          <p className="mt-1 text-sm font-medium text-text-dim">{t('tasks.sub')}</p>
        </header>

        {/* progress hero — same visual language as the "today" card on Focus */}
        <section className="rounded-3xl border bg-surface p-6">
          <div className="flex items-end justify-between">
            <div>
              <div className="text-[28px] font-extrabold leading-none tabular-nums text-text">
                {doneCount}
                <span className="text-text-faint">/{total}</span>
              </div>
              <div className="mt-1.5 text-[13px] font-semibold text-text-dim">
                {t('tasks.progress.done')}
              </div>
            </div>
            <span className="rounded-full bg-accent/10 px-2.5 py-1 text-xs font-extrabold tabular-nums text-accent">
              {pct}%
            </span>
          </div>
          <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-bg/60">
            <div
              className="h-full rounded-full transition-[width] duration-700 ease-out"
              style={{
                width: `${pct}%`,
                background:
                  'linear-gradient(90deg, color-mix(in srgb, var(--color-accent) 55%, transparent), var(--color-accent))',
                boxShadow: '0 0 12px color-mix(in srgb, var(--color-accent) 45%, transparent)',
              }}
            />
          </div>
          <p className="mt-3 text-[13px] font-semibold text-text-faint">
            {total === 0
              ? t('tasks.empty')
              : doneCount === total
                ? t('tasks.progress.all')
                : t('tasks.progress.left', total - doneCount)}
          </p>
        </section>

        {/* composer — one pill, send button materializes when there is text */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
          className="flex items-center gap-1 rounded-2xl border bg-surface py-2 pl-4 pr-2"
        >
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t('tasks.new.ph')}
            className="min-w-0 flex-1 bg-transparent text-[15px] font-medium text-text outline-none placeholder:text-text-faint"
          />
          <button
            type="button"
            onClick={() => setDueOpen(true)}
            title={t('tasks.due.set')}
            className={`no-press flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-full transition-colors ${
              dueValue
                ? 'bg-accent/10 px-3 text-xs font-bold tabular-nums text-accent'
                : 'w-9 text-text-dim hover:bg-white/5 hover:text-text'
            }`}
          >
            <ClockIcon size={dueValue ? 13 : 15} />
            {dueValue && fmtDue(dueValue.toISOString())}
          </button>
          <div
            className="shrink-0 overflow-hidden transition-all duration-200 ease-out"
            style={{ width: draft.trim() ? '2.65rem' : 0 }}
          >
            <button
              type="submit"
              disabled={!draft.trim()}
              className={`ml-1 flex h-9 w-9 items-center justify-center rounded-full bg-accent text-bg transition-all duration-200 ease-out ${
                draft.trim() ? 'scale-100 opacity-100' : 'scale-50 opacity-0'
              }`}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </button>
          </div>
        </form>

        {open.length > 0 && (
          <section className="space-y-2">
            <h2 className="px-1 text-xs font-extrabold uppercase tracking-wide text-text-faint">
              {t('tasks.open')} · {open.length}
            </h2>
            {open.map(row)}
          </section>
        )}

        {done.length > 0 && (
          <section className="space-y-2">
            <div className="flex items-center justify-between px-1">
              <h2 className="text-xs font-extrabold uppercase tracking-wide text-text-faint">
                {t('tasks.done.section')} · {done.length}
              </h2>
              <button
                type="button"
                onClick={() => setConfirmClear(true)}
                className="text-xs font-bold text-text-faint transition-colors hover:text-danger"
              >
                {t('tasks.done.clear')}
              </button>
            </div>
            {done.map(row)}
          </section>
        )}

        {loaded && total === 0 && (
          <p className="pt-6 text-center text-sm font-medium text-text-faint">
            {t('tasks.empty')}
          </p>
        )}
      </div>

      {/* deadline picker — full popup: day chips, hour grid, minute chips */}
      {dueOpen &&
        createPortal(
          <div
            className="animate-fade-in fixed inset-0 z-[70] flex items-center justify-center bg-black/80 px-6"
            onMouseDown={(e) => e.target === e.currentTarget && setDueOpen(false)}
          >
            <div className="chunk animate-scale-in w-full max-w-md p-6">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-extrabold text-text">{t('tasks.due')}</h2>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-bold tabular-nums transition-colors ${
                    dueValue ? 'bg-accent/10 text-accent' : 'bg-bg/60 text-text-faint'
                  }`}
                >
                  {dueValue ? fmtDue(dueValue.toISOString()) : '—'}
                </span>
              </div>

              <p className="mt-4 text-xs font-extrabold uppercase tracking-wide text-text-faint">
                {t('tasks.due.day')}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {dayChips.map(({ date, label }) => {
                  const active = dueDay?.getTime() === date.getTime();
                  return (
                    <button
                      key={date.getTime()}
                      type="button"
                      onClick={() => {
                        setDueDay(active ? null : date);
                        setDayText('');
                      }}
                      className={`no-press rounded-full px-3 py-1.5 text-xs font-bold transition-colors ${
                        active ? 'bg-accent text-bg' : 'bg-bg/60 text-text-dim hover:text-text'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
                <input
                  value={dayText}
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^\d/]/g, '').slice(0, 5);
                    setDayText(v);
                    const m = v.match(/^(\d{1,2})\/(\d{1,2})$/);
                    if (m) {
                      const dayN = Number(m[1]);
                      const monN = Number(m[2]);
                      if (dayN >= 1 && dayN <= 31 && monN >= 1 && monN <= 12) {
                        const d = new Date();
                        d.setHours(0, 0, 0, 0);
                        d.setMonth(monN - 1, dayN);
                        // a past date means next year — deadlines point forward
                        const today = new Date();
                        today.setHours(0, 0, 0, 0);
                        if (d.getTime() < today.getTime()) d.setFullYear(d.getFullYear() + 1);
                        if (d.getDate() === dayN) setDueDay(d);
                      }
                    }
                  }}
                  placeholder="dd/mm"
                  className={`w-[4.5rem] rounded-full px-3 py-1.5 text-center text-xs font-bold tabular-nums outline-none transition-colors placeholder:text-text-faint ${
                    dayText && dueDay ? 'bg-accent/10 text-accent' : 'bg-bg/60 text-text'
                  }`}
                />
              </div>

              <p className="mt-4 text-xs font-extrabold uppercase tracking-wide text-text-faint">
                {t('tasks.due.hour')}
              </p>
              <div className="mt-2 grid grid-cols-6 gap-1.5">
                {HOURS.map((h) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => {
                      setDueHour(h);
                      if (!dueDay) setDueDay(dayChips[0].date);
                    }}
                    className={`no-press rounded-lg py-1.5 text-xs font-bold tabular-nums transition-colors ${
                      dueHour === h && dueDay
                        ? 'bg-accent text-bg'
                        : 'bg-bg/60 text-text-dim hover:text-text'
                    }`}
                  >
                    {String(h).padStart(2, '0')}
                  </button>
                ))}
              </div>

              <p className="mt-4 text-xs font-extrabold uppercase tracking-wide text-text-faint">
                {t('tasks.due.min')}
              </p>
              <div className="mt-2 grid grid-cols-5 gap-1.5">
                {MINUTES.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      setDueMinute(m);
                      setMinText('');
                      if (!dueDay) setDueDay(dayChips[0].date);
                    }}
                    className={`no-press rounded-lg py-1.5 text-xs font-bold tabular-nums transition-colors ${
                      dueMinute === m && !minText && dueDay
                        ? 'bg-accent text-bg'
                        : 'bg-bg/60 text-text-dim hover:text-text'
                    }`}
                  >
                    :{String(m).padStart(2, '0')}
                  </button>
                ))}
                <input
                  value={minText}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, '').slice(0, 2);
                    setMinText(v);
                    if (v !== '') {
                      const n = Number(v);
                      if (n <= 59) {
                        setDueMinute(n);
                        if (!dueDay) setDueDay(dayChips[0].date);
                      }
                    }
                  }}
                  placeholder=":mm"
                  className={`rounded-lg py-1.5 text-center text-xs font-bold tabular-nums outline-none transition-colors placeholder:text-text-faint ${
                    minText ? 'bg-accent/10 text-accent' : 'bg-bg/60 text-text'
                  }`}
                />
              </div>

              <div className="mt-5 flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setDueDay(null);
                    setDueOpen(false);
                  }}
                  className="chunk-btn flex-1 py-3 text-sm text-text"
                >
                  {t('tasks.done.clear')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!dueDay) setDueDay(dayChips[0].date);
                    setDueOpen(false);
                  }}
                  className="no-press flex-1 rounded-xl bg-accent py-3 text-sm font-extrabold text-bg"
                >
                  {t('tasks.due.ok')}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {confirmClear && (
        <ConfirmModal
          title={t('tasks.clear.title')}
          body={t('tasks.clear.body')}
          confirmLabel={t('tasks.done.clear')}
          onConfirm={() => {
            db.clearDoneTasks().then(reload).catch((err) => onError(String(err)));
          }}
          onClose={() => setConfirmClear(false)}
        />
      )}

      {confirmDelete && (
        <ConfirmModal
          title={t('tasks.delete.title')}
          body={`“${confirmDelete.title}” — ${t('tasks.delete.body')}`}
          confirmLabel={t('misc.delete')}
          onConfirm={() => {
            db.deleteTask(confirmDelete.id).then(reload).catch((err) => onError(String(err)));
          }}
          onClose={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

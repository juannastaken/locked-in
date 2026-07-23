import { useCallback, useEffect, useState } from 'react';
import * as db from '../lib/db';
import { dateLocale, t } from '../lib/i18n';
import { formatDurationShort } from '../lib/time';
import type { ProjectGoal } from '../types';
import { Mascot } from './Mascot';

interface GoalsProps {
  onError: (m: string) => void;
  refreshKey: number;
}

interface GoalRow {
  goal: ProjectGoal;
  doneSec: number;
}

export function GoalsPage({ onError, refreshKey }: GoalsProps) {
  const [rows, setRows] = useState<GoalRow[]>([]);
  const [projects, setProjects] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [project, setProject] = useState('');
  const [hours, setHours] = useState(20);
  const [deadline, setDeadline] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  const reload = useCallback(() => {
    Promise.all([db.listGoals(), db.listProjects()])
      .then(async ([goals, projs]) => {
        const withProgress = await Promise.all(
          goals.map(async (goal) => ({
            goal,
            doneSec: await db.getProjectSecondsSince(goal.project, goal.created_at),
          })),
        );
        setRows(withProgress);
        setProjects(projs);
      })
      .catch((err) => onError(String(err)));
  }, [onError]);

  useEffect(reload, [reload, refreshKey]);

  // goals change rarely — push them to the cloud right away instead of waiting
  // for the next session-save/15min sync window
  function syncCloud() {
    import('../lib/cloud')
      .then((c) => c.currentUser().then((u) => (u ? c.uploadSnapshot() : null)))
      .catch(() => {});
  }

  async function save() {
    const p = project.trim();
    if (!p || hours <= 0) return;
    try {
      await db.createGoal(p, hours, deadline || null);
      setProject('');
      setHours(20);
      setDeadline('');
      setAdding(false);
      reload();
      syncCloud();
    } catch (err) {
      onError(String(err));
    }
  }

  async function remove(id: number) {
    if (confirmDelete !== id) {
      setConfirmDelete(id);
      window.setTimeout(() => setConfirmDelete((c) => (c === id ? null : c)), 3000);
      return;
    }
    setConfirmDelete(null);
    try {
      await db.deleteGoal(id);
      reload();
      syncCloud();
    } catch (err) {
      onError(String(err));
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="cascade mx-auto max-w-3xl space-y-5 px-4 pb-10 pt-8 sm:px-6 xl:max-w-4xl">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-text">{t('goals.title')}</h1>
            <p className="mt-1 text-[13px] text-text-faint">{t('goals.sub')}</p>
          </div>
          {!adding && (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="chunk-btn chunk-btn-accent px-4 py-2 text-[13px]"
            >
              {t('goals.new')}
            </button>
          )}
        </div>

        {adding && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
            className="chunk animate-scale-in space-y-3 p-4"
          >
            <input
              autoFocus
              value={project}
              onChange={(e) => setProject(e.target.value)}
              placeholder={t('goals.project.placeholder')}
              list="goal-projects"
              className="chunk-input w-full px-3 py-2.5 text-sm font-semibold text-text placeholder:font-medium placeholder:text-text-faint"
            />
            <datalist id="goal-projects">
              {projects.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
            <p className="text-[11px] leading-relaxed text-text-faint">💡 {t('goals.hint')}</p>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-text-dim">
                {t('goals.target')}
                <div className="flex items-center gap-0.5 rounded-lg border-2 border-border-strong bg-bg p-0.5">
                  <button
                    type="button"
                    onClick={() => setHours(Math.max(1, hours - 5))}
                    className="h-7 w-7 rounded-md text-text-dim hover:bg-surface-hover hover:text-text"
                  >
                    −
                  </button>
                  <span className="min-w-14 text-center font-mono text-sm font-bold tabular-nums text-text">
                    {hours}h
                  </span>
                  <button
                    type="button"
                    onClick={() => setHours(hours + 5)}
                    className="h-7 w-7 rounded-md text-text-dim hover:bg-surface-hover hover:text-text"
                  >
                    +
                  </button>
                </div>
              </label>
            </div>
            <label className="flex items-center justify-between gap-2 text-sm text-text-dim">
              {t('goals.deadline')}
              <input
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                className="chunk-input px-3 py-2 text-sm text-text [color-scheme:dark]"
              />
            </label>
            <div className="flex gap-2 pt-0.5">
              <button
                type="submit"
                disabled={!project.trim()}
                className="chunk-btn chunk-btn-accent flex-1 py-2.5 text-[13px]"
              >
                {t('goals.create')}
              </button>
              <button
                type="button"
                onClick={() => setAdding(false)}
                className="chunk-btn px-4 py-2.5 text-[13px] text-text-dim"
              >
                {t('misc.cancel')}
              </button>
            </div>
          </form>
        )}

        {rows.length === 0 && !adding && (
          <div className="chunk flex flex-col items-center gap-3 py-16 text-center">
            <Mascot mood="think" size={64} />
            <span className="text-sm font-semibold text-text-faint">{t('goals.empty')}</span>
          </div>
        )}

        {rows.map(({ goal, doneSec }) => {
          const targetSec = goal.target_hours * 3600;
          const frac = Math.min(1, doneSec / targetSec);
          const remainingSec = Math.max(0, targetSec - doneSec);
          const done = doneSec >= targetSec;

          // pace: how much per day is needed to hit the deadline
          let paceLine: string | null = null;
          if (goal.deadline && !done) {
            const daysLeft = Math.max(
              0,
              Math.ceil(
                (new Date(goal.deadline + 'T23:59:59').getTime() - Date.now()) / 86_400_000,
              ),
            );
            if (daysLeft > 0) {
              const perDay = remainingSec / daysLeft;
              paceLine = t(
                'goals.pace',
                formatDurationShort(remainingSec),
                String(daysLeft),
                `${formatDurationShort(perDay)}`,
              );
            } else {
              paceLine = t('goals.overdue');
            }
          }

          return (
            <div key={goal.id} className="chunk group p-6">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-lg font-bold tracking-tight text-text">{goal.project}</div>
                  <div className="mt-1 text-xs text-text-faint">
                    {goal.deadline
                      ? t(
                          'goals.until',
                          new Date(goal.deadline + 'T00:00:00').toLocaleDateString(dateLocale(), {
                            day: '2-digit',
                            month: '2-digit',
                          }),
                        )
                      : t('goals.notime')}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <span
                      className={`text-2xl font-bold tracking-tight tabular-nums ${done ? 'text-accent' : 'text-text'}`}
                    >
                      {formatDurationShort(doneSec)}
                    </span>
                    <span className="text-sm font-medium text-text-faint"> / {goal.target_hours}h</span>
                  </div>
                  <span className="rounded-full bg-accent-dim px-3 py-1.5 text-[13px] font-bold tabular-nums text-accent">
                    {Math.round(frac * 100)}%
                  </span>
                  <button
                    type="button"
                    onClick={() => remove(goal.id)}
                    className={`rounded-full px-2.5 py-1 text-xs transition-opacity ${
                      confirmDelete === goal.id
                        ? 'bg-danger/15 font-bold text-danger opacity-100'
                        : 'text-text-faint opacity-0 hover:text-danger group-hover:opacity-100'
                    }`}
                  >
                    {confirmDelete === goal.id ? t('misc.sure') : '✕'}
                  </button>
                </div>
              </div>

              <div className="relative mt-4 h-2.5 w-full rounded-full bg-bg">
                {[25, 50, 75].map((pTick) => (
                  <span
                    key={pTick}
                    className="absolute top-1/2 h-1.5 w-px -translate-y-1/2 bg-white/10"
                    style={{ left: `${pTick}%` }}
                  />
                ))}
                <div
                  className="relative h-full min-w-2.5 rounded-full"
                  style={{
                    width: `${frac * 100}%`,
                    background:
                      'linear-gradient(90deg, color-mix(in srgb, var(--color-accent) 55%, transparent), var(--color-accent))',
                    transition: 'width 600ms cubic-bezier(0.16,1,0.3,1)',
                  }}
                >
                  <span className="absolute right-0 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-accent shadow-[0_0_10px_color-mix(in_srgb,var(--color-accent)_60%,transparent)]" />
                </div>
              </div>

              <div className="mt-3 text-[13px] font-semibold text-text-dim">
                {done ? (
                  <span className="text-accent">{t('goals.done')}</span>
                ) : paceLine ? (
                  paceLine
                ) : (
                  t('goals.left', formatDurationShort(remainingSec))
                )}
              </div>
              {doneSec === 0 && !done && (
                <div className="mt-1.5 text-[13px] font-semibold text-warn">
                  {t('goals.zero', goal.project)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

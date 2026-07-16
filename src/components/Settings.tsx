import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { UseSettings } from '../hooks/useSettings';
import { useToast } from '../hooks/useToast';
import * as cloud from '../lib/cloud';
import * as db from '../lib/db';
import { dateLocale, t } from '../lib/i18n';
import { todayKey } from '../lib/time';

interface SettingsProps {
  settingsHook: UseSettings;
  onError: (message: string) => void;
}

const ACCENT_PRESETS = [
  { color: '#d4ff3f', nameKey: 'set.accent.lime' },
  { color: '#ff8c42', nameKey: 'set.accent.orange' },
  { color: '#4da6ff', nameKey: 'set.accent.blue' },
  { color: '#a78bfa', nameKey: 'set.accent.purple' },
  { color: '#ff6bb5', nameKey: 'set.accent.pink' },
  { color: '#7dd3fc', nameKey: 'set.accent.ice' },
  { color: '#f87171', nameKey: 'set.accent.red' },
  { color: '#fbbf24', nameKey: 'set.accent.amber' },
  { color: '#34d399', nameKey: 'set.accent.mint' },
  { color: '#e8e8ec', nameKey: 'set.accent.white' },
];

/** Live view of what the watcher sees — write list entries that match THIS.
 *  Kills the "auto-tracker works for me but not my friend" mystery: the
 *  friend was guessing process names. */
function DetectNow() {
  const [fg, setFg] = useState<{ exe: string; title: string } | null>(null);
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      const [exe, title] = await Promise.all([
        invoke<string | null>('get_foreground_app').catch(() => null),
        invoke<string | null>('get_foreground_window_title').catch(() => null),
      ]);
      if (alive) setFg({ exe: exe ?? '?', title: title ?? '' });
    };
    poll();
    const iv = window.setInterval(poll, 2000);
    return () => {
      alive = false;
      window.clearInterval(iv);
    };
  }, []);
  return (
    <div className="px-4 py-3">
      <div className="text-sm text-text">{t('set.detect.title')}</div>
      <div className="mt-0.5 text-xs text-text-faint">{t('set.detect.hint')}</div>
      <div className="mt-2 rounded-lg border border-border bg-bg px-3 py-2 font-mono text-xs text-text">
        <span className="font-bold text-accent">{fg?.exe ?? '…'}</span>
        {fg?.title ? <span className="text-text-faint"> — {fg.title.slice(0, 60)}</span> : null}
      </div>
    </div>
  );
}

export function SettingsScreen({ settingsHook, onError }: SettingsProps) {
  const { settings, update } = settingsHook;
  const { pushToast } = useToast();
  const [exporting, setExporting] = useState(false);

  // ---- cloud account (sign-in/up UI lives in the full-screen Login gate) ----
  const [account, setAccount] = useState<{ id: string; email: string } | null>(null);
  const [accBusy, setAccBusy] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(
    () => localStorage.getItem('cloud-last-sync'),
  );

  useEffect(() => {
    cloud.currentUser().then(setAccount).catch(() => {});
  }, []);

  function markSynced() {
    const now = new Date().toISOString();
    localStorage.setItem('cloud-last-sync', now);
    setLastSync(now);
  }

  // opens the login gate by clearing guest mode and reloading
  function openLoginGate() {
    localStorage.removeItem('guest-mode');
    window.location.reload();
  }

  async function accSyncNow() {
    setAccBusy(true);
    const err = await cloud.uploadSnapshot();
    setAccBusy(false);
    if (err) pushToast(t('acc.err', err), 'error');
    else {
      markSynced();
      pushToast(t('acc.synced'), 'info');
    }
  }

  async function accLogout() {
    await cloud.signOut();
    setAccount(null);
    pushToast(t('acc.loggedout'), 'info');
  }

  if (!settings) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-text-faint">
        {t('set.loading')}
      </div>
    );
  }

  async function exportData() {
    setExporting(true);
    try {
      const sessions = await db.listSessions({ limit: 100000 });
      const blob = new Blob([JSON.stringify({ sessions }, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `locked-in-export-${todayKey()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      pushToast(t('set.export.done'), 'info');
    } catch (err) {
      onError(String(err));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-lg space-y-7 px-6 pb-10 pt-6">
        <Section title={t('acc.section')}>
          {account ? (
            <>
              <Field label={account.email} hint={lastSync ? t('acc.lastsync', new Date(lastSync).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' })) : t('acc.nosync')}>
                <span className="flex items-center gap-1.5 text-xs text-accent">
                  <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                  {t('acc.connected')}
                </span>
              </Field>
              <div className="flex items-center justify-between gap-2 px-4 py-3.5">
                <button
                  type="button"
                  disabled={accBusy}
                  onClick={accSyncNow}
                  className="chunk-btn chunk-btn-accent flex-1 py-2.5 text-[13px]"
                >
                  {accBusy ? '…' : t('acc.syncnow')}
                </button>
                <button
                  type="button"
                  onClick={accLogout}
                  className="chunk-btn px-4 py-2.5 text-[13px] text-text-dim"
                >
                  {t('acc.logout')}
                </button>
              </div>
            </>
          ) : (
            <div className="space-y-2.5 px-4 py-3.5">
              <div className="text-sm font-semibold text-text">{t('acc.title')}</div>
              <div className="text-xs text-text-faint">{t('acc.hint')}</div>
              <button
                type="button"
                onClick={openLoginGate}
                className="chunk-btn chunk-btn-accent mt-1 w-full py-2.5 text-[13px]"
              >
                {t('acc.signin')} / {t('acc.signup')}
              </button>
            </div>
          )}
        </Section>

        <Section title={t('set.profile')}>
          <Field label="Idioma / Language">
            <Segmented
              options={[
                { value: 'pt', label: 'PT' },
                { value: 'en', label: 'EN' },
              ]}
              value={settings.language || 'pt'}
              onChange={(v) => update('language', v)}
            />
          </Field>
          <Field label={t('set.name')} hint={t('set.name.hint')}>
            <input
              value={settings.user_name}
              onChange={(e) => update('user_name', e.target.value)}
              placeholder={t('set.name.placeholder')}
              className="w-40 rounded-lg border border-border bg-bg px-3 py-2 text-right text-[13px] text-text transition-colors placeholder:text-text-faint focus:border-accent"
            />
          </Field>
        </Section>

        <Section title={t('set.focus')}>
          <Field label={t('set.goal')} hint={t('set.goal.hint')}>
            <Stepper
              value={settings.daily_goal_hours}
              min={1}
              max={16}
              suffix="h"
              onChange={(v) => update('daily_goal_hours', v)}
            />
          </Field>
        </Section>

        <Section title={t('set.intel')}>
          <Field label={t('set.mirror')} hint={t('set.mirror.hint')}>
            <Toggle
              checked={settings.mirror_enabled}
              onChange={(v) => update('mirror_enabled', v)}
            />
          </Field>
          <Field label={t('set.afk')} hint={t('set.afk.hint')}>
            <Toggle checked={settings.afk_enabled} onChange={(v) => update('afk_enabled', v)} />
          </Field>
          <Field label={t('set.afk.threshold')} hint={t('set.afk.threshold.hint')}>
            <Stepper
              value={settings.afk_threshold_min}
              min={1}
              max={30}
              suffix="min"
              onChange={(v) => update('afk_threshold_min', v)}
            />
          </Field>
          <Field label={t('set.burnout')} hint={t('set.burnout.hint')}>
            <Toggle
              checked={settings.burnout_enabled}
              onChange={(v) => update('burnout_enabled', v)}
            />
          </Field>
          <Field label={t('set.burnout.limit')}>
            <Stepper
              value={settings.burnout_limit_hours}
              min={4}
              max={16}
              suffix="h"
              onChange={(v) => update('burnout_limit_hours', v)}
            />
          </Field>
          <Field label={t('set.autoend')} hint={t('set.autoend.hint')}>
            <Toggle
              checked={settings.auto_end_enabled}
              onChange={(v) => update('auto_end_enabled', v)}
            />
          </Field>
          <Field label={t('set.autoend.after')}>
            <Stepper
              value={settings.auto_end_afk_min}
              min={15}
              max={120}
              step={5}
              suffix="min"
              onChange={(v) => update('auto_end_afk_min', v)}
            />
          </Field>
        </Section>

        <Section title={t('set.checkin')}>
          <Field label={t('set.checkin.enable')} hint={t('set.checkin.enable.hint')}>
            <Toggle
              checked={settings.checkin_enabled}
              onChange={(v) => update('checkin_enabled', v)}
            />
          </Field>
          <Field label={t('set.checkin.interval')} hint={t('set.checkin.interval.hint')}>
            <Stepper
              value={settings.checkin_interval_min}
              min={15}
              max={240}
              step={15}
              suffix="min"
              onChange={(v) => update('checkin_interval_min', v)}
            />
          </Field>
          <Field label={t('set.checkin.onlysession')} hint={t('set.checkin.onlysession.hint')}>
            <Toggle
              checked={settings.checkin_only_session}
              onChange={(v) => update('checkin_only_session', v)}
            />
          </Field>
          <Field label={t('set.checkin.test')} hint={t('set.checkin.test.hint')}>
            <button
              type="button"
              onClick={() => invoke('test_checkin').catch(() => {})}
              className="rounded-lg border border-border px-4 py-2 text-[13px] font-medium text-text hover:border-accent/50 hover:bg-accent-dim hover:text-accent"
            >
              {t('set.checkin.test.btn')}
            </button>
          </Field>
        </Section>

        <Section title={t('set.nudge')}>
          <Field label={t('set.nudge.enable')} hint={t('set.nudge.enable.hint')}>
            <Toggle checked={settings.nudge_enabled} onChange={(v) => update('nudge_enabled', v)} />
          </Field>
          <Field label={t('set.nudge.threshold')} hint={t('set.nudge.threshold.hint')}>
            <Stepper
              value={settings.nudge_threshold_min}
              min={1}
              max={30}
              suffix="min"
              onChange={(v) => update('nudge_threshold_min', v)}
            />
          </Field>
          <div className="px-4 py-3.5">
            <div className="text-sm text-text">{t('set.nudge.apps')}</div>
            <div className="mt-0.5 text-xs text-text-faint">{t('set.nudge.apps.hint')}</div>
            <textarea
              value={settings.nudge_apps}
              onChange={(e) => update('nudge_apps', e.target.value)}
              spellCheck={false}
              className="mt-2.5 h-20 w-full resize-none rounded-lg border border-border bg-bg px-3 py-2 font-mono text-xs leading-relaxed text-text transition-colors placeholder:text-text-faint focus:border-accent"
            />
          </div>
          <Field label={t('set.checkin.test')} hint={t('set.nudge.test.hint')}>
            <button
              type="button"
              onClick={() => invoke('test_nudge').catch(() => {})}
              className="rounded-lg border border-border px-4 py-2 text-[13px] font-medium text-text hover:border-accent/50 hover:bg-accent-dim hover:text-accent"
            >
              {t('set.checkin.test.btn')}
            </button>
          </Field>
        </Section>

        <Section title={t('set.autotrack')}>
          <Field label={t('set.autotrack.enable')} hint={t('set.autotrack.enable.hint')}>
            <Toggle
              checked={settings.autotrack_enabled}
              onChange={(v) => update('autotrack_enabled', v)}
            />
          </Field>
          <Field label={t('set.autotrack.overlay')} hint={t('set.autotrack.overlay.hint')}>
            <Toggle
              checked={settings.autotrack_show_overlay}
              onChange={(v) => update('autotrack_show_overlay', v)}
            />
          </Field>
          <div className="px-4 py-3.5">
            <div className="text-sm text-text">{t('set.autotrack.apps')}</div>
            <div className="mt-0.5 text-xs text-text-faint">{t('set.autotrack.apps.hint')}</div>
            <textarea
              value={settings.autotrack_apps}
              onChange={(e) => update('autotrack_apps', e.target.value)}
              spellCheck={false}
              className="mt-2.5 h-16 w-full resize-none rounded-lg border border-border bg-bg px-3 py-2 font-mono text-xs leading-relaxed text-text transition-colors placeholder:text-text-faint focus:border-accent"
            />
          </div>
          <DetectNow />
        </Section>

        <Section title={t('set.quotes')}>
          <Field label={t('set.quotes.enable')} hint={t('set.quotes.enable.hint')}>
            <Toggle
              checked={settings.quotes_enabled}
              onChange={(v) => update('quotes_enabled', v)}
            />
          </Field>
          <Field label={t('set.quotes.interval')} hint={t('set.quotes.interval.hint')}>
            <Stepper
              value={settings.quotes_interval_min}
              min={5}
              max={240}
              step={5}
              suffix="min"
              onChange={(v) => update('quotes_interval_min', v)}
            />
          </Field>
          <Field label={t('set.checkin.test')} hint={t('set.quotes.test.hint')}>
            <button
              type="button"
              onClick={() => invoke('test_quote').catch(() => {})}
              className="rounded-lg border border-border px-4 py-2 text-[13px] font-medium text-text hover:border-accent/50 hover:bg-accent-dim hover:text-accent"
            >
              {t('set.checkin.test.btn')}
            </button>
          </Field>
        </Section>

        <Section title={t('set.refboard')}>
          <Field label={t('set.refboard.enable')} hint={t('set.refboard.hint')}>
            <Toggle
              checked={settings.refboard_enabled}
              onChange={(v) => update('refboard_enabled', v)}
            />
          </Field>
        </Section>

        <Section title={t('set.overlay')}>
          <Field label={t('set.overlay.enable')} hint={t('set.overlay.enable.hint')}>
            <Toggle
              checked={settings.overlay_enabled}
              onChange={(v) => update('overlay_enabled', v)}
            />
          </Field>
          <Field label={t('set.overlay.opacity')} hint={t('set.overlay.opacity.hint')}>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={15}
                max={100}
                step={5}
                value={settings.overlay_opacity}
                onChange={(e) => update('overlay_opacity', Number(e.target.value))}
                className="w-32"
              />
              <span className="w-10 text-right font-mono text-xs tabular-nums text-text-dim">
                {settings.overlay_opacity}%
              </span>
            </div>
          </Field>
          <Field label={t('set.overlay.size')}>
            <Segmented
              options={[
                { value: 'sm', label: t('set.size.sm') },
                { value: 'md', label: t('set.size.md') },
                { value: 'lg', label: t('set.size.lg') },
              ]}
              value={settings.overlay_size}
              onChange={(v) => update('overlay_size', v)}
            />
          </Field>
          <Field label={t('set.overlay.task')} hint={t('set.overlay.task.hint')}>
            <Toggle
              checked={settings.overlay_show_task}
              onChange={(v) => update('overlay_show_task', v)}
            />
          </Field>
          <Field label={t('set.overlay.goal')} hint={t('set.overlay.goal.hint')}>
            <Toggle
              checked={settings.overlay_show_goal}
              onChange={(v) => update('overlay_show_goal', v)}
            />
          </Field>
        </Section>

        <Section title={t('set.appearance')}>
          <Field label={t('set.accent')} hint={t('set.accent.hint')}>
            <div className="flex items-center gap-1.5">
              {ACCENT_PRESETS.map((preset) => (
                <button
                  key={preset.color}
                  type="button"
                  title={t(preset.nameKey)}
                  onClick={() => update('accent_color', preset.color)}
                  className={`h-7 w-7 rounded-full transition-transform hover:scale-110 ${
                    settings.accent_color === preset.color
                      ? 'ring-2 ring-text ring-offset-2 ring-offset-surface'
                      : ''
                  }`}
                  style={{ backgroundColor: preset.color }}
                />
              ))}
            </div>
          </Field>
        </Section>

        <Section title={t('set.notifications')}>
          <Field label={t('set.sound')} hint={t('set.sound.hint')}>
            <Toggle checked={settings.sound_enabled} onChange={(v) => update('sound_enabled', v)} />
          </Field>
          <Field label={t('set.notify.break')}>
            <Toggle
              checked={settings.notify_break_end}
              onChange={(v) => update('notify_break_end', v)}
            />
          </Field>
          <Field label={t('set.notify.milestones')} hint={t('set.notify.milestones.hint')}>
            <Toggle
              checked={settings.notify_milestones}
              onChange={(v) => update('notify_milestones', v)}
            />
          </Field>
          <Field label={t('set.profile.projects')} hint={t('set.profile.projects.hint')}>
            <Toggle
              checked={settings.profile_projects_public}
              onChange={(v) => update('profile_projects_public', v)}
            />
          </Field>
          <Field label={t('set.friendsbar')} hint={t('set.friendsbar.hint')}>
            <Toggle
              checked={settings.friends_bar_enabled}
              onChange={(v) => update('friends_bar_enabled', v)}
            />
          </Field>
          <Field label={t('set.pomodoro')} hint={t('set.pomodoro.hint')}>
            <Toggle
              checked={settings.pomodoro_enabled}
              onChange={(v) => update('pomodoro_enabled', v)}
            />
          </Field>
        </Section>

        <Section title={t('set.system')}>
          <Field label={t('set.autostart')} hint={t('set.autostart.hint')}>
            <Toggle
              checked={settings.autostart_enabled}
              onChange={(v) => {
                update('autostart_enabled', v);
                invoke('set_autostart', { enabled: v }).catch((err) =>
                  pushToast(String(err), 'error'),
                );
              }}
            />
          </Field>
        </Section>

        <Section title={t('set.data')}>
          <div className="flex items-center justify-between px-4 py-3.5">
            <div>
              <div className="text-sm text-text">{t('set.export')}</div>
              <div className="mt-0.5 text-xs text-text-faint">{t('set.export.hint')}</div>
            </div>
            <button
              type="button"
              onClick={exportData}
              disabled={exporting}
              className="rounded-lg border border-border px-4 py-2 text-[13px] font-medium text-text hover:border-border-strong hover:bg-surface-hover disabled:opacity-50"
            >
              {exporting ? t('set.export.busy') : t('set.export.btn')}
            </button>
          </div>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-2.5 text-xs font-medium uppercase tracking-[0.12em] text-text-faint">
        {title}
      </h2>
      <div className="divide-y divide-border rounded-2xl border border-border bg-surface">
        {children}
      </div>
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3.5">
      <div className="min-w-0">
        <div className="text-sm text-text">{label}</div>
        {hint && <div className="mt-0.5 text-xs text-text-faint">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Segmented({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-border bg-bg p-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`h-7 w-9 rounded-md text-[13px] font-medium ${
            value === opt.value
              ? 'bg-surface-hover text-text'
              : 'text-text-dim hover:text-text'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function Stepper({
  value,
  min,
  max,
  step = 1,
  suffix,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-border bg-bg p-0.5">
      <button
        type="button"
        onClick={() => onChange(clamp(value - step))}
        disabled={value <= min}
        className="h-7 w-7 rounded-md text-text-dim hover:bg-surface-hover hover:text-text disabled:opacity-30"
        aria-label={t('misc.dec')}
      >
        −
      </button>
      <span className="min-w-[52px] text-center font-mono text-[13px] tabular-nums text-text">
        {value}
        {suffix && <span className="ml-0.5 text-text-faint">{suffix}</span>}
      </span>
      <button
        type="button"
        onClick={() => onChange(clamp(value + step))}
        disabled={value >= max}
        className="h-7 w-7 rounded-md text-text-dim hover:bg-surface-hover hover:text-text disabled:opacity-30"
        aria-label={t('misc.inc')}
      >
        +
      </button>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`h-[22px] w-10 rounded-full p-[2px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        checked ? 'bg-accent' : 'bg-border-strong'
      }`}
    >
      <span
        className={`block h-[18px] w-[18px] rounded-full bg-bg shadow-sm transition-transform ${
          checked ? 'translate-x-[18px]' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { Chat } from './components/Chat';
import { CheckinPage } from './components/Checkin';
import { HabitsPage } from './components/Habits';
import { Home } from './components/Home';
import { Log } from './components/Log';
import { Stats } from './components/Stats';
import { SettingsScreen } from './components/Settings';
import { Week } from './components/Week';
import { useFocusSession } from './hooks/useFocusSession';
import { useSettings } from './hooks/useSettings';
import { ToastProvider, useToast } from './hooks/useToast';
import * as db from './lib/db';
import { check } from '@tauri-apps/plugin-updater';
import type { Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { setLang, t } from './lib/i18n';
import { checkMilestones } from './lib/milestones';
import { playChime } from './lib/sound';
import { formatHms, todayKey } from './lib/time';
import { Mascot } from './components/Mascot';
import type { OverlaySize, OverlayState } from './types';

function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return `rgba(212, 255, 63, ${alpha})`;
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
}

type Tab = 'home' | 'checkin' | 'habits' | 'week' | 'log' | 'stats' | 'chat' | 'settings';

const TABS: { id: Tab; labelKey: string }[] = [
  { id: 'home', labelKey: 'tab.home' },
  { id: 'checkin', labelKey: 'tab.checkin' },
  { id: 'habits', labelKey: 'tab.habits' },
  { id: 'week', labelKey: 'tab.week' },
  { id: 'log', labelKey: 'tab.log' },
  { id: 'stats', labelKey: 'tab.stats' },
  { id: 'chat', labelKey: 'tab.chat' },
  { id: 'settings', labelKey: 'tab.settings' },
];

function AppShell() {
  const { pushToast } = useToast();
  const onError = useCallback((message: string) => pushToast(message, 'error'), [pushToast]);
  const settingsHook = useSettings(onError);
  const focus = useFocusSession({
    mirrorEnabled: settingsHook.settings?.mirror_enabled ?? true,
    afkEnabled: settingsHook.settings?.afk_enabled ?? true,
    afkThresholdMin: settingsHook.settings?.afk_threshold_min ?? 5,
    autoEndEnabled: settingsHook.settings?.auto_end_enabled ?? true,
    autoEndAfkMin: settingsHook.settings?.auto_end_afk_min ?? 40,
    onAutoEnd: (task, minutes, reason) => {
      const msg =
        reason === 'paused'
          ? t('sess.pausedend.toast', task)
          : t('sess.autoend.toast', task, String(minutes));
      pushToast(msg, 'info');
      invoke('show_notice', { title: 'Locked In', body: msg, mood: 'sleep' }).catch(() => {});
    },
  });
  const [tab, setTab] = useState<Tab>('home');
  const [refreshKey, setRefreshKey] = useState(0);

  // language: apply saved choice; empty = first run, ask
  const language = settingsHook.settings?.language;
  setLang(language === 'en' ? 'en' : 'pt');
  const showFirstRun = settingsHook.settings !== null && language === '';

  // tray menu follows the language
  useEffect(() => {
    if (!language) return;
    invoke('set_tray_lang', { lang: language }).catch(() => {});
  }, [language]);

  // daily local backup of the sqlite db — delayed so the copy (which briefly
  // deny-writes the file) can never race the sqlite connection opening at boot
  useEffect(() => {
    const id = window.setTimeout(() => invoke('backup_database').catch(() => {}), 15_000);
    return () => window.clearTimeout(id);
  }, []);

  // auto-update: check on boot + every 6h → corner popup → one click downloads,
  // installs with a progress screen and relaunches into the new version
  const [updating, setUpdating] = useState<{ version: string; pct: number | null } | null>(null);
  const pendingUpdateRef = useRef<Update | null>(null);
  useEffect(() => {
    let shownFor: string | null = null;
    const lookForUpdate = () => {
      check()
        .then((update) => {
          if (update && shownFor !== update.version) {
            shownFor = update.version;
            pendingUpdateRef.current = update;
            invoke('show_update_popup', { version: update.version, url: '' }).catch(() => {});
          }
        })
        .catch(() => {}); // offline / manifest missing — silently skip
    };
    const boot = window.setTimeout(lookForUpdate, 8_000);
    const iv = window.setInterval(lookForUpdate, 6 * 3600_000);

    let unlisten: (() => void) | undefined;
    listen('update:install', async () => {
      const update = pendingUpdateRef.current;
      if (!update) return;
      invoke('show_main_window').catch(() => {});
      setUpdating({ version: update.version, pct: null });
      try {
        let total = 0;
        let received = 0;
        await update.downloadAndInstall((e) => {
          if (e.event === 'Started') {
            total = e.data.contentLength ?? 0;
          } else if (e.event === 'Progress') {
            received += e.data.chunkLength;
            if (total > 0) {
              setUpdating({ version: update.version, pct: Math.min(99, (received / total) * 100) });
            }
          } else if (e.event === 'Finished') {
            setUpdating({ version: update.version, pct: 100 });
          }
        });
        await relaunch();
      } catch (err) {
        setUpdating(null);
        pushToast(t('up.error', String(err)), 'error');
      }
    }).then((u) => {
      unlisten = u;
    });

    return () => {
      window.clearTimeout(boot);
      window.clearInterval(iv);
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // feed the native watchers (hourly check-in + anti-procrastination nudge);
  // retries a few times — the very first sync can race Rust initialization
  useEffect(() => {
    const s = settingsHook.settings;
    if (!s) return;
    let cancelled = false;
    const cfg = {
      checkin_enabled: s.checkin_enabled,
      checkin_interval_min: s.checkin_interval_min,
      checkin_only_session: s.checkin_only_session,
      nudge_enabled: s.nudge_enabled,
      nudge_threshold_min: s.nudge_threshold_min,
      nudge_apps: s.nudge_apps,
      session_active: focus.phase === 'focusing',
      suspended: focus.phase === 'paused' || focus.phase === 'break',
      lang: s.language === 'en' ? 'en' : 'pt',
      sound: s.sound_enabled,
      accent: s.accent_color,
    };
    const attempt = (triesLeft: number) => {
      invoke('sync_watchers', { cfg }).catch((err) => {
        if (cancelled) return;
        if (triesLeft > 0) {
          window.setTimeout(() => attempt(triesLeft - 1), 1500);
        } else {
          console.error('[sync_watchers]', err);
          pushToast(`watchers: ${String(err)}`, 'error');
        }
      });
    };
    attempt(4);
    return () => {
      cancelled = true;
    };
  }, [settingsHook.settings, focus.phase, pushToast]);

  useEffect(() => {
    if (focus.error) onError(focus.error);
  }, [focus.error, onError]);

  const prevPhase = useRef(focus.phase);
  useEffect(() => {
    const prev = prevPhase.current;
    prevPhase.current = focus.phase;
    // refresh when a session is saved (rating -> break/idle) or a break ends
    if (prev !== focus.phase && (prev === 'rating' || focus.phase === 'idle')) {
      setRefreshKey((k) => k + 1);
    }
  }, [focus.phase]);

  // today's total (for overlay goal bar)
  const [todaySec, setTodaySec] = useState(0);
  useEffect(() => {
    db.getDaySummary(todayKey())
      .then((d) => setTodaySec(d.total_sec))
      .catch((err) => onError(String(err)));
  }, [refreshKey, onError]);

  const goalSec = (settingsHook.settings?.daily_goal_hours ?? 4) * 3600;
  // todayElapsedSec: sessions crossing midnight only count today's share
  const liveTodaySec =
    todaySec +
    (focus.phase === 'focusing' || focus.phase === 'paused' ? focus.todayElapsedSec : 0);
  const goalProgress = Math.min(1, liveTodaySec / goalSec);

  // apply accent color everywhere in the main window
  const accentColor = settingsHook.settings?.accent_color ?? '#d4ff3f';
  useEffect(() => {
    document.documentElement.style.setProperty('--color-accent', accentColor);
    document.documentElement.style.setProperty('--color-accent-dim', hexToRgba(accentColor, 0.12));
  }, [accentColor]);

  // broadcast state to the floating overlay
  const overlayState: OverlayState = {
    phase: focus.phase === 'rating' ? 'focusing' : focus.phase,
    task: focus.activeSession?.task ?? null,
    elapsedSec: focus.elapsedSec,
    breakRemainingSec: focus.breakRemainingSec,
    breakOverrunSec: focus.breakOverrunSec,
    goalProgress,
    todaySec: liveTodaySec,
    cfg: {
      opacity: settingsHook.settings?.overlay_opacity ?? 40,
      size: (settingsHook.settings?.overlay_size ?? 'md') as OverlaySize,
      showTask: settingsHook.settings?.overlay_show_task ?? true,
      showGoal: settingsHook.settings?.overlay_show_goal ?? true,
      accent: accentColor,
      lang: language === 'en' ? 'en' : 'pt',
    },
  };
  const overlayStateRef = useRef(overlayState);
  overlayStateRef.current = overlayState;
  useEffect(() => {
    emit('overlay:state', overlayStateRef.current).catch(() => {});
  }, [
    focus.phase,
    focus.elapsedSec,
    focus.breakRemainingSec,
    focus.breakOverrunSec,
    focus.activeSession,
    goalProgress,
    settingsHook.settings,
  ]);

  // overlay commands + late-join handshake
  const focusRef = useRef(focus);
  focusRef.current = focus;
  useEffect(() => {
    const unlisteners: (() => void)[] = [];
    // rust re-applies the app icon on every show (Windows loses it after tray cycles)
    const showMain = () => invoke('show_main_window').catch(() => {});
    listen<{ cmd: string }>('overlay:cmd', (e) => {
      const { cmd } = e.payload;
      if (cmd === 'pause') {
        if (focusRef.current.phase === 'focusing') focusRef.current.pauseSession();
      } else if (cmd === 'resume') {
        if (focusRef.current.phase === 'paused') focusRef.current.resumeSession();
      } else if (cmd === 'open-main') {
        showMain();
      } else if (cmd === 'end-break') {
        focusRef.current.endBreakNow();
      }
    }).then((u) => unlisteners.push(u));
    listen('overlay:ready', () => {
      emit('overlay:state', overlayStateRef.current).catch(() => {});
    }).then((u) => unlisteners.push(u));
    return () => unlisteners.forEach((u) => u());
  }, []);

  // show/hide overlay window per setting
  useEffect(() => {
    const enabled = settingsHook.settings?.overlay_enabled;
    if (enabled === undefined) return;
    WebviewWindow.getByLabel('overlay')
      .then((w) => (enabled ? w?.show() : w?.hide()))
      .catch(() => {});
  }, [settingsHook.settings?.overlay_enabled]);

  // show/hide the reference board per setting; its ✕ flips the setting off
  useEffect(() => {
    const enabled = settingsHook.settings?.refboard_enabled;
    if (enabled === undefined) return;
    WebviewWindow.getByLabel('refboard')
      .then((w) => (enabled ? w?.show() : w?.hide()))
      .catch(() => {});
  }, [settingsHook.settings?.refboard_enabled]);

  const settingsUpdateRef = useRef(settingsHook.update);
  settingsUpdateRef.current = settingsHook.update;
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen('refboard:closed', () => {
      settingsUpdateRef.current('refboard_enabled', false);
    }).then((u) => {
      unlisten = u;
    });
    return () => unlisten?.();
  }, []);

  // anti-burnout: gentle stop signal once per day
  const burnoutNotifiedDay = useRef<string | null>(null);
  useEffect(() => {
    const s = settingsHook.settings;
    if (!s || !s.burnout_enabled || focus.phase !== 'focusing') return;
    const limitSec = s.burnout_limit_hours * 3600;
    const day = todayKey();
    if (liveTodaySec >= limitSec && burnoutNotifiedDay.current !== day) {
      burnoutNotifiedDay.current = day;
      const msg = t('burnout.msg', String(s.burnout_limit_hours));
      pushToast(msg, 'info');
      invoke('show_notice', { title: 'Locked In', body: msg, mood: 'sad' }).catch(() => {});
    }
  }, [liveTodaySec, focus.phase, settingsHook.settings, pushToast]);

  // anti-doomscroll: temporarily disabled (flip with lib.rs DOOMSCROLL_ENABLED)
  const DOOMSCROLL_ENABLED = false;
  const liveTodaySecRef = useRef(0);
  liveTodaySecRef.current = liveTodaySec;
  const instaSettingsRef = useRef(settingsHook.settings);
  instaSettingsRef.current = settingsHook.settings;

  useEffect(() => {
    if (!DOOMSCROLL_ENABLED) return;
    let cancelled = false;
    async function sync() {
      const s = instaSettingsRef.current;
      if (!s) return;
      try {
        const used = await invoke<number>('sync_insta', {
          enabled: s.insta_enabled,
          limitMin: s.insta_limit_min,
          workMin: s.insta_work_min,
          bonusMin: s.insta_bonus_min,
          focusTodaySec: Math.max(0, Math.floor(liveTodaySecRef.current)),
        });
        if (!cancelled && used > 0) {
          db.setInstaUsedSec(todayKey(), used).catch(() => {});
        }
      } catch {
        // rust side not ready yet — next tick
      }
    }
    sync();
    const id = window.setInterval(sync, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [settingsHook.settings]);

  // milestones: check after each saved session
  useEffect(() => {
    if (refreshKey === 0) return;
    checkMilestones(settingsHook.settings?.daily_goal_hours ?? 4)
      .then((messages) => {
        if (messages.length === 0) return;
        if (settingsHook.settings?.notify_milestones === false) return;
        if (settingsHook.settings?.sound_enabled) playChime();
        for (const m of messages) {
          pushToast(m, 'info');
        }
        // one notice card is enough even when several milestones land together
        invoke('show_notice', { title: 'Locked In', body: messages.join('\n'), mood: 'hyped' }).catch(
          () => {},
        );
      })
      .catch((err) => onError(String(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  useEffect(() => {
    const tooltip =
      focus.phase === 'focusing'
        ? t('tray.focusing', formatHms(focus.elapsedSec))
        : focus.phase === 'paused'
          ? t('tray.paused')
          : focus.phase === 'break'
            ? t('tray.break')
            : 'Locked In';
    invoke('set_tray_status', { tooltip }).catch(() => {});
  }, [focus.phase, focus.elapsedSec]);

  const notifiedBreakEnd = useRef(false);
  useEffect(() => {
    if (focus.phase !== 'break') {
      notifiedBreakEnd.current = false;
      return;
    }
    if (focus.breakRemainingSec <= 0 && !notifiedBreakEnd.current) {
      notifiedBreakEnd.current = true;
      if (settingsHook.settings?.sound_enabled) playChime();
      if (settingsHook.settings?.notify_break_end === false) return;
      invoke('show_notice', {
        title: 'Locked In',
        body: t('notif.breakend'),
        mood: 'happy',
      }).catch(() => {});
    }
  }, [
    focus.phase,
    focus.breakRemainingSec,
    settingsHook.settings?.sound_enabled,
    settingsHook.settings?.notify_break_end,
  ]);

  const statusChip =
    focus.phase === 'focusing' || focus.phase === 'paused' ? (
      <button
        type="button"
        onClick={() => setTab('home')}
        className="flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 hover:border-border-strong"
        title={focus.phase === 'paused' ? t('home.paused') : t('home.rating.back')}
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            focus.phase === 'paused' ? 'bg-warn' : 'animate-pulse-dot bg-accent'
          }`}
        />
        <span
          className={`font-mono text-xs tabular-nums ${
            focus.phase === 'paused' ? 'text-text-dim' : 'text-text'
          }`}
        >
          {formatHms(focus.elapsedSec)}
        </span>
      </button>
    ) : focus.phase === 'break' ? (
      <button
        type="button"
        onClick={() => setTab('home')}
        className="flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 hover:border-border-strong"
        title={t('ov.break')}
      >
        <span className="animate-pulse-dot h-1.5 w-1.5 rounded-full bg-warn" />
        <span className="font-mono text-xs tabular-nums text-text">
          {focus.breakRemainingSec >= 0
            ? formatHms(focus.breakRemainingSec)
            : `+${formatHms(focus.breakOverrunSec)}`}
        </span>
      </button>
    ) : null;

  return (
    <div className="flex h-screen flex-col bg-bg text-text">
      {showFirstRun && (
        <div className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="animate-scale-in flex w-full max-w-sm flex-col items-center rounded-2xl border border-border bg-surface p-8 text-center shadow-2xl shadow-black/50">
            <Mascot mood="happy" size={90} />
            <h2 className="mt-4 text-lg font-semibold tracking-tight text-text">
              escolhe teu idioma · pick your language
            </h2>
            <p className="mt-1 text-xs text-text-faint">
              dá pra trocar depois nos Ajustes · you can change it later
            </p>
            <div className="mt-6 flex w-full gap-2">
              <button
                type="button"
                onClick={() => settingsHook.update('language', 'pt')}
                className="flex-1 rounded-xl border border-border bg-bg px-4 py-3 text-sm font-semibold text-text transition-colors hover:border-accent"
              >
                🇧🇷 Português
              </button>
              <button
                type="button"
                onClick={() => settingsHook.update('language', 'en')}
                className="flex-1 rounded-xl border border-border bg-bg px-4 py-3 text-sm font-semibold text-text transition-colors hover:border-accent"
              >
                🇺🇸 English
              </button>
            </div>
          </div>
        </div>
      )}

      {updating && (
        <div className="animate-fade-in fixed inset-0 z-[60] flex items-center justify-center bg-black/85 backdrop-blur-sm">
          <div className="animate-scale-in flex w-full max-w-sm flex-col items-center rounded-2xl border border-border bg-surface p-8 text-center shadow-2xl shadow-black/50">
            <Mascot mood="hyped" size={80} />
            <h2 className="mt-4 text-lg font-semibold tracking-tight text-text">
              {t('up.installing')} <span className="font-mono text-accent">v{updating.version}</span>
            </h2>
            <p className="mt-1 text-xs text-text-faint">{t('up.installing.sub')}</p>
            <div className="mt-5 h-2 w-full overflow-hidden rounded-full bg-bg">
              <div
                className={`h-full rounded-full bg-accent ${updating.pct === null ? 'animate-pulse' : ''}`}
                style={{
                  width: `${updating.pct ?? 15}%`,
                  transition: 'width 300ms ease',
                }}
              />
            </div>
            <div className="mt-2 font-mono text-xs tabular-nums text-text-dim">
              {updating.pct === null ? '…' : `${Math.round(updating.pct)}%`}
            </div>
          </div>
        </div>
      )}

      {focus.recoveredSession && (
        <div className="animate-fade-in fixed inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="animate-scale-in w-full max-w-sm rounded-2xl border border-border bg-surface p-6 shadow-2xl shadow-black/50">
            <h2 className="mb-2 text-base font-semibold text-text">{t('misc.recovered.title')}</h2>
            <p className="mb-5 text-sm leading-relaxed text-text-dim">
              {t('misc.recovered.body', focus.recoveredSession.task)}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={focus.keepRecoveredSession}
                className="flex-1 rounded-lg bg-accent py-2 text-sm font-semibold text-bg hover:brightness-110"
              >
                {t('misc.save')}
              </button>
              <button
                type="button"
                onClick={focus.discardRecoveredSession}
                className="flex-1 rounded-lg border border-border py-2 text-sm text-text-dim hover:bg-surface-hover hover:text-text"
              >
                {t('misc.discard')}
              </button>
            </div>
          </div>
        </div>
      )}

      <header className="flex h-13 shrink-0 items-center justify-between gap-3 border-b border-border px-3 sm:px-5">
        <div className="hidden items-center gap-2 md:flex">
          <span className="h-2 w-2 rounded-full bg-accent" />
          <span className="text-sm font-semibold tracking-tight text-text">Locked In</span>
        </div>

        <nav className="scrollbar-none flex min-w-0 items-center gap-0.5 overflow-x-auto rounded-full border border-border bg-surface p-0.5">
          {TABS.map((tabDef) => (
            <button
              key={tabDef.id}
              type="button"
              onClick={() => setTab(tabDef.id)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-[13px] font-medium sm:px-3.5 ${
                tab === tabDef.id
                  ? 'bg-surface-hover text-text shadow-sm'
                  : 'text-text-dim hover:text-text'
              }`}
            >
              {t(tabDef.labelKey)}
            </button>
          ))}
        </nav>

        <div className="flex shrink-0 items-center justify-end md:min-w-[110px]">{statusChip}</div>
      </header>

      <main key={tab} className="animate-fade-up min-h-0 flex-1">
        {tab === 'home' && (
          <Home
            focus={focus}
            settings={settingsHook.settings}
            onError={onError}
            refreshKey={refreshKey}
            onOpenHabits={() => setTab('habits')}
          />
        )}
        {tab === 'checkin' && (
          <CheckinPage settings={settingsHook.settings} onError={onError} />
        )}
        {tab === 'habits' && <HabitsPage onError={onError} />}
        {tab === 'week' && (
          <Week
            onError={onError}
            refreshKey={refreshKey}
            dailyGoalHours={settingsHook.settings?.daily_goal_hours ?? 4}
          />
        )}
        {tab === 'log' && <Log onError={onError} refreshKey={refreshKey} />}
        {tab === 'stats' && (
          <Stats settings={settingsHook.settings} onError={onError} refreshKey={refreshKey} />
        )}
        {tab === 'chat' && (
          <Chat
            apiKey={settingsHook.settings?.anthropic_api_key ?? ''}
            onError={onError}
            onOpenSettings={() => setTab('settings')}
          />
        )}
        {tab === 'settings' && <SettingsScreen settingsHook={settingsHook} onError={onError} />}
      </main>
    </div>
  );
}

function App() {
  return (
    <ToastProvider>
      <AppShell />
    </ToastProvider>
  );
}

export default App;

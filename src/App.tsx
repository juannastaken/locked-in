import { useCallback, useEffect, useRef, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { CheckinPage } from './components/Checkin';
import { ClaimUsernameForm, FriendsPage } from './components/Friends';
import { FriendsBar } from './components/FriendsBar';
import { JamPromptOverlay } from './components/JamPrompt';
import { KeyBackupModal } from './components/KeyBackup';
import { GoalsPage } from './components/Goals';
import { Login } from './components/Login';
import { Splash } from './components/Splash';
import { HabitsPage } from './components/Habits';
import { Home } from './components/Home';
import { Log } from './components/Log';
import { Stats } from './components/Stats';
import { CommandPalette } from './components/CommandPalette';
import type { Command } from './components/CommandPalette';
import { ProfilePage } from './components/Profile';
import { SettingsScreen } from './components/Settings';
import { Titlebar } from './components/Titlebar';
import { Week } from './components/Week';
import { useFocusSession } from './hooks/useFocusSession';
import { useSettings } from './hooks/useSettings';
import { useSocial } from './hooks/useSocial';
import { useJam } from './hooks/useJam';
import type { FriendEntry } from './lib/social';
import * as socialLib from './lib/social';
import * as chatLib from './lib/chat';
import * as e2e from './lib/e2e';
import { ToastProvider, useToast } from './hooks/useToast';
import * as db from './lib/db';
import { check } from '@tauri-apps/plugin-updater';
import type { Update } from '@tauri-apps/plugin-updater';
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

type Tab = 'home' | 'routine' | 'analytics' | 'goals' | 'friends' | 'profile' | 'settings';

// settings + profile intentionally not in the nav — the titlebar gear and
// avatar menu open them. Check-in/Hábitos live under Rotina; Semana/Stats/
// Histórico under Análise, so the top bar stays at five buttons.
const TABS: { id: Tab; labelKey: string }[] = [
  { id: 'home', labelKey: 'tab.home' },
  { id: 'routine', labelKey: 'tab.routine' },
  { id: 'analytics', labelKey: 'tab.analytics' },
  { id: 'goals', labelKey: 'tab.goals' },
  { id: 'friends', labelKey: 'tab.friends' },
];

function SubTabs<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { id: T; labelKey: string }[];
}) {
  return (
    <div className="flex justify-center pt-4">
      <div className="flex items-center gap-0.5 rounded-full border border-border bg-surface p-0.5">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            className={`rounded-full px-3.5 py-1.5 text-[13px] font-semibold ${
              value === o.id
                ? 'bg-surface-hover text-text shadow-sm'
                : 'text-text-dim hover:text-text'
            }`}
          >
            {t(o.labelKey)}
          </button>
        ))}
      </div>
    </div>
  );
}

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
  const [routineSub, setRoutineSub] = useState<'checkin' | 'habits'>('checkin');
  const [analyticsSub, setAnalyticsSub] = useState<'week' | 'stats' | 'log'>('week');
  const [refreshKey, setRefreshKey] = useState(0);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // keyboard: Ctrl+K command palette, Ctrl+1..5 tab jump
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      if (e.ctrlKey && e.key >= '1' && e.key <= String(TABS.length)) {
        e.preventDefault();
        setTab(TABS[Number(e.key) - 1].id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // boot splash: shown at least 5s while everything loads behind it
  const [splashDone, setSplashDone] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setSplashDone(true), 5000);
    return () => window.clearTimeout(id);
  }, []);

  // language: apply saved choice; empty = first run, ask. Default is English.
  const language = settingsHook.settings?.language;
  setLang(language === 'pt' ? 'pt' : 'en');
  const showFirstRun = settingsHook.settings !== null && language === '';

  // auth gate: after the language is picked, show the login screen unless the
  // user is already signed in or chose guest mode on this machine
  const [authChecked, setAuthChecked] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [guest, setGuest] = useState(() => localStorage.getItem('guest-mode') === '1');
  useEffect(() => {
    import('./lib/cloud')
      .then((cloud) => cloud.currentUser())
      .then((u) => setSignedIn(!!u))
      .catch(() => setSignedIn(false))
      .finally(() => setAuthChecked(true));
  }, []);
  const showLogin =
    settingsHook.settings !== null && !showFirstRun && authChecked && !signedIn && !guest;

  // friends + live presence (inert for guests)
  const social = useSocial(signedIn, onError);

  // presence heartbeat: my session state → cloud, on every phase change and
  // every 60s while the app runs. Friends treat rows older than ~2.5min as
  // offline, so closing the app (no explicit "stop") self-heals.
  const heartbeatRef = useRef({
    phase: focus.phase,
    task: focus.activeSession?.task ?? null,
    elapsedSec: focus.elapsedSec,
  });
  heartbeatRef.current = {
    phase: focus.phase,
    task: focus.activeSession?.task ?? null,
    elapsedSec: focus.elapsedSec,
  };
  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    let appVersion = '';
    const beat = async () => {
      const { phase, task, elapsedSec } = heartbeatRef.current;
      const focusing = phase === 'focusing';
      try {
        if (!appVersion) appVersion = await getVersion().catch(() => '0.0.0');
        const saved = await db.getFocusSecondsSince(socialLib.weekStart().toISOString());
        // recent projects go public only when the Settings toggle says so
        let publicProjects: string | null = null;
        if (settingsRef.current?.profile_projects_public) {
          const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
          const projs = await db.getProjectBreakdown(monthAgo).catch(() => []);
          publicProjects = JSON.stringify(
            projs.slice(0, 5).map((p) => ({ n: p.project, s: p.total_sec })),
          );
        }
        const life = await db.getLifetimeStats().catch(() => ({ totalSec: 0 }));
        if (cancelled) return;
        await socialLib.publishPresence({
          focusing,
          task: focusing ? task : null,
          startedAt: focusing ? new Date(Date.now() - elapsedSec * 1000).toISOString() : null,
          weekSec: saved + (focusing || phase === 'paused' ? elapsedSec : 0),
          appVersion,
          publicProjects,
          totalSec: life.totalSec + (focusing || phase === 'paused' ? elapsedSec : 0),
        });
      } catch {
        // offline — the next beat wins
      }
    };
    beat();
    const iv = window.setInterval(beat, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(iv);
    };
  }, [signedIn, focus.phase]);

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

  // encrypt any plaintext API key left by older versions (one-shot)
  useEffect(() => {
    db.migrateApiKeyEncryption().catch(() => {});
  }, []);

  // keep the Run-key entry pointing at the current exe after updates
  const autostartApplied = useRef(false);
  useEffect(() => {
    if (autostartApplied.current || !settingsHook.settings?.autostart_enabled) return;
    autostartApplied.current = true;
    invoke('set_autostart', { enabled: true }).catch(() => {});
  }, [settingsHook.settings?.autostart_enabled]);

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
        // Do NOT call relaunch() here: the NSIS installer (installMode
        // "passive") already restarts the app once it finishes. A second
        // restart raced the first and left WebView2 dead → the black screen
        // that only a manual reopen fixed. The progress screen stays at 100%
        // until the installer takes over and relaunches cleanly.
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
      autotrack_enabled: s.autotrack_enabled,
      autotrack_apps: s.autotrack_apps,
      quotes_enabled: s.quotes_enabled,
      quotes_interval_min: s.quotes_interval_min,
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
    elapsedSec: focus.displayElapsedSec,
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

  // ---------- JAM (shared focus sessions) ----------
  const myUsername = social.state?.me?.username ?? null;
  const myUsernameRef = useRef(myUsername);
  myUsernameRef.current = myUsername;
  const socialStateRef = useRef(social.state);
  socialStateRef.current = social.state;

  const jamLookup = useCallback((userId: string) => {
    const s = socialStateRef.current;
    const all = [...(s?.friends ?? []), ...(s?.incoming ?? []), ...(s?.outgoing ?? [])];
    const hit = all.find((f) => f.userId === userId);
    return { username: hit?.username ?? '???', avatar: hit?.avatar ?? null };
  }, []);

  const jam = useJam(signedIn, jamLookup, {
    onPrompt: (p) => {
      const msg =
        p.kind === 'invite' ? t('jam.toast.calling', p.username) : t('jam.toast.wantsin', p.username);
      pushToast(msg, 'info');
      // dedicated jam popup — answerable straight from the corner
      invoke('show_jam_call', {
        username: p.username,
        task: p.task,
        incomingKind: p.kind,
      }).catch(() => {});
    },
    onJoinApproved: (invite, hostUsername) => {
      // my join request got a yes — hop into the host's jam right now
      if (focusRef.current.phase !== 'idle') return;
      const me = myUsernameRef.current ?? 'me';
      focusRef.current.startSession(invite.task, null, {
        startedAt: invite.session_started_at,
        members: [me, hostUsername],
      });
      setTab('home');
      pushToast(t('jam.joined', hostUsername), 'info');
    },
    onGuestJoined: (invite, guestUsername) => {
      const me = myUsernameRef.current ?? 'me';
      if (focusRef.current.phase === 'idle') {
        // cold-start jam: they accepted while I wasn't focusing — we begin together
        focusRef.current.startSession(invite.task, null, {
          startedAt: invite.session_started_at,
          members: [me, guestUsername],
        });
        setTab('home');
      } else {
        focusRef.current.markJam([me, guestUsername]);
      }
      pushToast(t('jam.guestjoined', guestUsername), 'info');
      invoke('show_notice', {
        title: '🎧 JAM',
        body: t('jam.guestjoined', guestUsername),
        mood: 'hyped',
      }).catch(() => {});
    },
    onDeclined: (username) => pushToast(t('jam.declined', username), 'info'),
  });

  // ---------- E2E messages: keys, unread, realtime notifications ----------
  const [keyModal, setKeyModal] = useState<'backup' | 'restore' | null>(null);
  const keyInitRef = useRef(false);
  useEffect(() => {
    const me = social.state?.me;
    if (!signedIn || !me || keyInitRef.current) return;
    keyInitRef.current = true;
    e2e.ensureKeys(me.e2e_pub ?? null).then((status) => {
      if (status === 'restore-needed') setKeyModal('restore');
    });
  }, [signedIn, social.state]);

  const [unreadMsgs, setUnreadMsgs] = useState<Record<string, number>>({});
  const [chatRefetchKey, setChatRefetchKey] = useState(0);
  const [openChatWith, setOpenChatWith] = useState<string | null>(null);
  const openChatShortcut = useCallback((friendUserId: string) => {
    setOpenChatWith(friendUserId);
    setTab('friends');
  }, []);
  const openChatRef = useRef<string | null>(null);
  const refreshUnread = useCallback(() => {
    chatLib.fetchUnreadCounts().then(setUnreadMsgs).catch(() => {});
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    refreshUnread();
    const unsub = chatLib.subscribeMessages((row) => {
      const myId = socialStateRef.current?.me?.user_id;
      if (!row || !myId) {
        setChatRefetchKey((k) => k + 1); // deletes etc. — just refetch
        refreshUnread();
        return;
      }
      if (row.recipient !== myId && row.sender !== myId) return;
      setChatRefetchKey((k) => k + 1);
      if (row.recipient === myId && openChatRef.current !== row.sender) {
        refreshUnread();
        const who = jamLookup(row.sender).username;
        pushToast(t('msg.new', who), 'info');
        invoke('show_notice', {
          title: '💬 @' + who,
          body: t('msg.new.body'),
          mood: 'happy',
          data: JSON.stringify({ type: 'chat', userId: row.sender }),
        }).catch(() => {});
      }
    });
    return unsub;
  }, [signedIn, refreshUnread, jamLookup, pushToast]);

  // reactions land in real time on whichever chat is open
  useEffect(() => {
    if (!signedIn) return;
    return chatLib.subscribeReactions(() => setChatRefetchKey((k) => k + 1));
  }, [signedIn]);

  // clicking a corner popup that carries an action (e.g. a new message) jumps
  // straight into that conversation
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<{ data: string }>('notice:action', (e) => {
      try {
        const action = JSON.parse(e.payload.data) as { type?: string; userId?: string };
        if (action.type === 'chat' && action.userId) openChatShortcut(action.userId);
      } catch {
        // malformed action — ignore
      }
    }).then((u) => {
      unlisten = u;
    });
    return () => unlisten?.();
  }, [openChatShortcut]);

  const onChatOpened = useCallback(
    (friendId: string | null) => {
      openChatRef.current = friendId;
      if (friendId) {
        chatLib.markConversationRead(friendId);
        setUnreadMsgs((u) => {
          if (!u[friendId]) return u;
          const next = { ...u };
          delete next[friendId];
          return next;
        });
      }
    },
    [],
  );

  const sendJam = useCallback(
    async (f: FriendEntry, kind: 'invite' | 'request') => {
      // feature handshake: the other side needs a build that knows about JAM
      const presRow = social.presence.get(f.userId);
      if (socialLib.versionBelow(presRow, '0.17.0')) {
        pushToast(t('ver.old', f.username), 'error');
        return;
      }
      if (kind === 'invite') {
        // with a running session it's "join my jam"; idle it's "let's start one
        // right now" — acceptance then starts BOTH sides (cold start)
        const s = focusRef.current.activeSession;
        const task = s?.task ?? t('jam.generic');
        const startedAt = s?.started_at ?? new Date().toISOString();
        const err = await jam.send(f.userId, f.username, 'invite', task, startedAt);
        if (err) onError(err);
        else {
          pushToast(t('jam.sent.toast', f.username), 'info');
          if (f.e2ePub) chatLib.sendMessage(f.userId, 'jam', task).catch(() => {});
        }
      } else {
        const row = social.presence.get(f.userId);
        if (!row?.started_at) return;
        const task = row.task || t('jam.generic');
        const err = await jam.send(f.userId, f.username, 'request', task, row.started_at);
        if (err) onError(err);
        else {
          pushToast(t('jam.sent.toast', f.username), 'info');
          if (f.e2ePub) chatLib.sendMessage(f.userId, 'jam', task).catch(() => {});
        }
      }
    },
    [jam, onError, pushToast, social.presence],
  );

  // answers coming from the corner popup's Accept/Decline buttons
  const answerJamPromptRef = useRef<(accept: boolean) => void>(() => {});
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<{ accept: boolean }>('jam:popup-answer', (e) => {
      answerJamPromptRef.current(e.payload.accept);
    }).then((u) => {
      unlisten = u;
    });
    return () => unlisten?.();
  }, []);

  // "X saiu da JAM": while I'm in a jam, watch each member's presence — once
  // someone we've SEEN focusing goes not-focusing, announce the exit (the
  // seen-first rule avoids false alarms while they're still starting up)
  const jamSeenLiveRef = useRef<Set<string>>(new Set());
  const jamLeftNotifiedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!focus.jam) {
      jamSeenLiveRef.current.clear();
      jamLeftNotifiedRef.current.clear();
      return;
    }
    const others = focus.jam.members.filter((u) => u !== myUsernameRef.current);
    for (const u of others) {
      const friend = socialStateRef.current?.friends.find((f) => f.username === u);
      if (!friend) continue;
      const live = socialLib.isLive(social.presence.get(friend.userId));
      if (live) {
        jamSeenLiveRef.current.add(u);
        jamLeftNotifiedRef.current.delete(u);
      } else if (jamSeenLiveRef.current.has(u) && !jamLeftNotifiedRef.current.has(u)) {
        jamLeftNotifiedRef.current.add(u);
        jamSeenLiveRef.current.delete(u);
        const msg = t('jam.left', u);
        pushToast(msg, 'info');
        invoke('show_notice', { title: '🎧 JAM', body: msg, mood: 'sad' }).catch(() => {});
      }
    }
  }, [focus.jam, social.presence, pushToast]);

  async function answerJamPrompt(accept: boolean) {
    const p = await jam.answer(accept);
    if (!p || !accept) return;
    const me = myUsernameRef.current ?? 'me';
    if (p.kind === 'invite') {
      // I was called into their jam — join with the shared clock
      if (focusRef.current.phase !== 'idle') return;
      focusRef.current.startSession(p.task, null, {
        startedAt: p.session_started_at,
        members: [me, p.username],
      });
      setTab('home');
    } else {
      // I let them into MY jam — my running session becomes a jam too
      focusRef.current.markJam([me, p.username]);
      pushToast(t('jam.guestjoined', p.username), 'info');
    }
  }
  answerJamPromptRef.current = answerJamPrompt;
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

  // auto-track: a whitelisted work app gained focus → the session starts itself;
  // leaving every work app 10s+ pauses it, coming back resumes it. A manual
  // pause is sacred: it never auto-resumes. Only auto-started sessions auto-pause.
  const settingsRef = useRef(settingsHook.settings);
  settingsRef.current = settingsHook.settings;
  const autoShownOverlayRef = useRef(false);
  const autoSessionRef = useRef(false);
  const autoPausedRef = useRef(false);
  useEffect(() => {
    const unlisteners: (() => void)[] = [];
    listen<{ app: string }>('autotrack:start', (e) => {
      if (focusRef.current.phase !== 'idle') return;
      const pretty = e.payload.app
        .split(' ')
        .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
        .join(' ');
      focusRef.current.startSession(pretty, null);
      autoSessionRef.current = true;
      autoPausedRef.current = false;
      const s = settingsRef.current;
      if (s?.autotrack_show_overlay) {
        autoShownOverlayRef.current = !s.overlay_enabled;
        WebviewWindow.getByLabel('overlay')
          .then((w) => w?.show())
          .catch(() => {});
        emit('overlay:autoshow').catch(() => {});
      }
    }).then((u) => unlisteners.push(u));

    // a session counts as auto-trackable when the watcher started it OR when
    // its task matches the work-app list (e.g. started via the "continue:
    // Roblox Studio" button) — those pause/resume with the app exactly the same
    const sessionIsAutoLike = () => {
      if (autoSessionRef.current) return true;
      const task = focusRef.current.activeSession?.task?.toLowerCase();
      const list = settingsRef.current?.autotrack_apps;
      if (!task || !list || !settingsRef.current?.autotrack_enabled) return false;
      return list
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
        .some((entry) =>
          entry.includes(' ')
            ? entry.split(/\s+/).every((w) => task.includes(w))
            : task.includes(entry),
        );
    };

    listen('autotrack:away', () => {
      if (!sessionIsAutoLike()) return;
      if (focusRef.current.phase !== 'focusing') return;
      autoPausedRef.current = true;
      focusRef.current.pauseSession();
    }).then((u) => unlisteners.push(u));

    listen('autotrack:back', () => {
      if (!autoPausedRef.current) return;
      if (focusRef.current.phase !== 'paused') return;
      autoPausedRef.current = false;
      focusRef.current.resumeSession();
    }).then((u) => unlisteners.push(u));

    return () => unlisteners.forEach((u) => u());
  }, []);

  // session gone → the auto flags reset
  useEffect(() => {
    if (focus.phase === 'idle') {
      autoSessionRef.current = false;
      autoPausedRef.current = false;
    }
  }, [focus.phase]);

  // an auto-shown overlay hides again once the session is over (when the
  // overlay isn't normally enabled)
  useEffect(() => {
    if (focus.phase !== 'idle' || !autoShownOverlayRef.current) return;
    autoShownOverlayRef.current = false;
    if (settingsHook.settings?.overlay_enabled) return;
    WebviewWindow.getByLabel('overlay')
      .then((w) => w?.hide())
      .catch(() => {});
  }, [focus.phase, settingsHook.settings?.overlay_enabled]);

  // optional pomodoro: every work_min of focus, a gentle custom nudge to break
  const pomoCycleRef = useRef(0);
  useEffect(() => {
    const s = settingsHook.settings;
    if (!s?.pomodoro_enabled || focus.phase !== 'focusing') {
      if (focus.phase === 'idle') pomoCycleRef.current = 0;
      return;
    }
    const workSec = Math.max(5, s.pomodoro_work_min || 25) * 60;
    const cycles = Math.floor(focus.elapsedSec / workSec);
    if (cycles > pomoCycleRef.current) {
      pomoCycleRef.current = cycles;
      const msg = t('pomo.msg', String(s.pomodoro_break_min || 5));
      pushToast(msg, 'info');
      if (s.sound_enabled) playChime();
      invoke('show_notice', { title: '🍅 Pomodoro', body: msg, mood: 'relax' }).catch(() => {});
    }
  }, [focus.elapsedSec, focus.phase, settingsHook.settings, pushToast]);

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

  // cloud auto-sync: after every saved session (debounced) + every 15min,
  // silently — errors here never bother the user, manual sync reports them
  useEffect(() => {
    let timer: number | null = null;
    const push = () => {
      import('./lib/cloud').then((cloud) => {
        cloud.currentUser().then((u) => {
          if (!u) return;
          cloud.uploadSnapshot().then((err) => {
            if (!err) localStorage.setItem('cloud-last-sync', new Date().toISOString());
          });
        });
      });
    };
    if (refreshKey > 0) {
      timer = window.setTimeout(push, 20_000);
    }
    const iv = window.setInterval(push, 15 * 60_000);
    return () => {
      if (timer) window.clearTimeout(timer);
      window.clearInterval(iv);
    };
  }, [refreshKey]);

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
        ? t('tray.focusing', formatHms(focus.displayElapsedSec))
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
          {focus.jam ? '🎧 ' : ''}
          {formatHms(focus.displayElapsedSec)}
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

  // boot splash takes precedence — held for its minimum time while the app,
  // settings and auth all load behind it
  if (!splashDone) {
    return <Splash />;
  }

  // while deciding auth (after language is set), hold on a blank dark screen
  // so the app never flashes before the login gate
  if (settingsHook.settings !== null && !showFirstRun && !authChecked) {
    return <div className="h-screen w-screen bg-bg" />;
  }

  // login gate takes over the whole window (language pick still comes first)
  if (showLogin) {
    return (
      <Login
        onDone={() => {
          setGuest(true); // dismiss the gate for this launch/session
          setSignedIn(true);
        }}
      />
    );
  }

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

      {keyModal && (
        <KeyBackupModal
          mode={keyModal}
          onClose={() => setKeyModal(null)}
          onDone={() => {
            setKeyModal(null);
            pushToast(t(keyModal === 'backup' ? 'key.backup.done' : 'key.restore.done'), 'info');
          }}
          onRotated={() => social.refresh()}
          onError={onError}
        />
      )}

      {jam.prompt && (
        <JamPromptOverlay
          prompt={jam.prompt}
          canAccept={
            jam.prompt.kind === 'invite' ? focus.phase === 'idle' : focus.phase === 'focusing'
          }
          onAccept={() => answerJamPrompt(true)}
          onDecline={() => answerJamPrompt(false)}
        />
      )}

      {/* signed-in account with no username yet → claiming one is mandatory
          (friends can only add each other by unique name) */}
      {signedIn && !showFirstRun && social.state !== null && !social.state.me && (
        <div className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="chunk animate-scale-in w-full max-w-sm p-6 text-center">
            <Mascot mood="happy" size={72} />
            <h2 className="mt-3 text-lg font-extrabold text-text">{t('fr.claim.title')}</h2>
            <p className="mt-1 text-xs font-medium text-text-dim">{t('fr.claim.body')}</p>
            <ClaimUsernameForm onClaimed={social.refresh} />
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

      <Titlebar
        tabs={TABS}
        tab={tab}
        onTab={(id) => setTab(id as Tab)}
        statusChip={statusChip}
        social={social}
        signedIn={signedIn}
        userName={settingsHook.settings?.user_name?.trim() || null}
        onOpenProfile={() => setTab('profile')}
        focusing={focus.phase === 'focusing'}
      />

      {paletteOpen && (
        <CommandPalette
          onClose={() => setPaletteOpen(false)}
          commands={
            [
              ...TABS.map((tb, i) => ({
                id: tb.id,
                label: t(tb.labelKey),
                hint: `Ctrl+${i + 1}`,
                run: () => setTab(tb.id),
              })),
              { id: 'profile', label: t('menu.profile'), run: () => setTab('profile') },
              { id: 'settings', label: t('tab.settings'), run: () => setTab('settings') },
              {
                id: 'focus',
                label: t('cmd.focus'),
                run: () => setTab('home'),
              },
              {
                id: 'addfriend',
                label: t('cmd.addfriend'),
                run: () => setTab('friends'),
              },
              {
                id: 'checkin',
                label: t('tab.checkin'),
                run: () => {
                  setTab('routine');
                  setRoutineSub('checkin');
                },
              },
              {
                id: 'habits',
                label: t('tab.habits'),
                run: () => {
                  setTab('routine');
                  setRoutineSub('habits');
                },
              },
              {
                id: 'stats',
                label: t('tab.stats'),
                run: () => {
                  setTab('analytics');
                  setAnalyticsSub('stats');
                },
              },
              {
                id: 'log',
                label: t('tab.log'),
                run: () => {
                  setTab('analytics');
                  setAnalyticsSub('log');
                },
              },
            ] satisfies Command[]
          }
        />
      )}

      <div className="flex min-h-0 flex-1">
      <main key={tab} className="animate-fade-up min-h-0 flex-1">
        {tab === 'home' && (
          <Home
            focus={focus}
            settings={settingsHook.settings}
            onError={onError}
            refreshKey={refreshKey}
            onOpenHabits={() => {
              setTab('routine');
              setRoutineSub('habits');
            }}
          />
        )}
        {tab === 'routine' && (
          <div className="flex h-full min-h-0 flex-col">
            <SubTabs
              value={routineSub}
              onChange={setRoutineSub}
              options={[
                { id: 'checkin', labelKey: 'tab.checkin' },
                { id: 'habits', labelKey: 'tab.habits' },
              ]}
            />
            <div className="min-h-0 flex-1">
              {routineSub === 'checkin' ? (
                <CheckinPage settings={settingsHook.settings} onError={onError} />
              ) : (
                <HabitsPage onError={onError} />
              )}
            </div>
          </div>
        )}
        {tab === 'analytics' && (
          <div className="flex h-full min-h-0 flex-col">
            <SubTabs
              value={analyticsSub}
              onChange={setAnalyticsSub}
              options={[
                { id: 'week', labelKey: 'tab.week' },
                { id: 'stats', labelKey: 'tab.stats' },
                { id: 'log', labelKey: 'tab.log' },
              ]}
            />
            <div className="min-h-0 flex-1">
              {analyticsSub === 'week' && (
                <Week
                  onError={onError}
                  refreshKey={refreshKey}
                  dailyGoalHours={settingsHook.settings?.daily_goal_hours ?? 4}
                />
              )}
              {analyticsSub === 'stats' && (
                <Stats settings={settingsHook.settings} onError={onError} refreshKey={refreshKey} />
              )}
              {analyticsSub === 'log' && <Log onError={onError} refreshKey={refreshKey} />}
            </div>
          </div>
        )}
        {tab === 'goals' && <GoalsPage onError={onError} refreshKey={refreshKey} />}
        {tab === 'profile' && (
          <ProfilePage
            social={social}
            userName={settingsHook.settings?.user_name?.trim() || null}
            projectsPublic={settingsHook.settings?.profile_projects_public ?? false}
            signedIn={signedIn}
            onError={onError}
            onOpenFriends={() => setTab('friends')}
            onOpenBackup={() => setKeyModal('backup')}
            refreshKey={refreshKey}
          />
        )}
        {tab === 'friends' && (
          <FriendsPage
            signedIn={signedIn}
            social={social}
            onError={onError}
            myFocus={{
              focusing: focus.phase === 'focusing' || focus.phase === 'paused',
              task: focus.activeSession?.task ?? null,
              startedAtIso: focus.activeSession?.started_at ?? null,
            }}
            onSendJam={sendJam}
            unread={unreadMsgs}
            chatRefetchKey={chatRefetchKey}
            onChatOpened={onChatOpened}
            openChatWith={openChatWith}
            onOpenChatConsumed={() => setOpenChatWith(null)}
            myJamMembers={focus.jam?.members ?? null}
          />
        )}
        {tab === 'settings' && <SettingsScreen settingsHook={settingsHook} onError={onError} />}
      </main>
      {signedIn && tab !== 'friends' && settingsHook.settings?.friends_bar_enabled !== false && (
        <FriendsBar
          social={social}
          onOpenFriends={() => setTab('friends')}
          onOpenChat={openChatShortcut}
          unread={unreadMsgs}
          jamMembers={
            focus.jam
              ? focus.jam.members.map((u) => {
                  const friend = social.state?.friends.find((fr) => fr.username === u);
                  return {
                    username: u,
                    avatar:
                      u === social.state?.me?.username
                        ? (social.state?.me?.avatar_b64 ?? null)
                        : (friend?.avatar ?? null),
                    isMe: u === social.state?.me?.username,
                  };
                })
              : null
          }
        />
      )}
      </div>
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

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
import { consumeWarmReload, warmReload } from './lib/reload';

// read ONCE at module load — StrictMode re-renders must not re-consume it
const warmBoot = consumeWarmReload();
import { HabitsPage } from './components/Habits';
import { Home } from './components/Home';
import { Log } from './components/Log';
import { Stats } from './components/Stats';
import { CommandPalette } from './components/CommandPalette';
import type { Command } from './components/CommandPalette';
import { ProfilePage } from './components/Profile';
import { SettingsScreen } from './components/Settings';
import { RankingPage } from './components/Ranking';
import { Onboarding } from './components/Onboarding';
import * as telemetry from './lib/telemetry';
import { Titlebar } from './components/Titlebar';
import { Week } from './components/Week';
import { cleanProfanity } from './lib/filter';
import { parsePomo, useFocusSession } from './hooks/useFocusSession';
import { useSettings } from './hooks/useSettings';
import { useSocial } from './hooks/useSocial';
import { useGroups } from './hooks/useGroups';
import { useJam } from './hooks/useJam';
import * as groupsLib from './lib/groups';
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
import { formatDurationShort, formatHms, todayKey } from './lib/time';
import { Mascot } from './components/Mascot';
import type { OverlaySize, OverlayState } from './types';

function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return `rgba(212, 255, 63, ${alpha})`;
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
}

type Tab = 'home' | 'routine' | 'analytics' | 'goals' | 'friends' | 'ranking' | 'profile' | 'settings';

// settings + profile intentionally not in the nav — the titlebar gear and
// avatar menu open them. Check-in/Hábitos live under Rotina; Semana/Stats/
// Histórico under Análise, so the top bar stays at five buttons.
const TABS: { id: Tab; labelKey: string }[] = [
  { id: 'home', labelKey: 'tab.home' },
  { id: 'routine', labelKey: 'tab.routine' },
  { id: 'analytics', labelKey: 'tab.analytics' },
  { id: 'goals', labelKey: 'tab.goals' },
  { id: 'friends', labelKey: 'tab.friends' },
  { id: 'ranking', labelKey: 'tab.ranking' },
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
  // after a stale token gets refreshed, refetch everything IMMEDIATELY —
  // swallowing the 401 and waiting for the next poll made the whole app
  // look frozen for up to a minute after boot/unfreeze
  const healRetryRef = useRef<() => void>(() => {});
  // raw Supabase/network errors are cryptic — map the common ones to something
  // a human understands before they hit a toast
  const onError = useCallback(
    (message: string) => {
      const m = message.toLowerCase();
      let friendly = message;
      if (m.includes('jwt') || m.includes('expired') || m.includes('not signed in')) {
        // WebView2 froze the refresh timer — heal silently, don't alarm the user
        import('./lib/cloud').then((c) =>
          c.ensureFreshSession().then((r) => {
            if (r.healed) healRetryRef.current();
          }),
        );
        return;
      }
      if (
        m.includes('failed to fetch') ||
        m.includes('networkerror') ||
        m.includes('load failed') ||
        !navigator.onLine
      ) {
        friendly = t('err.network');
      } else if (m.includes('rate') || m.includes('limit') || m.includes('429')) {
        friendly = t('err.rate');
      } else if (m.includes('row-level security') || m.includes('violates')) {
        friendly = t('err.denied');
      }
      pushToast(friendly, 'error');
    },
    [pushToast],
  );
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

  // boot splash: held on COLD starts only. Internal reloads (logout, login
  // gate, cloud restore) mark themselves warm and skip straight past it —
  // watching the 5s pet on every screen hop read as a loading bug.
  const [splashDone, setSplashDone] = useState(warmBoot);
  useEffect(() => {
    if (warmBoot) return;
    const id = window.setTimeout(() => setSplashDone(true), 5000);
    return () => window.clearTimeout(id);
  }, []);

  // language: apply saved choice. Default is English (most users are abroad);
  // the picker is gone — anyone can switch to Portuguese in Settings.
  const language = settingsHook.settings?.language;
  setLang(language === 'pt' ? 'pt' : 'en');
  const showFirstRun = false;

  // connectivity banner: navigator flag + a light periodic reachability check
  // (the flag alone is unreliable — it says "online" on a dead wifi)
  const [offline, setOffline] = useState(() => !navigator.onLine);
  useEffect(() => {
    const heal = () => {
      if (navigator.onLine)
        import('./lib/cloud').then((c) =>
          c.ensureFreshSession().then((r) => {
            if (r.healed) healRetryRef.current();
          }),
        );
    };
    const on = () => {
      setOffline(false);
      heal();
    };
    const off = () => setOffline(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    // WebView2 unfreezes on focus — refresh the token before queries fire again
    window.addEventListener('focus', heal);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      window.removeEventListener('focus', heal);
    };
  }, []);

  // opt-in crash telemetry — hooks installed once, gate follows the setting
  useEffect(() => {
    telemetry.installTelemetry();
    getVersion()
      .then((v) => {
        (window as unknown as { __APP_VERSION__?: string }).__APP_VERSION__ = v;
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    telemetry.setTelemetryEnabled(settingsHook.settings?.telemetry_enabled === true);
  }, [settingsHook.settings?.telemetry_enabled]);

  // auth gate: after the language is picked, show the login screen unless the
  // user is already signed in or chose guest mode on this machine
  const [authChecked, setAuthChecked] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [guest, setGuest] = useState(() => localStorage.getItem('guest-mode') === '1');
  useEffect(() => {
    let unsub: (() => void) | undefined;
    import('./lib/cloud')
      .then(async (cloud) => {
        // a session can die outside our own logout flow (password changed on
        // another device, account deleted) — mirror that into the UI so social
        // features gate instead of silently erroring forever
        const { data } = cloud.supabase.auth.onAuthStateChange((event) => {
          if (event === 'SIGNED_OUT') setSignedIn(false);
          if (event === 'SIGNED_IN') setSignedIn(true);
        });
        unsub = () => data.subscription.unsubscribe();
        // heal a token that expired while the app was closed BEFORE flipping
        // signedIn — otherwise every initial fetch 401s and the whole app
        // sits empty until the next poll cycle ("everything loads slow")
        await cloud.ensureFreshSession();
        return cloud.currentUser();
      })
      .then((u) => setSignedIn(!!u))
      .catch(() => setSignedIn(false))
      .finally(() => setAuthChecked(true));
    return () => unsub?.();
  }, []);
  const showLogin =
    settingsHook.settings !== null && !showFirstRun && authChecked && !signedIn && !guest;

  // one-time guided setup — full-screen, after language + auth gate
  const [onboardOpen, setOnboardOpen] = useState(
    () => localStorage.getItem('onboarded-v1') !== '1',
  );

  // friends + live presence (inert for guests)
  const social = useSocial(signedIn, onError);
  const groups = useGroups(signedIn, onError);
  const groupsRef = useRef<typeof groups.list>([]);
  groupsRef.current = groups.list;

  // the group whose jam I'm focusing in (server-authoritative membership lives
  // in group_members.in_jam; this mirrors it locally for the UI + leave path)
  const [activeGroupJamId, setActiveGroupJamId] = useState<number | null>(null);
  const activeGroupJamRef = useRef<number | null>(null);
  activeGroupJamRef.current = activeGroupJamId;
  // clearing the focus session clears my group-jam membership too. Clear ALL
  // my in_jam flags, not just activeGroupJamId — that ref can be null after an
  // app restart while the server still has me flagged (the desync that made a
  // stopped session keep "playing" in the group). Idle = I'm in no jam, period.
  useEffect(() => {
    if (focus.phase === 'idle') {
      if (activeGroupJamRef.current !== null) setActiveGroupJamId(null);
      groupsLib.clearOrphanJamFlags().catch(() => {});
    }
  }, [focus.phase]);

  // groupmates' presence matters (is that in_jam member actually alive?), so
  // feed their ids into the presence poll — friends or not
  useEffect(() => {
    const ids = [...new Set(groups.list.flatMap((g) => g.members.map((m) => m.user_id)))];
    social.setExtraIds(ids);
  }, [groups.list, social.setExtraIds]);

  // boot self-heal: a force-close mid-jam leaves my in_jam flag stuck on the
  // server (the "ghost jam" that keeps playing). On launch, if I'm flagged in
  // a jam but not actually in a session, clear it.
  const orphanHealedRef = useRef(false);
  useEffect(() => {
    if (!signedIn || orphanHealedRef.current) return;
    orphanHealedRef.current = true;
    groupsLib.clearOrphanJamFlags().catch(() => {});
  }, [signedIn]);

  // group jam members are server-authoritative — mirror them into the local
  // session (fixes "I joined but Focus showed me alone": the local list only
  // had me until this sync existed)
  useEffect(() => {
    if (activeGroupJamId === null) return;
    const g = groups.list.find((x) => x.group.id === activeGroupJamId);
    if (!g) return;
    const me = myUsernameRef.current;
    // always include myself — my own in_jam flag may not have round-tripped
    // through realtime yet, and I must never vanish from my own roster
    const members = [
      ...new Set([
        ...(me ? [me] : []),
        ...g.members.filter((m) => m.in_jam).map((m) => m.username),
      ]),
    ];
    if (members.length > 0) focusRef.current.syncJamMembers(members);
  }, [groups.list, activeGroupJamId]);

  // reconcile ANY jam (1:1 OR group) against live presence: prune members who
  // stopped focusing so leaving propagates to the other side. The 1:1 jam had
  // no server state, so a "I left" never reached the peer — this fixes that by
  // making everyone derive the roster from who's actually still focusing.
  const jamSeenRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const jam = focus.jam;
    if (!jam) {
      jamSeenRef.current.clear();
      return;
    }
    const me = myUsernameRef.current;
    const meKey = me?.toLowerCase() ?? null;
    // canonicalize first: heal the 'me' placeholder (roster built before my
    // username had loaded) and collapse case-duplicates of the same person —
    // both showed up as "2 people" that were really one
    const seenKeys = new Set<string>();
    const canonical: string[] = [];
    for (const raw of jam.members) {
      const u = raw === 'me' && me ? me : raw;
      const k = u.toLowerCase();
      if (!seenKeys.has(k)) {
        seenKeys.add(k);
        canonical.push(u);
      }
    }
    const uidOf = (u: string) => {
      const k = u.toLowerCase();
      const fr = social.state?.friends.find((f) => f.username.toLowerCase() === k);
      if (fr) return fr.userId;
      const gm = groups.list
        .flatMap((g) => g.members)
        .find((m) => m.username.toLowerCase() === k);
      return gm?.user_id ?? null;
    };
    // adopt: when a jam-mate publishes a roster that includes ME, union it in.
    // GROUP jams only — friend jams are strictly 1:1 now, nothing to adopt
    if (meKey && activeGroupJamId !== null) {
      for (const u of [...canonical]) {
        const uid = uidOf(u);
        if (!uid) continue;
        const rowP = social.presence.get(uid);
        if (!rowP?.jam_members || !socialLib.isLive(rowP)) continue;
        try {
          const theirs = JSON.parse(rowP.jam_members) as string[];
          if (!theirs.some((x) => x.toLowerCase() === meKey)) continue;
          for (const x of theirs) {
            const k = x.toLowerCase();
            if (!seenKeys.has(k)) {
              seenKeys.add(k);
              canonical.push(x);
            }
          }
        } catch {
          // malformed roster — ignore
        }
      }
    }
    const live = canonical.filter((u) => {
      const k = u.toLowerCase();
      if (meKey && k === meKey) return true;
      const uid = uidOf(u);
      if (!uid) return true; // unknown identity → keep, can't judge
      const row = social.presence.get(uid);
      // seen-live-first: don't prune someone we've never observed focusing yet
      // (their presence may not have loaded right after they joined)
      if (socialLib.isLive(row)) {
        // live but publishing a roster that EXCLUDES me → they moved on to a
        // different jam (e.g. a group) — this jam is over for them
        if (row?.jam_members && meKey) {
          try {
            const theirs = JSON.parse(row.jam_members) as string[];
            if (theirs.length >= 2 && !theirs.some((x) => x.toLowerCase() === meKey)) {
              return false;
            }
          } catch {
            // unreadable — treat as still with me
          }
        }
        jamSeenRef.current.add(k);
        return true;
      }
      return !jamSeenRef.current.has(k); // seen before & now not live → prune
    });
    // friend jams are two people, full stop — anything beyond is a stale
    // artifact from older versions and gets trimmed to me + first partner
    let final = live;
    if (activeGroupJamId === null && final.length > 2 && meKey) {
      const meEntry = final.filter((u) => u.toLowerCase() === meKey);
      const others = final.filter((u) => u.toLowerCase() !== meKey);
      final = [...meEntry, ...others.slice(0, 1)];
    }
    if (final.length !== jam.members.length || final.some((u, i) => u !== jam.members[i])) {
      focusRef.current.syncJamMembers(final);
    }
  }, [focus.jam, social.presence, social.state, groups.list, activeGroupJamId]);

  // presence heartbeat: my session state → cloud, on every phase change and
  // every 60s while the app runs. Friends treat rows older than ~2.5min as
  // offline, so closing the app (no explicit "stop") self-heals.
  const heartbeatRef = useRef({
    phase: focus.phase,
    task: focus.activeSession?.task ?? null,
    elapsedSec: focus.elapsedSec,
    afkSec: focus.pendingAfkSec ?? 0,
    jamMembers: focus.jam?.members ?? null,
  });
  heartbeatRef.current = {
    phase: focus.phase,
    task: focus.activeSession?.task ?? null,
    elapsedSec: focus.elapsedSec,
    afkSec: focus.pendingAfkSec ?? 0,
    jamMembers: focus.jam?.members ?? null,
  };
  const beatNowRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    let appVersion = '';
    const beat = async () => {
      const { phase, task, elapsedSec, afkSec, jamMembers } = heartbeatRef.current;
      // paused/rating still count as "in the session" for friends — otherwise a
      // 2-minute pause (or just opening the stop screen) kicked you out of the
      // jam on everyone else's side
      const focusing = phase === 'focusing' || phase === 'paused' || phase === 'rating';
      // fairness: AFK time never counts toward the published leaderboard
      const liveSec = focusing ? Math.max(0, elapsedSec - afkSec) : 0;
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
        // rich presence: the work app in focus — ONLY with the auto-tracker on
        let fgApp: string | null = null;
        if (focusing && settingsRef.current?.autotrack_enabled) {
          const fg = await invoke<string | null>('get_foreground_app').catch(() => null);
          if (fg) fgApp = fg.replace(/\.exe$/i, '');
        }
        const rec = await db
          .getRecords()
          .then((r) => JSON.stringify({ bd: r.bestDaySec, bs: r.bestSessionSec }))
          .catch(() => null);
        if (cancelled) return;
        await socialLib.publishPresence({
          focusing,
          task: focusing ? task : null,
          startedAt: focusing ? new Date(Date.now() - elapsedSec * 1000).toISOString() : null,
          weekSec: saved + liveSec,
          appVersion,
          publicProjects,
          totalSec: life.totalSec + liveSec,
          // a jam is 2+ people — solo focusing (or a group jam nobody joined
          // yet) must not read as "in a jam" to friends
          jamMembers: focusing && jamMembers && jamMembers.length >= 2 ? jamMembers : null,
          fgApp,
          records: rec,
        });
      } catch {
        // offline — the next beat wins
      }
    };
    beatNowRef.current = beat;
    beat();
    const iv = window.setInterval(beat, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(iv);
    };
  }, [signedIn, focus.phase]);

  // roster changes (someone left/joined my jam) publish IMMEDIATELY — waiting
  // for the next 60s tick left friends seeing a stale "in JAM with X" line
  useEffect(() => {
    beatNowRef.current();
  }, [focus.jam]);

  // tray menu follows the language
  useEffect(() => {
    invoke('set_tray_lang', { lang: language === 'pt' ? 'pt' : 'en' }).catch(() => {});
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

  // auto-update, Chrome-style: check on boot + every 30min, pre-download in
  // the background, then install by itself the moment the app is idle (60s
  // countdown, snoozable 1h). While a session/jam runs nothing ever installs.
  // latest.json may also carry "min_version" — below it the update is FORCED:
  // shorter countdown, no snooze, blocking screen while idle.
  const [updating, setUpdating] = useState<{ version: string; pct: number | null } | null>(null);
  const [updateReady, setUpdateReady] = useState<string | null>(null);
  const [updateForced, setUpdateForced] = useState(false);
  const [updateCountdown, setUpdateCountdown] = useState<number | null>(null);
  const pendingUpdateRef = useRef<Update | null>(null);
  const downloadedRef = useRef<string | null>(null); // version already on disk
  const downloadPromiseRef = useRef<Promise<void> | null>(null); // in-flight pre-download
  const installingRef = useRef(false);
  const snoozeUntilRef = useRef(0);

  const doInstall = useCallback(async () => {
    const update = pendingUpdateRef.current;
    if (!update || installingRef.current) return;
    installingRef.current = true;
    setUpdateCountdown(null);
    invoke('show_main_window').catch(() => {});
    setUpdating({ version: update.version, pct: null });
    // flush the cloud snapshot so nothing recent is lost across the restart
    try {
      const c = await import('./lib/cloud');
      if (await c.currentUser()) await c.uploadSnapshot();
    } catch {
      // offline — local SQLite survives the restart untouched anyway
    }
    // a pre-download may still be in flight — wait for it instead of racing
    // it with a second download of the same update
    if (downloadPromiseRef.current) {
      try {
        await downloadPromiseRef.current;
      } catch {
        // pre-download failed — downloadAndInstall below redoes it
      }
    }
    // transient GitHub/CDN failures ("error sending request") are common in
    // the minutes right after a release is published — retry with a short
    // backoff before bothering the user with an error toast
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, attempt * 2500));
      try {
        if (downloadedRef.current === update.version) {
          setUpdating({ version: update.version, pct: 100 });
          await update.install();
        } else {
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
        }
        lastErr = null;
        break;
        // Do NOT call relaunch() here: the NSIS installer (installMode
        // "passive") already restarts the app once it finishes. A second
        // restart raced the first and left WebView2 dead → the black screen
        // that only a manual reopen fixed. The progress screen stays at 100%
        // until the installer takes over and relaunches cleanly.
      } catch (err) {
        lastErr = err;
      }
    }
    if (lastErr !== null) {
      installingRef.current = false;
      setUpdating(null);
      pushToast(t('up.error', String(lastErr)), 'error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pushToast]);
  const doInstallRef = useRef(doInstall);
  doInstallRef.current = doInstall;

  useEffect(() => {
    let shownFor: string | null = null;
    const lookForUpdate = async () => {
      try {
        const update = await check();
        if (update && pendingUpdateRef.current?.version !== update.version) {
          pendingUpdateRef.current = update;
          setUpdateReady(update.version);
          // pre-download now so the actual install is a near-instant restart
          downloadPromiseRef.current = update
            .download(() => {})
            .then(() => {
              downloadedRef.current = update.version;
            })
            .catch(() => {
              // download will happen at install time instead
            })
            .finally(() => {
              downloadPromiseRef.current = null;
            });
          // mid-session there's no auto countdown — the corner popup lets the
          // user choose to interrupt themselves
          if (focusRef.current.phase !== 'idle' && shownFor !== update.version) {
            shownFor = update.version;
            invoke('show_update_popup', { version: update.version, url: '' }).catch(() => {});
          }
        }
      } catch {
        // offline / manifest missing — silently skip
      }
      try {
        const res = await fetch(
          'https://raw.githubusercontent.com/JuanArtxz/locked-in/main/latest.json',
          { cache: 'no-store' },
        );
        const man = (await res.json()) as { min_version?: string };
        if (man?.min_version) {
          const cur = await getVersion();
          setUpdateForced(cmpVersions(cur, man.min_version) < 0);
        }
      } catch {
        // manifest unreachable — keep last known forced state
      }
    };
    const boot = window.setTimeout(lookForUpdate, 8_000);
    const iv = window.setInterval(lookForUpdate, 30 * 60_000);

    let unlisten: (() => void) | undefined;
    listen('update:install', () => doInstallRef.current()).then((u) => {
      unlisten = u;
    });

    return () => {
      window.clearTimeout(boot);
      window.clearInterval(iv);
      unlisten?.();
    };
  }, []);

  // arm the countdown whenever an update is ready and the app turns idle
  useEffect(() => {
    if (!updateReady || updating || installingRef.current || updateCountdown !== null) return;
    if (focus.phase !== 'idle') return;
    const arm = () => setUpdateCountdown(updateForced ? 15 : 60);
    if (updateForced) {
      arm();
      return;
    }
    const wait = snoozeUntilRef.current - Date.now();
    if (wait <= 0) {
      arm();
      return;
    }
    const id = window.setTimeout(arm, wait);
    return () => window.clearTimeout(id);
  }, [updateReady, updating, updateForced, focus.phase, updateCountdown]);

  // tick — starting a session cancels it, zero installs
  useEffect(() => {
    if (updateCountdown === null) return;
    if (focus.phase !== 'idle') {
      setUpdateCountdown(null);
      return;
    }
    if (updateCountdown <= 0) {
      doInstallRef.current();
      return;
    }
    const id = window.setTimeout(
      () => setUpdateCountdown((c) => (c === null ? null : c - 1)),
      1000,
    );
    return () => window.clearTimeout(id);
  }, [updateCountdown, focus.phase]);

  const snoozeUpdate = useCallback(() => {
    snoozeUntilRef.current = Date.now() + 3600_000;
    setUpdateCountdown(null);
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
      lang: s.language === 'pt' ? 'pt' : 'en',
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
      lang: language === 'pt' ? 'pt' : 'en',
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
    // Friends-tab toggle: silently declines every incoming jam (anti-flood)
    blockIncoming: () => localStorage.getItem('jams-blocked') === '1',
    onPrompt: (p) => {
      const msg =
        p.kind === 'invite' ? t('jam.toast.calling', p.username) : t('jam.toast.wantsin', p.username);
      pushToast(msg, 'info');
      // dedicated jam popup — answerable straight from the corner
      invoke('show_jam_call', {
        username: p.username,
        task: cleanProfanity(p.task),
        incomingKind: p.kind,
      }).catch(() => {});
    },
    onJoinApproved: (invite, hostUsername) => {
      // my join request got a yes — hop into the host's jam right now
      const me = myUsernameRef.current ?? 'me';
      if (activeGroupJamRef.current !== null) return; // group jam wins
      if (focusRef.current.jam && focusRef.current.jam.members.length >= 2) return; // already paired
      if (focusRef.current.phase === 'idle') {
        focusRef.current.startSession(invite.task, null, {
          startedAt: invite.session_started_at,
          members: [me, hostUsername],
        });
        setTab('home');
      } else {
        // approved while I was already focusing → my session joins their clock
        focusRef.current.adoptJam({
          startedAt: invite.session_started_at,
          members: [me, hostUsername],
        });
      }
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
        // friend jams are strictly 1:1 — a late accept after the seat filled
        // (race with cancelSent) or after I moved into a GROUP jam is refused
        const cur = focusRef.current.jam;
        if (activeGroupJamRef.current !== null || (cur && cur.members.length >= 2)) {
          pushToast(t('jam.late', guestUsername), 'info');
          return;
        }
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

  // outgoing invites die the moment they can't be honored anymore: my 1:1
  // seat filled, or my session ended — kills the "late accept ghost jam"
  const jamCancelRef = useRef<() => void>(() => {});
  jamCancelRef.current = jam.cancelSent;
  useEffect(() => {
    if (focus.phase === 'idle' || (focus.jam && focus.jam.members.length >= 2)) {
      jam.cancelSent();
    }
  }, [focus.phase, focus.jam, jam]);

  // ---------- E2E messages: keys, unread, realtime notifications ----------
  // Messages are plaintext + RLS since v0.46 — nobody is forced through key
  // modals anymore. The modal stays reachable from Profile for legacy-history
  // backup/restore only.
  const [keyModal, setKeyModal] = useState<'backup' | 'restore' | null>(null);

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

  // token was stale and just got refreshed → refetch the world right away
  healRetryRef.current = () => {
    social.refresh();
    groups.refresh();
    refreshUnread();
    setChatRefetchKey((k) => k + 1);
  };

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
        const who = jamLookup(row.sender);
        pushToast(t('msg.new', who.username), 'info');
        // Steam-style: sender photo + decrypted preview (decryption is local,
        // the plaintext never leaves this machine)
        (async () => {
          let preview = t('msg.new.body');
          try {
            if (row.kind === 'image') preview = `📷 ${t('msg.kind.image')}`;
            else if (row.kind === 'jam') preview = `🎧 ${t('msg.kind.jam')}`;
            else if (row.kind === 'voice') preview = `🎤 ${t('msg.kind.voice')}`;
            else {
              // plaintext rows (v0.46+) read directly; E2EE-era rows still
              // decrypt locally when the legacy key is present
              const txt =
                row.body ??
                (row.body_ct && row.nonce && row.sender_pub && row.recipient_pub
                  ? await e2e.decryptRow(
                      {
                        nonce: row.nonce,
                        body_ct: row.body_ct,
                        sender_pub: row.sender_pub,
                        recipient_pub: row.recipient_pub,
                      },
                      false,
                    )
                  : null);
              if (txt) {
                if (row.kind === 'status') {
                  // body = JSON {s: status snippet, t: reply text} — never show raw
                  let replyTxt = '';
                  try {
                    replyTxt = String(JSON.parse(txt).t ?? '');
                  } catch {
                    /* malformed — generic label below */
                  }
                  preview = replyTxt
                    ? `${t('msg.kind.status')}: ${replyTxt.slice(0, 70)}`
                    : t('msg.kind.status');
                } else if (/^\[sticker:\w+\]$/.test(txt)) {
                  preview = t('attach.sticker');
                } else {
                  preview = txt.length > 90 ? `${txt.slice(0, 90)}…` : txt;
                }
              }
            }
          } catch {
            // undecryptable (key not restored yet) — keep the generic line
          }
          invoke('show_notice', {
            title: '💬 @' + who.username,
            body: preview,
            mood: 'happy',
            avatar: who.avatar,
            data: JSON.stringify({ type: 'chat', userId: row.sender }),
          }).catch(() => {});
        })();
      }
    });
    return unsub;
  }, [signedIn, refreshUnread, jamLookup, pushToast]);

  // reactions land in real time on whichever chat is open
  useEffect(() => {
    if (!signedIn) return;
    return chatLib.subscribeReactions(() => setChatRefetchKey((k) => k + 1));
  }, [signedIn]);

  // who's typing TO me right now — shown on friend rows, not just in the chat.
  // Group keystrokes arrive on the same private inbox tagged with the group id
  // and land in their own per-group map ("@x is typing" inside the group view).
  const [typingMap, setTypingMap] = useState<Map<string, number>>(() => new Map());
  const [groupTypingMap, setGroupTypingMap] = useState<Map<number, Map<string, number>>>(
    () => new Map(),
  );
  useEffect(() => {
    const myId = social.state?.me?.user_id;
    if (!signedIn || !myId) return;
    const unsub = chatLib.subscribeTypingAll(myId, (fromId, groupId) => {
      if (groupId !== undefined) {
        setGroupTypingMap((m) => {
          const next = new Map(m);
          const inner = new Map(next.get(groupId) ?? []);
          inner.set(fromId, Date.now());
          next.set(groupId, inner);
          return next;
        });
      } else {
        setTypingMap((m) => new Map(m).set(fromId, Date.now()));
      }
    });
    const iv = window.setInterval(() => {
      const now = Date.now();
      setTypingMap((m) => {
        let changed = false;
        const next = new Map(m);
        for (const [k, ts] of next) {
          if (now - ts > 3000) {
            next.delete(k);
            changed = true;
          }
        }
        return changed ? next : m;
      });
      setGroupTypingMap((m) => {
        let changed = false;
        const next = new Map(m);
        for (const [gid, inner] of next) {
          const pruned = new Map(inner);
          for (const [k, ts] of pruned) {
            if (now - ts > 3000) {
              pruned.delete(k);
              changed = true;
            }
          }
          if (pruned.size === 0) next.delete(gid);
          else next.set(gid, pruned);
        }
        return changed ? next : m;
      });
    }, 1500);
    return () => {
      unsub();
      window.clearInterval(iv);
    };
  }, [signedIn, social.state?.me?.user_id]);
  const typingIds = new Set(typingMap.keys());

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
    // quick reply typed straight into the notification popup
    let unlistenReply: (() => void) | undefined;
    listen<{ data: string; text: string }>('notice:reply', (e) => {
      try {
        const action = JSON.parse(e.payload.data) as { type?: string; userId?: string };
        const text = e.payload.text?.trim();
        if (action.type === 'chat' && action.userId && text) {
          chatLib.sendMessage(action.userId, 'text', text).catch(() => {});
        }
      } catch {
        // malformed — ignore
      }
    }).then((u) => {
      unlistenReply = u;
    });
    return () => {
      unlisten?.();
      unlistenReply?.();
    };
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
      // friend jams are strictly TWO people — for more, make a group.
      // Me already paired OR inside a group jam (even alone) → no 1:1 flows.
      if (
        activeGroupJamRef.current !== null ||
        (focusRef.current.jam && focusRef.current.jam.members.length >= 2)
      ) {
        pushToast(t('jam.selfbusy'), 'info');
        return;
      }
      // target already paired → their jam is closed to thirds
      if (presRow?.jam_members) {
        try {
          if ((JSON.parse(presRow.jam_members) as string[]).length >= 2) {
            pushToast(t('jam.targetbusy', f.username), 'info');
            return;
          }
        } catch {
          // unreadable roster — let the attempt through
        }
      }
      if (kind === 'invite') {
        // with a running session it's "join my jam"; idle it's "let's start one
        // right now" — acceptance then starts BOTH sides (cold start)
        const s = focusRef.current.activeSession;
        const task = s?.task ?? t('jam.generic');
        const startedAt = s?.started_at ?? new Date().toISOString();
        const err = await jam.send(f.userId, f.username, 'invite', task, startedAt);
        if (err === 'pending') pushToast(t('jam.pending', f.username), 'info');
        else if (err) onError(err);
        else {
          pushToast(t('jam.sent.toast', f.username), 'info');
          chatLib.sendMessage(f.userId, 'jam', task).catch(() => {});
        }
      } else {
        const row = social.presence.get(f.userId);
        if (!row?.started_at) return;
        const task = row.task || t('jam.generic');
        const err = await jam.send(f.userId, f.username, 'request', task, row.started_at);
        if (err === 'pending') pushToast(t('jam.pending', f.username), 'info');
        else if (err) onError(err);
        else {
          pushToast(t('jam.sent.toast', f.username), 'info');
          chatLib.sendMessage(f.userId, 'jam', task).catch(() => {});
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

  // ---- synced pomodoro: purely advisory — announces work/break flips derived
  // from the SHARED jam clock; never pauses anyone's session ----
  const pomoPrevRef = useRef<'work' | 'break' | null>(null);
  useEffect(() => {
    const p = parsePomo(focus.jam?.pomo);
    if (!focus.jam || !p || focus.phase !== 'focusing') {
      pomoPrevRef.current = null;
      return;
    }
    const cycle = p.workSec + p.breakSec;
    const pos = ((focus.displayElapsedSec % cycle) + cycle) % cycle;
    const phase: 'work' | 'break' = pos < p.workSec ? 'work' : 'break';
    const prev = pomoPrevRef.current;
    pomoPrevRef.current = phase;
    if (prev && prev !== phase) {
      const msg =
        phase === 'break'
          ? t('pomo.jam.break', String(Math.round(p.breakSec / 60)))
          : t('pomo.jam.work');
      pushToast(msg, 'info');
      invoke('show_notice', {
        title: '🍅 Pomodoro',
        body: msg,
        mood: phase === 'break' ? 'relax' : 'focus',
      }).catch(() => {});
    }
  }, [focus.displayElapsedSec, focus.jam, focus.phase, pushToast]);

  // ---- jam shame: in a 2+ jam WITH the auto-tracker on, drifting into a
  // procrastination app for 2 straight minutes rats you out to the whole jam.
  // Tracker off = zero detection, period. Broadcast is ephemeral (no rows). ----
  const shameChanRef = useRef<ReturnType<typeof socialLib.joinJamShame> | null>(null);
  const myUserIdForShame = social.state?.me?.user_id ?? null;
  useEffect(() => {
    if (!signedIn || !myUserIdForShame) return;
    const chan = socialLib.joinJamShame(myUserIdForShame, (p) => {
      const meL = myUsernameRef.current?.toLowerCase();
      if (!meL || p.from.toLowerCase() === meL) return;
      if (!p.members.includes(meL)) return;
      // only if the slacker is actually in MY current jam
      const inMyJam = focusRef.current.jam?.members.some(
        (m) => m.toLowerCase() === p.from.toLowerCase(),
      );
      if (!inMyJam) return;
      const msg = t('shame.msg', cleanProfanity(p.from), cleanProfanity(p.app));
      pushToast(msg, 'info');
      invoke('show_notice', {
        title: t('shame.title'),
        body: msg,
        mood: 'angry',
      }).catch(() => {});
    });
    shameChanRef.current = chan;
    return () => {
      chan.close();
      shameChanRef.current = null;
    };
  }, [signedIn, myUserIdForShame, pushToast]);

  const distractedSinceRef = useRef<number | null>(null);
  const lastShameRef = useRef(0);
  useEffect(() => {
    const iv = window.setInterval(async () => {
      const jamNow = focusRef.current.jam;
      const s = settingsRef.current;
      if (
        !jamNow ||
        jamNow.members.length < 2 ||
        focusRef.current.phase !== 'focusing' ||
        !s?.autotrack_enabled // the explicit gate: tracker off → no detection
      ) {
        distractedSinceRef.current = null;
        return;
      }
      const bad = (s.nudge_apps ?? '')
        .split(',')
        .map((x) => x.trim().toLowerCase().replace(/\.exe$/, ''))
        .filter(Boolean);
      if (bad.length === 0) {
        distractedSinceRef.current = null;
        return;
      }
      const fg = await invoke<string | null>('get_foreground_app').catch(() => null);
      if (!fg) return;
      const exe = fg.toLowerCase().replace(/\.exe$/, '');
      if (!bad.some((b) => exe.includes(b))) {
        distractedSinceRef.current = null;
        return;
      }
      const now = Date.now();
      if (distractedSinceRef.current === null) {
        distractedSinceRef.current = now;
        return;
      }
      if (now - distractedSinceRef.current < 120_000) return; // 2min of slack first
      if (now - lastShameRef.current < 600_000) return; // shame at most 1x/10min
      lastShameRef.current = now;
      const meName = myUsernameRef.current;
      if (!meName) return;
      // usernames → userIds (friends + groupmates cover every possible jam-mate)
      const idOf = new Map<string, string>();
      for (const f of socialStateRef.current?.friends ?? []) {
        idOf.set(f.username.toLowerCase(), f.userId);
      }
      for (const g of groupsRef.current) {
        for (const m of g.members) idOf.set(m.username.toLowerCase(), m.user_id);
      }
      const recipients = jamNow.members
        .filter((m) => m.toLowerCase() !== meName.toLowerCase())
        .map((m) => idOf.get(m.toLowerCase()))
        .filter((x): x is string => !!x);
      if (recipients.length === 0) return;
      shameChanRef.current?.sendTo(recipients, {
        from: meName,
        app: fg.replace(/\.exe$/i, ''),
        members: jamNow.members.map((m) => m.toLowerCase()),
      });
    }, 30_000);
    return () => window.clearInterval(iv);
  }, []);

  // ---- @mentions in group chats → toast + native notice ----
  const groupsListRef = useRef(groups.list);
  groupsListRef.current = groups.list;
  useEffect(() => {
    if (!signedIn) return;
    return groupsLib.subscribeGroupMessages((row) => {
      const meName = myUsernameRef.current;
      const meId = socialStateRef.current?.me?.user_id;
      if (!meName || !meId || row.sender === meId || row.kind !== 'text') return;
      if (!row.body.toLowerCase().includes(`@${meName.toLowerCase()}`)) return;
      const g = groupsListRef.current.find((x) => x.group.id === row.group_id);
      if (!g) return; // not my group — RLS wouldn't deliver it anyway
      const who = g.members.find((m) => m.user_id === row.sender)?.username ?? '?';
      const msg = t('grp.mention', cleanProfanity(who), cleanProfanity(g.group.name));
      pushToast(msg, 'info');
      invoke('show_notice', { title: t('grp.mention.title'), body: msg, mood: 'hyped' }).catch(
        () => {},
      );
    });
  }, [signedIn, pushToast]);

  // ---- pokes: 👉 nudges + 🔥 cheers from friends (server rate-limited) ----
  useEffect(() => {
    if (!signedIn) return;
    const seenKey = 'pokes-seen';
    const markSeen = () => localStorage.setItem(seenKey, new Date().toISOString());
    const showPoke = (row: socialLib.PokeRow) => {
      if (localStorage.getItem('pokes-blocked') === '1') return;
      const who = jamLookup(row.from_user);
      const cheer = row.kind === 'cheer';
      pushToast(
        cheer ? t('poke.cheer.toast', who.username) : t('poke.toast', who.username),
        'info',
      );
      invoke('show_notice', {
        title: (cheer ? '🔥 @' : '👉 @') + who.username,
        body: cheer ? t('poke.cheer.body') : t('poke.body'),
        mood: 'hyped',
        avatar: who.avatar,
      }).catch(() => {});
    };
    // catch up on pokes that landed while the app was closed (24h window),
    // showing at most the 3 newest — after friends state had time to load
    const since =
      localStorage.getItem(seenKey) ?? new Date(Date.now() - 86_400_000).toISOString();
    const boot = window.setTimeout(() => {
      socialLib
        .fetchPokesSince(since)
        .then((rows) => {
          rows.slice(-3).forEach(showPoke);
          if (rows.length > 0) markSeen();
        })
        .catch(() => {});
    }, 4000);
    const unsub = socialLib.subscribePokes((row) => {
      if (row.to_user !== socialStateRef.current?.me?.user_id) return;
      showPoke(row);
      markSeen();
    });
    return () => {
      window.clearTimeout(boot);
      unsub();
    };
  }, [signedIn, jamLookup, pushToast]);

  // ---- jam room data: members of MY jam with avatar/live info ----
  const jamRoomMembers = focus.jam
    ? focus.jam.members.map((u) => {
        const isMe = u === social.state?.me?.username;
        const friendRow = social.state?.friends.find((fr) => fr.username === u);
        const groupmate = groups.list
          .flatMap((g) => g.members)
          .find((m) => m.username === u);
        const userId = isMe
          ? (social.state?.me?.user_id ?? null)
          : (friendRow?.userId ?? groupmate?.user_id ?? null);
        return {
          username: u,
          avatar: isMe
            ? (social.state?.me?.avatar_b64 ?? null)
            : (friendRow?.avatar ?? groupmate?.avatar ?? null),
          userId,
          isMe,
          live: isMe ? true : userId ? socialLib.isLive(social.presence.get(userId)) : false,
        };
      })
    : null;

  const cheerMember = useCallback(
    (userId: string) => {
      socialLib
        .sendPoke(userId, 'cheer')
        .then((err) => {
          if (err === 'rate') pushToast(t('poke.rate'), 'info');
          else if (!err) pushToast(t('poke.sent'), 'info');
        })
        .catch(() => {});
    },
    [pushToast],
  );

  // "vocês focaram X juntos" — fires once when my jam dissolves (everyone
  // left or I did), only for jams that actually lasted a while
  const prevJamSummaryRef = useRef<{ startedAt: string } | null>(null);
  useEffect(() => {
    const cur =
      focus.jam && focus.jam.members.length >= 2 ? { startedAt: focus.jam.startedAt } : null;
    const prev = prevJamSummaryRef.current;
    prevJamSummaryRef.current = cur;
    if (prev && !cur) {
      // only when the jam dissolved AROUND me (others left) — when I'm the one
      // stopping, phase is already idle and announcing "you left" is noise
      const stillInSession =
        focusRef.current.phase !== 'idle' && focusRef.current.phase !== 'rating';
      const sec = Math.max(0, (Date.now() - new Date(prev.startedAt).getTime()) / 1000);
      if (sec >= 300 && stillInSession) {
        pushToast(t('jam.summary', formatDurationShort(sec)), 'info');
      }
    }
  }, [focus.jam, pushToast]);

  // ---- group weekly goal: while focusing INSIDE this group's jam, tick my
  // per-group clock every minute (server trigger clamps to real time) ----
  useEffect(() => {
    if (activeGroupJamId === null) return;
    const iv = window.setInterval(() => {
      if (focusRef.current.phase === 'focusing') {
        groupsLib.bumpGroupJamTime(activeGroupJamId, 60).catch(() => {});
      }
    }, 60_000);
    return () => window.clearInterval(iv);
  }, [activeGroupJamId]);

  // ---- group jam: shares the focus session + the shared display timer ----
  const startGroupJam = useCallback(
    (groupId: number, task: string, pomo: string | null = null) => {
      const me = myUsernameRef.current ?? 'me';
      // converting a running 1:1 jam into a group jam would splice the 1:1
      // partner into the group roster — leave the 1:1 first
      if (
        activeGroupJamRef.current === null &&
        focusRef.current.jam &&
        focusRef.current.jam.members.length >= 2
      ) {
        pushToast(t('jam.leavefirst'), 'info');
        return;
      }
      jamCancelRef.current(); // pending 1:1 invites die on entering a group jam
      if (focusRef.current.phase !== 'idle') {
        // already focusing → convert my running session into the group jam so
        // Focus/overlay reflect it and syncJamMembers (which needs a jam) fills
        // in the roster from the server
        focusRef.current.markJam([me], pomo);
        setActiveGroupJamId(groupId);
        pushToast(t('grp.jam.started'), 'info');
        return;
      }
      focusRef.current.startSession(task, null, {
        startedAt: new Date().toISOString(),
        members: [me],
        pomo,
      });
      setActiveGroupJamId(groupId);
      setTab('home');
    },
    [pushToast],
  );

  const joinGroupJam = useCallback(
    (groupId: number, task: string, startedAtIso: string, pomo: string | null = null) => {
      const me = myUsernameRef.current ?? 'me';
      jamCancelRef.current(); // no 1:1 invite may survive into a group jam
      if (focusRef.current.phase !== 'idle') {
        onError(t('jam.busy'));
        // membership was optimistically set by the caller — roll it back
        groupsLib.setJamMembership(groupId, false);
        return;
      }
      focusRef.current.startSession(task, null, {
        startedAt: startedAtIso, // shared timer counts from the group's start
        members: [me],
        pomo,
      });
      setActiveGroupJamId(groupId);
      setTab('home');
    },
    [onError],
  );

  const leaveGroupJam = useCallback(() => {
    // stopping the session runs the normal rating flow; membership clears via
    // the phase-idle effect. If they were only "in jam" with nothing else,
    // just stop.
    if (focusRef.current.phase === 'focusing' || focusRef.current.phase === 'paused') {
      focusRef.current.stopSession();
    } else {
      setActiveGroupJamId(null);
    }
  }, []);

  async function answerJamPrompt(accept: boolean) {
    const p = await jam.answer(accept);
    if (!p || !accept) return;
    const me = myUsernameRef.current ?? 'me';
    if (p.kind === 'invite') {
      // I was called into their jam — join with the shared clock. Group jam
      // (even solo, waiting for people) blocks 1:1 — the rosters would fight.
      if (
        activeGroupJamRef.current !== null ||
        (focusRef.current.jam && focusRef.current.jam.members.length >= 2)
      ) {
        pushToast(t('jam.selfbusy'), 'info');
        return;
      }
      if (focusRef.current.phase === 'idle') {
        focusRef.current.startSession(p.task, null, {
          startedAt: p.session_started_at,
          members: [me, p.username],
        });
        setTab('home');
      } else {
        // accepting mid-session used to silently do nothing — now my running
        // session simply joins their jam clock
        focusRef.current.adoptJam({
          startedAt: p.session_started_at,
          members: [me, p.username],
        });
        pushToast(t('jam.joined', p.username), 'info');
      }
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

  // guided first-run setup — owns the whole window until finished/skipped
  if (onboardOpen && settingsHook.settings && !showFirstRun) {
    return (
      <Onboarding
        settings={settingsHook.settings}
        update={settingsHook.update}
        signedIn={signedIn}
        onCreateAccount={() => {
          localStorage.setItem('onboarded-v1', '1');
          localStorage.removeItem('guest-mode');
          warmReload();
        }}
        onDone={() => {
          setOnboardOpen(false);
          setTab('home');
        }}
      />
    );
  }

  return (
    <div className="flex h-screen flex-col bg-bg text-text">
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
        <div className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/80">
          <div className="chunk animate-scale-in w-full max-w-sm p-6 text-center">
            <Mascot mood="happy" size={72} />
            <h2 className="mt-3 text-lg font-extrabold text-text">{t('fr.claim.title')}</h2>
            <p className="mt-1 text-xs font-medium text-text-dim">{t('fr.claim.body')}</p>
            <ClaimUsernameForm onClaimed={social.refresh} />
          </div>
        </div>
      )}

      {/* forced update — running below min_version: blocking while idle,
          slim banner while a session runs (never interrupts focus) */}
      {updateForced && updateReady && !updating && (
        focus.phase === 'idle' ? (
          <div className="animate-fade-in fixed inset-0 z-[59] flex items-center justify-center bg-black/85">
            <div className="chunk animate-scale-in w-full max-w-sm p-6 text-center">
              <Mascot mood="sad" size={72} />
              <h2 className="mt-3 text-lg font-extrabold text-text">{t('up.forced')}</h2>
              <p className="mt-1 text-xs font-medium text-text-dim">
                {t('up.forced.sub', updateReady)}
              </p>
              {updateCountdown !== null && (
                <p className="mt-3 font-mono text-sm font-bold tabular-nums text-warn">
                  {t('up.restartin', String(updateCountdown))}
                </p>
              )}
              <button
                type="button"
                onClick={() => doInstall()}
                className="chunk-btn chunk-btn-accent mt-4 w-full py-2.5 text-sm"
              >
                {t('up.get').toUpperCase()}
              </button>
            </div>
          </div>
        ) : (
          <div className="fixed left-1/2 top-12 z-[59] -translate-x-1/2 rounded-full border-2 border-warn bg-bg px-4 py-1.5 text-xs font-bold text-warn shadow-lg">
            {t('up.forced')} — {t('up.aftersession')}
          </div>
        )
      )}

      {/* update ready — self-restarting countdown, snoozable for 1h */}
      {!updateForced && updateCountdown !== null && !updating && (
        <div className="animate-scale-in fixed bottom-4 right-4 z-50 w-72 rounded-2xl border-2 border-accent bg-surface p-4 shadow-2xl shadow-black/50">
          <div className="text-sm font-extrabold text-text">⬆ {t('up.ready', updateReady ?? '')}</div>
          <div className="mt-0.5 font-mono text-xs font-bold tabular-nums text-accent">
            {t('up.restartin', String(updateCountdown))}
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => doInstall()}
              className="chunk-btn chunk-btn-accent flex-1 py-2 text-xs"
            >
              {t('up.now')}
            </button>
            <button
              type="button"
              onClick={snoozeUpdate}
              className="chunk-btn flex-1 py-2 text-xs text-text-dim"
            >
              {t('up.snooze')}
            </button>
          </div>
        </div>
      )}

      {updating && (
        <div className="animate-fade-in fixed inset-0 z-[60] flex items-center justify-center bg-black/85">
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
        <div className="animate-fade-in fixed inset-0 z-40 flex items-center justify-center bg-black/70">
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

      {signedIn && offline && (
        <div className="flex shrink-0 items-center justify-center gap-2 bg-danger/15 py-1 text-[11px] font-bold text-danger">
          <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-danger" />
          {t('net.offline')}
        </div>
      )}

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
      {/* no key= and no entrance animation: tab switches render instantly —
          the remount-per-switch + fade-up combo read as "loading" every time */}
      <main className="min-h-0 flex-1">
        {tab === 'home' && (
          <Home
            focus={focus}
            settings={settingsHook.settings}
            updateSetting={settingsHook.update}
            onError={onError}
            refreshKey={refreshKey}
            onOpenHabits={() => {
              setTab('routine');
              setRoutineSub('habits');
            }}
            jamRoom={jamRoomMembers}
            onCheer={cheerMember}
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
              inJam: !!focus.jam && focus.jam.members.length >= 2,
            }}
            onSendJam={sendJam}
            unread={unreadMsgs}
            typingIds={typingIds}
            groupTyping={groupTypingMap}
            chatRefetchKey={chatRefetchKey}
            onChatOpened={onChatOpened}
            openChatWith={openChatWith}
            onOpenChatConsumed={() => setOpenChatWith(null)}
            myJamMembers={focus.jam?.members ?? null}
            groups={groups}
            activeGroupJamId={activeGroupJamId}
            onStartGroupJam={startGroupJam}
            onJoinGroupJam={joinGroupJam}
            onLeaveGroupJam={leaveGroupJam}
          />
        )}
        {tab === 'ranking' && <RankingPage soc={social} signedIn={signedIn} />}
        {tab === 'settings' && <SettingsScreen settingsHook={settingsHook} onError={onError} />}
      </main>
      {signedIn && settingsHook.settings?.friends_bar_enabled !== false && (
        <FriendsBar
          hidden={tab === 'friends'}
          social={social}
          onOpenFriends={() => setTab('friends')}
          onOpenChat={openChatShortcut}
          unread={unreadMsgs}
          typingIds={typingIds}
          jamMembers={
            focus.jam && focus.jam.members.length >= 2
              ? focus.jam.members.map((u) => {
                  // avatars come from friends OR from my group rosters — in a
                  // group jam even non-friends are shown (they're groupmates)
                  const friend = social.state?.friends.find((fr) => fr.username === u);
                  const groupmate = groups.list
                    .flatMap((g) => g.members)
                    .find((m) => m.username === u);
                  return {
                    username: u,
                    avatar:
                      u === social.state?.me?.username
                        ? (social.state?.me?.avatar_b64 ?? null)
                        : (friend?.avatar ?? groupmate?.avatar ?? null),
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

/** "0.23.1" vs "0.24.0" → -1/0/1, missing parts count as 0 */
function cmpVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

function App() {
  return (
    <ToastProvider>
      <AppShell />
    </ToastProvider>
  );
}

export default App;

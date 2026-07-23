import { useEffect, useRef, useState } from 'react';
import type { Settings } from '../types';
import { t } from '../lib/i18n';
import * as social from '../lib/social';
import { ACCENT_PRESETS } from './Settings';
import { NAV_ICONS } from './Titlebar';
import logoUrl from '../assets/logo.png';

interface OnboardingProps {
  settings: Settings;
  update: <K extends keyof Settings>(key: K, value: Settings[K]) => Promise<void>;
  signedIn: boolean;
  onCreateAccount: () => void;
  onDone: () => void;
}

/** Curated auto-tracker suggestions — lowercase, matched against window titles. */
const APP_SUGGESTIONS = [
  'visual studio code',
  'roblox studio',
  'photoshop',
  'figma',
  'blender',
  'unity',
  'godot',
  'aseprite',
  'premiere pro',
  'after effects',
  'davinci resolve',
  'fl studio',
  'ableton live',
  'obs',
  'word',
  'excel',
  'powerpoint',
  'notion',
  'obsidian',
  'intellij idea',
  'android studio',
];

const GOAL_OPTIONS = [1, 2, 3, 4, 6, 8];

const TOUR_TABS = [
  'home',
  'routine',
  'tasks',
  'analytics',
  'goals',
  'friends',
  'ranking',
] as const;
type TourTab = (typeof TOUR_TABS)[number];
const TOUR_LABEL_KEY: Record<TourTab, string> = {
  home: 'tab.home',
  routine: 'tab.routine',
  tasks: 'tab.tasks',
  analytics: 'tab.analytics',
  goals: 'tab.goals',
  friends: 'tab.friends',
  ranking: 'tab.ranking',
};

/** Role presets — picking what you do preselects the right auto-track apps. */
const WORK_ROLES = [
  { id: 'dev', apps: ['visual studio code', 'intellij idea', 'android studio'] },
  { id: 'design', apps: ['figma', 'photoshop', 'aseprite'] },
  { id: 'game', apps: ['roblox studio', 'unity', 'godot', 'blender'] },
  { id: 'video', apps: ['premiere pro', 'after effects', 'davinci resolve', 'obs'] },
  { id: 'music', apps: ['fl studio', 'ableton live'] },
  { id: 'study', apps: ['word', 'excel', 'powerpoint', 'notion', 'obsidian'] },
] as const;
type WorkRole = (typeof WORK_ROLES)[number]['id'];

const STEPS = ['welcome', 'name', 'work', 'goal', 'autotrack', 'accent', 'extras', 'tour', 'social', 'loading'] as const;
type Step = (typeof STEPS)[number];

const RING_R = 50;
const RING_C = 2 * Math.PI * RING_R;

export function Onboarding({ settings, update, signedIn, onCreateAccount, onDone }: OnboardingProps) {
  const [stepIdx, setStepIdx] = useState(0);
  const step: Step = STEPS[stepIdx];

  // local selections — committed to settings as the user picks them
  const [name, setName] = useState(settings.user_name ?? '');
  const [roles, setRoles] = useState<Set<WorkRole>>(new Set());
  const [goal, setGoal] = useState(settings.daily_goal_hours || 3);
  const [autotrackOn, setAutotrackOn] = useState(settings.autotrack_enabled);
  const [apps, setApps] = useState<Set<string>>(() => {
    const cur = settings.autotrack_apps
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    return new Set(cur.filter((a) => APP_SUGGESTIONS.includes(a)));
  });
  const [customApp, setCustomApp] = useState('');
  const [customApps, setCustomApps] = useState<string[]>(() =>
    settings.autotrack_apps
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((a) => a && !APP_SUGGESTIONS.includes(a)),
  );
  const [accent, setAccent] = useState(settings.accent_color);
  const [sound, setSound] = useState(settings.sound_enabled);
  const [pomo, setPomo] = useState(settings.pomodoro_enabled);
  const [overlay, setOverlay] = useState(settings.overlay_enabled);
  const [checkin, setCheckin] = useState(settings.checkin_enabled);
  const [telemetry, setTelemetry] = useState(settings.telemetry_enabled);
  const [tourSel, setTourSel] = useState<TourTab>('home');
  const [friendName, setFriendName] = useState('');
  const [friendMsg, setFriendMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [friendBusy, setFriendBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string[]>([]);
  const [loadPct, setLoadPct] = useState(0);
  const finishedRef = useRef(false);

  const commitApps = (on: boolean, sel: Set<string>, customs: string[]) => {
    update('autotrack_enabled', on);
    const list = [...sel, ...customs].join(', ');
    if (list) update('autotrack_apps', list);
  };

  const next = () => {
    if (step === 'name') {
      const n = name.trim();
      if (n) update('user_name', n);
    }
    setStepIdx((i) => Math.min(i + 1, STEPS.length - 1));
  };
  const back = () => setStepIdx((i) => Math.max(i - 1, 0));

  const firstName = name.trim().split(/\s+/)[0] ?? '';

  const toggleRole = (id: WorkRole) => {
    const nextRoles = new Set(roles);
    if (nextRoles.has(id)) nextRoles.delete(id);
    else nextRoles.add(id);
    setRoles(nextRoles);
    // apps derive from the selected roles; the autotrack step refines them
    const preset = new Set<string>();
    for (const role of WORK_ROLES) {
      if (nextRoles.has(role.id)) role.apps.forEach((a) => preset.add(a));
    }
    setApps(preset);
    const on = nextRoles.size > 0 ? true : autotrackOn;
    setAutotrackOn(on);
    commitApps(on, preset, customApps);
  };

  const finish = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    localStorage.setItem('onboarded-v1', '1');
    onDone();
  };

  // final screen: ~7s cinematic — lock closes, clock spins, check draws
  useEffect(() => {
    if (step !== 'loading') return;
    const t0 = performance.now();
    const dur = 6800;
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / dur);
      setLoadPct(p);
      if (p < 1) raf = requestAnimationFrame(tick);
      else window.setTimeout(finish, 400);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  async function addFriend() {
    const name = friendName.trim();
    if (!name || friendBusy) return;
    setFriendBusy(true);
    setFriendMsg(null);
    try {
      const r = await social.sendFriendRequest(name);
      if (r === 'sent') {
        setSentTo((prev) => [...prev, name.replace(/^@/, '')]);
        setFriendName('');
      } else if (r === 'notfound') setFriendMsg({ text: t('fr.err.notfound'), ok: false });
      else if (r === 'self') setFriendMsg({ text: t('fr.err.self'), ok: false });
      else if (r === 'duplicate') setFriendMsg({ text: t('fr.err.duplicate'), ok: false });
      else setFriendMsg({ text: t('fr.err.generic'), ok: false });
    } finally {
      setFriendBusy(false);
    }
  }

  const chip = (active: boolean) =>
    `no-press chip-quiet rounded-full px-4 py-2.5 text-sm ${
      active ? 'bg-accent text-bg' : 'bg-surface text-text-dim hover:text-text'
    }`;

  const toggleRow = (label: string, hint: string, value: boolean, set: (v: boolean) => void) => (
    <button
      type="button"
      onClick={() => set(!value)}
      className="no-press flex w-full items-center justify-between gap-4 rounded-2xl border bg-surface px-5 py-4 text-left"
    >
      <div className="min-w-0">
        <div className="text-[15px] font-extrabold text-text">{label}</div>
        <div className="mt-0.5 text-[12px] font-medium text-text-dim">{hint}</div>
      </div>
      <span
        role="switch"
        aria-checked={value}
        className={`h-[26px] w-12 shrink-0 rounded-full p-[3px] transition-colors duration-300 ${
          value ? 'bg-accent' : 'bg-border-strong'
        }`}
      >
        <span
          className={`block h-[20px] w-[20px] rounded-full bg-bg transition-transform duration-300 ease-out ${
            value ? 'translate-x-[22px]' : ''
          }`}
        />
      </span>
    </button>
  );

  const loadPhase = loadPct < 0.34 ? 0 : loadPct < 0.7 ? 1 : 2;
  const loadMsg =
    loadPhase === 0
      ? t('ob.load.1')
      : loadPhase === 1
        ? t('ob.load.2')
        : firstName
          ? t('ob.load.ready.named', firstName)
          : t('ob.load.3');
  const loadIcon = (phase: number) =>
    `absolute inset-0 flex items-center justify-center transition-all duration-500 ease-out ${
      loadPhase === phase ? 'scale-100 opacity-100' : 'scale-75 opacity-0'
    }`;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center overflow-hidden bg-bg">
      {/* one huge quiet glow, same language as the Focus screen */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(circle 63vh at 50% 42%, color-mix(in srgb, var(--color-accent) 6.5%, transparent), transparent 72%)',
        }}
        aria-hidden
      />
      <div className="relative flex h-full w-full max-w-2xl flex-col px-10 py-8">
        {/* progress + skip (hidden on the final loading screen) */}
        <div className={`flex items-center justify-between ${step === 'loading' ? 'invisible' : ''}`}>
          <div className="flex gap-1.5">
            {STEPS.slice(0, -1).map((s, i) => (
              <span
                key={s}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  i === stepIdx ? 'w-8 bg-accent' : i < stepIdx ? 'w-4 bg-accent/40' : 'w-4 bg-border-strong'
                }`}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={finish}
            className="text-[13px] font-bold text-text-faint transition-colors hover:text-text"
          >
            {t('ob.skip')}
          </button>
        </div>

        {/* step body — materialize cascade on every step change */}
        <div
          key={step}
          className="cascade flex min-h-0 flex-1 flex-col items-center justify-center gap-6 text-center"
        >
          {step === 'welcome' && (
            <>
              <img
                src={logoUrl}
                alt="Locked In"
                draggable={false}
                className="pointer-events-none h-14 w-auto select-none"
              />
              <p className="mx-auto max-w-md text-base font-medium leading-relaxed text-text-dim">
                {t('ob.welcome.sub')}
              </p>
              {/* teaser of the real nav — the tour step brings it to life */}
              <div className="cascade-fast flex items-center gap-1.5">
                {TOUR_TABS.map((id) => (
                  <span
                    key={id}
                    className="flex h-11 w-11 items-center justify-center rounded-full border bg-surface text-text-dim"
                  >
                    {NAV_ICONS[id]}
                  </span>
                ))}
              </div>
            </>
          )}

          {step === 'name' && (
            <>
              <div>
                <h2 className="text-2xl font-extrabold text-text">{t('ob.name.title')}</h2>
                <p className="mt-2 text-sm font-medium text-text-dim">{t('ob.name.sub')}</p>
              </div>
              <form
                className="w-full max-w-xs"
                onSubmit={(e) => {
                  e.preventDefault();
                  next();
                }}
              >
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('ob.name.ph')}
                  maxLength={40}
                  autoFocus
                  className="w-full rounded-full border bg-surface px-6 py-4 text-center text-lg font-extrabold text-text outline-none transition-colors placeholder:font-semibold placeholder:text-text-faint"
                />
              </form>
            </>
          )}

          {step === 'work' && (
            <>
              <div>
                <h2 className="text-2xl font-extrabold text-text">{t('ob.work.title')}</h2>
                <p className="mt-2 text-sm font-medium text-text-dim">{t('ob.work.sub')}</p>
              </div>
              <div className="flex max-w-md flex-wrap justify-center gap-2">
                {WORK_ROLES.map((role) => (
                  <button
                    key={role.id}
                    type="button"
                    onClick={() => toggleRole(role.id)}
                    className={`no-press chip-quiet rounded-2xl px-5 py-3 text-[15px] ${
                      roles.has(role.id)
                        ? 'bg-accent text-bg'
                        : 'bg-surface text-text-dim hover:text-text'
                    }`}
                  >
                    {t(`ob.work.${role.id}`)}
                  </button>
                ))}
              </div>
            </>
          )}

          {step === 'goal' && (
            <>
              <div>
                <h2 className="text-2xl font-extrabold text-text">
                  {firstName ? t('ob.goal.title.named', firstName) : t('ob.goal.title')}
                </h2>
                <p className="mt-2 text-sm font-medium text-text-dim">{t('ob.goal.sub')}</p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {GOAL_OPTIONS.map((h) => (
                  <button
                    key={h}
                    type="button"
                    className={`no-press chip-quiet rounded-2xl px-6 py-3.5 text-base tabular-nums ${
                      goal === h ? 'bg-accent text-bg' : 'bg-surface text-text-dim hover:text-text'
                    }`}
                    onClick={() => {
                      setGoal(h);
                      update('daily_goal_hours', h);
                    }}
                  >
                    {h}h
                  </button>
                ))}
              </div>
            </>
          )}

          {step === 'autotrack' && (
            <>
              <div>
                <h2 className="text-2xl font-extrabold text-text">{t('ob.auto.title')}</h2>
                <p className="mx-auto mt-2 max-w-md text-sm font-medium text-text-dim">
                  {t('ob.auto.sub')}
                </p>
              </div>
              <div className="w-full max-w-sm">
                {toggleRow(t('ob.auto.toggle'), t('ob.auto.toggle.hint'), autotrackOn, (v) => {
                  setAutotrackOn(v);
                  commitApps(v, apps, customApps);
                })}
              </div>
              <p className="flex items-center justify-center gap-2 text-[12px] font-medium text-text-faint">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M12 2.5 4.5 5.5v6c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5v-6z" />
                  <path d="m9 12 2 2 4-4.5" />
                </svg>
                {t('ob.auto.privacy')}
              </p>
              {/* app list slides open under the toggle — no scroll, no pop-in */}
              <div
                className={`grid w-full transition-all duration-500 ease-out ${
                  autotrackOn ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
                }`}
              >
                <div className="min-h-0 overflow-hidden">
                  <div className="flex flex-wrap justify-center gap-1.5 px-1 pb-1">
                    {APP_SUGGESTIONS.map((a) => (
                      <button
                        key={a}
                        type="button"
                        tabIndex={autotrackOn ? 0 : -1}
                        className={chip(apps.has(a))}
                        onClick={() => {
                          const nextSet = new Set(apps);
                          if (nextSet.has(a)) nextSet.delete(a);
                          else nextSet.add(a);
                          setApps(nextSet);
                          commitApps(autotrackOn, nextSet, customApps);
                        }}
                      >
                        {a}
                      </button>
                    ))}
                    {customApps.map((a) => (
                      <button
                        key={a}
                        type="button"
                        className={chip(true)}
                        onClick={() => {
                          const nextCustom = customApps.filter((x) => x !== a);
                          setCustomApps(nextCustom);
                          commitApps(autotrackOn, apps, nextCustom);
                        }}
                      >
                        {a} ✕
                      </button>
                    ))}
                  </div>
                  <form
                    className="mx-auto mt-3 flex w-full max-w-xs items-center gap-1 rounded-full border bg-surface py-1.5 pl-4 pr-1.5"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const name = customApp.trim().toLowerCase();
                      if (!name || apps.has(name) || customApps.includes(name)) return;
                      const nextCustom = [...customApps, name];
                      setCustomApps(nextCustom);
                      setCustomApp('');
                      commitApps(autotrackOn, apps, nextCustom);
                    }}
                  >
                    <input
                      value={customApp}
                      onChange={(e) => setCustomApp(e.target.value)}
                      tabIndex={autotrackOn ? 0 : -1}
                      placeholder={t('ob.auto.custom')}
                      className="min-w-0 flex-1 bg-transparent text-[13px] font-medium text-text outline-none placeholder:text-text-faint"
                    />
                    <button
                      type="submit"
                      tabIndex={autotrackOn ? 0 : -1}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-base font-extrabold text-bg"
                    >
                      +
                    </button>
                  </form>
                </div>
              </div>
            </>
          )}

          {step === 'accent' && (
            <>
              <div>
                <h2 className="text-2xl font-extrabold text-text">{t('ob.accent.title')}</h2>
                <p className="mt-2 text-sm font-medium text-text-dim">{t('ob.accent.sub')}</p>
              </div>
              <div className="grid grid-cols-5 gap-4">
                {ACCENT_PRESETS.map((p) => (
                  <button
                    key={p.color}
                    type="button"
                    title={t(p.nameKey)}
                    onClick={() => {
                      setAccent(p.color);
                      update('accent_color', p.color);
                    }}
                    className="no-press flex h-11 w-11 items-center justify-center rounded-full transition-shadow duration-300"
                    style={{
                      backgroundColor: p.color,
                      boxShadow:
                        accent === p.color
                          ? `0 0 0 3px var(--color-bg), 0 0 0 5px ${p.color}`
                          : 'none',
                    }}
                  >
                    {accent === p.color && (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#101113" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="m5 12.5 4.5 4.5L19 7.5" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            </>
          )}

          {step === 'extras' && (
            <>
              <div>
                <h2 className="text-2xl font-extrabold text-text">{t('ob.extras.title')}</h2>
                <p className="mt-2 text-sm font-medium text-text-dim">{t('ob.extras.sub')}</p>
              </div>
              <div className="w-full max-w-sm space-y-2">
                {toggleRow(t('set.sound'), t('ob.extras.sound'), sound, (v) => {
                  setSound(v);
                  update('sound_enabled', v);
                })}
                {toggleRow(t('set.pomodoro'), t('ob.extras.pomo'), pomo, (v) => {
                  setPomo(v);
                  update('pomodoro_enabled', v);
                })}
                {toggleRow(t('set.overlay'), t('ob.extras.overlay'), overlay, (v) => {
                  setOverlay(v);
                  update('overlay_enabled', v);
                })}
                {toggleRow(t('set.checkin'), t('ob.extras.checkin'), checkin, (v) => {
                  setCheckin(v);
                  update('checkin_enabled', v);
                })}
                {toggleRow(t('set.telemetry'), t('ob.extras.telemetry'), telemetry, (v) => {
                  setTelemetry(v);
                  update('telemetry_enabled', v);
                })}
              </div>
            </>
          )}

          {step === 'tour' && (
            <>
              <div>
                <h2 className="text-2xl font-extrabold text-text">{t('ob.tour.title')}</h2>
                <p className="mt-2 text-sm font-medium text-text-dim">{t('ob.tour.sub')}</p>
              </div>
              {/* the real nav pill, miniature — fixed-width slots exactly like the
                  titlebar: only the active button widens, the pill never resizes */}
              <div className="flex shrink-0 items-center gap-1 rounded-full border bg-surface p-1.5">
                {TOUR_TABS.map((id) => {
                  const active = tourSel === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setTourSel(id)}
                      style={{ width: active ? 112 : 44 }}
                      className={`no-press chip-quiet flex h-11 shrink-0 items-center justify-center overflow-hidden rounded-full text-[13px] transition-[width,background-color,color] duration-300 ${
                        active ? 'bg-accent text-bg' : 'text-text-dim hover:text-text'
                      }`}
                    >
                      {NAV_ICONS[id]}
                      <span
                        className={`overflow-hidden whitespace-nowrap transition-[max-width,opacity,margin-left] duration-300 ease-out ${
                          active ? 'ml-2 max-w-[8rem] opacity-100' : 'ml-0 max-w-0 opacity-0'
                        }`}
                      >
                        {t(TOUR_LABEL_KEY[id])}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p
                key={tourSel}
                className="animate-fade-in mx-auto max-w-sm text-[15px] font-medium leading-relaxed text-text-dim"
              >
                {t(`ob.tour.${tourSel}`)}
              </p>
            </>
          )}

          {step === 'social' && (
            <>
              <div>
                <h2 className="text-2xl font-extrabold text-text">{t('ob.social.title')}</h2>
                <p className="mx-auto mt-2 max-w-md text-sm font-medium text-text-dim">
                  {t('ob.social.sub')}
                </p>
              </div>
              {signedIn ? (
                <div className="w-full max-w-xs">
                  <form
                    className="flex items-center gap-1 rounded-full border bg-surface py-1.5 pl-4 pr-1.5"
                    onSubmit={(e) => {
                      e.preventDefault();
                      addFriend();
                    }}
                  >
                    <input
                      value={friendName}
                      onChange={(e) => setFriendName(e.target.value)}
                      placeholder={t('fr.add.placeholder')}
                      className="min-w-0 flex-1 bg-transparent text-[13px] font-medium text-text outline-none placeholder:text-text-faint"
                    />
                    <button
                      type="submit"
                      disabled={friendBusy}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-base font-extrabold text-bg transition-opacity disabled:opacity-50"
                    >
                      +
                    </button>
                  </form>
                  {sentTo.length > 0 && (
                    <div className="mt-3 flex flex-wrap justify-center gap-1.5">
                      {sentTo.map((n) => (
                        <span
                          key={n}
                          className="animate-fade-up flex items-center gap-1.5 rounded-full bg-accent/10 px-3 py-1.5 text-xs font-bold text-accent"
                        >
                          @{n}
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <path d="m5 12.5 4.5 4.5L19 7.5" />
                          </svg>
                        </span>
                      ))}
                    </div>
                  )}
                  {friendMsg && !friendMsg.ok && (
                    <p className="animate-fade-in mt-2 text-[12px] font-bold text-danger">
                      {friendMsg.text}
                    </p>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={onCreateAccount}
                  className="rounded-2xl bg-accent px-8 py-4 text-base font-extrabold text-bg"
                >
                  {t('ob.social.create')}
                </button>
              )}
            </>
          )}

          {step === 'loading' && (
            <>
              <div className="relative h-[152px] w-[152px]">
                <svg width="152" height="152" viewBox="0 0 152 152" className="absolute inset-0" aria-hidden>
                  <circle
                    cx="76"
                    cy="76"
                    r={RING_R}
                    fill="none"
                    stroke="rgba(255,255,255,0.07)"
                    strokeWidth="6"
                  />
                  <circle
                    cx="76"
                    cy="76"
                    r={RING_R}
                    fill="none"
                    stroke="var(--color-accent)"
                    strokeWidth="6"
                    strokeLinecap="round"
                    strokeDasharray={RING_C}
                    strokeDashoffset={RING_C * (1 - loadPct)}
                    transform="rotate(-90 76 76)"
                    style={{ transition: 'stroke-dashoffset 120ms linear' }}
                  />
                </svg>

                {/* act 1 — the padlock snaps shut */}
                <div className={loadIcon(0)}>
                  <svg width="60" height="60" viewBox="0 0 60 60" aria-hidden>
                    <g
                      style={{
                        transform: loadPct > 0.08 ? 'translateY(0)' : 'translateY(-7px)',
                        transition: 'transform 550ms cubic-bezier(0.34, 1.4, 0.64, 1)',
                      }}
                    >
                      <path
                        d="M21 30 v-8 a9 9 0 0 1 18 0 v8"
                        fill="none"
                        stroke="var(--color-accent)"
                        strokeWidth="4.5"
                        strokeLinecap="round"
                      />
                    </g>
                    <rect x="14" y="30" width="32" height="24" rx="7" fill="var(--color-accent)" />
                    <circle cx="30" cy="41" r="3" fill="var(--color-bg)" />
                  </svg>
                </div>

                {/* act 2 — the clock hand sweeps */}
                <div className={loadIcon(1)}>
                  <svg width="60" height="60" viewBox="0 0 60 60" aria-hidden>
                    <circle
                      cx="30"
                      cy="30"
                      r="21"
                      fill="none"
                      stroke="var(--color-accent)"
                      strokeWidth="4.5"
                    />
                    <g
                      style={{
                        transformOrigin: '30px 30px',
                        animation:
                          loadPhase === 1 ? 'ob-hand 1.5s cubic-bezier(0.5, 0, 0.4, 1) infinite' : 'none',
                      }}
                    >
                      <line
                        x1="30"
                        y1="30"
                        x2="30"
                        y2="17"
                        stroke="var(--color-accent)"
                        strokeWidth="4.5"
                        strokeLinecap="round"
                      />
                    </g>
                    <circle cx="30" cy="30" r="2.5" fill="var(--color-accent)" />
                  </svg>
                </div>

                {/* act 3 — the check draws itself */}
                <div className={loadIcon(2)}>
                  <svg width="60" height="60" viewBox="0 0 60 60" aria-hidden>
                    <path
                      d="M15 31 l11 11 l19 -22"
                      fill="none"
                      stroke="var(--color-accent)"
                      strokeWidth="5.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeDasharray="46"
                      strokeDashoffset={loadPhase === 2 ? undefined : 46}
                      style={
                        loadPhase === 2
                          ? { strokeDashoffset: 46, animation: 'ob-draw 650ms ease-out 150ms forwards' }
                          : undefined
                      }
                    />
                  </svg>
                </div>
              </div>
              <div>
                <p key={loadMsg} className="animate-fade-in text-[15px] font-semibold text-text-dim">
                  {loadMsg}
                </p>
                <p className="mt-1.5 text-xs font-bold tabular-nums text-text-faint">
                  {Math.round(loadPct * 100)}%
                </p>
              </div>
            </>
          )}
        </div>

        {/* nav */}
        <div className={`flex items-center justify-between ${step === 'loading' ? 'invisible' : ''}`}>
          <button
            type="button"
            onClick={back}
            className={`rounded-xl px-5 py-3 text-sm font-bold text-text-dim transition-colors hover:text-text ${
              stepIdx === 0 ? 'invisible' : ''
            }`}
          >
            {t('ob.back')}
          </button>
          <button
            type="button"
            onClick={next}
            className="rounded-2xl bg-accent px-10 py-3.5 text-base font-extrabold text-bg"
          >
            {step === 'social' ? t('ob.finish') : step === 'welcome' ? t('ob.start') : t('ob.next')}
          </button>
        </div>
      </div>
    </div>
  );
}

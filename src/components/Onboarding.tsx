import { useState } from 'react';
import type { Settings } from '../types';
import { Mascot } from './Mascot';
import { t } from '../lib/i18n';
import * as social from '../lib/social';
import { ACCENT_PRESETS } from './Settings';

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

const STEPS = ['welcome', 'goal', 'autotrack', 'accent', 'extras', 'social', 'done'] as const;
type Step = (typeof STEPS)[number];

export function Onboarding({ settings, update, signedIn, onCreateAccount, onDone }: OnboardingProps) {
  const [stepIdx, setStepIdx] = useState(0);
  const step: Step = STEPS[stepIdx];

  // local selections — committed to settings as the user picks them
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
  const [friendName, setFriendName] = useState('');
  const [friendMsg, setFriendMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [friendBusy, setFriendBusy] = useState(false);

  const commitApps = (on: boolean, sel: Set<string>, customs: string[]) => {
    update('autotrack_enabled', on);
    const list = [...sel, ...customs].join(', ');
    if (list) update('autotrack_apps', list);
  };

  const next = () => setStepIdx((i) => Math.min(i + 1, STEPS.length - 1));
  const back = () => setStepIdx((i) => Math.max(i - 1, 0));

  const finish = () => {
    localStorage.setItem('onboarded-v1', '1');
    onDone();
  };

  async function addFriend() {
    const name = friendName.trim();
    if (!name || friendBusy) return;
    setFriendBusy(true);
    setFriendMsg(null);
    try {
      const r = await social.sendFriendRequest(name);
      if (r === 'sent') {
        setFriendMsg({ text: t('fr.add.sent', name.replace(/^@/, '')), ok: true });
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
    `rounded-2xl border-2 px-5 py-3 text-[15px] font-extrabold transition-all ${
      active
        ? 'border-accent bg-accent-dim text-accent scale-105'
        : 'border-border bg-surface text-text-dim hover:border-border-strong hover:text-text'
    }`;

  const toggleRow = (label: string, hint: string, value: boolean, set: (v: boolean) => void) => (
    <button
      type="button"
      onClick={() => set(!value)}
      className={`flex w-full items-center justify-between gap-4 rounded-2xl border-2 px-5 py-4 text-left transition-colors ${
        value ? 'border-accent/50 bg-accent-dim/40' : 'border-border bg-surface hover:border-border-strong'
      }`}
    >
      <div className="min-w-0">
        <div className="text-[15px] font-extrabold text-text">{label}</div>
        <div className="mt-0.5 text-[12px] text-text-dim">{hint}</div>
      </div>
      <span
        className={`h-[26px] w-12 shrink-0 rounded-full p-[3px] transition-colors ${
          value ? 'bg-accent' : 'bg-border-strong'
        }`}
      >
        <span
          className={`block h-[20px] w-[20px] rounded-full bg-bg shadow-sm transition-transform ${
            value ? 'translate-x-[22px]' : ''
          }`}
        />
      </span>
    </button>
  );

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center overflow-hidden bg-bg">
      {/* subtle dotted backdrop, same language as the login screen */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage: 'radial-gradient(var(--color-accent) 1.5px, transparent 1.5px)',
          backgroundSize: '30px 30px',
        }}
        aria-hidden
      />
      <div className="relative flex h-full w-full max-w-2xl flex-col px-10 py-8">
        {/* progress + skip */}
        <div className="flex items-center justify-between">
          <div className="flex gap-2">
            {STEPS.map((s, i) => (
              <span
                key={s}
                className={`h-2 rounded-full transition-all duration-300 ${
                  i === stepIdx ? 'w-8 bg-accent' : i < stepIdx ? 'w-4 bg-accent/50' : 'w-4 bg-border-strong'
                }`}
              />
            ))}
          </div>
          {step !== 'done' && (
            <button
              type="button"
              onClick={finish}
              className="text-[13px] font-bold text-text-faint hover:text-text"
            >
              {t('ob.skip')}
            </button>
          )}
        </div>

        {/* step body */}
        <div
          key={step}
          className="animate-fade-up flex min-h-0 flex-1 flex-col items-center justify-center gap-7 text-center"
        >
          {step === 'welcome' && (
            <>
              <div className="animate-mascot-wobble">
                <Mascot mood="happy" size={160} />
              </div>
              <div>
                <h1 className="text-4xl font-extrabold tracking-tight text-text">Locked In</h1>
                <p className="mx-auto mt-3 max-w-md text-base text-text-dim">{t('ob.welcome.sub')}</p>
              </div>
            </>
          )}

          {step === 'goal' && (
            <>
              <Mascot mood="think" size={110} />
              <div>
                <h2 className="text-2xl font-extrabold text-text">{t('ob.goal.title')}</h2>
                <p className="mt-2 text-[13px] text-text-dim">{t('ob.goal.sub')}</p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {GOAL_OPTIONS.map((h) => (
                  <button
                    key={h}
                    type="button"
                    className={chip(goal === h)}
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
              <Mascot mood="hyped" size={104} />
              <div>
                <h2 className="text-2xl font-extrabold text-text">{t('ob.auto.title')}</h2>
                <p className="mx-auto mt-2 max-w-md text-[13px] text-text-dim">
                  {t('ob.auto.sub')}
                </p>
              </div>
              {toggleRow(
                t('ob.auto.toggle'),
                t('ob.auto.toggle.hint'),
                autotrackOn,
                (v) => {
                  setAutotrackOn(v);
                  commitApps(v, apps, customApps);
                },
              )}
              {autotrackOn && (
                <>
                  <div className="scrollbar-none flex max-h-44 flex-wrap justify-center gap-1.5 overflow-y-auto">
                    {APP_SUGGESTIONS.map((a) => (
                      <button
                        key={a}
                        type="button"
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
                    className="flex w-full max-w-xs gap-1.5"
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
                      placeholder={t('ob.auto.custom')}
                      className="min-w-0 flex-1 rounded-xl border border-border bg-surface px-3 py-2 text-[13px] text-text outline-none placeholder:text-text-faint focus:border-accent"
                    />
                    <button
                      type="submit"
                      className="rounded-xl border border-border bg-surface px-3 text-sm font-extrabold text-text hover:border-accent"
                    >
                      +
                    </button>
                  </form>
                </>
              )}
            </>
          )}

          {step === 'accent' && (
            <>
              <Mascot mood="relax" size={104} />
              <div>
                <h2 className="text-2xl font-extrabold text-text">{t('ob.accent.title')}</h2>
                <p className="mt-2 text-[13px] text-text-dim">{t('ob.accent.sub')}</p>
              </div>
              <div className="grid grid-cols-5 gap-3">
                {ACCENT_PRESETS.map((p) => (
                  <button
                    key={p.color}
                    type="button"
                    title={t(p.nameKey)}
                    onClick={() => {
                      setAccent(p.color);
                      update('accent_color', p.color);
                    }}
                    className={`h-12 w-12 rounded-2xl border-4 transition-transform ${
                      accent === p.color ? 'border-text' : 'border-transparent'
                    }`}
                    style={{ backgroundColor: p.color }}
                  />
                ))}
              </div>
            </>
          )}

          {step === 'extras' && (
            <>
              <Mascot mood="think" size={104} />
              <div>
                <h2 className="text-2xl font-extrabold text-text">{t('ob.extras.title')}</h2>
                <p className="mt-2 text-[13px] text-text-dim">{t('ob.extras.sub')}</p>
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

          {step === 'social' && (
            <>
              <Mascot mood="hyped" size={104} />
              <div>
                <h2 className="text-2xl font-extrabold text-text">{t('ob.social.title')}</h2>
                <p className="mx-auto mt-2 max-w-md text-[13px] text-text-dim">
                  {t('ob.social.sub')}
                </p>
              </div>
              {signedIn ? (
                <div className="w-full max-w-xs">
                  <form
                    className="flex gap-1.5"
                    onSubmit={(e) => {
                      e.preventDefault();
                      addFriend();
                    }}
                  >
                    <input
                      value={friendName}
                      onChange={(e) => setFriendName(e.target.value)}
                      placeholder={t('fr.add.placeholder')}
                      className="min-w-0 flex-1 rounded-xl border border-border bg-surface px-3 py-2.5 text-[13px] text-text outline-none placeholder:text-text-faint focus:border-accent"
                    />
                    <button
                      type="submit"
                      disabled={friendBusy}
                      className="rounded-xl bg-accent px-4 text-sm font-extrabold text-bg disabled:opacity-50"
                    >
                      +
                    </button>
                  </form>
                  {friendMsg && (
                    <p
                      className={`mt-2 text-[12px] font-bold ${
                        friendMsg.ok ? 'text-accent' : 'text-danger'
                      }`}
                    >
                      {friendMsg.text}
                    </p>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={onCreateAccount}
                  className="rounded-2xl bg-accent px-8 py-4 text-base font-extrabold text-bg transition-transform"
                >
                  {t('ob.social.create')}
                </button>
              )}
            </>
          )}

          {step === 'done' && (
            <>
              <div className="animate-mascot-wobble">
                <Mascot mood="hyped" size={160} />
              </div>
              <div>
                <h2 className="text-3xl font-extrabold text-text">{t('ob.done.title')}</h2>
                <p className="mx-auto mt-3 max-w-md text-base text-text-dim">
                  {t('ob.done.sub', String(goal))}
                </p>
              </div>
            </>
          )}
        </div>

        {/* nav */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={back}
            className={`rounded-xl px-5 py-3 text-sm font-bold text-text-dim hover:text-text ${
              stepIdx === 0 ? 'invisible' : ''
            }`}
          >
            {t('ob.back')}
          </button>
          <button
            type="button"
            onClick={step === 'done' ? finish : next}
            className="rounded-2xl bg-accent px-10 py-3.5 text-base font-extrabold text-bg transition-transform"
          >
            {step === 'done' ? t('ob.finish') : step === 'welcome' ? t('ob.start') : t('ob.next')}
          </button>
        </div>
      </div>
    </div>
  );
}

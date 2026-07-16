import { useState } from 'react';
import * as cloud from '../lib/cloud';
import { t } from '../lib/i18n';
import { Mascot } from './Mascot';

interface LoginProps {
  /** called once the user is past the gate (signed in or chose guest) */
  onDone: () => void;
}

type Screen = 'signin' | 'signup';

export function Login({ onDone }: LoginProps) {
  const [screen, setScreen] = useState<Screen>('signin');
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ cloud: cloud.CloudSnapshot; localCount: number } | null>(
    null,
  );

  function switchTo(s: Screen) {
    setScreen(s);
    setError(null);
    setPass('');
    setPass2('');
  }

  async function afterAuth() {
    const r = await cloud.reconcileAfterLogin();
    if (r.kind === 'conflict') {
      setConflict({ cloud: r.cloud, localCount: r.localCount });
      return;
    }
    if (r.kind === 'error') {
      setError(t('acc.err', r.message));
      return;
    }
    if (r.kind === 'restored') {
      window.location.reload();
      return;
    }
    onDone();
  }

  async function doSignIn() {
    setError(null);
    if (!email.trim() || pass.length < 8) {
      setError(t('acc.badinput'));
      return;
    }
    setBusy(true);
    try {
      const err = await cloud.signIn(email.trim(), pass);
      if (err) {
        setError(t('login.badcreds'));
        return;
      }
      await afterAuth();
    } finally {
      setBusy(false);
    }
  }

  async function doSignUp() {
    setError(null);
    if (!email.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      setError(t('login.bademail'));
      return;
    }
    if (pass.length < 8) {
      setError(t('login.badpass'));
      return;
    }
    if (pass !== pass2) {
      setError(t('login.mismatch'));
      return;
    }
    setBusy(true);
    try {
      const r = await cloud.signUp(email.trim(), pass);
      if (r.kind === 'exists') {
        setError(t('login.existing'));
        return;
      }
      if (r.kind === 'error') {
        setError(t('acc.err', r.message));
        return;
      }
      // created — sign in to get a session, then reconcile
      const err = await cloud.signIn(email.trim(), pass);
      if (err) {
        setError(t('acc.err', err));
        return;
      }
      await afterAuth();
    } finally {
      setBusy(false);
    }
  }

  function continueAsGuest() {
    localStorage.setItem('guest-mode', '1');
    onDone();
  }

  async function resolveConflict(useCloud: boolean) {
    if (!conflict) return;
    setBusy(true);
    setError(null);
    try {
      if (useCloud) {
        await cloud.restoreSnapshot(conflict.cloud);
        window.location.reload();
      } else {
        const err = await cloud.uploadSnapshot();
        if (err) {
          setError(t('acc.err', err));
          return;
        }
        onDone();
      }
    } catch (e) {
      setError(t('acc.err', String(e)));
    } finally {
      setBusy(false);
    }
  }

  // ---- conflict picker (both local and cloud have data) ----
  if (conflict) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-bg px-6">
        <div className="chunk animate-scale-in w-full max-w-sm p-6">
          <h2 className="text-lg font-extrabold text-text">{t('acc.conflict.title')}</h2>
          <p className="mt-1.5 text-sm font-medium text-text-dim">{t('acc.conflict.body')}</p>
          <div className="mt-4 space-y-2.5 text-sm">
            <div className="chunk px-4 py-3 font-semibold text-text">
              ☁️ {t('acc.conflict.cloud')}{' '}
              <span className="text-text-faint">
                · {conflict.cloud.data.sessions?.length ?? 0} {t('home.blocks')}
              </span>
            </div>
            <div className="chunk px-4 py-3 font-semibold text-text">
              💻 {t('acc.conflict.local')}{' '}
              <span className="text-text-faint">
                · {conflict.localCount} {t('acc.conflict.items')}
              </span>
            </div>
          </div>
          {error && <div className="mt-3 text-center text-xs font-bold text-danger">{error}</div>}
          <div className="mt-5 flex flex-col gap-2.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => resolveConflict(true)}
              className="chunk-btn chunk-btn-accent py-3.5 text-sm"
            >
              {busy ? '…' : t('acc.conflict.usecloud')}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => resolveConflict(false)}
              className="chunk-btn py-3 text-sm text-text"
            >
              {t('acc.conflict.uselocal')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in relative flex h-screen w-screen items-center justify-center bg-bg px-6">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage: 'radial-gradient(var(--color-accent) 1.5px, transparent 1.5px)',
          backgroundSize: '26px 26px',
        }}
        aria-hidden
      />

      <div className="relative w-full max-w-sm">
        {/* mascot + wordmark */}
        <div className="mb-7 flex items-end justify-center gap-3">
          <div className="animate-mascot-wobble">
            <Mascot mood="happy" size={72} />
          </div>
          <div className="pb-1">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-[3px] bg-accent" />
              <span className="text-2xl font-extrabold tracking-tight text-text">Locked In</span>
            </div>
            <div className="mt-0.5 text-xs font-bold text-text-faint">{t('login.tagline')}</div>
          </div>
        </div>

        <div className="chunk animate-fade-up p-5">
          <div className="mb-3 text-center text-sm font-extrabold uppercase tracking-wide text-text">
            {screen === 'signin' ? t('acc.signin') : t('acc.signup')}
          </div>

          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email"
            autoComplete="off"
            autoFocus
            className="chunk-input w-full px-4 py-3 text-[15px] font-semibold text-text placeholder:font-medium placeholder:text-text-faint"
          />
          <input
            type="password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            placeholder={t('acc.pass.placeholder')}
            autoComplete="new-password"
            onKeyDown={(e) => e.key === 'Enter' && screen === 'signin' && doSignIn()}
            className="chunk-input mt-2.5 w-full px-4 py-3 text-[15px] font-semibold text-text placeholder:font-medium placeholder:text-text-faint"
          />
          {screen === 'signup' && (
            <input
              type="password"
              value={pass2}
              onChange={(e) => setPass2(e.target.value)}
              placeholder={t('login.confirm')}
              autoComplete="new-password"
              onKeyDown={(e) => e.key === 'Enter' && doSignUp()}
              className="chunk-input mt-2.5 w-full px-4 py-3 text-[15px] font-semibold text-text placeholder:font-medium placeholder:text-text-faint"
            />
          )}

          {error && <div className="mt-3 text-center text-xs font-bold text-danger">{error}</div>}

          <button
            type="button"
            disabled={busy}
            onClick={screen === 'signin' ? doSignIn : doSignUp}
            className="chunk-btn chunk-btn-accent mt-4 w-full py-3.5 text-[15px]"
          >
            {busy ? '…' : screen === 'signin' ? t('acc.signin') : t('acc.signup')}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => switchTo(screen === 'signin' ? 'signup' : 'signin')}
            className="chunk-btn mt-2.5 w-full py-3 text-sm text-text"
          >
            {screen === 'signin' ? t('login.newhere') : t('login.haveaccount')}
          </button>
        </div>

        <button
          type="button"
          onClick={continueAsGuest}
          className="mt-4 w-full text-center text-sm font-bold text-text-dim underline-offset-4 hover:text-text hover:underline"
        >
          {t('login.guest')}
        </button>
        <p className="mt-2 text-center text-[11px] font-medium leading-relaxed text-text-faint">
          {t('login.guest.hint')}
        </p>
      </div>
    </div>
  );
}

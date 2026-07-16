import { useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import * as cloud from '../lib/cloud';
import * as db from '../lib/db';
import * as e2e from '../lib/e2e';
import { getLang, setLang, t } from '../lib/i18n';
import type { Lang } from '../lib/i18n';
import * as social from '../lib/social';
import { Mascot } from './Mascot';

/**
 * Zero-friction message-key cloud flow, run while the account password is
 * still in memory: fresh device restores the key with it; fresh key gets
 * backed up with it. The passphrase is stretched with Argon2id client-side —
 * the server never stores the password and can't open the backup. A custom
 * backup passphrase (set via Profile) still wins: auto-restore just fails
 * closed and the manual restore modal takes over inside the app.
 */
async function autoKeyFlow(accountPassword: string): Promise<void> {
  try {
    const prof = await social.getMyProfile();
    const status = await e2e.ensureKeys(prof?.e2e_pub ?? null);
    if (status === 'ok') {
      if (!(await e2e.hasCloudBackup())) await e2e.backupKeyToCloud(accountPassword);
    } else if (status === 'restore-needed') {
      await e2e.restoreKeyFromCloud(accountPassword);
    }
  } catch {
    // offline or race — the in-app modal remains the fallback
  }
}

interface LoginProps {
  /** called once the user is past the gate (signed in or chose guest) */
  onDone: () => void;
}

type Screen = 'signin' | 'signup';

export function Login({ onDone }: LoginProps) {
  const [screen, setScreen] = useState<Screen>('signin');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ cloud: cloud.CloudSnapshot; localCount: number } | null>(
    null,
  );
  const [lang, setLangState] = useState<Lang>(getLang());

  function pickLang(l: Lang) {
    setLang(l);
    setLangState(l);
    db.setSetting('language', l).catch(() => {});
  }

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
      await autoKeyFlow(pass);
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
    const uname = username.trim().replace(/^@/, '');
    if (!social.USERNAME_RE.test(uname)) {
      setError(t('fr.claim.rules'));
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
      // username first — don't create the auth user if the name is taken
      const free = await social.usernameAvailable(uname);
      if (!free) {
        setError(t('fr.err.taken'));
        return;
      }
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
      // claim the username; if someone raced us to it, the Friends tab
      // asks again — never blocks the account itself
      await social.claimUsername(uname).catch(() => {});
      await autoKeyFlow(pass);
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

      {/* frameless window: draggable top strip */}
      <div data-tauri-drag-region className="absolute inset-x-0 top-0 h-10" />

      {/* language toggle + window controls, top-right */}
      <div className="absolute right-2 top-2 flex items-center gap-2">
        <div className="flex items-center gap-0.5 rounded-lg border-2 border-border-strong bg-surface p-0.5">
          {(['pt', 'en'] as const).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => pickLang(l)}
              className={`h-6 w-8 rounded-md text-[11px] font-bold uppercase ${
                lang === l ? 'bg-accent text-bg' : 'text-text-dim hover:text-text'
              }`}
            >
              {l}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => getCurrentWindow().minimize()}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-text-dim hover:bg-surface-hover hover:text-text"
        >
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.4">
            <line x1="1" y1="5.5" x2="10" y2="5.5" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => getCurrentWindow().close()}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-text-dim hover:bg-danger hover:text-white"
        >
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.4">
            <line x1="1.5" y1="1.5" x2="9.5" y2="9.5" />
            <line x1="9.5" y1="1.5" x2="1.5" y2="9.5" />
          </svg>
        </button>
      </div>

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
          {screen === 'signup' && (
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={t('login.username')}
              autoComplete="off"
              maxLength={21}
              className="chunk-input mt-2.5 w-full px-4 py-3 text-[15px] font-semibold text-text placeholder:font-medium placeholder:text-text-faint"
            />
          )}
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

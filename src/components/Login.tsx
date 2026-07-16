import { useState } from 'react';
import * as cloud from '../lib/cloud';
import { t } from '../lib/i18n';
import { Mascot } from './Mascot';

interface LoginProps {
  /** called once the user is past the gate (signed in or chose guest) */
  onDone: () => void;
}

export function Login({ onDone }: LoginProps) {
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ cloud: cloud.CloudSnapshot; localCount: number } | null>(
    null,
  );

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
      // pulled cloud data down — reload so every screen picks it up
      window.location.reload();
      return;
    }
    onDone();
  }

  async function submit(kind: 'signin' | 'signup') {
    setError(null);
    if (!email.trim() || pass.length < 8) {
      setError(t('acc.badinput'));
      return;
    }
    setBusy(true);
    try {
      const err =
        kind === 'signup'
          ? await cloud.signUp(email.trim(), pass)
          : await cloud.signIn(email.trim(), pass);
      if (err) {
        setError(t('acc.err', err));
        return;
      }
      const user = await cloud.currentUser();
      if (!user) {
        // signup on an existing email returns an obfuscated non-session
        setError(t('login.existing'));
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

  // ---- conflict picker (both local and cloud have data) ----
  if (conflict) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-bg px-6">
        <div className="chunk animate-scale-in w-full max-w-sm p-6">
          <h2 className="text-lg font-extrabold text-text">{t('acc.conflict.title')}</h2>
          <p className="mt-1.5 text-sm text-text-dim">{t('acc.conflict.body')}</p>
          <div className="mt-4 space-y-2 text-sm">
            <div className="chunk px-4 py-3">
              ☁️ {t('acc.conflict.cloud')}{' '}
              <span className="text-text-faint">
                · {conflict.cloud.data.sessions?.length ?? 0} {t('home.blocks')}
              </span>
            </div>
            <div className="chunk px-4 py-3">
              💻 {t('acc.conflict.local')}{' '}
              <span className="text-text-faint">
                · {conflict.localCount} {t('acc.conflict.items')}
              </span>
            </div>
          </div>
          <div className="mt-5 flex gap-2.5">
            <button
              type="button"
              onClick={async () => {
                await cloud.restoreSnapshot(conflict.cloud);
                window.location.reload();
              }}
              className="chunk-btn chunk-btn-accent flex-1 py-3 text-sm"
            >
              {t('acc.conflict.usecloud')}
            </button>
            <button
              type="button"
              onClick={async () => {
                await cloud.uploadSnapshot();
                onDone();
              }}
              className="chunk-btn flex-1 py-3 text-sm text-text"
            >
              {t('acc.conflict.uselocal')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in flex h-screen w-screen items-center justify-center bg-bg px-6">
      {/* subtle pixel-dust backdrop */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            'radial-gradient(var(--color-accent) 1.5px, transparent 1.5px)',
          backgroundSize: '26px 26px',
        }}
        aria-hidden
      />

      <div className="relative w-full max-w-sm">
        {/* mascot + wordmark */}
        <div className="mb-7 flex flex-col items-center gap-3">
          <div className="flex items-end gap-3">
            <div className="animate-mascot-wobble">
              <Mascot mood="happy" size={72} />
            </div>
            <div className="pb-1">
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-[3px] bg-accent" />
                <span className="text-2xl font-extrabold tracking-tight text-text">Locked In</span>
              </div>
              <div className="mt-0.5 text-xs font-medium text-text-faint">{t('login.tagline')}</div>
            </div>
          </div>
        </div>

        <div className="chunk animate-fade-up p-5">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email"
            autoComplete="off"
            autoFocus
            className="chunk-input w-full px-4 py-3 text-[15px] text-text placeholder:text-text-faint"
          />
          <input
            type="password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            placeholder={t('acc.pass.placeholder')}
            autoComplete="new-password"
            onKeyDown={(e) => e.key === 'Enter' && submit('signin')}
            className="chunk-input mt-2.5 w-full px-4 py-3 text-[15px] text-text placeholder:text-text-faint"
          />

          {error && <div className="mt-3 text-center text-xs font-medium text-danger">{error}</div>}

          <button
            type="button"
            disabled={busy}
            onClick={() => submit('signin')}
            className="chunk-btn chunk-btn-accent mt-4 w-full py-3.5 text-[15px]"
          >
            {busy ? '…' : t('acc.signin')}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => submit('signup')}
            className="chunk-btn mt-2.5 w-full py-3 text-sm text-text"
          >
            {t('login.newhere')}
          </button>
        </div>

        {/* guest */}
        <button
          type="button"
          onClick={continueAsGuest}
          className="mt-4 w-full text-center text-sm font-semibold text-text-dim underline-offset-4 hover:text-text hover:underline"
        >
          {t('login.guest')}
        </button>
        <p className="mt-2 text-center text-[11px] leading-relaxed text-text-faint">
          {t('login.guest.hint')}
        </p>
      </div>
    </div>
  );
}

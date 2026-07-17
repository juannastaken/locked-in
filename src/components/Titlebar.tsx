import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { t } from '../lib/i18n';
import type { SocialHook } from '../hooks/useSocial';
import { HeadphonesIcon, PointIcon } from './Icons';

export interface TabDef {
  id: string;
  labelKey: string;
}

interface TitlebarProps {
  tabs: TabDef[];
  tab: string;
  onTab: (id: string) => void;
  statusChip: ReactNode;
  social: SocialHook;
  signedIn: boolean;
  userName: string | null;
  onOpenProfile: () => void;
  /** my own session state — mirrors the green ring friends see */
  focusing: boolean;
}

/** Instagram-style empty avatar: a little head-and-shoulders silhouette. */
export function PersonIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="12" cy="8.2" r="4.2" />
      <path d="M12 14.4c-4.8 0-8.2 2.6-8.2 6.1V22h16.4v-1.5c0-3.5-3.4-6.1-8.2-6.1z" />
    </svg>
  );
}

/** Square on/off gate (jam invites / pokes) living beside the gear. */
function GateSquare({
  storageKey,
  titleOn,
  titleOff,
  icon,
}: {
  storageKey: string;
  titleOn: string;
  titleOff: string;
  icon: ReactNode;
}) {
  const [blocked, setBlocked] = useState(() => localStorage.getItem(storageKey) === '1');
  return (
    <button
      type="button"
      title={blocked ? titleOff : titleOn}
      onClick={() => {
        const next = !blocked;
        localStorage.setItem(storageKey, next ? '1' : '0');
        setBlocked(next);
      }}
      className={`ml-1 flex h-10 w-10 items-center justify-center rounded-xl border-2 transition-colors ${
        blocked
          ? 'border-danger/50 text-danger hover:bg-danger/10'
          : 'border-border text-accent hover:border-accent/60 hover:bg-accent-dim'
      }`}
    >
      {icon}
    </button>
  );
}

function WinButton({
  onClick,
  danger,
  title,
  children,
}: {
  onClick: () => void;
  danger?: boolean;
  title: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`flex h-14 w-12 items-center justify-center text-text-dim transition-colors ${
        danger ? 'hover:bg-danger hover:text-white' : 'hover:bg-surface-hover hover:text-text'
      }`}
    >
      {children}
    </button>
  );
}

export function Titlebar({
  tabs,
  tab,
  onTab,
  statusChip,
  social,
  signedIn,
  userName,
  onOpenProfile,
  focusing,
}: TitlebarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [menuOpen]);

  const me = social.state?.me ?? null;
  const win = () => getCurrentWindow();

  const avatarCircle = (size: string, iconSize: number) => (
    <div
      className={`flex ${size} items-center justify-center overflow-hidden rounded-full border-2 bg-surface text-text-dim ${
        focusing ? 'border-accent' : 'border-border-strong'
      }`}
    >
      {me?.avatar_b64 ? (
        <img src={me.avatar_b64} alt="" className="h-full w-full object-cover" />
      ) : (
        <PersonIcon size={iconSize} />
      )}
    </div>
  );

  return (
    <header
      data-tauri-drag-region
      className="relative flex h-14 shrink-0 select-none items-stretch gap-2 border-b border-border pl-2"
    >
      {/* left: settings gear only */}
      <div data-tauri-drag-region className="flex items-center">
        <button
          type="button"
          onClick={() => onTab('settings')}
          title={t('tab.settings')}
          className={`flex h-10 w-10 items-center justify-center rounded-xl transition-colors ${
            tab === 'settings'
              ? 'bg-surface-hover text-text'
              : 'text-text-dim hover:bg-surface-hover hover:text-text'
          }`}
        >
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
        {/* jam/poke gates — square, next to the gear (moved out of Friends) */}
        {signedIn && (
          <>
            <GateSquare
              storageKey="jams-blocked"
              titleOn={t('fr.jams.on')}
              titleOff={t('fr.jams.off')}
              icon={<HeadphonesIcon size={15} />}
            />
            <GateSquare
              storageKey="pokes-blocked"
              titleOn={t('poke.gate.tip')}
              titleOff={t('poke.gate.tip')}
              icon={<PointIcon size={15} />}
            />
          </>
        )}
      </div>

      {/* center: bare text nav, active shown by a bar ON TOP */}
      <div data-tauri-drag-region className="flex min-w-0 flex-1 items-stretch justify-center">
        <nav className="scrollbar-none flex min-w-0 items-stretch gap-1 overflow-x-auto px-2 sm:gap-2">
          {tabs.map((tabDef) => {
            const active = tab === tabDef.id;
            return (
              <button
                key={tabDef.id}
                type="button"
                onClick={() => onTab(tabDef.id)}
                className={`relative flex shrink-0 items-center px-2.5 text-sm font-bold tracking-tight transition-colors sm:px-3 ${
                  active ? 'text-text' : 'text-text-dim hover:text-text'
                }`}
              >
                {active && (
                  <span className="absolute inset-x-1.5 top-0 h-[3px] rounded-b-full bg-accent" />
                )}
                {t(tabDef.labelKey)}
                {tabDef.id === 'friends' && (social.state?.incoming.length ?? 0) > 0 && (
                  <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-extrabold text-bg">
                    {social.state?.incoming.length}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* right: session chip + profile + window controls */}
      <div className="flex shrink-0 items-center gap-2">
        {statusChip}

        <div ref={menuRef} className="relative flex items-center">
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            title={me ? `@${me.username}` : t('menu.account')}
            className="transition-transform hover:scale-105"
          >
            {avatarCircle('h-9 w-9', 18)}
          </button>

          {menuOpen && (
            <div className="animate-scale-in absolute right-0 top-12 z-50 w-56 rounded-xl border-2 border-border-strong bg-surface p-1.5 shadow-2xl shadow-black/50">
              {signedIn ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onOpenProfile();
                    }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-surface-hover"
                  >
                    {avatarCircle('h-9 w-9 shrink-0', 18)}
                    <div className="min-w-0">
                      <div className="truncate text-sm font-bold text-text">
                        {userName || (me ? `@${me.username}` : '…')}
                      </div>
                      {me && (
                        <div className="truncate text-[11px] font-medium text-text-faint">
                          @{me.username}
                        </div>
                      )}
                    </div>
                  </button>
                  <div className="mx-1 my-1 border-t border-border" />
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onOpenProfile();
                    }}
                    className="w-full rounded-lg px-2.5 py-2 text-left text-[13px] font-semibold text-text hover:bg-surface-hover"
                  >
                    {t('menu.profile')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onTab('friends');
                    }}
                    className="w-full rounded-lg px-2.5 py-2 text-left text-[13px] font-semibold text-text hover:bg-surface-hover"
                  >
                    {t('fr.title')}
                    {(social.state?.incoming.length ?? 0) > 0 && (
                      <span className="ml-2 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-extrabold text-bg">
                        {social.state?.incoming.length}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onTab('settings');
                    }}
                    className="w-full rounded-lg px-2.5 py-2 text-left text-[13px] font-semibold text-text hover:bg-surface-hover"
                  >
                    {t('tab.settings')}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    localStorage.removeItem('guest-mode');
                    window.location.reload();
                  }}
                  className="w-full rounded-lg px-2.5 py-2 text-left text-[13px] font-semibold text-text hover:bg-surface-hover"
                >
                  {t('fr.guest.cta')}
                </button>
              )}
            </div>
          )}
        </div>

        {/* window controls */}
        <div className="ml-1 flex items-stretch border-l border-border">
          <WinButton title={t('win.min')} onClick={() => win().minimize()}>
            <svg width="12" height="12" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.4">
              <line x1="1" y1="5.5" x2="10" y2="5.5" />
            </svg>
          </WinButton>
          <WinButton title={t('win.max')} onClick={() => win().toggleMaximize()}>
            <svg width="12" height="12" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.4">
              <rect x="1.5" y="1.5" width="8" height="8" rx="1" />
            </svg>
          </WinButton>
          <WinButton danger title={t('win.close')} onClick={() => win().close()}>
            <svg width="12" height="12" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.4">
              <line x1="1.5" y1="1.5" x2="9.5" y2="9.5" />
              <line x1="9.5" y1="1.5" x2="1.5" y2="9.5" />
            </svg>
          </WinButton>
        </div>
      </div>
    </header>
  );
}

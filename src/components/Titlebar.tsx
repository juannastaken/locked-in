import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { t } from '../lib/i18n';
import { warmReload } from '../lib/reload';
import type { SocialHook } from '../hooks/useSocial';

export interface TabDef {
  id: string;
  labelKey: string;
}

/* one outline icon per tab — inactive tabs collapse to icon-only bubbles */
const NAV_ICONS: Record<string, ReactNode> = {
  home: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  ),
  routine: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  ),
  analytics: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 20v-8M12 20V5M19 20v-11" />
    </svg>
  ),
  goals: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4.2" />
      <circle cx="12" cy="12" r="0.6" fill="currentColor" />
    </svg>
  ),
  friends: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="9" cy="8" r="3.4" />
      <path d="M2.8 20c0-3.5 2.8-5.8 6.2-5.8s6.2 2.3 6.2 5.8" />
      <circle cx="17.3" cy="9" r="2.7" />
      <path d="M16.8 14.5c2.6.4 4.4 2.3 4.4 5.1" />
    </svg>
  ),
  ranking: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8 21h8M12 17v4M17 5h3a1 1 0 0 1 1 1c0 3-2 5-4.5 5.4M7 5H4a1 1 0 0 0-1 1c0 3 2 5 4.5 5.4" />
      <path d="M17 4v5a5 5 0 0 1-10 0V4z" />
    </svg>
  ),
};

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

/* the pill's TweenPosition — must be re-applied explicitly after any 'none',
   because clearing an inline transition kills it permanently (React won't
   re-diff an unchanged style prop). The pill NEVER resizes: every active tab
   occupies the same fixed slot, so only `left` ever animates. */
const IND_TWEEN = 'left 300ms cubic-bezier(0.25, 0.9, 0.3, 1)';
/* fixed width of the active slot (and therefore of the pill) — must fit the
   longest tab label in both locales ("Analytics") */
const ACTIVE_W = 116;

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
      className={`flex h-full w-12 items-center justify-center text-text-dim transition-colors ${
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
  const navRef = useRef<HTMLElement>(null);
  const indRef = useRef<HTMLSpanElement>(null);
  const indReady = useRef(false);

  // the accent pill is a single element that GLIDES to the active tab.
  // the BAR has a fixed width (content is centered inside it), so expanding
  // the active tab's label only shifts siblings inside — the bar's edges
  // never move. The pill chases the active button's real geometry for a few
  // frames while the label expands; the CSS transition smooths the pursuit.
  useLayoutEffect(() => {
    const ind = indRef.current;
    const btn = navRef.current?.querySelector<HTMLElement>(`[data-tab="${tab}"]`);
    if (!ind) return;
    if (!btn) {
      // settings/profile live outside the pill — park the indicator invisibly
      ind.style.opacity = '0';
      indReady.current = false;
      return;
    }
    ind.style.opacity = '1';
    const place = () => {
      ind.style.left = `${btn.offsetLeft}px`;
    };
    if (!indReady.current) {
      ind.style.transition = 'none';
      place();
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      ind.offsetWidth; // flush so the jump isn't animated
      ind.style.transition = IND_TWEEN;
      indReady.current = true;
      return;
    }
    // glide via the CSS tween; re-aim a couple of times while the label
    // expansion shifts the target's final position, then land exactly.
    // (re-aiming every frame would restart the tween constantly = crawl.)
    ind.style.transition = IND_TWEEN;
    place();
    const t1 = window.setTimeout(place, 160);
    const t2 = window.setTimeout(place, 330);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [tab]);

  // font load / window resize can shift label widths — snap silently to the
  // CURRENT tab. Mount-only (tab read via ref): re-running this on tab change
  // would fire fonts.ready immediately and kill the glide mid-tween.
  const tabRef = useRef(tab);
  tabRef.current = tab;
  useEffect(() => {
    const snap = () => {
      const ind = indRef.current;
      const btn = navRef.current?.querySelector<HTMLElement>(
        `[data-tab="${tabRef.current}"]`,
      );
      if (!ind || !btn) return;
      ind.style.transition = 'none';
      ind.style.left = `${btn.offsetLeft}px`;
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      ind.offsetWidth;
      ind.style.transition = IND_TWEEN;
    };
    window.addEventListener('resize', snap);
    document.fonts?.ready.then(snap).catch(() => {});
    return () => window.removeEventListener('resize', snap);
  }, []);

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
      className="relative flex h-[72px] shrink-0 select-none items-stretch gap-2 pl-2"
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
      </div>

      {/* center: floating pill nav — one accent pill glides between tabs */}
      <div data-tauri-drag-region className="flex min-w-0 flex-1 items-center justify-center">
        <nav
          ref={navRef}
          className="nav-pill relative flex w-[420px] max-w-full shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-border bg-surface p-1.5"
        >
          {/* sliding accent indicator (behind the buttons) */}
          <span
            ref={indRef}
            aria-hidden
            className="pointer-events-none absolute top-1.5 h-11 rounded-full bg-accent"
            style={{ left: 0, width: ACTIVE_W, opacity: 0, transition: IND_TWEEN }}
          />
          {tabs.map((tabDef) => {
            const active = tab === tabDef.id;
            const pending = tabDef.id === 'friends' ? (social.state?.incoming.length ?? 0) : 0;
            return (
              <button
                key={tabDef.id}
                type="button"
                data-tab={tabDef.id}
                onClick={() => onTab(tabDef.id)}
                title={t(tabDef.labelKey)}
                style={{ width: active ? ACTIVE_W : 44 }}
                className={`nav-tab relative z-10 flex h-11 shrink-0 items-center justify-center overflow-hidden rounded-full text-[13px] font-bold transition-[width,color] duration-300 ${
                  active ? 'text-bg' : 'text-text-dim hover:text-text'
                }`}
              >
                {NAV_ICONS[tabDef.id]}
                <span
                  className={`overflow-hidden whitespace-nowrap transition-[max-width,opacity,margin-left] duration-300 ease-out ${
                    active ? 'ml-2 max-w-[8rem] opacity-100' : 'ml-0 max-w-0 opacity-0'
                  }`}
                >
                  {t(tabDef.labelKey)}
                </span>
                {pending > 0 && (
                  <span
                    className={`absolute -right-0.5 -top-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-extrabold ${
                      active ? 'bg-bg text-accent' : 'border-2 border-surface bg-accent text-bg'
                    }`}
                  >
                    {pending}
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
            className="flex items-center gap-2.5 py-1 pl-1 pr-1 sm:pl-3"
          >
            {me && (
              <span className="hidden min-w-0 flex-col items-end leading-tight sm:flex">
                <span className="max-w-32 truncate text-[13px] font-bold text-text">
                  {userName || me.username}
                </span>
                <span className="max-w-32 truncate text-[11px] font-medium text-text-faint">
                  @{me.username}
                </span>
              </span>
            )}
            <span className="relative shrink-0">
              {avatarCircle('h-10 w-10', 19)}
              {(social.state?.incoming.length ?? 0) > 0 && (
                <span className="absolute -right-1 -top-1 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-bg bg-danger px-1 text-[10px] font-extrabold text-white">
                  {social.state?.incoming.length}
                </span>
              )}
            </span>
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
                    warmReload();
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

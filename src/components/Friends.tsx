import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { unlockedBadges } from '../lib/badges';
import type { Badge } from '../lib/badges';
import { cleanProfanity } from '../lib/filter';
import { dateLocale, getLang, t } from '../lib/i18n';
import { BadgeModal } from './BadgeModal';
import { ChatIcon, CheckIcon, DoubleCheckIcon, FlameIcon, HeadphonesIcon, PointIcon, ProfileIcon } from './Icons';
import { formatDurationShort } from '../lib/time';
import * as social from '../lib/social';
import type { FriendEntry, PresenceRow } from '../lib/social';
import type { SocialHook } from '../hooks/useSocial';
import type { GroupsHook } from '../hooks/useGroups';
import { ChatView } from './Chat';
import * as chatLib from '../lib/chat';
import type * as groupsLib from '../lib/groups';
import { ConfirmModal } from './Confirm';
import { CreateGroupModal, GroupView } from './Groups';
import { Mascot } from './Mascot';
import { useToast } from '../hooks/useToast';
import { warmReload } from '../lib/reload';

export interface MyFocusState {
  focusing: boolean;
  task: string | null;
  startedAtIso: string | null;
  /** I'm already in a full jam (2+): friend jams are closed to me */
  inJam: boolean;
}

interface FriendsProps {
  signedIn: boolean;
  social: SocialHook;
  onError: (m: string) => void;
  myFocus: MyFocusState;
  /** 'invite' = come into MY jam (cold-start allowed); 'request' = let me join yours */
  onSendJam: (f: FriendEntry, kind: 'invite' | 'request') => Promise<void>;
  unread: Record<string, number>;
  /** friend userIds typing to me right now */
  typingIds: Set<string>;
  /** per-group live typing (groupId → userId → last keystroke ts) */
  groupTyping: Map<number, Map<string, number>>;
  chatRefetchKey: number;
  onChatOpened: (friendUserId: string | null) => void;
  openChatWith: string | null;
  onOpenChatConsumed: () => void;
  /** usernames in MY running jam (null = not in a jam) */
  myJamMembers: string[] | null;
  groups: GroupsHook;
  /** the group id whose jam I'm currently focusing in, if any */
  activeGroupJamId: number | null;
  onStartGroupJam: (groupId: number, task: string, pomo: string | null) => void;
  onJoinGroupJam: (groupId: number, task: string, startedAtIso: string, pomo: string | null) => void;
  onLeaveGroupJam: () => void;
}

/** Username claim form — used by the Friends tab and the mandatory app modal. */
export function ClaimUsernameForm({ onClaimed }: { onClaimed: () => void }) {
  const [name, setName] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const valid = social.USERNAME_RE.test(name.trim().replace(/^@/, ''));

  async function claim() {
    setBusy(true);
    setErr(null);
    try {
      const r = await social.claimUsername(name.trim().replace(/^@/, ''));
      if (r === 'ok') onClaimed();
      else if (r === 'taken') setErr(t('fr.err.taken'));
      else if (r === 'invalid') setErr(t('fr.claim.rules'));
      else setErr(t('fr.err.generic'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <input
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          setErr(null);
        }}
        placeholder={t('fr.claim.placeholder')}
        autoFocus
        maxLength={21}
        onKeyDown={(e) => e.key === 'Enter' && valid && !busy && claim()}
        className="chunk-input mt-4 w-full px-4 py-3 text-center text-[15px] font-bold text-text placeholder:font-medium placeholder:text-text-faint"
      />
      <p className="mt-1.5 text-[11px] font-medium text-text-faint">{t('fr.claim.rules')}</p>
      {err && <div className="mt-2 text-xs font-bold text-danger">{err}</div>}
      <button
        type="button"
        disabled={busy || !valid}
        onClick={claim}
        className="chunk-btn chunk-btn-accent mt-4 w-full py-3 text-sm"
      >
        {busy ? '…' : t('fr.claim.cta')}
      </button>
    </>
  );
}

export function statusDot(status: social.FriendStatus): string {
  if (status === 'focusing') return 'animate-pulse-dot bg-accent';
  if (status === 'online') return 'bg-sky-400';
  return 'bg-border-strong';
}

export function statusText(status: social.FriendStatus): string {
  if (status === 'focusing') return 'text-accent';
  if (status === 'online') return 'text-sky-400';
  return 'text-text-faint';
}

/** Detail popup for an active jam: task, everyone inside (friends or not),
 *  and a "ask to join" button — the friend in the jam approves, I hop in. */
function JamDetailModal({
  detail,
  friends,
  myUsername,
  inJamAlready,
  onClose,
}: {
  detail: { task: string; names: string[]; friend: FriendEntry };
  friends: FriendEntry[];
  myUsername: string;
  inJamAlready: boolean;
  onClose: () => void;
}) {
  // non-friends in the jam get their photo straight from profiles
  const [extra, setExtra] = useState<Map<string, { username: string; avatar: string | null }>>(
    () => new Map(),
  );
  useEffect(() => {
    const unknown = detail.names.filter(
      (n) => !friends.some((f) => f.username.toLowerCase() === n.toLowerCase()),
    );
    if (unknown.length === 0) return;
    social
      .fetchProfilesByUsernames(unknown)
      .then(setExtra)
      .catch(() => {});
  }, [detail.names, friends]);

  const meIn = detail.names.some((n) => n.toLowerCase() === myUsername.toLowerCase());

  return (
    <div
      className="animate-fade-in fixed inset-0 z-[60] flex items-center justify-center bg-black/80 px-6"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="chunk animate-scale-in w-full max-w-sm p-6 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-dim">
          <HeadphonesIcon size={26} className="text-accent" />
        </div>
        <h2 className="mt-3 text-lg font-extrabold text-text">{t('jamdetail.title')}</h2>
        {detail.task && (
          <p className="mt-1 truncate text-sm font-bold text-text-dim">{detail.task}</p>
        )}
        <div className="mt-4 flex flex-wrap items-start justify-center gap-3">
          {detail.names.map((n) => {
            const fr = friends.find((f) => f.username.toLowerCase() === n.toLowerCase());
            const ex = extra.get(n.toLowerCase());
            const avatar = fr?.avatar ?? ex?.avatar ?? null;
            return (
              <div key={n.toLowerCase()} className="flex w-16 flex-col items-center">
                <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-full border-2 border-accent bg-bg text-[11px] font-extrabold uppercase text-accent">
                  {avatar ? (
                    <img src={avatar} alt="" className="h-full w-full object-cover" />
                  ) : (
                    n.slice(0, 2)
                  )}
                </div>
                <span className="mt-1 w-full truncate text-[10px] font-bold text-text-dim">
                  @{n}
                </span>
                {!fr && n.toLowerCase() !== myUsername.toLowerCase() && (
                  <span className="text-[8px] font-bold uppercase text-text-faint">
                    {t('jamdetail.notfriend')}
                  </span>
                )}
              </div>
            );
          })}
        </div>
        {/* friend jams are STRICTLY 1:1 — closed to thirds. Want a crowd?
            Make a group and jam there. */}
        <div className="mt-5 w-full rounded-xl border-2 border-border px-3 py-3 text-center text-xs font-bold text-text-faint">
          {meIn || inJamAlready ? t('jamdetail.alreadyin') : t('jamdetail.closed')}
        </div>
        {!meIn && !inJamAlready && (
          <p className="mt-2 text-[10px] font-medium text-text-faint">
            {t('jamdetail.closed.hint')}
          </p>
        )}
        <button
          type="button"
          onClick={onClose}
          className="mt-2 text-xs font-bold text-text-faint hover:text-text"
        >
          {t('misc.close')}
        </button>
      </div>
    </div>
  );
}

/** live people float to the top: focusing → online → offline, then A-Z */
export function sortFriendsByStatus(
  friends: FriendEntry[],
  statusOf: (uid: string) => social.FriendStatus,
): FriendEntry[] {
  const rank = (s: social.FriendStatus) => (s === 'focusing' ? 0 : s === 'online' ? 1 : 2);
  return [...friends].sort((a, b) => {
    const d = rank(statusOf(a.userId)) - rank(statusOf(b.userId));
    return d !== 0 ? d : a.username.localeCompare(b.username);
  });
}

export function statusLineFor(
  status: social.FriendStatus,
  row: PresenceRow | undefined,
  customStatus?: string | null,
  /** the presence owner's username — filtered OUT of the jam list ("jam with
   *  the OTHERS", never with themselves) */
  ownerUsername?: string,
): string {
  if (status === 'focusing') {
    const sec = row?.started_at
      ? Math.max(0, (Date.now() - new Date(row.started_at).getTime()) / 1000)
      : 0;
    // in a jam? show who with — names render even for people I haven't added.
    // A jam is 2+ people: a lone name means they're just focusing solo.
    if (row?.jam_members) {
      try {
        const list = JSON.parse(row.jam_members) as string[];
        if (list.length >= 2) {
          const others = ownerUsername
            ? list.filter((u) => u.toLowerCase() !== ownerUsername.toLowerCase())
            : list;
          const names = others.map((u) => `@${cleanProfanity(u)}`).join(' ');
          return `${t('fr.injam', names)} · ${formatDurationShort(sec)}`;
        }
      } catch {
        // fall through to the plain line
      }
    }
    // display-side filter: the task text came from someone else's client.
    // fg_app = rich presence ("no VS Code") when their auto-tracker is on
    const app = row?.fg_app ? ` · ${cleanProfanity(row.fg_app)}` : '';
    return `${t('fr.focusing', formatDurationShort(sec))}${row?.task ? ` · ${cleanProfanity(row.task)}` : ''}${app}`;
  }
  // not focusing → their hand-written status (filtered) beats the plain label
  if (customStatus) return `“${cleanProfanity(customStatus)}”`;
  return status === 'online' ? t('fr.online') : t('fr.offline');
}

function Avatar({
  name,
  status,
  photo,
  size = 'h-12 w-12',
}: {
  name: string;
  status: social.FriendStatus;
  photo?: string | null;
  size?: string;
}) {
  return (
    <div className="relative">
      <div
        className={`flex ${size} items-center justify-center overflow-hidden rounded-full border border-border-strong bg-bg text-sm font-extrabold uppercase text-text`}
      >
        {photo ? <img src={photo} alt="" className="h-full w-full object-cover" /> : name.slice(0, 2)}
      </div>
      <span
        className={`absolute -bottom-1 -right-1 h-3.5 w-3.5 rounded-full border-2 border-surface ${statusDot(status)}`}
      />
    </div>
  );
}

/** Rich friend profile — mirrors my own profile page, minus private data. */
function FriendProfile({
  friend,
  soc,
  myFocus,
  onSendJam,
  onError,
  onMessage,
  unreadCount,
}: {
  friend: FriendEntry;
  soc: SocialHook;
  myFocus: MyFocusState;
  onSendJam: FriendsProps['onSendJam'];
  onError: (m: string) => void;
  onMessage: () => void;
  unreadCount: number;
}) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [jamSent, setJamSent] = useState(false);
  const [badgeInfo, setBadgeInfo] = useState<Badge | null>(null);

  const row = soc.presence.get(friend.userId);
  const status = soc.statusOf(friend.userId);
  const live = status === 'focusing';
  const wk = social.weekKey();
  const weekSec = row && row.week_key === wk ? row.week_sec : 0;

  let publicProjects: { n: string; s: number }[] = [];
  try {
    if (row?.public_projects) {
      const arr = JSON.parse(row.public_projects) as unknown;
      if (Array.isArray(arr)) {
        publicProjects = arr.filter(
          (p): p is { n: string; s: number } =>
            typeof p === 'object' && p !== null && 'n' in p && 's' in p,
        );
      }
    }
  } catch {
    publicProjects = [];
  }
  const maxProj = publicProjects[0]?.s || 1;

  async function sendJam(kind: 'invite' | 'request') {
    setBusy(true);
    try {
      await onSendJam(friend, kind);
      setJamSent(true);
      window.setTimeout(() => setJamSent(false), 4000);
    } finally {
      setBusy(false);
    }
  }

  async function unfriend() {
    setBusy(true);
    try {
      const err = await social.removeFriendship(friend.friendshipId);
      if (err) onError(err);
      soc.refresh();
    } finally {
      setBusy(false);
    }
  }

  const [pokeSent, setPokeSent] = useState<social.PokeKind | null>(null);
  async function poke(kind: social.PokeKind) {
    const err = await social.sendPoke(friend.userId, kind);
    if (err === 'rate') {
      onError(t('poke.rate'));
      return;
    }
    if (err) {
      onError(err);
      return;
    }
    setPokeSent(kind);
    window.setTimeout(() => setPokeSent(null), 4000);
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-xl space-y-4 px-5 pb-10 pt-8">
        {/* identity header — same shape as my own profile */}
        <div className="flex items-center gap-5">
          <div className="relative shrink-0">
            <div className="flex h-28 w-28 items-center justify-center overflow-hidden rounded-full border-4 border-border-strong bg-surface text-2xl font-extrabold uppercase text-text">
              {friend.avatar ? (
                <img src={friend.avatar} alt="" className="h-full w-full object-cover" />
              ) : (
                friend.username.slice(0, 2)
              )}
            </div>
            <span
              className={`absolute bottom-1 right-1 h-6 w-6 rounded-full border-4 border-bg ${statusDot(status)}`}
            />
          </div>
          <div className="min-w-0">
            <div className="text-[11px] font-extrabold uppercase tracking-widest text-text-faint">
              {t('menu.profile')}
            </div>
            <h1 className="truncate text-3xl font-extrabold tracking-tight text-text">
              @{friend.username}
            </h1>
            <div className={`mt-1 text-sm font-semibold ${statusText(status)}`}>
              {statusLineFor(status, row, null, friend.username)}
            </div>
            {friend.statusText && (
              <p className="mt-1 max-w-xs truncate text-xs font-bold italic text-text">
                “{cleanProfanity(friend.statusText)}”
              </p>
            )}
            {friend.bio && (
              <p className="mt-1.5 max-w-xs text-xs font-medium leading-relaxed text-text-dim">
                {cleanProfanity(friend.bio)}
              </p>
            )}
          </div>
        </div>

        {/* poke / cheer — server rate-limited (1/h · 1/10min), friends only */}
        <div className="flex gap-2">
          <button
            type="button"
            disabled={pokeSent !== null}
            onClick={() => poke('poke')}
            className="chunk-btn flex flex-1 items-center justify-center gap-1.5 py-2.5 text-xs text-text"
          >
            <PointIcon size={14} /> {pokeSent === 'poke' ? t('poke.sent') : t('poke.cta')}
          </button>
          {live && (
            <button
              type="button"
              disabled={pokeSent !== null}
              onClick={() => poke('cheer')}
              className="chunk-btn flex flex-1 items-center justify-center gap-1.5 py-2.5 text-xs text-text"
            >
              <FlameIcon size={14} />{' '}
              {pokeSent === 'cheer' ? t('poke.sent') : t('poke.cheer.cta')}
            </button>
          )}
        </div>

        {/* personal records grid — published alongside presence */}
        {(() => {
          if (!row?.records) return null;
          try {
            const r = JSON.parse(row.records) as { bd?: number; bs?: number };
            if (!r.bd && !r.bs) return null;
            return (
              <div className="grid grid-cols-2 gap-2">
                <div className="chunk p-3 text-center">
                  <div className="font-mono text-xl font-bold tabular-nums text-text">
                    {formatDurationShort(r.bd ?? 0)}
                  </div>
                  <div className="mt-0.5 text-[10px] font-extrabold uppercase tracking-wide text-text-faint">
                    {t('status.card.bestday')}
                  </div>
                </div>
                <div className="chunk p-3 text-center">
                  <div className="font-mono text-xl font-bold tabular-nums text-text">
                    {formatDurationShort(r.bs ?? 0)}
                  </div>
                  <div className="mt-0.5 text-[10px] font-extrabold uppercase tracking-wide text-text-faint">
                    {t('status.card.bestsession')}
                  </div>
                </div>
              </div>
            );
          } catch {
            return null;
          }
        })()}

        {/* badges from their lifetime focus — click one for details */}
        {row && unlockedBadges(row.total_sec ?? 0).length > 0 && (
          <div className="chunk p-4">
            <div className="mb-2 text-xs font-extrabold uppercase tracking-wide text-text-dim">
              {t('badges.title')}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {unlockedBadges(row.total_sec ?? 0).map((b) => (
                <button
                  key={b.hours}
                  type="button"
                  title={getLang() === 'en' ? b.labelEn : b.labelPt}
                  onClick={() => setBadgeInfo(b)}
                  className="flex h-9 w-9 items-center justify-center rounded-xl bg-bg text-base transition-transform"
                >
                  {b.icon}
                </button>
              ))}
            </div>
          </div>
        )}
        {badgeInfo && (
          <BadgeModal
            badge={badgeInfo}
            unlocked={(row?.total_sec ?? 0) / 3600 >= badgeInfo.hours}
            onClose={() => setBadgeInfo(null)}
          />
        )}

        {/* big week number */}
        <div className="chunk p-5">
          <div className="font-mono text-[40px] font-bold leading-none tabular-nums text-accent">
            {formatDurationShort(weekSec)}
          </div>
          <div className="mt-1.5 text-xs font-bold uppercase tracking-wide text-text-faint">
            {t('fr.profile.weeklabel')}
          </div>
        </div>

        {/* actions: big square MESSAGE + jam */}
        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={onMessage}
            className="chunk-btn chunk-btn-accent relative py-4 text-sm"
          >
            💬 {t('msg.open').toUpperCase()}
            {unreadCount > 0 && (
              <span className="absolute -right-1.5 -top-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1.5 text-[10px] font-extrabold text-white">
                {unreadCount}
              </span>
            )}
          </button>
          {myFocus.inJam ? (
            <div
              className="flex items-center justify-center rounded-xl border-2 border-border px-3 py-4 text-center text-xs font-bold text-text-faint"
              title={t('jam.selfbusy')}
            >
              {t('jam.selfbusy.short')}
            </div>
          ) : myFocus.focusing ? (
            <button
              type="button"
              disabled={busy || jamSent}
              onClick={() => sendJam('invite')}
              className="chunk-btn flex items-center justify-center gap-1.5 py-4 text-sm text-text"
            >
              <HeadphonesIcon size={15} /> {jamSent ? t('jam.sent') : t('jam.invite')}
            </button>
          ) : live ? (
            <button
              type="button"
              disabled={busy || jamSent}
              onClick={() => sendJam('request')}
              className="chunk-btn flex items-center justify-center gap-1.5 py-4 text-sm text-text"
            >
              <HeadphonesIcon size={15} /> {jamSent ? t('jam.sent') : t('jam.request')}
            </button>
          ) : (
            <button
              type="button"
              disabled={busy || jamSent}
              onClick={() => sendJam('invite')}
              title={t('jam.create.hint')}
              className="chunk-btn flex items-center justify-center gap-1.5 py-4 text-sm text-text"
            >
              <HeadphonesIcon size={15} /> {jamSent ? t('jam.sent') : t('jam.create')}
            </button>
          )}
        </div>

        {/* public recent projects (only when the friend opted in) */}
        <div className="chunk space-y-2.5 p-4">
          <div className="text-xs font-extrabold uppercase tracking-wide text-text-dim">
            {t('profile.projects')}
          </div>
          {publicProjects.length === 0 ? (
            <div className="py-2 text-center text-xs font-semibold text-text-faint">
              🔒 {t('fr.projects.private')}
            </div>
          ) : (
            publicProjects.map((p) => (
              <div key={p.n} className="flex items-center gap-2.5">
                <span className="w-32 truncate text-sm font-bold text-text">{p.n}</span>
                <div className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-[3px] border border-border-strong bg-bg">
                  <div className="h-full bg-accent" style={{ width: `${(p.s / maxProj) * 100}%` }} />
                </div>
                <span className="w-14 shrink-0 text-right font-mono text-xs font-bold tabular-nums text-text-dim">
                  {formatDurationShort(p.s)}
                </span>
              </div>
            ))
          )}
        </div>

        {/* unfriend — full confirmation popup */}
        <button
          type="button"
          disabled={busy}
          onClick={() => setConfirmRemove(true)}
          className="chunk-btn w-full py-3 text-sm text-danger"
        >
          {t('fr.unfriend')}
        </button>
        {confirmRemove && (
          <ConfirmModal
            title={t('fr.unfriend')}
            body={t('fr.unfriend.confirm', friend.username)}
            confirmLabel={t('fr.unfriend.yes')}
            onConfirm={unfriend}
            onClose={() => setConfirmRemove(false)}
          />
        )}
      </div>
    </div>
  );
}

/** Right-hand details rail — the third column that appears next to an open DM:
 *  identity, this-week stats and quick actions, reference-dashboard style. */
function ChatDetailsPanel({
  friend,
  soc,
  jam,
  onViewProfile,
  onError,
}: {
  friend: FriendEntry;
  soc: FriendsProps['social'];
  jam: { label: string; run: () => void } | null;
  onViewProfile: () => void;
  onError: (m: string) => void;
}) {
  const [pokeSent, setPokeSent] = useState(false);
  const row = soc.presence.get(friend.userId);
  const status = soc.statusOf(friend.userId);
  const wk = social.weekKey();
  const weekSec = row && row.week_key === wk ? row.week_sec : 0;
  let bd = 0;
  let bs = 0;
  try {
    if (row?.records) {
      const r = JSON.parse(row.records) as { bd?: number; bs?: number };
      bd = r.bd ?? 0;
      bs = r.bs ?? 0;
    }
  } catch {
    /* malformed records — zeros */
  }
  return (
    <aside className="cascade scrollbar-none my-4 mr-4 hidden w-[290px] shrink-0 flex-col gap-4 overflow-y-auto rounded-3xl bg-surface p-4 xl:flex">
      <div className="flex flex-col items-center gap-1.5 rounded-2xl bg-bg/60 p-6 text-center">
        <Avatar name={friend.username} status={status} photo={friend.avatar} size="h-20 w-20" />
        <div className="mt-2 w-full truncate text-base font-extrabold text-text">
          @{friend.username}
        </div>
        <div className={`w-full truncate text-xs font-semibold ${statusText(status)}`}>
          {statusLineFor(status, row, friend.statusText, friend.username)}
        </div>
      </div>

      <div className="rounded-2xl bg-bg/60 p-5">
        <div className="text-[11px] font-extrabold uppercase tracking-wide text-text-faint">
          {t('fr.profile.weeklabel')}
        </div>
        <div className="mt-1.5 font-mono text-2xl font-extrabold tabular-nums text-text">
          {formatDurationShort(weekSec)}
        </div>
        <div className="mt-3 space-y-1.5 border-t border-border pt-3 text-[12px] font-semibold text-text-dim">
          <div className="flex justify-between">
            <span className="text-text-faint">{t('rank.bestday')}</span>
            <span className="font-mono tabular-nums">{bd > 0 ? formatDurationShort(bd) : '—'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-faint">{t('rank.bestsession')}</span>
            <span className="font-mono tabular-nums">{bs > 0 ? formatDurationShort(bs) : '—'}</span>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {jam && (
          <button
            type="button"
            onClick={jam.run}
            className="chunk-btn chunk-btn-accent py-2.5 text-[13px]"
          >
            {jam.label}
          </button>
        )}
        <button
          type="button"
          disabled={pokeSent}
          onClick={() =>
            social.sendPoke(friend.userId, 'poke').then((err) => {
              if (err) onError(err);
              else setPokeSent(true);
            })
          }
          className="chunk-btn py-2.5 text-[13px] text-text"
        >
          {pokeSent ? t('poke.sent') : t('poke.cta')}
        </button>
        <button
          type="button"
          onClick={onViewProfile}
          className="chunk-btn py-2.5 text-[13px] text-text-dim"
        >
          {t('fr.viewprofile')}
        </button>
      </div>
    </aside>
  );
}

export function FriendsPage({
  signedIn,
  social: soc,
  onError,
  myFocus,
  onSendJam,
  unread,
  typingIds,
  groupTyping,
  chatRefetchKey,
  onChatOpened,
  openChatWith,
  onOpenChatConsumed,
  myJamMembers,
  groups: groupsHook,
  activeGroupJamId,
  onStartGroupJam,
  onJoinGroupJam,
  onLeaveGroupJam,
}: FriendsProps) {
  const { pushToast } = useToast();
  const [addName, setAddName] = useState('');
  // WhatsApp-style rows: last decrypted message per conversation
  const [lastMsgs, setLastMsgs] = useState<Map<string, chatLib.LastMessage>>(() => new Map());
  const [groupLastMsgs, setGroupLastMsgs] = useState<Map<number, groupsLib.GroupLastMessage>>(
    () => new Map(),
  );
  useEffect(() => {
    const load = () => {
      chatLib
        .fetchLastMessages()
        .then(setLastMsgs)
        .catch(() => {});
      import('../lib/groups')
        .then((gl) => gl.fetchGroupLastMessages())
        .then(setGroupLastMsgs)
        .catch(() => {});
    };
    load();
    const iv = window.setInterval(load, 45_000);
    return () => window.clearInterval(iv);
  }, [chatRefetchKey, groupsHook.tick]);
  const [addMsg, setAddMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null); // friend userId
  const [chatting, setChatting] = useState<string | null>(null); // friend userId
  const [jamDetail, setJamDetail] = useState<{
    task: string;
    names: string[];
    friend: FriendEntry;
  } | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; friend: FriendEntry } | null>(
    null,
  );
  const [confirmUnfriend, setConfirmUnfriend] = useState<FriendEntry | null>(null);
  const [confirmBlock, setConfirmBlock] = useState<FriendEntry | null>(null);
  const [reporting, setReporting] = useState<FriendEntry | null>(null);
  const [joinLinkOpen, setJoinLinkOpen] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [joiningGroup, setJoiningGroup] = useState(false);

  async function joinByLink() {
    const code = joinCode.trim();
    if (!code) return;
    setJoiningGroup(true);
    try {
      const r = await import('../lib/groups').then((g) => g.redeemInvite(code));
      if (typeof r === 'number') {
        setJoinLinkOpen(false);
        setJoinCode('');
        groupsHook.refresh();
        window.setTimeout(() => openGroup(r), 600);
      } else {
        onError(/invalid|full/i.test(r) ? t('grp.join.invalid') : r);
      }
    } finally {
      setJoiningGroup(false);
    }
  }
  const [groupOpen, setGroupOpen] = useState<number | null>(null); // group id
  const [creatingGroup, setCreatingGroup] = useState(false);

  function openGroup(id: number) {
    setChatting(null);
    setViewing(null);
    onChatOpened(null);
    setGroupOpen(id);
  }

  // no key gate anymore — messages are plaintext + RLS since v0.46, so a
  // fresh account (which never publishes a pubkey) chats like anyone else
  function openChat(f: FriendEntry) {
    setViewing(null);
    setChatting(f.userId);
    onChatOpened(f.userId);
  }

  function closeChat() {
    setChatting(null);
    onChatOpened(null);
  }

  // live tick for "focusing for Xh" lines
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => () => onChatOpened(null), [onChatOpened]);

  // sidebar 💬 asks for a specific conversation
  useEffect(() => {
    if (!openChatWith) return;
    const f = soc.state?.friends.find((fr) => fr.userId === openChatWith);
    onOpenChatConsumed();
    if (f) openChat(f);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openChatWith, soc.state]);

  if (!signedIn) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
        <Mascot mood="think" size={80} />
        <div>
          <h2 className="text-lg font-extrabold text-text">{t('fr.guest.title')}</h2>
          <p className="mx-auto mt-1 max-w-xs text-sm font-medium text-text-dim">
            {t('fr.guest.body')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            localStorage.removeItem('guest-mode');
            warmReload();
          }}
          className="chunk-btn chunk-btn-accent px-6 py-3 text-sm"
        >
          {t('fr.guest.cta')}
        </button>
      </div>
    );
  }

  const state = soc.state;
  if (!state) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="skeleton h-6 w-40">.</span>
      </div>
    );
  }

  if (!state.me) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <div className="chunk animate-scale-in w-full max-w-sm p-6 text-center">
          <Mascot mood="happy" size={72} />
          <h2 className="mt-3 text-lg font-extrabold text-text">{t('fr.claim.title')}</h2>
          <p className="mt-1 text-xs font-medium text-text-dim">{t('fr.claim.body')}</p>
          <ClaimUsernameForm onClaimed={soc.refresh} />
        </div>
      </div>
    );
  }
  const me = state.me;

  async function addFriend() {
    const name = addName.trim();
    if (!name) return;
    setBusy(true);
    setAddMsg(null);
    try {
      const r = await social.sendFriendRequest(name);
      if (r === 'sent') {
        setAddMsg({ text: t('fr.add.sent', name.replace(/^@/, '')), ok: true });
        setAddName('');
        soc.refresh();
      } else if (r === 'notfound') setAddMsg({ text: t('fr.err.notfound'), ok: false });
      else if (r === 'self') setAddMsg({ text: t('fr.err.self'), ok: false });
      else if (r === 'duplicate') setAddMsg({ text: t('fr.err.duplicate'), ok: false });
      else setAddMsg({ text: t('fr.err.generic'), ok: false });
    } finally {
      setBusy(false);
    }
  }

  async function accept(f: FriendEntry) {
    const err = await social.acceptRequest(f.friendshipId);
    if (err) onError(err);
    soc.refresh();
  }

  async function removePending(f: FriendEntry) {
    const err = await social.removeFriendship(f.friendshipId);
    if (err) onError(err);
    soc.refresh();
  }

  const chattingFriend = chatting ? state.friends.find((f) => f.userId === chatting) : null;
  const viewingFriend = viewing ? state.friends.find((f) => f.userId === viewing) : null;
  const openGroupSummary = groupOpen
    ? (groupsHook.list.find((g) => g.group.id === groupOpen) ?? null)
    : null;

  const sortedFriends = sortFriendsByStatus(state.friends, soc.statusOf);
  // WhatsApp-style time: today → HH:mm, yesterday → label, older → dd/mm
  const rowTime = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    if (d.toDateString() === now.toDateString())
      return d.toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' });
    const yest = new Date(now);
    yest.setDate(yest.getDate() - 1);
    if (d.toDateString() === yest.toDateString()) return t('msg.yesterday').toLowerCase();
    return d.toLocaleDateString(dateLocale(), { day: '2-digit', month: '2-digit' });
  };
  const previewOf = (lm: chatLib.LastMessage) => {
    if (lm.kind === 'image') return t('msg.kind.image');
    if (lm.kind === 'jam') return t('msg.kind.jam');
    if (lm.kind === 'voice') return t('msg.kind.voice');
    if (lm.kind === 'status') return t('msg.kind.status');
    if (lm.text && /^\[sticker:\w+\]$/.test(lm.text)) return t('attach.sticker');
    return lm.text === null ? '🔒' : cleanProfanity(lm.text);
  };
  const friendRow = (f: FriendEntry) => {
    const row = soc.presence.get(f.userId);
    const status = soc.statusOf(f.userId);
    const active = chatting === f.userId || viewing === f.userId;
    const lm = lastMsgs.get(f.userId);
    const isTyping = typingIds.has(f.userId);
    return (
      <div
        key={f.friendshipId}
        role="button"
        tabIndex={0}
        onClick={() => openChat(f)}
        onContextMenu={(e) => {
          e.preventDefault();
          setCtxMenu({
            x: Math.min(e.clientX, window.innerWidth - 200),
            y: Math.min(e.clientY, window.innerHeight - 190),
            friend: f,
          });
        }}
        onKeyDown={(e) => e.key === 'Enter' && openChat(f)}
        className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded-2xl px-2.5 py-2.5 ${
          active ? 'bg-surface-hover' : 'hover:bg-surface-hover'
        }`}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <Avatar name={f.username} status={status} photo={f.avatar} />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-[15px] font-bold text-text">@{f.username}</span>
              {lm && (
                <span className="shrink-0 font-mono text-[10px] font-semibold tabular-nums text-text-faint">
                  {rowTime(lm.created_at)}
                </span>
              )}
            </div>
            {isTyping ? (
              <div className="truncate text-xs font-semibold italic text-accent">
                {t('msg.typing')}
              </div>
            ) : lm ? (
              <div className="flex items-center gap-1 text-xs font-medium text-text-dim">
                {lm.mine &&
                  (lm.read_at ? (
                    <DoubleCheckIcon size={13} className="shrink-0 text-accent" />
                  ) : (
                    <CheckIcon size={11} className="shrink-0 text-text-faint" />
                  ))}
                <span className="truncate">
                  {lm.mine ? `${t('msg.you')} ` : ''}
                  {previewOf(lm)}
                </span>
              </div>
            ) : (
              <div className={`truncate text-xs font-medium ${statusText(status)}`}>
                {statusLineFor(status, row, f.statusText, f.username)}
              </div>
            )}
          </div>
        </div>
        {(unread[f.userId] ?? 0) > 0 && (
          <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-accent px-1.5 text-[10px] font-extrabold text-bg">
            {unread[f.userId]}
          </span>
        )}
      </div>
    );
  };
  const groupRow = (g: (typeof groupsHook.list)[number]) => {
    const jamOn =
      !!g.group.jam_started_at &&
      g.members.some(
        (m) =>
          m.in_jam && (m.user_id === me.user_id || social.isLive(soc.presence.get(m.user_id))),
      );
    const glm = groupLastMsgs.get(g.group.id);
    const preview = glm
      ? `${glm.mine ? t('msg.you') : glm.senderName ? `${glm.senderName}:` : ''} ${
          glm.kind === 'text'
            ? glm.text
              ? cleanProfanity(glm.text)
              : '🔒'
            : glm.kind === 'image'
              ? t('msg.kind.image')
              : glm.kind === 'voice'
                ? t('msg.kind.voice')
                : t('msg.kind.jam')
        }`.trim()
      : t('grp.members', String(g.members.length));
    return (
      <button
        type="button"
        onClick={() => openGroup(g.group.id)}
        className={`flex w-full items-center justify-between gap-2 rounded-2xl px-2.5 py-2.5 text-left ${
          groupOpen === g.group.id ? 'bg-surface-hover' : 'hover:bg-surface-hover'
        }`}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          {g.group.avatar_b64 ? (
            <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border-strong">
              <img src={g.group.avatar_b64} alt="" className="h-full w-full object-cover" />
            </div>
          ) : (
            <div className="flex w-10 shrink-0 -space-x-3 pl-0.5">
              {g.members.slice(0, 2).map((m) => (
                <div
                  key={m.user_id}
                  className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border-2 border-bg bg-surface text-[9px] font-extrabold uppercase text-text-dim"
                >
                  {m.avatar ? (
                    <img src={m.avatar} alt="" className="h-full w-full object-cover" />
                  ) : (
                    m.username.slice(0, 2)
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-[15px] font-bold text-text">
                {cleanProfanity(g.group.name)}
              </span>
              {glm && (
                <span className="shrink-0 font-mono text-[10px] font-semibold tabular-nums text-text-faint">
                  {rowTime(glm.created_at)}
                </span>
              )}
            </div>
            <div className="truncate text-xs font-medium text-text-dim">{preview}</div>
          </div>
        </div>
        {jamOn && <HeadphonesIcon size={14} className="shrink-0 text-accent" />}
      </button>
    );
  };
  return (
    <div className="flex h-full min-h-0">
      {/* LEFT: conversations column (reference layout: me → search → chats) */}
      <aside className="cascade scrollbar-none m-4 mr-0 flex w-[400px] shrink-0 flex-col gap-4 overflow-y-auto rounded-3xl bg-surface p-4">
        {/* me */}
        <div className="flex flex-col items-center gap-1.5 pt-3 text-center">
          <Avatar
            name={me.username}
            status={myFocus.focusing ? 'focusing' : 'online'}
            photo={me.avatar_b64}
            size="h-16 w-16"
          />
          <div className="mt-1 max-w-full truncate text-base font-extrabold text-text">
            @{me.username}
          </div>
          <span
            className={`rounded-full px-3 py-1 text-[11px] font-bold ${
              myFocus.focusing
                ? 'bg-accent-dim text-accent'
                : 'bg-surface-hover text-text-dim'
            }`}
          >
            {myFocus.focusing ? t('home.lockedin').toUpperCase() : t('fr.online')}
          </span>
        </div>

        {/* search / add */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            addFriend();
          }}
          className="relative"
        >
          <svg
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-faint"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            aria-hidden
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.2-3.2" />
          </svg>
          <input
            value={addName}
            onChange={(e) => {
              setAddName(e.target.value);
              setAddMsg(null);
            }}
            placeholder={t('fr.search')}
            maxLength={21}
            className="w-full rounded-full bg-bg/60 py-2.5 pl-9 pr-4 text-[13px] font-semibold text-text placeholder:font-medium placeholder:text-text-faint focus:outline-none focus:ring-1 focus:ring-accent/40"
          />
        </form>
        {addMsg && (
          <div className={`px-1 text-[11px] font-bold ${addMsg.ok ? 'text-accent' : 'text-danger'}`}>
            {addMsg.text}
          </div>
        )}

        {state.incoming.length > 0 && (
          <div className="space-y-2 rounded-2xl bg-bg/60 p-3">
            <div className="text-[10px] font-extrabold uppercase tracking-wide text-text-dim">
              {t('fr.inbox')} <span className="text-accent">({state.incoming.length})</span>
            </div>
            {state.incoming.map((f) => (
              <div key={f.friendshipId} className="flex items-center justify-between gap-1.5">
                <span className="truncate text-[13px] font-bold text-text">@{f.username}</span>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => accept(f)}
                    className="chunk-btn chunk-btn-accent px-2.5 py-1 text-[11px]"
                  >
                    {t('fr.accept')}
                  </button>
                  <button
                    type="button"
                    onClick={() => removePending(f)}
                    className="chunk-btn px-2 py-1 text-[11px] text-text-dim"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {state.outgoing.length > 0 && (
          <div className="space-y-1.5 rounded-2xl bg-bg/60 p-3">
            <div className="text-[10px] font-extrabold uppercase tracking-wide text-text-dim">
              {t('fr.outgoing')}
            </div>
            {state.outgoing.map((f) => (
              <div key={f.friendshipId} className="flex items-center justify-between gap-1.5">
                <span className="truncate text-xs font-semibold text-text-dim">@{f.username}</span>
                <button
                  type="button"
                  onClick={() => removePending(f)}
                  className="text-[11px] font-bold text-text-faint hover:text-danger"
                >
                  {t('fr.cancel')}
                </button>
              </div>
            ))}
          </div>
        )}

        {/* unified conversations — DMs and groups merged, newest first */}
        <div className="space-y-0.5">
          <div className="flex items-center justify-between px-1 pb-1">
            <span className="text-[10px] font-extrabold uppercase tracking-wide text-text-dim">
              {t('fr.convos')}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setJoinLinkOpen(true)}
                className="text-[11px] font-bold text-text-dim hover:text-text hover:underline"
              >
                {t('grp.join.link')}
              </button>
              {state.friends.length > 0 && (
                <button
                  type="button"
                  onClick={() => setCreatingGroup(true)}
                  className="text-[11px] font-bold text-accent hover:underline"
                >
                  + {t('grp.new')}
                </button>
              )}
            </div>
          </div>
          {state.friends.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <Mascot mood="think" size={52} />
              <span className="text-sm font-semibold text-text-faint">{t('fr.empty')}</span>
            </div>
          )}
          {(() => {
            const q = addName.trim().replace(/^@/, '').toLowerCase();
            const dms = sortedFriends
              .filter((f) => !q || f.username.toLowerCase().includes(q))
              .map((f) => ({
                key: `f-${f.friendshipId}`,
                ts: lastMsgs.get(f.userId)
                  ? new Date(lastMsgs.get(f.userId)!.created_at).getTime()
                  : 0,
                node: friendRow(f),
              }));
            const grps = groupsHook.list
              .filter((g) => !q || g.group.name.toLowerCase().includes(q))
              .map((g) => ({
                key: `g-${g.group.id}`,
                ts: groupLastMsgs.get(g.group.id)
                  ? new Date(groupLastMsgs.get(g.group.id)!.created_at).getTime()
                  : 0,
                node: groupRow(g),
              }));
            const all = [...dms, ...grps].sort((a, b) => b.ts - a.ts);
            return (
              <>
                {all.map((c) => (
                  <div key={c.key}>{c.node}</div>
                ))}
                {q &&
                  !state.friends.some((f) => f.username.toLowerCase() === q) && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={addFriend}
                      className="flex w-full items-center gap-2.5 rounded-2xl px-3 py-2.5 text-left text-[13px] font-bold text-accent hover:bg-surface-hover"
                    >
                      + {t('fr.addaction', addName.trim().replace(/^@/, ''))}
                    </button>
                  )}
              </>
            );
          })()}
        </div>

        {/* active jams — group jams + friends currently jamming */}
        {(() => {
          // a member counts as truly in the jam only if in_jam AND their
          // presence says they're actually FOCUSING right now (or it's me).
          // The in_jam flag alone desyncs — force-close leaves it stuck (stale
          // presence), and stop-with-app-still-open leaves it stuck too (fresh
          // presence but focusing=false). Cross-checking focusing kills both.
          const liveInJam = (g: (typeof groupsHook.list)[number]) =>
            g.members.filter(
              (m) =>
                m.in_jam &&
                (m.user_id === me.user_id || social.isLive(soc.presence.get(m.user_id))),
            );
          // one jam = one card. Every member publishes the same roster, so a
          // 1:1 jam between two of my friends would render once per friend —
          // and a group jam would repeat via its members' presence. Dedupe by
          // the (case-insensitive) member set.
          const dedupeNames = (names: string[]) => {
            const seen = new Set<string>();
            const out: string[] = [];
            for (const n of names) {
              const k = n.toLowerCase();
              if (!seen.has(k)) {
                seen.add(k);
                out.push(n);
              }
            }
            return out;
          };
          const keyOf = (names: string[]) =>
            names
              .map((n) => n.toLowerCase())
              .sort()
              .join('|');
          const groupJams = groupsHook.list
            .filter((g) => g.group.jam_started_at && liveInJam(g).length > 0)
            .map((g) => {
              const live = liveInJam(g);
              return {
                key: `g${g.group.id}`,
                jamKey: keyOf(live.map((m) => m.username)),
                title: cleanProfanity(g.group.name),
                task: cleanProfanity(g.group.jam_task ?? ''),
                count: live.length,
                avatars: live.map((m) => ({ name: m.username, avatar: m.avatar })),
                onClick: () => openGroup(g.group.id),
              };
            });
          const seenJams = new Set(groupJams.map((j) => j.jamKey));
          const friendJams: typeof groupJams = [];
          for (const f of state.friends) {
            const row = soc.presence.get(f.userId);
            if (!social.isLive(row) || !row?.jam_members) continue;
            let names: string[] = [];
            try {
              names = dedupeNames(JSON.parse(row.jam_members) as string[]);
            } catch {
              continue;
            }
            // a jam is 2+ people — solo focusing is not a jam
            if (names.length < 2) continue;
            // my own jam is already pinned in the sidebar
            if (names.some((n) => n.toLowerCase() === me.username.toLowerCase())) continue;
            const jamKey = keyOf(names);
            if (seenJams.has(jamKey)) continue;
            seenJams.add(jamKey);
            friendJams.push({
              key: `f${f.userId}`,
              jamKey,
              title: `@${f.username}`,
              task: cleanProfanity(row.task ?? ''),
              count: names.length,
              avatars: names.slice(0, 5).map((n) => {
                const fr = state.friends.find(
                  (x) => x.username.toLowerCase() === n.toLowerCase(),
                );
                return {
                  name: n,
                  avatar:
                    fr?.avatar ??
                    (n.toLowerCase() === f.username.toLowerCase() ? f.avatar : null),
                };
              }),
              onClick: () => setJamDetail({ task: cleanProfanity(row.task ?? ''), names, friend: f }),
            });
          }
          const jams = [...groupJams, ...friendJams];
          if (jams.length === 0) return null;
          return (
            <div className="space-y-1.5 rounded-2xl bg-accent-dim/40 p-2.5">
              <div className="flex items-center gap-1.5 px-0.5">
                <HeadphonesIcon size={13} className="text-accent" />
                <span className="text-[10px] font-extrabold uppercase tracking-wide text-accent">
                  {t('jams.active')} ({jams.length})
                </span>
              </div>
              {jams.map((j) => (
                <button
                  key={j.key}
                  type="button"
                  onClick={j.onClick}
                  className="flex w-full items-center gap-2 rounded-xl bg-surface/60 px-2 py-1.5 text-left hover:bg-surface"
                >
                  <div className="flex -space-x-1.5">
                    {j.avatars.slice(0, 3).map((a, idx) => (
                      <div
                        key={idx}
                        className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-full border border-accent bg-bg text-[8px] font-extrabold uppercase text-accent"
                      >
                        {a.avatar ? (
                          <img src={a.avatar} alt="" className="h-full w-full object-cover" />
                        ) : (
                          a.name.slice(0, 1)
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] font-bold text-text">{j.title}</div>
                    <div className="truncate text-[10px] font-semibold text-accent">
                      {t('grp.jam.count', String(j.count))}
                      {j.task ? ` · ${j.task}` : ''}
                    </div>
                  </div>
                  <span className="shrink-0 text-[10px] font-bold text-accent">→</span>
                </button>
              ))}
            </div>
          );
        })()}


      </aside>

      {/* right-click menu on a friend — Discord-style. Portaled to <body>:
          a transformed ancestor (tab-switch animation) turns position:fixed
          into container-relative and the menu drifted way below the cursor */}
      {ctxMenu &&
        createPortal(
        <div className="fixed inset-0 z-[68]" onMouseDown={() => setCtxMenu(null)}>
          <div
            className="animate-scale-in absolute w-48 rounded-xl border-2 border-border-strong bg-surface p-1.5 shadow-2xl shadow-black/60"
            style={{ left: ctxMenu.x, top: ctxMenu.y }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="truncate px-2.5 pb-1 pt-0.5 text-[11px] font-extrabold text-text-faint">
              @{ctxMenu.friend.username}
            </div>
            <button
              type="button"
              onClick={() => {
                setChatting(null);
                onChatOpened(null);
                setViewing(ctxMenu.friend.userId);
                setCtxMenu(null);
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-semibold text-text hover:bg-surface-hover"
            >
              <ProfileIcon size={15} /> {t('menu.profile')}
            </button>
            <button
              type="button"
              onClick={() => {
                openChat(ctxMenu.friend);
                setCtxMenu(null);
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-semibold text-text hover:bg-surface-hover"
            >
              <ChatIcon size={15} /> {t('msg.open')}
            </button>
            <button
              type="button"
              onClick={() => {
                social.sendPoke(ctxMenu.friend.userId, 'poke').then((err) => {
                  if (err === 'rate') onError(t('poke.rate'));
                });
                setCtxMenu(null);
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-semibold text-text hover:bg-surface-hover"
            >
              <PointIcon size={15} /> {t('poke.cta')}
            </button>
            <div className="mx-1 my-1 border-t border-border" />
            <button
              type="button"
              onClick={() => {
                setConfirmUnfriend(ctxMenu.friend);
                setCtxMenu(null);
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-semibold text-danger hover:bg-danger/10"
            >
              ✕ {t('fr.unfriend')}
            </button>
            <button
              type="button"
              onClick={() => {
                setReporting(ctxMenu.friend);
                setCtxMenu(null);
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-semibold text-text-dim hover:bg-surface-hover"
            >
              ⚑ {t('mod.report')}
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmBlock(ctxMenu.friend);
                setCtxMenu(null);
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-bold text-danger hover:bg-danger/10"
            >
              ⊘ {t('mod.block')}
            </button>
          </div>
        </div>,
        document.body,
      )}

      {/* join group by invite link/code */}
      {joinLinkOpen && (
        <div
          className="animate-fade-in fixed inset-0 z-[60] flex items-center justify-center bg-black/80 px-6"
          onMouseDown={(e) => e.target === e.currentTarget && setJoinLinkOpen(false)}
        >
          <div className="chunk animate-scale-in w-full max-w-sm p-6 text-center">
            <h2 className="text-lg font-extrabold text-text">{t('grp.join.title')}</h2>
            <p className="mt-1 text-xs font-medium text-text-dim">{t('grp.join.body')}</p>
            <input
              autoFocus
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && joinByLink()}
              placeholder="lockedin:group/…"
              className="chunk-input mt-4 w-full px-4 py-3 text-center font-mono text-sm text-text placeholder:text-text-faint"
            />
            <button
              type="button"
              disabled={joiningGroup || !joinCode.trim()}
              onClick={joinByLink}
              className="chunk-btn chunk-btn-accent mt-4 w-full py-3 text-sm"
            >
              {joiningGroup ? '…' : t('grp.join.cta')}
            </button>
            <button
              type="button"
              onClick={() => setJoinLinkOpen(false)}
              className="mt-2 text-xs font-bold text-text-faint hover:text-text"
            >
              {t('misc.cancel')}
            </button>
          </div>
        </div>
      )}

      {confirmUnfriend && (
        <ConfirmModal
          title={t('fr.unfriend')}
          body={t('fr.unfriend.confirm', confirmUnfriend.username)}
          confirmLabel={t('fr.unfriend.yes')}
          onConfirm={() => {
            social.removeFriendship(confirmUnfriend.friendshipId).then((err) => {
              if (err) onError(err);
              soc.refresh();
            });
          }}
          onClose={() => setConfirmUnfriend(null)}
        />
      )}

      {confirmBlock && (
        <ConfirmModal
          title={t('mod.block')}
          body={t('mod.block.confirm', confirmBlock.username)}
          confirmLabel={t('mod.block')}
          onConfirm={() => {
            const b = confirmBlock;
            social.blockUser(b.userId).then((err) => {
              if (err) onError(err);
              else pushToast(t('mod.block.done', b.username), 'info');
              soc.refresh();
            });
          }}
          onClose={() => setConfirmBlock(null)}
        />
      )}

      {reporting && (
        <ReportModal
          username={reporting.username}
          onCancel={() => setReporting(null)}
          onSubmit={(reason, detail) => {
            const r = reporting;
            setReporting(null);
            social.reportUser(r.userId, reason, detail).then((err) => {
              if (err) onError(err);
              else pushToast(t('mod.report.done'), 'info');
            });
          }}
        />
      )}

      {/* active jam detail — see who's inside + ask to join */}
      {jamDetail && (
        <JamDetailModal
          detail={jamDetail}
          friends={state.friends}
          myUsername={me.username}
          inJamAlready={
            !!myJamMembers &&
            jamDetail.names.some((n) =>
              myJamMembers.some((m) => m.toLowerCase() === n.toLowerCase()),
            )
          }
          onClose={() => setJamDetail(null)}
        />
      )}

      {/* RIGHT: chat / profile / placeholder */}
      <main className="animate-fade-in min-h-0 min-w-0 flex-1 p-4">
        <div className="h-full overflow-hidden rounded-3xl bg-black/25">
        {chattingFriend ? (
          (() => {
            const presRow = soc.presence.get(chattingFriend.userId);
            const chatStatus = soc.statusOf(chattingFriend.userId);
            const live = chatStatus === 'focusing';
            const focusSec =
              live && presRow?.started_at
                ? Math.max(0, (Date.now() - new Date(presRow.started_at).getTime()) / 1000)
                : 0;
            return (
              <ChatView
                key={chattingFriend.userId}
                friend={chattingFriend}
                peerTypingNow={typingIds.has(chattingFriend.userId)}
                myUserId={me.user_id}
                statusLine={statusLineFor(chatStatus, presRow, chattingFriend.statusText, chattingFriend.username)}
                statusColor={statusText(chatStatus)}
                friendLive={live}
                friendFocusSec={focusSec}
                inJamWithFriend={myJamMembers?.includes(chattingFriend.username) ?? false}
                onError={onError}
                onBack={closeChat}
                refetchKey={chatRefetchKey}
                jamAction={
                  myFocus.inJam
                    ? null // friend jams are 1:1 — I'm already paired
                    : myFocus.focusing
                      ? { label: t('jam.invite'), run: () => onSendJam(chattingFriend, 'invite') }
                      : live
                        ? {
                            label: t('jam.request'),
                            run: () => onSendJam(chattingFriend, 'request'),
                          }
                        : { label: t('jam.create'), run: () => onSendJam(chattingFriend, 'invite') }
                }
              />
            );
          })()
        ) : viewingFriend ? (
          <FriendProfile
            friend={viewingFriend}
            soc={soc}
            myFocus={myFocus}
            onSendJam={onSendJam}
            onError={onError}
            onMessage={() => openChat(viewingFriend)}
            unreadCount={unread[viewingFriend.userId] ?? 0}
          />
        ) : openGroupSummary ? (
          <div className="relative h-full">
            <GroupView
              key={openGroupSummary.group.id}
              summary={openGroupSummary}
              myUserId={me.user_id}
              friends={state.friends}
              isLive={(uid) => social.isLive(soc.presence.get(uid))}
              refetchKey={groupsHook.tick}
              typing={groupTyping.get(openGroupSummary.group.id)}
              onError={onError}
              onBack={() => setGroupOpen(null)}
              meInJam={activeGroupJamId === openGroupSummary.group.id}
              onStartJam={(task, pomo) => onStartGroupJam(openGroupSummary.group.id, task, pomo)}
              onJoinJam={(task, startedAt, pomo) =>
                onJoinGroupJam(openGroupSummary.group.id, task, startedAt, pomo)
              }
              onLeaveJam={onLeaveGroupJam}
            />
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <Mascot mood="relax" size={72} />
            <p className="max-w-xs text-sm font-semibold text-text-faint">{t('fr.select')}</p>
          </div>
        )}
        </div>
      </main>

      {/* third column: details rail for the open DM (wide windows only) */}
      {chattingFriend && (
        <ChatDetailsPanel
          friend={chattingFriend}
          soc={soc}
          jam={
            myFocus.inJam
              ? null
              : myFocus.focusing
                ? { label: t('jam.invite'), run: () => onSendJam(chattingFriend, 'invite') }
                : soc.statusOf(chattingFriend.userId) === 'focusing'
                  ? { label: t('jam.request'), run: () => onSendJam(chattingFriend, 'request') }
                  : { label: t('jam.create'), run: () => onSendJam(chattingFriend, 'invite') }
          }
          onViewProfile={() => {
            setChatting(null);
            onChatOpened(null);
            setViewing(chattingFriend.userId);
          }}
          onError={onError}
        />
      )}

      {creatingGroup && (
        <CreateGroupModal
          friends={state.friends}
          onClose={() => setCreatingGroup(false)}
          onCreated={(id) => {
            setCreatingGroup(false);
            groupsHook.refresh();
            openGroup(id);
          }}
          onError={onError}
        />
      )}
    </div>
  );
}

const REPORT_REASONS = ['spam', 'harassment', 'inappropriate', 'impersonation', 'other'] as const;

function ReportModal({
  username,
  onCancel,
  onSubmit,
}: {
  username: string;
  onCancel: () => void;
  onSubmit: (reason: string, detail: string) => void;
}) {
  const [reason, setReason] = useState<string>('spam');
  const [detail, setDetail] = useState('');
  return (
    <div
      className="animate-fade-in fixed inset-0 z-[80] flex items-center justify-center bg-black/80 px-6"
      onMouseDown={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div className="chunk animate-scale-in w-full max-w-sm p-5">
        <h2 className="text-base font-extrabold text-text">{t('mod.report.title', username)}</h2>
        <p className="mt-1 text-[12px] text-text-dim">{t('mod.report.body')}</p>
        <div className="mt-3 space-y-1.5">
          {REPORT_REASONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setReason(r)}
              className={`flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-[13px] font-semibold ${
                reason === r
                  ? 'border-accent bg-accent-dim text-text'
                  : 'border-border text-text-dim hover:border-border-strong'
              }`}
            >
              {t(`mod.reason.${r}`)}
            </button>
          ))}
        </div>
        <textarea
          value={detail}
          onChange={(e) => setDetail(e.target.value.slice(0, 500))}
          placeholder={t('mod.report.detail')}
          rows={3}
          className="chunk-input mt-3 w-full resize-none px-3 py-2 text-[13px] text-text placeholder:text-text-faint"
        />
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="chunk-btn flex-1 py-2.5 text-[13px] text-text"
          >
            {t('misc.cancel')}
          </button>
          <button
            type="button"
            onClick={() => onSubmit(reason, detail)}
            className="flex-1 rounded-xl bg-danger py-2.5 text-[13px] font-extrabold text-white"
          >
            {t('mod.report')}
          </button>
        </div>
      </div>
    </div>
  );
}

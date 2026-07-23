import { useEffect, useRef, useState } from 'react';
import { BADGES, nextBadge } from '../lib/badges';
import type { Badge } from '../lib/badges';
import { BadgeModal } from './BadgeModal';
import * as db from '../lib/db';
import { cleanProfanity } from '../lib/filter';
import { getLang, t } from '../lib/i18n';
import * as social from '../lib/social';
import { formatDurationShort } from '../lib/time';
import type { SocialHook } from '../hooks/useSocial';
import { useCountUp } from '../hooks/useCountUp';
import type { ProjectBreakdown } from '../types';
import { PersonIcon } from './Titlebar';

interface ProfileProps {
  social: SocialHook;
  userName: string | null;
  projectsPublic: boolean;
  signedIn: boolean;
  onError: (m: string) => void;
  onOpenFriends: () => void;
  refreshKey: number;
}

/** Reads a picked image file and returns a small square jpeg data-url. */
function fileToAvatar(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const SIZE = 128;
      const canvas = document.createElement('canvas');
      canvas.width = SIZE;
      canvas.height = SIZE;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('canvas'));
      const side = Math.min(img.width, img.height);
      ctx.drawImage(
        img,
        (img.width - side) / 2,
        (img.height - side) / 2,
        side,
        side,
        0,
        0,
        SIZE,
        SIZE,
      );
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('bad image'));
    };
    img.src = url;
  });
}

interface Analytics {
  totalSec: number;
  sessionCount: number;
  activeDays: number;
  bestDaySec: number;
}

export function ProfilePage({
  social: soc,
  userName,
  projectsPublic,
  signedIn,
  onError,
  onOpenFriends,
  refreshKey,
}: ProfileProps) {
  const me = soc.state?.me ?? null;
  const [an, setAn] = useState<Analytics | null>(null);
  const [recentProjects, setRecentProjects] = useState<ProjectBreakdown[]>([]);
  const [busy, setBusy] = useState(false);
  const [bio, setBio] = useState('');
  const [bioDirty, setBioDirty] = useState(false);
  const [bioSaving, setBioSaving] = useState(false);
  const [statusLine, setStatusLine] = useState('');
  const [statusDirty, setStatusDirty] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);
  const [badgeInfo, setBadgeInfo] = useState<Badge | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setBio(me?.bio ?? '');
    setBioDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.bio]);

  useEffect(() => {
    setStatusLine(me?.status_text ?? '');
    setStatusDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.status_text]);

  async function saveStatus() {
    setStatusSaving(true);
    try {
      const clean = cleanProfanity(statusLine);
      const err = await social.updateStatusText(clean);
      if (err) onError(err);
      else {
        setStatusLine(clean.trim());
        setStatusDirty(false);
        soc.refresh();
      }
    } finally {
      setStatusSaving(false);
    }
  }

  async function saveBio() {
    setBioSaving(true);
    try {
      const clean = cleanProfanity(bio);
      const err = await social.updateBio(clean);
      if (err) onError(err);
      else {
        setBio(clean);
        setBioDirty(false);
        soc.refresh();
      }
    } finally {
      setBioSaving(false);
    }
  }

  useEffect(() => {
    const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
    Promise.all([
      db.getLifetimeStats(),
      db.getDailyTotals(new Date(0).toISOString()),
      db.getProjectBreakdown(monthAgo),
    ])
      .then(([life, daily, projs]) => {
        const active = daily.filter((d) => d.total_sec > 0);
        setAn({
          totalSec: life.totalSec,
          sessionCount: life.sessionCount,
          activeDays: active.length,
          bestDaySec: active.reduce((m, d) => Math.max(m, d.total_sec), 0),
        });
        setRecentProjects(projs.slice(0, 5));
      })
      .catch((err) => onError(String(err)));
  }, [onError, refreshKey]);

  async function pickPhoto(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const b64 = await fileToAvatar(file);
      const err = await social.updateAvatar(b64);
      if (err) onError(err);
      else soc.refresh();
    } catch {
      onError(t('fr.err.generic'));
    } finally {
      setBusy(false);
    }
  }

  const friends = soc.state?.friends ?? [];
  const avgPerActiveDay = an && an.activeDays > 0 ? an.totalSec / an.activeDays : 0;
  const maxProj = recentProjects[0]?.total_sec || 1;
  const animatedTotal = useCountUp(an?.totalSec ?? 0, 1100);

  return (
    <div className="h-full overflow-y-auto">
      <div className="cascade mx-auto max-w-2xl space-y-5 px-4 pb-10 pt-8 sm:px-6 xl:max-w-3xl">
        {/* identity header */}
        <div className="flex items-center gap-5">
          <button
            type="button"
            disabled={busy || !signedIn}
            onClick={() => fileRef.current?.click()}
            title={t('profile.changephoto')}
            className="group relative h-28 w-28 shrink-0 overflow-hidden rounded-full border-4 border-border-strong bg-surface text-text-dim"
          >
            {me?.avatar_b64 ? (
              <img src={me.avatar_b64} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <PersonIcon size={52} />
              </div>
            )}
            {signedIn && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 transition-opacity group-hover:opacity-100">
                <span className="text-[10px] font-extrabold uppercase text-white">
                  {busy ? '…' : t('profile.changephoto')}
                </span>
              </div>
            )}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              pickPhoto(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <div className="min-w-0">
            <div className="text-[11px] font-extrabold uppercase tracking-widest text-text-faint">
              {t('menu.profile')}
            </div>
            <h1 className="truncate text-3xl font-extrabold tracking-tight text-text">
              {userName || (me ? me.username : '—')}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm">
              {me && <span className="font-bold text-accent">@{me.username}</span>}
              <button
                type="button"
                onClick={onOpenFriends}
                className="text-xs font-bold text-text-dim underline-offset-4 hover:text-text hover:underline"
              >
                {friends.length} {t('fr.title').toLowerCase()}
              </button>
            </div>
          </div>
        </div>

        {/* custom status — the short line friends see when you're not focusing */}
        {signedIn && (
          <div className="chunk p-4">
            <div className="mb-1.5 text-xs font-extrabold uppercase tracking-wide text-text-dim">
              {t('status.title')}
            </div>
            <input
              value={statusLine}
              onChange={(e) => {
                setStatusLine(e.target.value.slice(0, 80));
                setStatusDirty(true);
              }}
              placeholder={t('status.placeholder')}
              className="chunk-input w-full px-3 py-2.5 text-sm font-semibold text-text placeholder:font-medium placeholder:text-text-faint"
            />
            <div className="mt-1.5 flex items-center justify-between">
              <span className="text-[10px] font-bold text-text-faint">{statusLine.length}/80</span>
              {statusDirty && (
                <button
                  type="button"
                  disabled={statusSaving}
                  onClick={saveStatus}
                  className="chunk-btn chunk-btn-accent px-4 py-1.5 text-xs"
                >
                  {statusSaving ? '…' : t('bio.save')}
                </button>
              )}
            </div>
          </div>
        )}

        {/* bio — free-form, profanity-filtered */}
        {signedIn && (
          <div className="chunk p-4">
            <div className="mb-1.5 text-xs font-extrabold uppercase tracking-wide text-text-dim">
              {t('bio.title')}
            </div>
            <textarea
              value={bio}
              onChange={(e) => {
                setBio(e.target.value.slice(0, 140));
                setBioDirty(true);
              }}
              placeholder={t('bio.placeholder')}
              rows={2}
              className="chunk-input w-full resize-none px-3 py-2.5 text-sm font-semibold text-text placeholder:font-medium placeholder:text-text-faint"
            />
            <div className="mt-1.5 flex items-center justify-between">
              <span className="text-[10px] font-bold text-text-faint">{bio.length}/140</span>
              {bioDirty && (
                <button
                  type="button"
                  disabled={bioSaving}
                  onClick={saveBio}
                  className="chunk-btn chunk-btn-accent px-4 py-1.5 text-xs"
                >
                  {bioSaving ? '…' : t('bio.save')}
                </button>
              )}
            </div>
          </div>
        )}

        {/* badges — lifetime focus milestones */}
        {an && (
          <div className="chunk p-4">
            <div className="mb-2 text-xs font-extrabold uppercase tracking-wide text-text-dim">
              {t('badges.title')}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {BADGES.map((b) => {
                const unlocked = an.totalSec / 3600 >= b.hours;
                return (
                  <button
                    key={b.hours}
                    type="button"
                    title={getLang() === 'en' ? b.labelEn : b.labelPt}
                    onClick={() => setBadgeInfo(b)}
                    className={`flex h-9 w-9 items-center justify-center rounded-xl bg-bg text-base transition-transform ${
                      unlocked ? '' : 'opacity-30 grayscale'
                    }`}
                  >
                    {b.icon}
                  </button>
                );
              })}
            </div>
            {nextBadge(an.totalSec) && (
              <div className="mt-2 text-[11px] font-medium text-text-faint">
                {t(
                  'badges.next',
                  nextBadge(an.totalSec)!.icon,
                  getLang() === 'en'
                    ? nextBadge(an.totalSec)!.labelEn
                    : nextBadge(an.totalSec)!.labelPt,
                )}
              </div>
            )}
          </div>
        )}

        {/* big focus number */}
        <div className="chunk p-5">
          <div className="font-mono text-[44px] font-bold leading-none tabular-nums text-accent">
            {an ? (
              formatDurationShort(animatedTotal)
            ) : (
              <span className="skeleton h-11 w-40">.</span>
            )}
          </div>
          <div className="mt-1.5 text-xs font-bold uppercase tracking-wide text-text-faint">
            {t('profile.hours')}
          </div>
        </div>

        {/* analytics */}
        <div className="grid grid-cols-3 gap-3">
          <div className="chunk px-3 py-4 text-center">
            <div className="font-mono text-xl font-bold tabular-nums text-text">
              {an ? an.sessionCount : <span className="skeleton h-6 w-10">.</span>}
            </div>
            <div className="mt-1 text-[10px] font-bold uppercase tracking-wide text-text-faint">
              {t('profile.sessions')}
            </div>
          </div>
          <div className="chunk px-3 py-4 text-center">
            <div className="font-mono text-xl font-bold tabular-nums text-text">
              {an ? formatDurationShort(avgPerActiveDay) : <span className="skeleton h-6 w-12">.</span>}
            </div>
            <div className="mt-1 text-[10px] font-bold uppercase tracking-wide text-text-faint">
              {t('profile.avgday')}
            </div>
          </div>
          <div className="chunk px-3 py-4 text-center">
            <div className="font-mono text-xl font-bold tabular-nums text-text">
              {an ? formatDurationShort(an.bestDaySec) : <span className="skeleton h-6 w-12">.</span>}
            </div>
            <div className="mt-1 text-[10px] font-bold uppercase tracking-wide text-text-faint">
              {t('profile.bestday')}
            </div>
          </div>
        </div>

        {/* recent projects (last 30 days) */}
        <div className="chunk space-y-2.5 p-4">
          <div className="flex items-baseline justify-between">
            <span className="text-xs font-extrabold uppercase tracking-wide text-text-dim">
              {t('profile.projects')}
            </span>
            <span
              className="text-[11px] font-bold text-text-faint"
              title={t('set.profile.projects.hint')}
            >
              {projectsPublic ? t('profile.public') : `🔒 ${t('profile.private')}`}
            </span>
          </div>
          {recentProjects.length === 0 && (
            <div className="py-3 text-center text-sm font-semibold text-text-faint">
              {t('profile.noprojects')}
            </div>
          )}
          {recentProjects.map((p) => (
            <div key={p.project} className="flex items-center gap-2.5">
              <span className="w-36 truncate text-sm font-bold text-text">{p.project}</span>
              <div className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-[3px] border border-border-strong bg-bg">
                <div
                  className="h-full bg-accent"
                  style={{ width: `${(p.total_sec / maxProj) * 100}%` }}
                />
              </div>
              <span className="w-14 shrink-0 text-right font-mono text-xs font-bold tabular-nums text-text-dim">
                {formatDurationShort(p.total_sec)}
              </span>
            </div>
          ))}
        </div>

        {badgeInfo && an && (
          <BadgeModal
            badge={badgeInfo}
            unlocked={an.totalSec / 3600 >= badgeInfo.hours}
            onClose={() => setBadgeInfo(null)}
          />
        )}

        {/* friends */}
        <div className="chunk space-y-3 p-4">
          <div className="flex items-baseline justify-between">
            <span className="text-xs font-extrabold uppercase tracking-wide text-text-dim">
              {t('fr.title')} ({friends.length})
            </span>
            <button
              type="button"
              onClick={onOpenFriends}
              className="text-[11px] font-bold text-accent underline-offset-4 hover:underline"
            >
              {t('profile.seefriends')}
            </button>
          </div>
          {friends.length === 0 ? (
            <div className="py-2 text-center text-sm font-semibold text-text-faint">
              {t('fr.empty')}
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {friends.slice(0, 12).map((f) => (
                <span
                  key={f.userId}
                  title={`@${f.username}`}
                  className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border-2 border-border-strong bg-bg text-[11px] font-extrabold uppercase text-text-dim"
                >
                  {f.avatar ? (
                    <img src={f.avatar} alt="" className="h-full w-full object-cover" />
                  ) : (
                    f.username.slice(0, 2)
                  )}
                </span>
              ))}
              {friends.length > 12 && (
                <span className="self-center text-xs font-bold text-text-faint">
                  +{friends.length - 12}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

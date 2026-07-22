import { useState } from 'react';
import type { SocialHook } from '../hooks/useSocial';
import * as social from '../lib/social';
import { t } from '../lib/i18n';
import { warmReload } from '../lib/reload';
import { formatDurationShort } from '../lib/time';
import { Mascot } from './Mascot';

type Mode = 'week' | 'total';

interface Entry {
  userId: string;
  username: string;
  avatar: string | null;
  isMe: boolean;
  weekSec: number;
  totalSec: number;
  live: boolean;
  bestDay: number;
  bestSession: number;
}

function Avatar({
  src,
  name,
  size,
  live,
}: {
  src: string | null;
  name: string;
  size: string;
  live: boolean;
}) {
  return (
    <div className="relative shrink-0">
      <div
        className={`flex ${size} items-center justify-center overflow-hidden rounded-full border-2 bg-surface text-[11px] font-extrabold uppercase text-text-dim ${
          live ? 'border-accent' : 'border-border-strong'
        }`}
      >
        {src ? (
          <img src={src} alt="" className="h-full w-full object-cover" />
        ) : (
          // initials, like everywhere else in the app — the generic person
          // icon made the podium look empty
          name.slice(0, 2)
        )}
      </div>
      {live && (
        <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-bg bg-accent" />
      )}
    </div>
  );
}

export function RankingPage({ soc, signedIn }: { soc: SocialHook; signedIn: boolean }) {
  const [mode, setMode] = useState<Mode>('week');
  const state = soc.state;
  if (!signedIn) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
        <Mascot mood="think" size={80} />
        <div>
          <h2 className="text-lg font-extrabold text-text">{t('rank.guest.title')}</h2>
          <p className="mx-auto mt-1 max-w-xs text-sm font-medium text-text-dim">
            {t('rank.guest.body')}
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
  if (!state?.me) return null;
  const me = state.me;
  const wk = social.weekKey();

  const entries: Entry[] = [
    {
      userId: me.user_id,
      username: me.username,
      avatar: me.avatar_b64 ?? null,
      isMe: true,
    },
    ...state.friends.map((f) => ({
      userId: f.userId,
      username: f.username,
      avatar: f.avatar,
      isMe: false,
    })),
  ].map((p) => {
    const row = soc.presence.get(p.userId);
    let bestDay = 0;
    let bestSession = 0;
    try {
      if (row?.records) {
        const r = JSON.parse(row.records) as { bd?: number; bs?: number };
        bestDay = r.bd ?? 0;
        bestSession = r.bs ?? 0;
      }
    } catch {
      /* malformed records — zeros */
    }
    return {
      ...p,
      weekSec: row && row.week_key === wk ? row.week_sec : 0,
      totalSec: row?.total_sec ?? 0,
      live: soc.statusOf(p.userId) === 'focusing',
      bestDay,
      bestSession,
    };
  });

  const secOf = (e: Entry) => (mode === 'week' ? e.weekSec : e.totalSec);
  const ranking = [...entries].sort((a, b) => secOf(b) - secOf(a));
  const leaderSec = secOf(ranking[0]) || 1;
  const myIdx = ranking.findIndex((e) => e.isMe);
  const mine = ranking[myIdx];
  const sum = ranking.reduce((acc, e) => acc + secOf(e), 0);
  const avg = ranking.length ? sum / ranking.length : 0;

  const bestDayHolder = [...entries].sort((a, b) => b.bestDay - a.bestDay)[0];
  const bestSessionHolder = [...entries].sort((a, b) => b.bestSession - a.bestSession)[0];

  const medals = ['🥇', '🥈', '🥉'];
  const podium = ranking.slice(0, 3);
  // classic podium: 2nd · 1st · 3rd
  const podiumOrder = [podium[1], podium[0], podium[2]].filter(Boolean) as Entry[];

  const nameOf = (e: Entry) => (e.isMe ? t('fr.me') : `@${e.username}`);

  if (state.friends.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <p className="max-w-xs text-center text-sm text-text-faint">{t('rank.empty')}</p>
      </div>
    );
  }

  return (
    <div className="scrollbar-none mx-auto h-full max-w-3xl overflow-y-auto p-6"><div className="cascade">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-extrabold tracking-tight text-text">{t('rank.title')}</h1>
          <p className="text-[11px] text-text-faint">
            {mode === 'week' ? t('rank.sub.week') : t('rank.sub.total')}
          </p>
        </div>
        <div className="flex items-center gap-0.5 rounded-xl border border-border bg-surface p-1">
          {(['week', 'total'] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded-lg px-3 py-1.5 text-[12px] font-extrabold ${
                mode === m ? 'bg-accent text-bg' : 'text-text-dim hover:text-text'
              }`}
            >
              {m === 'week' ? t('fr.week') : t('rank.total')}
            </button>
          ))}
        </div>
      </div>

      {/* podium */}
      <div className="mb-5 flex items-end justify-center gap-3">
        {podiumOrder.map((e) => {
          const place = ranking.indexOf(e);
          const first = place === 0;
          return (
            <div
              key={e.userId}
              className={`chunk flex flex-col items-center gap-1.5 px-5 pt-4 ${
                first ? 'pb-8' : 'pb-4'
              } ${e.isMe ? 'border-accent/60' : ''}`}
            >
              <Avatar src={e.avatar} name={e.username} size={first ? 'h-16 w-16' : 'h-12 w-12'} live={e.live} />
              <div className="text-xl leading-none">{medals[place]}</div>
              <div
                className={`max-w-24 truncate text-[13px] font-extrabold ${
                  e.isMe ? 'text-accent' : 'text-text'
                }`}
              >
                {nameOf(e)}
              </div>
              <div className="font-mono text-[12px] font-bold tabular-nums text-text-dim">
                {formatDurationShort(secOf(e))}
              </div>
            </div>
          );
        })}
      </div>

      {/* my position */}
      {mine && (
        <div className="chunk mb-5 flex items-center gap-4 p-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-dim font-mono text-lg font-extrabold text-accent">
            #{myIdx + 1}
          </div>
          <div className="min-w-0">
            <div className="text-[13px] font-extrabold text-text">{t('rank.you')}</div>
            <div className="truncate text-[12px] text-text-faint">
              {myIdx === 0
                ? t('rank.leader')
                : t(
                    'rank.behind',
                    formatDurationShort(secOf(ranking[myIdx - 1]) - secOf(mine)),
                    ranking[myIdx - 1].username,
                  )}
            </div>
          </div>
        </div>
      )}

      {/* full list as horizontal bar chart */}
      <div className="chunk mb-5 space-y-2.5 p-4">
        {ranking.map((e, i) => (
          <div key={e.userId} className="flex items-center gap-3">
            <span className="w-6 shrink-0 text-center font-mono text-[12px] font-extrabold text-text-faint">
              {i + 1}
            </span>
            <Avatar src={e.avatar} name={e.username} size="h-8 w-8" live={e.live} />
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <span
                  className={`truncate text-[13px] font-extrabold ${
                    e.isMe ? 'text-accent' : 'text-text'
                  }`}
                >
                  {nameOf(e)}
                </span>
                <span className="shrink-0 font-mono text-[12px] font-bold tabular-nums text-text-dim">
                  {formatDurationShort(secOf(e))}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-surface-hover">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    e.isMe ? 'bg-accent' : 'bg-border-strong'
                  }`}
                  style={{ width: `${Math.max(2, (secOf(e) / leaderSec) * 100)}%` }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* squad stats + records */}
      <div className="grid grid-cols-2 gap-3 pb-6 sm:grid-cols-4">
        <div className="chunk p-3.5">
          <div className="text-[10px] font-extrabold uppercase tracking-wide text-text-faint">
            {t('rank.sum')}
          </div>
          <div className="mt-1 font-mono text-base font-extrabold tabular-nums text-text">
            {formatDurationShort(sum)}
          </div>
        </div>
        <div className="chunk p-3.5">
          <div className="text-[10px] font-extrabold uppercase tracking-wide text-text-faint">
            {t('rank.avg')}
          </div>
          <div className="mt-1 font-mono text-base font-extrabold tabular-nums text-text">
            {formatDurationShort(avg)}
          </div>
        </div>
        <div className="chunk p-3.5">
          <div className="text-[10px] font-extrabold uppercase tracking-wide text-text-faint">
            {t('rank.bestday')}
          </div>
          {bestDayHolder && bestDayHolder.bestDay > 0 ? (
            <>
              <div className="mt-1 font-mono text-base font-extrabold tabular-nums text-text">
                {formatDurationShort(bestDayHolder.bestDay)}
              </div>
              <div
                className={`truncate text-[11px] font-bold ${
                  bestDayHolder.isMe ? 'text-accent' : 'text-text-dim'
                }`}
              >
                {nameOf(bestDayHolder)}
              </div>
            </>
          ) : (
            <div className="mt-1 text-base font-extrabold text-text-faint">—</div>
          )}
        </div>
        <div className="chunk p-3.5">
          <div className="text-[10px] font-extrabold uppercase tracking-wide text-text-faint">
            {t('rank.bestsession')}
          </div>
          {bestSessionHolder && bestSessionHolder.bestSession > 0 ? (
            <>
              <div className="mt-1 font-mono text-base font-extrabold tabular-nums text-text">
                {formatDurationShort(bestSessionHolder.bestSession)}
              </div>
              <div
                className={`truncate text-[11px] font-bold ${
                  bestSessionHolder.isMe ? 'text-accent' : 'text-text-dim'
                }`}
              >
                {nameOf(bestSessionHolder)}
              </div>
            </>
          ) : (
            <div className="mt-1 text-base font-extrabold text-text-faint">—</div>
          )}
        </div>
      </div>
    </div>
    </div>
  );
}

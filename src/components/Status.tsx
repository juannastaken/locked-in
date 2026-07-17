import { useCallback, useEffect, useRef, useState } from 'react';
import * as chat from '../lib/chat';
import * as db from '../lib/db';
import { cleanProfanity } from '../lib/filter';
import { dateLocale, t } from '../lib/i18n';
import * as social from '../lib/social';
import type { FriendEntry, StatusRow } from '../lib/social';
import { formatDurationShort } from '../lib/time';
import type { SocialHook } from '../hooks/useSocial';
import { Mascot, mascotMap } from './Mascot';
import type { MascotMood } from './Mascot';

function Skeleton({ className }: { className?: string }) {
  return <div className={`skeleton rounded-2xl ${className ?? ''}`} />;
}

const SEEN_KEY = 'status-seen'; // { [userId]: highest status id already viewed }

function seenMap(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
}

function markSeen(userId: string, statusId: number) {
  const map = seenMap();
  if ((map[userId] ?? 0) < statusId) {
    map[userId] = statusId;
    localStorage.setItem(SEEN_KEY, JSON.stringify(map));
  }
}

const TEXT_BGS = ['#1f6f43', '#274690', '#7c3aed', '#b3335b', '#b45309', '#0f766e', '#374151'];
const STICKER_MOODS: MascotMood[] = ['happy', 'hyped', 'focus', 'relax', 'sleep', 'sad', 'angry'];
const QUICK_REACTIONS = ['🔥', '👏', '😂', '❤️'];

/** Draws the pixel mascot onto a canvas context. */
function drawMascot(
  ctx: CanvasRenderingContext2D,
  mood: MascotMood,
  x: number,
  y: number,
  cell: number,
  accent: string,
  dark: string,
) {
  const map = mascotMap(mood);
  map.forEach((rowStr, ry) => {
    for (let rx = 0; rx < rowStr.length; rx++) {
      const ch = rowStr[rx];
      if (ch === '.') continue;
      ctx.fillStyle = ch === 'B' ? accent : dark;
      ctx.fillRect(x + rx * cell, y + ry * cell, cell + 0.5, cell + 0.5);
    }
  });
}

function accentColor(): string {
  return (
    getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim() ||
    '#d4ff3f'
  );
}

/** Sticker: mascot on a dark rounded card → jpeg data-url. */
export function renderStickerImage(mood: MascotMood): string {
  const W = 420;
  const H = 420;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.fillStyle = '#141417';
  ctx.fillRect(0, 0, W, H);
  const cell = 24;
  drawMascot(ctx, mood, (W - 14 * cell) / 2, (H - 11 * cell) / 2, cell, accentColor(), '#141417');
  return canvas.toDataURL('image/jpeg', 0.85);
}

/** The week-summary card drawn client-side for a status post. */
async function renderWeekCardImage(username: string): Promise<string> {
  const since = social.weekStart().toISOString();
  const [weekSec, records] = await Promise.all([
    db.getFocusSecondsSince(since),
    db.getRecords().catch(() => ({ bestSessionSec: 0, bestDaySec: 0 })),
  ]);
  const W = 460;
  const H = 640;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const accent = accentColor();
  ctx.fillStyle = '#121215';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = accent;
  ctx.font = 'bold 22px Inter, sans-serif';
  ctx.fillText('LOCKED IN', 32, 56);
  ctx.fillStyle = '#9c9ca6';
  ctx.font = '600 16px Inter, sans-serif';
  ctx.fillText(`@${username}`, 32, 84);
  ctx.fillStyle = '#f2f2f4';
  ctx.font = 'bold 64px Inter, sans-serif';
  ctx.fillText(formatDurationShort(weekSec), 32, 190);
  ctx.fillStyle = '#9c9ca6';
  ctx.font = '600 18px Inter, sans-serif';
  ctx.fillText(t('status.card.week'), 32, 220);
  ctx.fillStyle = '#f2f2f4';
  ctx.font = 'bold 34px Inter, sans-serif';
  ctx.fillText(formatDurationShort(records.bestDaySec), 32, 310);
  ctx.fillStyle = '#9c9ca6';
  ctx.font = '600 15px Inter, sans-serif';
  ctx.fillText(t('status.card.bestday'), 32, 336);
  ctx.fillStyle = '#f2f2f4';
  ctx.font = 'bold 34px Inter, sans-serif';
  ctx.fillText(formatDurationShort(records.bestSessionSec), 32, 410);
  ctx.fillStyle = '#9c9ca6';
  ctx.font = '600 15px Inter, sans-serif';
  ctx.fillText(t('status.card.bestsession'), 32, 436);
  drawMascot(ctx, 'hyped', W - 190, H - 180, 11, accent, '#121215');
  ctx.fillStyle = '#6b6b76';
  ctx.font = '600 13px Inter, sans-serif';
  ctx.fillText(
    new Date().toLocaleDateString(dateLocale(), { day: '2-digit', month: 'short' }),
    32,
    H - 36,
  );
  return canvas.toDataURL('image/jpeg', 0.85);
}

interface StatusPageProps {
  soc: SocialHook;
  onError: (m: string) => void;
  /** open the chat with this friend (status replies land there) */
  onOpenChat: (friendUserId: string) => void;
}

interface PersonStatuses {
  userId: string;
  username: string;
  avatar: string | null;
  isMe: boolean;
  items: StatusRow[];
  hasUnseen: boolean;
}

export function StatusPage({ soc, onError, onOpenChat }: StatusPageProps) {
  const [rows, setRows] = useState<StatusRow[] | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [viewing, setViewing] = useState<PersonStatuses | null>(null);

  const reload = useCallback(() => {
    social
      .fetchStatuses()
      .then(setRows)
      .catch((err) => onError(String(err)));
  }, [onError]);

  useEffect(() => {
    reload();
    const unsub = social.subscribeStatuses(reload);
    const iv = window.setInterval(reload, 120_000);
    return () => {
      unsub();
      window.clearInterval(iv);
    };
  }, [reload]);

  const me = soc.state?.me;
  if (!me) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <Mascot mood="think" size={64} />
        <p className="max-w-xs text-sm font-semibold text-text-faint">{t('fr.signin.hint')}</p>
      </div>
    );
  }

  const seen = seenMap();
  const people: PersonStatuses[] = [];
  const byUser = new Map<string, StatusRow[]>();
  for (const r of rows ?? []) {
    const list = byUser.get(r.user_id) ?? [];
    list.push(r);
    byUser.set(r.user_id, list);
  }
  const mine = byUser.get(me.user_id) ?? [];
  for (const [uid, items] of byUser) {
    if (uid === me.user_id) continue;
    const friend = soc.state?.friends.find((f) => f.userId === uid);
    if (!friend) continue;
    // oldest → newest inside the viewer
    const ordered = [...items].reverse();
    people.push({
      userId: uid,
      username: friend.username,
      avatar: friend.avatar,
      isMe: false,
      items: ordered,
      hasUnseen: ordered.some((s) => s.id > (seen[uid] ?? 0)),
    });
  }
  // unseen first, then most recent activity
  people.sort((a, b) => {
    if (a.hasUnseen !== b.hasUnseen) return a.hasUnseen ? -1 : 1;
    const la = a.items[a.items.length - 1]?.created_at ?? '';
    const lb = b.items[b.items.length - 1]?.created_at ?? '';
    return lb.localeCompare(la);
  });
  const fresh = people.filter((p) => p.hasUnseen);
  const viewed = people.filter((p) => !p.hasUnseen);

  const timeOf = (iso: string) => {
    const d = new Date(iso);
    const today = d.toDateString() === new Date().toDateString();
    const hm = d.toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' });
    return today ? t('status.today', hm) : t('status.yesterday', hm);
  };

  const personRow = (p: PersonStatuses) => (
    <button
      key={p.userId}
      type="button"
      onClick={() => setViewing(p)}
      className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-surface-hover"
    >
      <div
        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 p-0.5 ${
          p.hasUnseen ? 'border-accent' : 'border-border-strong'
        }`}
      >
        <div className="flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-bg text-[11px] font-extrabold uppercase text-text-dim">
          {p.avatar ? (
            <img src={p.avatar} alt="" className="h-full w-full object-cover" />
          ) : (
            p.username.slice(0, 2)
          )}
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-bold text-text">@{p.username}</div>
        <div className="truncate text-[11px] font-medium text-text-faint">
          {timeOf(p.items[p.items.length - 1]?.created_at ?? new Date().toISOString())}
          {p.items.length > 1 ? ` · ${p.items.length}` : ''}
        </div>
      </div>
    </button>
  );

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-xl space-y-4 px-4 pb-10 pt-6">
        <div>
          <h1 className="text-lg font-extrabold tracking-tight text-text">{t('status.title')}</h1>
          <p className="mt-0.5 text-xs text-text-faint">{t('status.sub')}</p>
        </div>

        {/* my status */}
        <div className="chunk flex items-center gap-3 p-3">
          <button
            type="button"
            onClick={() =>
              mine.length > 0
                ? setViewing({
                    userId: me.user_id,
                    username: me.username,
                    avatar: me.avatar_b64 ?? null,
                    isMe: true,
                    items: [...mine].reverse(),
                    hasUnseen: false,
                  })
                : setEditorOpen(true)
            }
            className="relative shrink-0"
          >
            <div
              className={`flex h-14 w-14 items-center justify-center rounded-full border-2 p-0.5 ${
                mine.length > 0 ? 'border-accent' : 'border-border-strong'
              }`}
            >
              <div className="flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-bg text-sm font-extrabold uppercase text-text-dim">
                {me.avatar_b64 ? (
                  <img src={me.avatar_b64} alt="" className="h-full w-full object-cover" />
                ) : (
                  me.username.slice(0, 2)
                )}
              </div>
            </div>
            <span className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full border-2 border-surface bg-accent text-sm font-extrabold text-bg">
              +
            </span>
          </button>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-text">{t('status.mine')}</div>
            <div className="truncate text-[11px] font-medium text-text-faint">
              {mine.length > 0
                ? `${mine.length} ${t('status.active')} · ${timeOf(mine[0].created_at)}`
                : t('status.mine.hint')}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setEditorOpen(true)}
            className="chunk-btn chunk-btn-accent shrink-0 px-4 py-2 text-xs"
          >
            + {t('status.new')}
          </button>
        </div>

        {rows === null && <Skeleton className="h-24 w-full" />}

        {fresh.length > 0 && (
          <div className="space-y-0.5">
            <div className="px-1 text-[10px] font-extrabold uppercase tracking-wide text-text-dim">
              {t('status.recent')}
            </div>
            {fresh.map(personRow)}
          </div>
        )}
        {viewed.length > 0 && (
          <div className="space-y-0.5">
            <div className="px-1 text-[10px] font-extrabold uppercase tracking-wide text-text-dim">
              {t('status.seen')}
            </div>
            {viewed.map(personRow)}
          </div>
        )}
        {rows !== null && people.length === 0 && mine.length === 0 && (
          <div className="chunk flex flex-col items-center gap-2 py-10 text-center">
            <Mascot mood="relax" size={56} />
            <span className="max-w-xs text-sm font-semibold text-text-faint">
              {t('status.empty')}
            </span>
          </div>
        )}
      </div>

      {editorOpen && (
        <StatusEditor
          username={me.username}
          onClose={() => setEditorOpen(false)}
          onPosted={() => {
            setEditorOpen(false);
            reload();
          }}
          onError={onError}
        />
      )}
      {viewing && (
        <StatusViewer
          person={viewing}
          friends={soc.state?.friends ?? []}
          onClose={() => {
            setViewing(null);
            reload();
          }}
          onOpenChat={onOpenChat}
          onError={onError}
        />
      )}
    </div>
  );
}

// ---------- editor ----------

function StatusEditor({
  username,
  onClose,
  onPosted,
  onError,
}: {
  username: string;
  onClose: () => void;
  onPosted: () => void;
  onError: (m: string) => void;
}) {
  const [mode, setMode] = useState<'text' | 'draw' | 'sticker' | 'card'>('text');
  const [text, setText] = useState('');
  const [bg, setBg] = useState(TEXT_BGS[0]);
  const [busy, setBusy] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const [penColor, setPenColor] = useState('#f2f2f4');
  const [cardPreview, setCardPreview] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== 'draw') return;
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#141417';
    ctx.fillRect(0, 0, c.width, c.height);
  }, [mode]);

  useEffect(() => {
    if (mode !== 'card') return;
    renderWeekCardImage(username).then(setCardPreview).catch(() => {});
  }, [mode, username]);

  function pos(c: HTMLCanvasElement, e: React.PointerEvent) {
    const r = c.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * c.width,
      y: ((e.clientY - r.top) / r.height) * c.height,
    };
  }

  async function post() {
    setBusy(true);
    try {
      let err: string | null = null;
      if (mode === 'text') {
        const clean = cleanProfanity(text).trim();
        if (!clean) return;
        err = await social.postStatus('text', clean.slice(0, 500), bg);
      } else if (mode === 'draw') {
        const c = canvasRef.current;
        if (!c) return;
        err = await social.postStatus('image', c.toDataURL('image/jpeg', 0.8));
      } else if (mode === 'sticker') {
        return; // stickers post directly from the grid
      } else if (mode === 'card') {
        if (!cardPreview) return;
        err = await social.postStatus('image', cardPreview);
      }
      if (err) onError(err);
      else onPosted();
    } finally {
      setBusy(false);
    }
  }

  async function postSticker(mood: MascotMood) {
    setBusy(true);
    try {
      const img = renderStickerImage(mood);
      if (!img) return;
      const err = await social.postStatus('image', img);
      if (err) onError(err);
      else onPosted();
    } finally {
      setBusy(false);
    }
  }

  const modeBtn = (m: typeof mode, label: string) => (
    <button
      key={m}
      type="button"
      onClick={() => setMode(m)}
      className={`rounded-full border px-3 py-1 text-[11px] font-bold ${
        mode === m
          ? 'border-accent bg-accent-dim text-accent'
          : 'border-border text-text-dim hover:border-border-strong hover:text-text'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div
      className="animate-fade-in fixed inset-0 z-[60] flex items-center justify-center bg-black/85 px-6 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="chunk animate-scale-in flex max-h-[85vh] w-full max-w-md flex-col p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-extrabold text-text">{t('status.new')}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm font-bold text-text-faint hover:text-text"
          >
            ✕
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {modeBtn('text', t('status.mode.text'))}
          {modeBtn('draw', t('status.mode.draw'))}
          {modeBtn('sticker', t('status.mode.sticker'))}
          {modeBtn('card', t('status.mode.card'))}
        </div>

        <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
          {mode === 'text' && (
            <div>
              <div
                className="flex min-h-48 items-center justify-center rounded-2xl p-6"
                style={{ backgroundColor: bg }}
              >
                <textarea
                  autoFocus
                  value={text}
                  onChange={(e) => setText(e.target.value.slice(0, 500))}
                  placeholder={t('status.text.placeholder')}
                  rows={4}
                  className="w-full resize-none bg-transparent text-center text-xl font-bold text-white outline-none placeholder:text-white/50"
                />
              </div>
              <div className="mt-3 flex justify-center gap-2">
                {TEXT_BGS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setBg(c)}
                    className={`h-7 w-7 rounded-full border-2 ${
                      bg === c ? 'border-text' : 'border-transparent'
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
          )}

          {mode === 'draw' && (
            <div>
              <canvas
                ref={canvasRef}
                width={480}
                height={360}
                className="w-full cursor-crosshair touch-none rounded-2xl border-2 border-border-strong"
                onPointerDown={(e) => {
                  drawingRef.current = true;
                  const c = canvasRef.current;
                  if (!c) return;
                  c.setPointerCapture(e.pointerId);
                  const ctx = c.getContext('2d');
                  if (!ctx) return;
                  const p = pos(c, e);
                  ctx.strokeStyle = penColor;
                  ctx.lineWidth = 5;
                  ctx.lineCap = 'round';
                  ctx.beginPath();
                  ctx.moveTo(p.x, p.y);
                }}
                onPointerMove={(e) => {
                  if (!drawingRef.current) return;
                  const c = canvasRef.current;
                  const ctx = c?.getContext('2d');
                  if (!c || !ctx) return;
                  const p = pos(c, e);
                  ctx.lineTo(p.x, p.y);
                  ctx.stroke();
                }}
                onPointerUp={() => {
                  drawingRef.current = false;
                }}
              />
              <div className="mt-3 flex items-center justify-center gap-2">
                {['#f2f2f4', '#d4ff3f', '#7dd3fc', '#f472b6', '#fbbf24', '#f87171'].map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setPenColor(c)}
                    className={`h-7 w-7 rounded-full border-2 ${
                      penColor === c ? 'border-text' : 'border-transparent'
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
                <button
                  type="button"
                  onClick={() => {
                    const c = canvasRef.current;
                    const ctx = c?.getContext('2d');
                    if (!c || !ctx) return;
                    ctx.fillStyle = '#141417';
                    ctx.fillRect(0, 0, c.width, c.height);
                  }}
                  className="ml-2 rounded-lg px-2 py-1 text-[11px] font-bold text-text-faint hover:text-text"
                >
                  {t('status.draw.clear')}
                </button>
              </div>
            </div>
          )}

          {mode === 'sticker' && (
            <div className="grid grid-cols-4 gap-2">
              {STICKER_MOODS.map((m) => (
                <button
                  key={m}
                  type="button"
                  disabled={busy}
                  onClick={() => postSticker(m)}
                  className="flex items-center justify-center rounded-2xl border-2 border-border bg-bg py-4 transition-transform hover:scale-105 hover:border-accent"
                >
                  <Mascot mood={m} size={52} effects={false} />
                </button>
              ))}
            </div>
          )}

          {mode === 'card' &&
            (cardPreview ? (
              <img
                src={cardPreview}
                alt=""
                className="mx-auto max-h-72 rounded-2xl border-2 border-border-strong"
              />
            ) : (
              <Skeleton className="mx-auto h-64 w-48" />
            ))}
        </div>

        {mode !== 'sticker' && (
          <button
            type="button"
            disabled={busy || (mode === 'text' && !text.trim()) || (mode === 'card' && !cardPreview)}
            onClick={post}
            className="chunk-btn chunk-btn-accent mt-4 w-full py-3 text-sm"
          >
            {busy ? '…' : t('status.post')}
          </button>
        )}
        {mode === 'sticker' && (
          <p className="mt-3 text-center text-[11px] font-medium text-text-faint">
            {t('status.sticker.hint')}
          </p>
        )}
      </div>
    </div>
  );
}

// ---------- viewer (stories) ----------

const STORY_MS = 5000;

function StatusViewer({
  person,
  friends,
  onClose,
  onOpenChat,
  onError,
}: {
  person: PersonStatuses;
  friends: FriendEntry[];
  onClose: () => void;
  onOpenChat: (friendUserId: string) => void;
  onError: (m: string) => void;
}) {
  const [idx, setIdx] = useState(0);
  const [reply, setReply] = useState('');
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const current = person.items[idx];

  useEffect(() => {
    if (current) markSeen(person.userId, current.id);
  }, [current, person.userId]);

  // auto-advance with a paused-while-typing guard
  useEffect(() => {
    if (paused) return;
    const started = Date.now();
    const iv = window.setInterval(() => {
      const p = (Date.now() - started) / STORY_MS;
      if (p >= 1) {
        if (idx < person.items.length - 1) setIdx((i) => i + 1);
        else onClose();
      } else setProgress(p);
    }, 50);
    setProgress(0);
    return () => window.clearInterval(iv);
  }, [idx, paused, person.items.length, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' && idx < person.items.length - 1) setIdx((i) => i + 1);
      if (e.key === 'ArrowLeft' && idx > 0) setIdx((i) => i - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [idx, person.items.length, onClose]);

  if (!current) return null;

  const friend = friends.find((f) => f.userId === person.userId);

  async function sendReply(text: string) {
    if (!friend || !text.trim()) return;
    const snippet =
      current.kind === 'text' ? current.body.slice(0, 60) : t('status.reply.image');
    const payload = JSON.stringify({ s: snippet, t: text.trim() });
    const r = await chat.sendMessage(friend.userId, 'status', payload);
    if (r !== 'ok') {
      onError(t('fr.err.generic'));
      return;
    }
    setReply('');
    onClose();
    onOpenChat(friend.userId);
  }

  const timeLabel = new Date(current.created_at).toLocaleTimeString(dateLocale(), {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="animate-fade-in fixed inset-0 z-[70] flex flex-col items-center justify-center bg-black/95">
      {/* progress bars */}
      <div className="absolute left-0 right-0 top-3 flex gap-1 px-4">
        {person.items.map((s, i) => (
          <div key={s.id} className="h-1 flex-1 overflow-hidden rounded-full bg-white/20">
            <div
              className="h-full bg-white"
              style={{ width: i < idx ? '100%' : i === idx ? `${progress * 100}%` : '0%' }}
            />
          </div>
        ))}
      </div>

      {/* header */}
      <div className="absolute left-4 top-7 flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border-2 border-white/30 bg-bg text-[10px] font-extrabold uppercase text-text-dim">
          {person.avatar ? (
            <img src={person.avatar} alt="" className="h-full w-full object-cover" />
          ) : (
            person.username.slice(0, 2)
          )}
        </div>
        <div>
          <div className="text-sm font-bold text-white">
            {person.isMe ? t('fr.me') : `@${person.username}`}
          </div>
          <div className="text-[10px] font-semibold text-white/60">{timeLabel}</div>
        </div>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-7 rounded-lg px-2 py-1 text-lg font-bold text-white/70 hover:text-white"
      >
        ✕
      </button>

      {/* content + tap zones */}
      <div className="relative flex h-[70vh] w-full max-w-md items-center justify-center px-6">
        {current.kind === 'text' ? (
          <div
            className="flex max-h-full w-full items-center justify-center overflow-hidden rounded-3xl p-10"
            style={{ backgroundColor: current.bg ?? '#1f6f43', minHeight: '50vh' }}
          >
            <p className="whitespace-pre-wrap break-words text-center text-2xl font-bold leading-snug text-white">
              {cleanProfanity(current.body)}
            </p>
          </div>
        ) : (
          <img
            src={current.body}
            alt=""
            className="max-h-full max-w-full rounded-3xl object-contain"
          />
        )}
        <button
          type="button"
          aria-label="prev"
          onClick={() => idx > 0 && setIdx((i) => i - 1)}
          className="absolute bottom-0 left-0 top-0 w-1/3"
        />
        <button
          type="button"
          aria-label="next"
          onClick={() => (idx < person.items.length - 1 ? setIdx((i) => i + 1) : onClose())}
          className="absolute bottom-0 right-0 top-0 w-1/3"
        />
      </div>

      {/* footer: delete (mine) or reply + quick reactions (theirs) */}
      {person.isMe ? (
        <button
          type="button"
          onClick={async () => {
            await social.deleteStatus(current.id);
            onClose();
          }}
          className="mt-4 rounded-xl border-2 border-danger/60 px-5 py-2 text-xs font-extrabold text-danger hover:bg-danger/10"
        >
          {t('status.delete')}
        </button>
      ) : (
        <div className="mt-4 flex w-full max-w-md items-center gap-2 px-6">
          {QUICK_REACTIONS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => sendReply(e)}
              className="text-2xl transition-transform hover:scale-125"
            >
              {e}
            </button>
          ))}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendReply(reply);
            }}
            className="min-w-0 flex-1"
          >
            <input
              value={reply}
              onChange={(e) => setReply(e.target.value.slice(0, 300))}
              onFocus={() => setPaused(true)}
              onBlur={() => setPaused(false)}
              placeholder={t('status.reply.placeholder')}
              className="w-full rounded-full border-2 border-white/25 bg-white/10 px-4 py-2.5 text-sm font-medium text-white outline-none placeholder:text-white/40 focus:border-accent"
            />
          </form>
        </div>
      )}
    </div>
  );
}

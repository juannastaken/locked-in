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
// ---------- editor: free composer (Photoshop-lite) ----------
// A 9:16 board. Add ANY mix of elements — text boxes, mascot stickers, your
// week card, images from disk — drag/scale each one, ink on top with the pen,
// then everything is composited into a single image and posted.

const BOARD_W = 480;
const BOARD_H = 720;

interface BoardElement {
  id: number;
  type: 'text' | 'sticker' | 'image';
  x: number;
  y: number;
  scale: number;
  /** text elements */
  text?: string;
  color?: string;
  /** sticker elements */
  mood?: MascotMood;
  /** image elements (data-url, pre-resized) */
  src?: string;
  w?: number;
  h?: number;
}

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
  const [bg, setBg] = useState(TEXT_BGS[0]);
  const [tool, setTool] = useState<'move' | 'pen'>('move');
  const [penColor, setPenColor] = useState('#f2f2f4');
  const [elements, setElements] = useState<BoardElement[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [stickerPick, setStickerPick] = useState(false);
  const [busy, setBusy] = useState(false);
  const idRef = useRef(1);
  const inkRef = useRef<HTMLCanvasElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: number; dx: number; dy: number } | null>(null);
  const penDownRef = useRef(false);
  const imgInputRef = useRef<HTMLInputElement>(null);

  const sel = elements.find((e) => e.id === selected) ?? null;

  function boardPos(e: React.PointerEvent) {
    const r = boardRef.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return {
      x: ((e.clientX - r.left) / r.width) * BOARD_W,
      y: ((e.clientY - r.top) / r.height) * BOARD_H,
    };
  }

  function addElement(el: Omit<BoardElement, 'id'>) {
    const id = idRef.current++;
    setElements((els) => [...els, { ...el, id }]);
    setSelected(id);
    setTool('move');
  }

  function patchSel(patch: Partial<BoardElement>) {
    if (selected === null) return;
    setElements((els) => els.map((e) => (e.id === selected ? { ...e, ...patch } : e)));
  }

  function addImage(file: File | undefined) {
    if (!file || !file.type.startsWith('image/')) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const MAX = 380;
      const s = Math.min(1, MAX / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * s);
      canvas.height = Math.round(img.height * s);
      canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
      addElement({
        type: 'image',
        x: 60,
        y: 160,
        scale: 1,
        src: canvas.toDataURL('image/jpeg', 0.8),
        w: canvas.width,
        h: canvas.height,
      });
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  }

  async function addCard() {
    const src = await renderWeekCardImage(username).catch(() => '');
    if (!src) return;
    addElement({ type: 'image', x: 90, y: 120, scale: 0.6, src, w: 460, h: 640 });
  }

  // pen strokes go on their own layer, over the background, under nothing —
  // elements render above so they stay grabbable
  function penDown(e: React.PointerEvent) {
    const c = inkRef.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    penDownRef.current = true;
    const p = boardPos(e);
    ctx.strokeStyle = penColor;
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  }

  function penMove(e: React.PointerEvent) {
    if (!penDownRef.current) return;
    const ctx = inkRef.current?.getContext('2d');
    if (!ctx) return;
    const p = boardPos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }

  async function publish() {
    setBusy(true);
    try {
      const out = document.createElement('canvas');
      out.width = BOARD_W;
      out.height = BOARD_H;
      const ctx = out.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, BOARD_W, BOARD_H);
      if (inkRef.current) ctx.drawImage(inkRef.current, 0, 0);
      for (const el of elements) {
        if (el.type === 'text' && el.text) {
          const size = Math.round(30 * el.scale);
          ctx.font = `bold ${size}px Inter, sans-serif`;
          ctx.fillStyle = el.color ?? '#ffffff';
          el.text.split('\n').forEach((line, i) => {
            ctx.fillText(line, el.x, el.y + size + i * size * 1.25);
          });
        } else if (el.type === 'sticker' && el.mood) {
          drawMascot(ctx, el.mood, el.x, el.y, 10 * el.scale, accentColor(), '#141417');
        } else if (el.type === 'image' && el.src) {
          const img = new Image();
          await new Promise<void>((res) => {
            img.onload = () => res();
            img.onerror = () => res();
            img.src = el.src as string;
          });
          ctx.drawImage(img, el.x, el.y, (el.w ?? 100) * el.scale, (el.h ?? 100) * el.scale);
        }
      }
      const err = await social.postStatus('image', out.toDataURL('image/jpeg', 0.82));
      if (err) onError(err);
      else onPosted();
    } finally {
      setBusy(false);
    }
  }

  const toolBtn = (active: boolean, onClick: () => void, label: string) => (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-[11px] font-bold ${
        active
          ? 'border-accent bg-accent-dim text-accent'
          : 'border-border text-text-dim hover:border-border-strong hover:text-text'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div
      className="animate-fade-in fixed inset-0 z-[60] flex items-center justify-center bg-black/85 px-4 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="chunk animate-scale-in flex max-h-[92vh] w-full max-w-2xl gap-4 p-5">
        {/* board */}
        <div className="min-w-0 flex-1">
          <div
            ref={boardRef}
            className="relative mx-auto aspect-[2/3] max-h-[70vh] select-none overflow-hidden rounded-2xl border-2 border-border-strong"
            style={{ backgroundColor: bg, cursor: tool === 'pen' ? 'crosshair' : 'default' }}
            onPointerDown={(e) => {
              if (tool === 'pen') {
                (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
                penDown(e);
              } else if (e.target === e.currentTarget) {
                setSelected(null);
              }
            }}
            onPointerMove={(e) => {
              if (tool === 'pen') {
                penMove(e);
                return;
              }
              const d = dragRef.current;
              if (!d) return;
              const p = boardPos(e);
              setElements((els) =>
                els.map((el) => (el.id === d.id ? { ...el, x: p.x - d.dx, y: p.y - d.dy } : el)),
              );
            }}
            onPointerUp={() => {
              penDownRef.current = false;
              dragRef.current = null;
            }}
          >
            <canvas
              ref={inkRef}
              width={BOARD_W}
              height={BOARD_H}
              className="pointer-events-none absolute inset-0 h-full w-full"
            />
            {elements.map((el) => {
              const isSel = el.id === selected;
              const base: React.CSSProperties = {
                left: `${(el.x / BOARD_W) * 100}%`,
                top: `${(el.y / BOARD_H) * 100}%`,
              };
              return (
                <div
                  key={el.id}
                  className={`absolute cursor-grab active:cursor-grabbing ${
                    isSel ? 'outline outline-2 outline-dashed outline-white/60' : ''
                  }`}
                  style={base}
                  onPointerDown={(e) => {
                    if (tool === 'pen') return;
                    e.stopPropagation();
                    (boardRef.current as HTMLDivElement).setPointerCapture(e.pointerId);
                    setSelected(el.id);
                    const p = boardPos(e);
                    dragRef.current = { id: el.id, dx: p.x - el.x, dy: p.y - el.y };
                  }}
                >
                  {el.type === 'text' && (
                    <span
                      className="whitespace-pre font-bold leading-tight"
                      style={{
                        color: el.color ?? '#ffffff',
                        fontSize: `${30 * el.scale * ((boardRef.current?.clientWidth ?? BOARD_W) / BOARD_W)}px`,
                      }}
                    >
                      {el.text || t('status.text.placeholder')}
                    </span>
                  )}
                  {el.type === 'sticker' && el.mood && (
                    <Mascot mood={el.mood} size={140 * el.scale * ((boardRef.current?.clientWidth ?? BOARD_W) / BOARD_W)} effects={false} />
                  )}
                  {el.type === 'image' && el.src && (
                    <img
                      src={el.src}
                      alt=""
                      draggable={false}
                      style={{
                        width: `${(((el.w ?? 100) * el.scale) / BOARD_W) * 100}%`,
                      }}
                      className="pointer-events-none max-w-none"
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* tools */}
        <div className="flex w-44 shrink-0 flex-col gap-3 overflow-y-auto">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-extrabold text-text">{t('status.new')}</h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-1.5 text-sm font-bold text-text-faint hover:text-text"
            >
              ✕
            </button>
          </div>

          <div className="space-y-1.5">
            <div className="text-[10px] font-extrabold uppercase tracking-wide text-text-dim">
              {t('status.tool.add')}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {toolBtn(false, () => addElement({ type: 'text', x: 60, y: 80, scale: 1, text: '', color: '#ffffff' }), `+ ${t('status.mode.text')}`)}
              {toolBtn(false, () => setStickerPick((s) => !s), `+ ${t('status.mode.sticker')}`)}
              {toolBtn(false, addCard, `+ ${t('status.mode.card')}`)}
              {toolBtn(false, () => imgInputRef.current?.click(), `+ ${t('status.tool.image')}`)}
            </div>
            {stickerPick && (
              <div className="grid grid-cols-4 gap-1 rounded-xl border border-border bg-bg p-1.5">
                {STICKER_MOODS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      setStickerPick(false);
                      addElement({ type: 'sticker', x: 160, y: 260, scale: 1, mood: m });
                    }}
                    className="flex items-center justify-center rounded-lg py-1.5 hover:bg-surface-hover"
                  >
                    <Mascot mood={m} size={26} effects={false} />
                  </button>
                ))}
              </div>
            )}
            <input
              ref={imgInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                addImage(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>

          <div className="space-y-1.5">
            <div className="text-[10px] font-extrabold uppercase tracking-wide text-text-dim">
              {t('status.tool.pen')}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {toolBtn(tool === 'move', () => setTool('move'), t('status.tool.move'))}
              {toolBtn(tool === 'pen', () => setTool('pen'), t('status.mode.draw'))}
            </div>
            {tool === 'pen' && (
              <div className="flex flex-wrap gap-1.5">
                {['#f2f2f4', '#d4ff3f', '#7dd3fc', '#f472b6', '#fbbf24', '#f87171'].map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setPenColor(c)}
                    className={`h-6 w-6 rounded-full border-2 ${penColor === c ? 'border-text' : 'border-transparent'}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <div className="text-[10px] font-extrabold uppercase tracking-wide text-text-dim">
              {t('status.tool.bg')}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {TEXT_BGS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setBg(c)}
                  className={`h-6 w-6 rounded-full border-2 ${bg === c ? 'border-text' : 'border-transparent'}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          {sel && (
            <div className="space-y-1.5 rounded-xl border border-border bg-bg p-2">
              <div className="text-[10px] font-extrabold uppercase tracking-wide text-text-dim">
                {t('status.tool.selected')}
              </div>
              {sel.type === 'text' && (
                <>
                  <textarea
                    autoFocus
                    value={sel.text ?? ''}
                    onChange={(e) => patchSel({ text: e.target.value.slice(0, 200) })}
                    rows={2}
                    placeholder={t('status.text.placeholder')}
                    className="chunk-input w-full px-2 py-1.5 text-xs font-semibold text-text"
                  />
                  <div className="flex flex-wrap gap-1.5">
                    {['#ffffff', '#d4ff3f', '#7dd3fc', '#f472b6', '#fbbf24', '#111114'].map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => patchSel({ color: c })}
                        className={`h-5 w-5 rounded-full border-2 ${sel.color === c ? 'border-text' : 'border-border'}`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </>
              )}
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => patchSel({ scale: Math.max(0.3, sel.scale - 0.15) })}
                  className="chunk-btn h-8 w-8 text-sm text-text"
                >
                  −
                </button>
                <button
                  type="button"
                  onClick={() => patchSel({ scale: Math.min(4, sel.scale + 0.15) })}
                  className="chunk-btn h-8 w-8 text-sm text-text"
                >
                  +
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setElements((els) => els.filter((e) => e.id !== sel.id));
                    setSelected(null);
                  }}
                  className="chunk-btn ml-auto h-8 px-3 text-xs font-bold text-danger"
                >
                  ✕
                </button>
              </div>
            </div>
          )}

          <button
            type="button"
            disabled={busy}
            onClick={publish}
            className="chunk-btn chunk-btn-accent mt-auto w-full py-3 text-sm"
          >
            {busy ? '…' : t('status.post')}
          </button>
        </div>
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

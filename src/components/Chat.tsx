import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useToast } from '../hooks/useToast';
import * as chat from '../lib/chat';
import * as media from '../lib/media';
import { cleanProfanity } from '../lib/filter';
import { Mascot } from './Mascot';
import type { MascotMood } from './Mascot';
import type { DecryptedMessage, TypingChannel } from '../lib/chat';
import { dateLocale, t } from '../lib/i18n';
import { formatDurationShort } from '../lib/time';
import type { FriendEntry } from '../lib/social';
import {
  CheckIcon,
  ClipIcon,
  DotsIcon,
  DoubleCheckIcon,
  HeadphonesIcon,
  ImageIcon,
  MicIcon,
  PaletteIcon,
  PencilIcon,
  PinIcon,
  ReplyIcon,
  SendIcon,
  SmileIcon,
  TrashIcon,
} from './Icons';

// last decrypted state per conversation — switching chats paints INSTANTLY
// from here (no skeleton, no double blink) while a silent refetch runs
const convoCache = new Map<string, DecryptedMessage[]>();

// only one voice note plays at a time (WhatsApp behavior)
let activeVoiceEl: HTMLAudioElement | null = null;

export function fmtVoiceSec(s: number) {
  if (!Number.isFinite(s) || s < 0) s = 0;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

const VOICE_BARS = 28;
const VOICE_RATES = [1, 1.5, 2];

export function VoicePlayer({ src, mine }: { src: string; mine: boolean }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [dur, setDur] = useState(0);
  const [cur, setCur] = useState(0);
  const [rate, setRate] = useState(1);

  // deterministic pseudo-waveform seeded by the payload — stable per message
  const bars = useMemo(() => {
    let h = 2166136261;
    for (let i = 40; i < Math.min(src.length, 4000); i += 13) {
      h = Math.imul(h ^ src.charCodeAt(i), 16777619);
    }
    return Array.from({ length: VOICE_BARS }, (_, i) => {
      h = Math.imul(h ^ (i + 1), 16777619);
      return 0.25 + (((h >>> 8) % 1000) / 1000) * 0.75;
    });
  }, [src]);

  useEffect(
    () => () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      const el = audioRef.current;
      if (el) {
        el.pause();
        if (activeVoiceEl === el) activeVoiceEl = null;
      }
    },
    [],
  );

  const tick = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    setCur(el.currentTime);
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const onMeta = () => {
    const el = audioRef.current;
    if (!el) return;
    if (Number.isFinite(el.duration) && el.duration > 0) {
      setDur(el.duration);
    } else {
      // MediaRecorder webm carries no duration header — force Chromium to
      // compute it by seeking past the end, then rewind
      const fix = () => {
        if (Number.isFinite(el.duration) && el.duration > 0) {
          setDur(el.duration);
          el.currentTime = 0;
          setCur(0);
          el.removeEventListener('durationchange', fix);
        }
      };
      el.addEventListener('durationchange', fix);
      el.currentTime = 1e7;
    }
  };

  const toggle = () => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      if (activeVoiceEl && activeVoiceEl !== el) activeVoiceEl.pause();
      activeVoiceEl = el;
      const out = localStorage.getItem('audio-output-id');
      if (out && 'setSinkId' in el) {
        (el as HTMLAudioElement & { setSinkId: (id: string) => Promise<void> })
          .setSinkId(out)
          .catch(() => {});
      }
      el.playbackRate = rate;
      el.play().catch(() => {});
    } else {
      el.pause();
    }
  };

  const seek = (clientX: number) => {
    const el = audioRef.current;
    const bar = barRef.current;
    if (!el || !bar || !dur) return;
    const rect = bar.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    el.currentTime = frac * dur;
    setCur(el.currentTime);
  };

  const cycleRate = () => {
    const next = VOICE_RATES[(VOICE_RATES.indexOf(rate) + 1) % VOICE_RATES.length];
    setRate(next);
    const el = audioRef.current;
    if (el) el.playbackRate = next;
  };

  const progress = dur > 0 ? cur / dur : 0;
  const shown = playing || cur > 0 ? cur : dur;

  return (
    <div className={`flex max-w-full items-center gap-2 ${mine ? 'text-bg' : 'text-text'}`}>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={onMeta}
        onPlay={() => {
          setPlaying(true);
          if (rafRef.current) cancelAnimationFrame(rafRef.current);
          rafRef.current = requestAnimationFrame(tick);
        }}
        onPause={() => {
          setPlaying(false);
          if (rafRef.current) cancelAnimationFrame(rafRef.current);
          const el = audioRef.current;
          if (el) setCur(el.ended ? 0 : el.currentTime);
        }}
      />
      <button
        type="button"
        onClick={toggle}
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-transform ${
          mine ? 'bg-bg/20' : 'bg-accent text-bg'
        }`}
      >
        {playing ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <rect x="5" y="4" width="5" height="16" rx="1.5" />
            <rect x="14" y="4" width="5" height="16" rx="1.5" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M7 4.8v14.4c0 .9 1 1.5 1.8 1L20.4 13c.8-.5.8-1.6 0-2L8.8 3.8c-.8-.5-1.8.1-1.8 1z" />
          </svg>
        )}
      </button>
      <div
        ref={barRef}
        className="flex h-9 w-32 min-w-0 shrink cursor-pointer items-center gap-[2px]"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          seek(e.clientX);
        }}
        onPointerMove={(e) => {
          if (e.buttons === 1) seek(e.clientX);
        }}
      >
        {bars.map((h, i) => (
          <span
            key={i}
            className="w-[3px] flex-1 rounded-full bg-current transition-opacity"
            style={{
              height: `${Math.round(h * 26)}px`,
              opacity: (i + 0.5) / VOICE_BARS <= progress ? 1 : 0.35,
            }}
          />
        ))}
      </div>
      <span className="w-8 shrink-0 text-right font-mono text-[11px] tabular-nums opacity-80">
        {fmtVoiceSec(shown)}
      </span>
      <button
        type="button"
        onClick={cycleRate}
        className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-extrabold ${
          mine ? 'bg-bg/20' : 'bg-surface-hover'
        }`}
      >
        {rate}×
      </button>
    </div>
  );
}

const REACTION_SET = ['👍', '❤️', '😂', '🔥', '👀'];
export const STICKER_MOODS: MascotMood[] = ['happy', 'hyped', 'focus', 'relax', 'sleep', 'sad', 'angry'];
export const CHAT_THEMES = ['#d4ff3f', '#7dd3fc', '#a78bfa', '#f472b6', '#fb923c', '#34d399'];

/** '[sticker:mood]' marker → the mascot mood, or null. */
export function stickerMoodOf(text: string | null): MascotMood | null {
  const m = text?.match(/^\[sticker:(\w+)\]$/);
  if (!m) return null;
  const mood = m[1] as MascotMood;
  return STICKER_MOODS.includes(mood) ? mood : null;
}

/** message that is ONLY 1-3 emoji → rendered jumbo, no bubble */
export function isJumbo(text: string): boolean {
  if (text.length > 12) return false;
  const m = text.trim().match(/\p{Extended_Pictographic}/gu);
  if (!m) return false;
  const stripped = text.replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}‍️\s]/gu, '');
  return stripped.length === 0 && m.length <= 3;
}

const PINS_KEY = 'chat-pins'; // { [friendId]: messageId }
function pinsMap(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(PINS_KEY) ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
}

const THEME_KEY = 'chat-themes'; // { [friendId]: hex }
function themesMap(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(THEME_KEY) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}
const EMOJI_GRID = [
  '😀', '😂', '🤣', '😅', '😍', '😎', '🤔', '😴',
  '😭', '😡', '🥶', '🤯', '👍', '👎', '👊', '🙏',
  '🔥', '⚡', '💪', '🧠', '🎯', '🏆', '💎', '🚀',
  '❤️', '💚', '☕', '🍕', '🎮', '🎧', '💻', '⏰',
];

interface ChatProps {
  friend: FriendEntry;
  myUserId: string;
  statusLine: string;
  statusColor: string;
  /** friend is focusing right now (drives the jam invite card state) */
  friendLive: boolean;
  friendFocusSec: number;
  /** I'm currently in a jam that includes this friend */
  inJamWithFriend: boolean;
  onError: (m: string) => void;
  onBack: () => void;
  refetchKey: number;
  jamAction: { label: string; run: () => void } | null;
  /** friend is typing right now — fed by the app-wide private inbox */
  peerTypingNow: boolean;
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' });
}

function dayKeyOf(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function dayLabel(iso: string): string {
  const now = new Date();
  if (dayKeyOf(iso) === dayKeyOf(now.toISOString())) return t('msg.today');
  const yest = new Date(now);
  yest.setDate(yest.getDate() - 1);
  if (dayKeyOf(iso) === dayKeyOf(yest.toISOString())) return t('msg.yesterday');
  return new Date(iso).toLocaleDateString(dateLocale(), { day: '2-digit', month: 'short' });
}

/** WhatsApp-style block: same author, same day, less than 5 min apart */
function sameBlock(a: { mine: boolean; created_at: string }, b: { mine: boolean; created_at: string }): boolean {
  return (
    a.mine === b.mine &&
    dayKeyOf(a.created_at) === dayKeyOf(b.created_at) &&
    Math.abs(new Date(b.created_at).getTime() - new Date(a.created_at).getTime()) < 5 * 60_000
  );
}

/** Centered "Hoje / Ontem / 12 jul" chip between day blocks. */
export function DaySeparator({ iso }: { iso: string }) {
  return (
    <div className="flex justify-center py-3.5">
      <span className="rounded-full border border-border bg-surface px-3.5 py-1 text-[10px] font-extrabold uppercase tracking-wide text-text-faint">
        {dayLabel(iso)}
      </span>
    </div>
  );
}

/** Fullscreen image viewer: Esc / click-outside closes; download + copy. */
/** URLs become blue, clickable (system browser) — plain text otherwise. */
function linkify(text: string) {
  const parts = text.split(/(https?:\/\/\S+)/gi);
  if (parts.length === 1) return text;
  return parts.map((p, i) =>
    /^https?:\/\//i.test(p) ? (
      <button
        key={i}
        type="button"
        onClick={() => openUrl(p).catch(() => {})}
        className="inline break-all text-left font-medium text-sky-400 underline underline-offset-2 hover:text-sky-300"
      >
        {p}
      </button>
    ) : (
      p
    ),
  );
}

export function ImageViewer({
  src,
  onClose,
  onToast,
}: {
  src: string;
  onClose: () => void;
  onToast: (m: string) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function toPngBlob(): Promise<Blob | null> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        canvas.getContext('2d')?.drawImage(img, 0, 0);
        canvas.toBlob((b) => resolve(b), 'image/png');
      };
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  async function download() {
    const blob = await toPngBlob();
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `locked-in-img-${Date.now()}.png`;
    a.click();
    URL.revokeObjectURL(url);
    onToast(t('img.saved'));
  }

  async function copy() {
    const blob = await toPngBlob();
    if (!blob) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      onToast(t('img.copied'));
    } catch {
      onToast(t('img.copy.fail'));
    }
  }

  // portaled: nested fixed overlays lose to sibling panels' stacking contexts
  return createPortal(
    <div
      className="animate-fade-in fixed inset-0 z-[70] flex flex-col items-center justify-center bg-black/90"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <img
        src={src}
        alt=""
        className="animate-scale-in max-h-[80vh] max-w-[90vw] rounded-xl object-contain shadow-2xl shadow-black"
      />
      <div className="mt-4 flex gap-2">
        <button type="button" onClick={download} className="chunk-btn px-4 py-2 text-xs text-text">
          ⬇ {t('img.download')}
        </button>
        <button type="button" onClick={copy} className="chunk-btn px-4 py-2 text-xs text-text">
          ⧉ {t('img.copy')}
        </button>
        <button type="button" onClick={onClose} className="chunk-btn px-4 py-2 text-xs text-text-dim">
          {t('misc.close')}
        </button>
      </div>
    </div>,
    document.body,
  );
}

/** compress a data-url/file to a jpeg data-url under maxPx / maxBytes */
function compressImage(
  src: string,
  maxPx: number,
  maxBytes: number,
  qualities: number[],
): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve(null);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      for (const q of qualities) {
        const out = canvas.toDataURL('image/jpeg', q);
        if (out.length <= maxBytes) return resolve(out);
      }
      resolve(null);
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** picked image → data-url. Storage-era budget: sharp 1280px, ~900KB. */
export function fileToChatImage(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    compressImage(url, 1280, 900_000, [0.85, 0.72, 0.55]).then((out) => {
      URL.revokeObjectURL(url);
      resolve(out);
    });
  });
}

/** legacy inline budget — used only when the Storage upload fails (offline) */
function shrinkForInline(dataUrl: string): Promise<string | null> {
  return compressImage(dataUrl, 512, 110_000, [0.72, 0.55, 0.4]);
}

function AvatarSm({ friend }: { friend: FriendEntry }) {
  return (
    <div className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border-strong bg-bg text-[10px] font-extrabold uppercase text-text-dim">
      {friend.avatar ? (
        <img src={friend.avatar} alt="" className="h-full w-full object-cover" />
      ) : (
        friend.username.slice(0, 2)
      )}
    </div>
  );
}

/** Discord-style jam invite card rendered for kind='jam' messages. */
function JamCard({
  m,
  friend,
  friendLive,
  friendFocusSec,
  inJam,
  onJoin,
}: {
  m: DecryptedMessage;
  friend: FriendEntry;
  friendLive: boolean;
  friendFocusSec: number;
  inJam: boolean;
  onJoin: () => void;
}) {
  // an invite only lives as long as the SESSION that sent it: if the friend's
  // current session started after the message, this card is history — without
  // this check a 4am invite kept "reactivating" every time the friend focused
  const sessionStartMs = Date.now() - friendFocusSec * 1000;
  const fromThisSession =
    friendLive && new Date(m.created_at).getTime() >= sessionStartMs - 60_000;
  const joinable = !m.mine && friendLive && !inJam && fromThisSession;
  return (
    <div className="bubble-shadow w-72 overflow-hidden rounded-2xl border-2 border-border-strong bg-surface">
      <div className="flex items-center gap-2 border-b border-border bg-accent-dim px-3.5 py-2">
        <HeadphonesIcon size={14} className="text-accent" />
        <span className="text-[11px] font-extrabold uppercase tracking-wide text-accent">
          {t('jamcard.title')}
        </span>
      </div>
      <div className="px-3.5 py-3">
        <div className="truncate text-sm font-bold text-text">{m.text ?? '🔒'}</div>
        <div className="mt-1.5 flex items-center gap-2">
          <AvatarSm friend={friend} />
          <span className="min-w-0 truncate text-xs font-semibold text-text-dim">
            @{friend.username}
          </span>
          {friendLive && (
            <span className="ml-auto shrink-0 font-mono text-[11px] font-bold tabular-nums text-accent">
              {t('jamcard.working', formatDurationShort(friendFocusSec))}
            </span>
          )}
        </div>
        <button
          type="button"
          disabled={!joinable}
          onClick={onJoin}
          className={`mt-3 w-full rounded-xl py-2.5 text-[13px] font-extrabold transition-transform ${
            joinable
              ? 'bg-accent text-bg'
              : 'cursor-default border border-border text-text-faint'
          }`}
        >
          {m.mine
            ? t('jamcard.sent')
            : inJam
              ? t('jamcard.already')
              : joinable
                ? t('jamcard.join')
                : t('jamcard.over')}
        </button>
      </div>
    </div>
  );
}

export function ChatView({
  friend,
  myUserId,
  statusLine,
  statusColor,
  friendLive,
  friendFocusSec,
  inJamWithFriend,
  onError,
  onBack,
  refetchKey,
  jamAction,
  peerTypingNow,
}: ChatProps) {
  const { pushToast } = useToast();
  const [messages, setMessages] = useState<DecryptedMessage[] | null>(
    () => convoCache.get(friend.userId) ?? null,
  );
  const [draft, setDraft] = useState('');
  /** image sitting in the composer (drag/paste/pick) — sends on the button */
  const [pendingImg, setPendingImg] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<DecryptedMessage | null>(null);
  const [reactFor, setReactFor] = useState<number | null>(null);
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const [editing, setEditing] = useState<DecryptedMessage | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const peerTyping = peerTypingNow;
  const [clipOpen, setClipOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [viewImg, setViewImg] = useState<string | null>(null);
  const [stickerOpen, setStickerOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [pinId, setPinId] = useState<number | null>(() => pinsMap()[friend.userId] ?? null);
  const [theme, setTheme] = useState<string | null>(() => themesMap()[friend.userId] ?? null);
  const [recording, setRecording] = useState(false);
  const [recSec, setRecSec] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recChunksRef = useRef<Blob[]>([]);
  const recTimerRef = useRef<number | null>(null);

  function setPin(id: number | null) {
    const map = pinsMap();
    if (id === null) delete map[friend.userId];
    else map[friend.userId] = id;
    localStorage.setItem(PINS_KEY, JSON.stringify(map));
    setPinId(id);
  }

  function setChatTheme(hex: string | null) {
    const map = themesMap();
    if (hex === null) delete map[friend.userId];
    else map[friend.userId] = hex;
    localStorage.setItem(THEME_KEY, JSON.stringify(map));
    setTheme(hex);
    setThemeOpen(false);
  }

  async function sendSticker(mood: MascotMood) {
    setStickerOpen(false);
    setClipOpen(false);
    // stickers travel as a tiny marker and render as the LIVE animated mascot
    const r = await chat.sendMessage(friend.userId, 'text', `[sticker:${mood}]`);
    if (r === 'ok') reload();
    else handleSendError(r);
  }

  const stickerOf = (text: string | null): MascotMood | null => {
    const m = text?.match(/^\[sticker:(\w+)\]$/);
    if (!m) return null;
    const mood = m[1] as MascotMood;
    return STICKER_MOODS.includes(mood) ? mood : null;
  };

  const [micAsk, setMicAsk] = useState(false);

  async function startRecording() {
    // first time: our own explainer BEFORE the raw WebView2 permission prompt
    if (!localStorage.getItem('mic-explained')) {
      setMicAsk(true);
      return;
    }
    await reallyStartRecording();
  }

  async function reallyStartRecording() {
    try {
      const inputId = localStorage.getItem('audio-input-id');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: inputId ? { deviceId: { exact: inputId } } : true,
      });
      // some machines reject the explicit opus mime — fall back gracefully
      let rec: MediaRecorder;
      try {
        rec = new MediaRecorder(stream, {
          mimeType: 'audio/webm;codecs=opus',
          audioBitsPerSecond: 16_000,
        });
      } catch {
        rec = new MediaRecorder(stream, { audioBitsPerSecond: 16_000 });
      }
      recChunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) recChunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((tr) => tr.stop());
        const blob = new Blob(recChunksRef.current, { type: 'audio/webm' });
        const dataUrl = await new Promise<string>((res) => {
          const fr = new FileReader();
          fr.onload = () => res(String(fr.result));
          fr.readAsDataURL(blob);
        });
        // Storage first; inline data-url only as the offline fallback
        let body = await media.uploadEncrypted(dataUrl);
        if (!body && dataUrl.length <= 110_000) body = dataUrl;
        if (!body) {
          onError(t('msg.voice.toobig'));
          return;
        }
        const r = await chat.sendMessage(friend.userId, 'voice', body);
        if (r === 'ok') reload();
        else handleSendError(r);
      };
      recorderRef.current = rec;
      rec.start();
      setRecording(true);
      setRecSec(0);
      recTimerRef.current = window.setInterval(() => {
        setRecSec((s) => {
          if (s + 1 >= 60) stopRecording(); // Storage-era cap: 1 minute
          return s + 1;
        });
      }, 1000);
    } catch (err) {
      const name = (err as DOMException | undefined)?.name ?? '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        onError(t('msg.voice.denied'));
      } else if (name === 'OverconstrainedError') {
        // saved device disappeared — forget it and retry with the default
        localStorage.removeItem('audio-input-id');
        onError(t('msg.voice.devicegone'));
      } else {
        onError(t('msg.voice.nomic'));
      }
    }
  }

  function stopRecording() {
    if (recTimerRef.current) {
      window.clearInterval(recTimerRef.current);
      recTimerRef.current = null;
    }
    setRecording(false);
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    recorderRef.current = null;
  }
  const [flashId, setFlashId] = useState<number | null>(null);
  const [newCount, setNewCount] = useState(0);
  const typingChanRef = useRef<TypingChannel | null>(null);
  const typingTimeoutRef = useRef<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const lastMsgIdRef = useRef<number | null>(null);
  const msgRefs = useRef(new Map<number, HTMLDivElement>());
  // spring entrance only for messages that arrive AFTER the initial history
  // paint — animating the whole backlog on open was rejected as "bounce".
  // Track the max id at load so re-renders never re-class old bubbles.
  const initialMaxIdRef = useRef<number | null>(null);
  const imgInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(() => {
    chat
      .listConversation(friend.userId)
      .then(async (msgs) => {
        // Storage-backed media → decrypted data-urls BEFORE paint (per-path
        // cache makes this free on re-renders and chat switches)
        await Promise.all(
          msgs
            .filter((m) => (m.kind === 'image' || m.kind === 'voice') && media.isMediaMarker(m.text))
            .map(async (m) => {
              const marker = m.text as string;
              m.mediaMarker = marker;
              m.text = await media.resolveMedia(marker);
            }),
        );
        // decode every image BEFORE the first paint — an <img> without known
        // dimensions grows after layout and each growth was a visible "bump"
        // while the view re-anchored to the bottom
        await Promise.all(
          msgs
            .filter((m) => m.kind === 'image' && m.text)
            .map(
              (m) =>
                new Promise<void>((res) => {
                  const img = new Image();
                  img.onload = () => res();
                  img.onerror = () => res();
                  img.src = m.text as string;
                }),
            ),
        );
        // "new message" baseline comes from the FRESH fetch — never the cache.
        // Cache-based baselines made every message that arrived while the chat
        // was closed spring-animate on open (THE bump).
        if (initialMaxIdRef.current === null) {
          initialMaxIdRef.current = msgs.reduce((acc, m) => Math.max(acc, m.id), 0);
        }
        convoCache.set(friend.userId, msgs);
        setMessages(msgs);
      })
      .catch((err) => onError(String(err)));
  }, [friend.userId, onError]);

  useEffect(reload, [reload, refetchKey]);
  useEffect(() => {
    chat.markConversationRead(friend.userId);
  }, [friend.userId, refetchKey]);


  // column-reverse container: bottom = scrollTop 0 (scrolling up goes negative)
  const scrollToBottom = useCallback((smooth = false) => {
    const el = listRef.current;
    if (!el) return;
    if (smooth) el.scrollTo({ top: 0, behavior: 'smooth' });
    else el.scrollTop = 0;
  }, []);

  // the browser keeps us pinned to the bottom by itself; this only counts
  // unseen messages while the user scrolled up
  useLayoutEffect(() => {
    const last = messages?.[messages.length - 1];
    const lastId = last?.id ?? null;
    const grew = lastId !== null && lastId !== lastMsgIdRef.current;
    lastMsgIdRef.current = lastId;
    if (atBottomRef.current || (grew && last?.mine)) {
      if (grew && last?.mine) scrollToBottom();
      setNewCount(0);
    } else if (grew && last && !last.mine) {
      setNewCount((c) => c + 1);
    }
  }, [messages, peerTyping, scrollToBottom]);

  function onListScroll() {
    const el = listRef.current;
    if (!el) return;
    const atBottom = el.scrollTop > -80;
    atBottomRef.current = atBottom;
    if (atBottom) setNewCount(0);
  }

  // click anywhere outside a popover ([data-pop]) closes every floating menu
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if ((e.target as Element | null)?.closest?.('[data-pop]')) return;
      setReactFor(null);
      setMenuFor(null);
      setClipOpen(false);
      setEmojiOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  function jumpToMessage(id: number) {
    const el = msgRefs.current.get(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setFlashId(id);
    window.setTimeout(() => setFlashId((f) => (f === id ? null : f)), 1400);
  }

  useEffect(() => {
    // send-only: my keystrokes go to the FRIEND's private inbox; their typing
    // reaches me through the app-wide inbox subscription (peerTypingNow prop)
    const chan = chat.joinTyping(myUserId, friend.userId);
    typingChanRef.current = chan;
    return () => {
      chan.close();
      typingChanRef.current = null;
      if (typingTimeoutRef.current) window.clearTimeout(typingTimeoutRef.current);
    };
  }, [myUserId, friend.userId]);

  function handleSendError(r: chat.SendResult) {
    if (r === 'friend-no-key') onError(t('msg.err.oldfriend', friend.username));
    else if (r === 'no-key') onError(t('msg.err.nokey'));
    else if (r !== 'ok') onError(t('fr.err.generic'));
  }

  async function send() {
    // staged image goes out first (Discord-style: it sat in the composer)
    if (pendingImg) {
      const img = pendingImg;
      setPendingImg(null);
      // media lives in Storage (E2E-encrypted blob); the row only carries a
      // tiny marker. Upload failure falls back to the old inline data-url.
      let body = await media.uploadEncrypted(img);
      if (!body) body = await shrinkForInline(img);
      if (!body) {
        setPendingImg(img);
        onError(t('msg.img.toobig'));
        return;
      }
      const ri = await chat.sendMessage(friend.userId, 'image', body);
      if (ri === 'ok') reload();
      else {
        setPendingImg(img); // put it back so nothing is lost
        handleSendError(ri);
        return;
      }
    }
    const text = draft.trim();
    if (!text) return;
    // clear IMMEDIATELY — waiting for the server left fast typers with a
    // sent message still sitting in the box
    const reply = replyTo?.id ?? null;
    setDraft('');
    setReplyTo(null);
    const r = await chat.sendMessage(friend.userId, 'text', text, reply);
    if (r === 'ok') reload();
    else {
      setDraft(text); // give the text back on failure
      handleSendError(r);
    }
  }

  /** Discord-style: the image lands in the composer, YOU decide when it goes */
  async function stageImage(file: File | undefined) {
    setClipOpen(false);
    if (!file || !file.type.startsWith('image/')) return;
    const dataUrl = await fileToChatImage(file);
    if (!dataUrl) {
      onError(t('msg.img.toobig'));
      return;
    }
    setPendingImg(dataUrl);
    inputRef.current?.focus();
  }

  async function saveEdit() {
    if (!editing) return;
    const text = editDraft.trim();
    if (!text) return;
    const r = await chat.editMessage(editing, friend.userId, text);
    setEditing(null);
    if (r === 'ok') reload();
    else handleSendError(r);
  }

  async function react(id: number, emoji: string) {
    setReactFor(null);
    await chat.toggleReaction(id, emoji).catch(() => {});
    reload();
  }

  async function remove(id: number) {
    if (confirmDelete !== id) {
      setConfirmDelete(id);
      window.setTimeout(() => setConfirmDelete((c) => (c === id ? null : c)), 3000);
      return;
    }
    setConfirmDelete(null);
    setMenuFor(null);
    const doomed = messages?.find((m) => m.id === id);
    const err = await chat.deleteMessage(id);
    if (err) onError(err);
    else if (doomed?.mine && doomed.mediaMarker) media.deleteMedia(doomed.mediaMarker);
    reload();
  }

  const byId = new Map((messages ?? []).map((m) => [m.id, m]));

  return (
    <div
      key={friend.userId}
      className="relative flex h-full min-h-0 flex-col"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault();
      }}
      onDrop={(e) => {
        const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith('image/'));
        if (file) {
          e.preventDefault();
          stageImage(file);
        }
      }}
    >
      {/* header */}
      <div className="flex shrink-0 items-center justify-between gap-2 bg-white/[0.03] px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <button
            type="button"
            onClick={onBack}
            className="rounded-lg px-1.5 py-1 text-sm font-bold text-text-dim transition-colors hover:bg-surface-hover hover:text-text"
          >
            ←
          </button>
          <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border-2 border-border-strong bg-bg text-[11px] font-extrabold uppercase text-text">
            {friend.avatar ? (
              <img src={friend.avatar} alt="" className="h-full w-full object-cover" />
            ) : (
              friend.username.slice(0, 2)
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-bold text-text">@{friend.username}</span>
            </div>
            <div className={`truncate text-[11px] font-semibold ${statusColor}`}>
              {peerTyping ? <span className="text-accent">{t('msg.typing')}</span> : statusLine}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <div className="relative" data-pop>
            <button
              type="button"
              title={t('msg.theme')}
              onClick={() => setThemeOpen((o) => !o)}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-text-faint hover:bg-surface-hover hover:text-text"
            >
              <PaletteIcon size={15} className={theme ? 'text-accent' : undefined} />
            </button>
            {themeOpen && (
              <div className="animate-scale-in absolute right-0 top-10 z-30 flex gap-1.5 rounded-xl border-2 border-border-strong bg-surface p-2 shadow-2xl shadow-black/50">
                {CHAT_THEMES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setChatTheme(c)}
                    className={`h-6 w-6 rounded-full border-2 ${theme === c ? 'border-text' : 'border-transparent'}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
                <button
                  type="button"
                  onClick={() => setChatTheme(null)}
                  className="px-1 text-[10px] font-bold text-text-faint hover:text-text"
                >
                  ✕
                </button>
              </div>
            )}
          </div>
          {jamAction && (
            <button
              type="button"
              onClick={jamAction.run}
              className="flex shrink-0 items-center gap-1.5 rounded-full bg-accent-dim px-3.5 py-2 text-xs font-bold text-accent transition-colors hover:bg-accent/20"
            >
              <HeadphonesIcon size={13} /> {jamAction.label}
            </button>
          )}
        </div>
      </div>

      {/* pinned message bar */}
      {pinId !== null &&
        (() => {
          const pm = byId.get(pinId);
          if (!pm) return null;
          return (
            <div className="flex shrink-0 items-center gap-2 bg-surface/70 px-4 py-1.5">
              <PinIcon size={13} className="shrink-0 text-accent" />
              <button
                type="button"
                onClick={() => jumpToMessage(pinId)}
                className="min-w-0 flex-1 truncate text-left text-[12px] font-semibold text-text-dim hover:text-text"
              >
                {pm.kind === 'image'
                  ? t('msg.kind.image')
                  : pm.kind === 'voice'
                    ? t('msg.kind.voice')
                    : (pm.text ?? '🔒')}
              </button>
              <button
                type="button"
                onClick={() => setPin(null)}
                className="shrink-0 px-1 text-xs font-bold text-text-faint hover:text-text"
              >
                ✕
              </button>
            </div>
          );
        })()}

      {/* messages */}
      {/* column-reverse = the browser pins the view to the BOTTOM natively.
          No manual scroll positioning → no "conversation teleports down" jump:
          the chat is simply born at the bottom, like every real chat app. */}
      <div
        ref={listRef}
        onScroll={onListScroll}
        style={{ scrollbarGutter: 'stable' }}
        className="chat-backdrop flex min-h-0 flex-1 flex-col-reverse overflow-y-auto px-5 py-4"
      >
      <div>
        {messages === null && (
          <div className="flex justify-center py-8">
            <span className="skeleton h-5 w-48">.</span>
          </div>
        )}
        {messages?.length === 0 && (
          <div className="py-10 text-center text-sm font-semibold text-text-faint">
            {t('msg.empty', friend.username)}
          </div>
        )}
        {messages?.map((m, i) => {
          const prev = messages[i - 1];
          const next = messages[i + 1];
          const firstOfGroup = !prev || !sameBlock(prev, m);
          const lastOfGroup = !next || !sameBlock(m, next);
          const newDay = !prev || dayKeyOf(prev.created_at) !== dayKeyOf(m.created_at);
          const quoted = m.reply_to ? byId.get(m.reply_to) : null;
          const isEditing = editing?.id === m.id;
          return (
            <div key={m.id}>
            {newDay && <DaySeparator iso={m.created_at} />}
            <div
              ref={(el) => {
                if (el) msgRefs.current.set(m.id, el);
                else msgRefs.current.delete(m.id);
              }}
              className={`group flex ${m.mine ? 'justify-end' : 'justify-start'} ${
                firstOfGroup ? 'mt-4' : 'mt-1'
              } ${
                initialMaxIdRef.current !== null && m.id > initialMaxIdRef.current
                  ? 'animate-msg-in-spring'
                  : ''
              } ${flashId === m.id ? 'flash-msg rounded-2xl' : ''}`}
            >
              <div
                className={`flex max-w-[78%] items-end gap-2.5 ${m.mine ? 'flex-row-reverse' : ''}`}
              >
                {!m.mine && (
                  <div className="w-7 shrink-0">{lastOfGroup && <AvatarSm friend={friend} />}</div>
                )}

                <div className="min-w-0">
                  {m.kind === 'jam' ? (
                    <JamCard
                      m={m}
                      friend={friend}
                      friendLive={friendLive}
                      friendFocusSec={friendFocusSec}
                      inJam={inJamWithFriend}
                      onJoin={() => jamAction?.run()}
                    />
                  ) : m.kind === 'image' ? (
                    <div className="bubble-shadow overflow-hidden rounded-2xl border-2 border-border-strong">
                      {m.text ? (
                        <button
                          type="button"
                          onClick={() => setViewImg(m.text)}
                          title={t('img.open')}
                          className="block cursor-zoom-in"
                        >
                          <img
                            src={m.text}
                            alt=""
                            className="img-fade block max-h-72 max-w-[300px]"
                            onLoad={(e) => {
                              e.currentTarget.classList.add('img-loaded');
                              // image height lands after layout — re-anchor
                              // instantly so the view doesn't drift mid-open
                              if (atBottomRef.current) scrollToBottom();
                            }}
                          />
                        </button>
                      ) : (
                        <div className="bg-bg/60 px-4 py-3 text-xs italic text-text-faint">
                          🔒 {t('msg.undecryptable')}
                        </div>
                      )}
                    </div>
                  ) : m.kind === 'voice' ? (
                    <div
                      className={`bubble-shadow flex items-center gap-2 rounded-2xl px-3 py-2 ${
                        m.mine
                          ? `rounded-br-md ${theme ? '' : 'bg-white/[0.08]'}`
                          : 'rounded-bl-md bg-bg/60'
                      }`}
                      style={m.mine && theme ? { backgroundColor: theme } : undefined}
                    >
                      {m.text ? (
                        <VoicePlayer src={m.text} mine={m.mine && !!theme} />
                      ) : (
                        <span className="px-2 py-1 text-xs italic text-text-faint">
                          🔒 {t('msg.undecryptable')}
                        </span>
                      )}
                    </div>
                  ) : m.kind === 'text' && stickerOf(m.text) ? (
                    <div className="px-1 py-1">
                      <Mascot mood={stickerOf(m.text) as MascotMood} size={80} />
                      {lastOfGroup && (
                        <div className="mt-0.5 font-mono text-[11px] tabular-nums text-text-dim">
                          {timeLabel(m.created_at)}
                          {m.mine &&
                            (m.read_at ? (
                              <DoubleCheckIcon size={14} className="ml-1 inline align-[-2px] text-accent" />
                            ) : (
                              <CheckIcon size={12} className="ml-1 inline align-[-2px]" />
                            ))}
                        </div>
                      )}
                    </div>
                  ) : m.text !== null && m.kind === 'text' && !quoted && isJumbo(m.text) ? (
                    <div className="px-1 py-0.5 text-5xl leading-tight">
                      {m.text}
                      {lastOfGroup && (
                        <span className="ml-2 align-middle font-mono text-[11px] tabular-nums text-text-dim">
                          {timeLabel(m.created_at)}
                          {m.mine &&
                            (m.read_at ? (
                              <DoubleCheckIcon size={14} className="ml-1 inline align-[-2px] text-accent" />
                            ) : (
                              <CheckIcon size={12} className="ml-1 inline align-[-2px]" />
                            ))}
                        </span>
                      )}
                    </div>
                  ) : m.kind === 'status' ? (
                    (() => {
                      // body = JSON {s: status snippet, t: the reply text}
                      let snippet = '';
                      let txt = m.text ?? '';
                      try {
                        const j = JSON.parse(m.text ?? '') as { s?: string; t?: string };
                        snippet = j.s ?? '';
                        txt = j.t ?? '';
                      } catch {
                        // legacy/undecryptable — show raw
                      }
                      return (
                        <div
                          className={`bubble-shadow relative rounded-2xl px-4 py-3 text-base font-medium leading-relaxed ${
                            m.mine
                              ? 'rounded-br-md bg-white/[0.08] text-text'
                              : 'rounded-bl-md bg-bg/60 text-text'
                          }`}
                        >
                          <div
                            className="mb-1.5 rounded-lg border-l-4 border-accent/60 bg-bg/40 px-2 py-1 text-[11px] text-text-dim"
                          >
                            {t('status.reply.label')}
                            {snippet ? `: “${cleanProfanity(snippet)}”` : ''}
                          </div>
                          {txt}
                          {(lastOfGroup || m.edited_at) && (
                            <span
                              className="ml-2 align-baseline font-mono text-[11px] tabular-nums text-text-dim"
                            >
                              {timeLabel(m.created_at)}
                            </span>
                          )}
                        </div>
                      );
                    })()
                  ) : isEditing ? (
                    <div className="bubble-shadow w-72 rounded-2xl border-2 border-accent bg-surface p-2">
                      <input
                        autoFocus
                        value={editDraft}
                        onChange={(e) => setEditDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveEdit();
                          if (e.key === 'Escape') setEditing(null);
                        }}
                        className="w-full bg-transparent px-2 py-1 text-sm font-medium text-text outline-none"
                      />
                      <div className="mt-1 flex justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => setEditing(null)}
                          className="rounded-lg px-2 py-1 text-[11px] font-bold text-text-faint hover:text-text"
                        >
                          {t('misc.cancel')}
                        </button>
                        <button
                          type="button"
                          onClick={saveEdit}
                          className="rounded-lg bg-accent px-2.5 py-1 text-[11px] font-extrabold text-bg"
                        >
                          {t('bio.save')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div
                      className={`bubble-shadow relative rounded-2xl px-4 py-3 text-base font-medium leading-relaxed ${
                        m.mine
                          ? `${theme ? 'text-bg' : 'bg-white/[0.08] text-text'} ${firstOfGroup ? '' : 'rounded-tr-md'} rounded-br-md`
                          : `bg-bg/60 text-text ${firstOfGroup ? '' : 'rounded-tl-md'} rounded-bl-md`
                      }`}
                      style={m.mine && theme ? { backgroundColor: theme } : undefined}
                    >
                      {quoted && (
                        <button
                          type="button"
                          onClick={() => jumpToMessage(quoted.id)}
                          title={t('msg.jump')}
                          className={`mb-1.5 block w-full rounded-lg border-l-4 px-2 py-1 text-left text-[11px] transition-colors ${
                            m.mine && theme
                              ? 'border-bg/40 bg-bg/10 text-bg/80 hover:bg-bg/20'
                              : 'border-accent/60 bg-bg/40 text-text-dim hover:bg-bg/60'
                          }`}
                        >
                          <span className="font-bold">
                            {quoted.mine ? t('fr.me') : `@${friend.username}`}
                          </span>
                          <span className="ml-1">
                            {quoted.text === null
                              ? '🔒'
                              : quoted.kind === 'image'
                                ? '🖼'
                                : quoted.text.slice(0, 80)}
                          </span>
                        </button>
                      )}
                      {m.text === null ? (
                        <span className="text-xs italic opacity-70">
                          🔒 {t('msg.undecryptable')}
                        </span>
                      ) : (
                        linkify(m.text)
                      )}
                      {(lastOfGroup || m.edited_at) && (
                        <span
                          className={`ml-2 align-baseline font-mono text-[11px] tabular-nums ${
                            m.mine && theme ? 'text-bg/70' : 'text-text-dim'
                          }`}
                        >
                          {m.edited_at ? `${t('msg.edited')} · ` : ''}
                          {timeLabel(m.created_at)}
                          {m.mine &&
                            (m.read_at ? (
                              <DoubleCheckIcon
                                size={14}
                                className={`ml-1 inline align-[-2px] ${theme ? 'text-emerald-700' : 'text-accent'}`}
                              />
                            ) : (
                              <CheckIcon size={12} className="ml-1 inline align-[-2px]" />
                            ))}
                        </span>
                      )}
                    </div>
                  )}

                </div>

                {/* hover actions: react · reply · ⋯ */}
                <div
                  data-pop
                  className={`flex shrink-0 items-center gap-0.5 pb-1 transition-opacity duration-150 ${
                    reactFor === m.id || menuFor === m.id
                      ? 'opacity-100'
                      : 'opacity-0 group-hover:opacity-100'
                  }`}
                >
                  <div className="relative">
                    <button
                      type="button"
                      title={t('msg.react')}
                      onClick={() => {
                        setMenuFor(null);
                        setReactFor(reactFor === m.id ? null : m.id);
                      }}
                      className="rounded-lg p-1.5 text-text-faint transition-colors hover:bg-surface-hover hover:text-text"
                    >
                      <SmileIcon />
                    </button>
                    {reactFor === m.id && (
                      <div className="animate-scale-in absolute bottom-9 left-1/2 z-20 flex -translate-x-1/2 gap-1.5 rounded-full border-2 border-border-strong bg-surface px-2.5 py-1.5 shadow-xl shadow-black/50">
                        {REACTION_SET.map((e) => (
                          <button
                            key={e}
                            type="button"
                            onClick={() => react(m.id, e)}
                            className="text-xl transition-transform"
                          >
                            {e}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    title={t('msg.reply')}
                    onClick={() => setReplyTo(m)}
                    className="rounded-lg p-1.5 text-text-faint transition-colors hover:bg-surface-hover hover:text-text"
                  >
                    <ReplyIcon />
                  </button>
                  <div className="relative">
                      <button
                        type="button"
                        onClick={() => {
                          setReactFor(null);
                          setMenuFor(menuFor === m.id ? null : m.id);
                        }}
                        className="rounded-lg p-1.5 text-text-faint transition-colors hover:bg-surface-hover hover:text-text"
                      >
                        <DotsIcon size={14} />
                      </button>
                      {menuFor === m.id && (
                        <div className="animate-scale-in absolute bottom-9 right-0 z-20 w-36 rounded-xl border-2 border-border-strong bg-surface p-1 shadow-xl shadow-black/50">
                          <button
                            type="button"
                            onClick={() => {
                              setMenuFor(null);
                              setPin(pinId === m.id ? null : m.id);
                            }}
                            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-semibold text-text hover:bg-surface-hover"
                          >
                            <PinIcon size={13} />{' '}
                            {pinId === m.id ? t('msg.unpin') : t('msg.pin')}
                          </button>
                          {m.mine && chat.canEdit(m) && (
                            <button
                              type="button"
                              onClick={() => {
                                setMenuFor(null);
                                setEditing(m);
                                setEditDraft(m.text ?? '');
                              }}
                              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-semibold text-text hover:bg-surface-hover"
                            >
                              <PencilIcon /> {t('msg.edit')}
                            </button>
                          )}
                          {m.mine && (
                            <button
                              type="button"
                              onClick={() => remove(m.id)}
                              className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-semibold hover:bg-surface-hover ${
                                confirmDelete === m.id ? 'text-danger' : 'text-text'
                              }`}
                            >
                              <TrashIcon />{' '}
                              {confirmDelete === m.id ? t('misc.sure') : t('msg.delete')}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                </div>
              </div>
            </div>
            {/* reactions live OUTSIDE the avatar-aligned row so the pfp never
                gets pushed down by them */}
            {m.reactions.length > 0 && (
              <div
                className={`mt-1 flex gap-1 ${m.mine ? 'justify-end pr-1' : 'justify-start pl-10'}`}
              >
                {m.reactions.map((r) => (
                  <button
                    key={r.emoji}
                    type="button"
                    onClick={() => react(m.id, r.emoji)}
                    className={`animate-pop rounded-full border-2 px-2 py-0.5 text-[14px] transition-transform ${
                      r.mine
                        ? 'border-accent bg-accent-dim'
                        : 'border-border bg-surface hover:border-border-strong'
                    }`}
                  >
                    {r.emoji}
                    {r.count > 1 && (
                      <span className="ml-1 text-[10px] font-bold text-text-dim">{r.count}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
            </div>
          );
        })}

        {peerTyping && (
          <div className="animate-msg-in mt-4 flex items-end gap-2.5">
            <div className="w-7 shrink-0">
              <AvatarSm friend={friend} />
            </div>
            <div className="bubble-shadow rounded-2xl rounded-bl-md border-2 border-border-strong bg-surface px-4 py-3">
              <span className="flex gap-1">
                {[0, 1, 2].map((d) => (
                  <span
                    key={d}
                    className="typing-dot h-1.5 w-1.5 rounded-full bg-text-dim"
                    style={{ animationDelay: `${d * 180}ms` }}
                  />
                ))}
              </span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      </div>

      {/* scrolled up + new incoming → floating catcher */}
      {newCount > 0 && (
        <button
          type="button"
          onClick={() => {
            scrollToBottom(true);
            setNewCount(0);
          }}
          className="animate-scale-in absolute bottom-24 left-1/2 z-20 -translate-x-1/2 rounded-full border-2 border-accent bg-surface px-4 py-1.5 text-xs font-extrabold text-accent shadow-xl shadow-black/50 hover:bg-accent-dim"
        >
          ↓ {newCount} {t('msg.newbelow')}
        </button>
      )}

      {micAsk && (
        <div
          className="animate-fade-in fixed inset-0 z-[70] flex items-center justify-center bg-black/80 px-6"
          onMouseDown={(e) => e.target === e.currentTarget && setMicAsk(false)}
        >
          <div className="chunk animate-scale-in w-full max-w-sm p-6 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-dim">
              <MicIcon size={26} className="text-accent" />
            </div>
            <h2 className="mt-3 text-lg font-extrabold text-text">{t('msg.mic.title')}</h2>
            <p className="mt-1.5 text-sm font-medium leading-relaxed text-text-dim">
              {t('msg.mic.body')}
            </p>
            <button
              type="button"
              onClick={() => {
                localStorage.setItem('mic-explained', '1');
                setMicAsk(false);
                reallyStartRecording();
              }}
              className="chunk-btn chunk-btn-accent mt-4 w-full py-3 text-sm"
            >
              {t('msg.mic.cta')}
            </button>
            <button
              type="button"
              onClick={() => setMicAsk(false)}
              className="mt-2 text-xs font-bold text-text-faint hover:text-text"
            >
              {t('misc.cancel')}
            </button>
          </div>
        </div>
      )}

      {viewImg && (
        <ImageViewer
          src={viewImg}
          onClose={() => setViewImg(null)}
          onToast={(m) => pushToast(m, 'info')}
        />
      )}

      {/* staged image — sits in the composer until YOU hit send */}
      {pendingImg && (
        <div className="animate-fade-in flex shrink-0 items-center gap-3 border-t border-border bg-surface px-4 py-2.5">
          <img
            src={pendingImg}
            alt=""
            className="h-16 w-16 rounded-lg border-2 border-border-strong object-cover"
          />
          <span className="min-w-0 flex-1 truncate text-xs font-semibold text-text-dim">
            {t('msg.img.staged')}
          </span>
          <button
            type="button"
            onClick={() => setPendingImg(null)}
            className="shrink-0 rounded-lg px-2 py-1 text-sm font-bold text-text-faint hover:text-text"
          >
            ✕
          </button>
        </div>
      )}

      {/* reply bar */}
      {replyTo && (
        <div className="animate-fade-in flex shrink-0 items-center justify-between gap-2 border-t border-border bg-surface px-4 py-2">
          <div className="min-w-0 border-l-4 border-accent pl-2 text-xs">
            <span className="font-bold text-text">
              {replyTo.mine ? t('fr.me') : `@${friend.username}`}
            </span>
            <span className="ml-1.5 text-text-dim">
              {replyTo.text === null
                ? '🔒'
                : replyTo.kind === 'image'
                  ? '🖼'
                  : replyTo.text.slice(0, 90)}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setReplyTo(null)}
            className="shrink-0 text-text-faint hover:text-text"
          >
            ✕
          </button>
        </div>
      )}

      {/* composer */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="flex shrink-0 items-center bg-white/[0.03] px-4 py-3.5"
      >
        <div className="flex w-full items-center gap-1 rounded-full bg-bg/60 py-1.5 pl-1.5 pr-1.5">
        {recording ? (
          <button
            type="button"
            onClick={stopRecording}
            className="flex h-9 shrink-0 items-center gap-2 rounded-full bg-danger/15 px-3 font-mono text-xs font-extrabold tabular-nums text-danger"
          >
            <span className="h-2 w-2 animate-pulse-dot rounded-full bg-danger" />{' '}
            {fmtVoiceSec(recSec)} ■
          </button>
        ) : (
          <button
            type="button"
            onClick={startRecording}
            title={t('msg.voice.rec')}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-text-dim transition-colors hover:bg-white/5 hover:text-text"
          >
            <MicIcon size={16} />
          </button>
        )}
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            typingChanRef.current?.sendTyping();
          }}
          onPaste={(e) => {
            // Ctrl+V stages the image in the composer (send on the button)
            const file = Array.from(e.clipboardData.files).find((f) =>
              f.type.startsWith('image/'),
            );
            if (file) {
              e.preventDefault();
              stageImage(file);
            }
          }}
          placeholder={t('msg.placeholder')}
          maxLength={chat.MESSAGE_MAX_CHARS}
          autoFocus
          className="min-w-0 flex-1 bg-transparent px-2 py-2 text-[15px] font-semibold text-text placeholder:font-medium placeholder:text-text-faint focus:outline-none"
        />
        {/* clip menu: emoji / image / jam */}
        <div className="relative" data-pop>
          <button
            type="button"
            onClick={() => {
              setEmojiOpen(false);
              setClipOpen((o) => !o);
            }}
            className={`flex h-9 w-9 items-center justify-center rounded-full transition-all duration-150 ${
              clipOpen
                ? 'rotate-45 text-accent'
                : 'text-text-dim hover:bg-white/5 hover:text-text'
            }`}
          >
            <ClipIcon size={17} />
          </button>
          {clipOpen && (
            <div className="animate-scale-in absolute bottom-14 right-0 z-30 w-52 rounded-xl border-2 border-border-strong bg-surface p-1.5 shadow-2xl shadow-black/50">
              <button
                type="button"
                onClick={() => {
                  setClipOpen(false);
                  setEmojiOpen(true);
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-semibold text-text hover:bg-surface-hover"
              >
                <SmileIcon size={16} /> {t('attach.emoji')}
              </button>
              <button
                type="button"
                onClick={() => imgInputRef.current?.click()}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-semibold text-text hover:bg-surface-hover"
              >
                <ImageIcon size={16} /> {t('attach.image')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setClipOpen(false);
                  setStickerOpen(true);
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-semibold text-text hover:bg-surface-hover"
              >
                <Mascot mood="happy" size={16} effects={false} /> {t('attach.sticker')}
              </button>
              {jamAction && (
                <button
                  type="button"
                  onClick={() => {
                    setClipOpen(false);
                    jamAction.run();
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-semibold text-text hover:bg-surface-hover"
                >
                  <HeadphonesIcon size={16} /> {jamAction.label}
                </button>
              )}
            </div>
          )}
          {stickerOpen && (
            <div className="animate-scale-in absolute bottom-14 right-0 z-30 grid w-64 grid-cols-4 gap-1.5 rounded-xl border-2 border-border-strong bg-surface p-2 shadow-2xl shadow-black/50">
              {STICKER_MOODS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => sendSticker(m)}
                  className="flex items-center justify-center rounded-lg border border-border bg-bg py-2.5 transition-transform hover:border-accent"
                >
                  <Mascot mood={m} size={34} effects={false} />
                </button>
              ))}
              <button
                type="button"
                onClick={() => setStickerOpen(false)}
                className="col-span-4 mt-1 rounded-lg py-1 text-[11px] font-bold text-text-faint hover:text-text"
              >
                {t('misc.cancel')}
              </button>
            </div>
          )}
          {emojiOpen && (
            <div className="animate-scale-in absolute bottom-14 right-0 z-30 grid w-64 grid-cols-8 gap-0.5 rounded-xl border-2 border-border-strong bg-surface p-2 shadow-2xl shadow-black/50">
              {EMOJI_GRID.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => {
                    setDraft((d) => d + e);
                    inputRef.current?.focus();
                  }}
                  className="rounded-lg p-1 text-lg transition-transform hover:bg-surface-hover"
                >
                  {e}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setEmojiOpen(false)}
                className="col-span-8 mt-1 rounded-lg py-1 text-[11px] font-bold text-text-faint hover:text-text"
              >
                {t('misc.cancel')}
              </button>
            </div>
          )}
          <input
            ref={imgInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              stageImage(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>

        {/* animated slot: the pill re-lays-out smoothly as this width tweens */}
        <div
          className="shrink-0 overflow-hidden transition-[width] duration-200 ease-out"
          style={{ width: draft.trim() || pendingImg ? 42 : 0 }}
        >
          <button
            type="submit"
            disabled={!draft.trim() && !pendingImg}
            title={t('msg.send')}
            className={`ml-1 flex h-9 w-9 items-center justify-center rounded-full bg-accent text-bg transition-all duration-200 ease-out ${
              draft.trim() || pendingImg ? 'scale-100 opacity-100' : 'scale-50 opacity-0'
            }`}
            style={theme ? { backgroundColor: theme } : undefined}
          >
            <SendIcon size={15} />
          </button>
        </div>
        </div>
      </form>
    </div>
  );
}

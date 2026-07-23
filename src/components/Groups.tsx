import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as groups from '../lib/groups';
import type { GroupMessage, GroupSummary } from '../lib/groups';
import * as chat from '../lib/chat';
import type { TypingChannel } from '../lib/chat';
import * as media from '../lib/media';
import { cleanProfanity } from '../lib/filter';
import { dateLocale, t } from '../lib/i18n';
import { formatDurationShort } from '../lib/time';
import type { FriendEntry } from '../lib/social';
import { weekKey } from '../lib/social';
import {
  DotsIcon,
  HeadphonesIcon,
  ImageIcon,
  MicIcon,
  PaletteIcon,
  PencilIcon,
  PinIcon,
  ReplyIcon,
  SendIcon,
  SmileIcon,
  TargetIcon,
  TrashIcon,
} from './Icons';
import {
  CHAT_THEMES,
  DaySeparator,
  ImageViewer,
  VoicePlayer,
  fileToChatImage,
  fmtVoiceSec,
  isJumbo,
  stickerMoodOf,
  STICKER_MOODS,
} from './Chat';
import { Mascot } from './Mascot';
import type { MascotMood } from './Mascot';
import { ConfirmModal } from './Confirm';
import { useToast } from '../hooks/useToast';

const GROUP_REACTIONS = ['👍', '❤️', '😂', '🔥', '😮', '😢'];
const GROUP_EMOJIS = [
  '😀', '😂', '🥹', '😍', '😎', '🤔', '😴', '😭', '😤', '🥳',
  '👍', '👎', '👏', '🙏', '💪', '🔥', '❤️', '💯', '✨', '🎉',
  '👀', '🤝', '🫡', '☕', '🚀', '⚡', '🧠', '📚', '⏰', '🎯',
];

const GROUP_PINS_KEY = 'group-pins'; // { [groupId]: messageId }
function groupPinsMap(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(GROUP_PINS_KEY) ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
}
const GROUP_THEME_KEY = 'group-themes'; // { [groupId]: hex }
function groupThemesMap(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(GROUP_THEME_KEY) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' });
}

function MiniAvatar({ name, photo, live }: { name: string; photo: string | null; live?: boolean }) {
  return (
    <div className="relative shrink-0">
      <div
        className={`flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border-2 text-[10px] font-extrabold uppercase ${
          live ? 'border-accent text-accent' : 'border-border-strong bg-bg text-text-dim'
        }`}
      >
        {photo ? <img src={photo} alt="" className="h-full w-full object-cover" /> : name.slice(0, 2)}
      </div>
      {live && (
        <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 animate-pulse-dot rounded-full border-2 border-bg bg-accent" />
      )}
    </div>
  );
}

// ---------- create group modal ----------

export function CreateGroupModal({
  friends,
  onClose,
  onCreated,
  onError,
}: {
  friends: FriendEntry[];
  onClose: () => void;
  onCreated: (id: number) => void;
  onError: (m: string) => void;
}) {
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < groups.GROUP_MAX - 1) next.add(id);
      return next;
    });
  }

  async function create() {
    if (!name.trim() || picked.size === 0) return;
    setBusy(true);
    try {
      const id = await groups.createGroup(name, [...picked]);
      if (id) onCreated(id);
      else onError(t('fr.err.generic'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="animate-fade-in fixed inset-0 z-[60] flex items-center justify-center bg-black/80 px-6"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="chunk animate-scale-in w-full max-w-sm p-5">
        <h2 className="text-lg font-extrabold text-text">{t('grp.create.title')}</h2>
        <input
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 40))}
          placeholder={t('grp.name.placeholder')}
          autoFocus
          className="chunk-input mt-3 w-full px-3.5 py-2.5 text-sm font-bold text-text placeholder:font-medium placeholder:text-text-faint"
        />
        <div className="mt-3 text-xs font-extrabold uppercase tracking-wide text-text-dim">
          {t('grp.pick')} ({picked.size + 1}/{groups.GROUP_MAX})
        </div>
        <div className="scrollbar-none mt-2 max-h-56 space-y-1 overflow-y-auto">
          {friends.length === 0 && (
            <div className="py-4 text-center text-xs font-semibold text-text-faint">
              {t('fr.empty')}
            </div>
          )}
          {friends.map((f) => {
            const on = picked.has(f.userId);
            return (
              <button
                key={f.userId}
                type="button"
                onClick={() => toggle(f.userId)}
                className={`flex w-full items-center gap-2.5 rounded-xl border-2 px-2.5 py-2 text-left ${
                  on ? 'border-accent bg-accent-dim' : 'border-border hover:border-border-strong'
                }`}
              >
                <MiniAvatar name={f.username} photo={f.avatar} />
                <span className="min-w-0 flex-1 truncate text-sm font-bold text-text">
                  @{f.username}
                </span>
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded-md border-2 text-[11px] font-extrabold ${
                    on ? 'border-accent bg-accent text-bg' : 'border-border-strong text-transparent'
                  }`}
                >
                  ✓
                </span>
              </button>
            );
          })}
        </div>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            disabled={busy || !name.trim() || picked.size === 0}
            onClick={create}
            className="chunk-btn chunk-btn-accent flex-1 py-2.5 text-sm"
          >
            {busy ? '…' : t('grp.create.cta')}
          </button>
          <button type="button" onClick={onClose} className="chunk-btn px-4 py-2.5 text-sm text-text">
            {t('misc.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- group view (chat + members + jam) ----------

interface GroupViewProps {
  summary: GroupSummary;
  myUserId: string;
  friends: FriendEntry[];
  /** presence lookup for live dots, jam liveness + shared-timer base */
  isLive: (userId: string) => boolean;
  refetchKey: number;
  onError: (m: string) => void;
  onBack: () => void;
  /** start/join the group's jam locally (App owns the focus session) */
  onStartJam: (task: string, pomo: string | null) => void;
  onJoinJam: (task: string, startedAtIso: string, pomo: string | null) => void;
  onLeaveJam: () => void;
  /** third-column rail element — the management panel portals into it */
  railEl?: HTMLElement | null;
  /** immediate re-fetch after a mutation — realtime alone lags ~5s */
  onChanged?: () => void;
  meInJam: boolean;
  /** groupmates typing in THIS group right now (userId → last keystroke ts) */
  typing?: Map<string, number>;
}

export function GroupView({
  summary,
  myUserId,
  friends,
  isLive,
  refetchKey,
  onError,
  onBack,
  onStartJam,
  onJoinJam,
  onLeaveJam,
  meInJam,
  typing,
  railEl,
  onChanged,
}: GroupViewProps) {
  const { group, members, meAdmin } = summary;
  const [messages, setMessages] = useState<GroupMessage[] | null>(null);
  const [draft, setDraft] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(group.name);
  const [jamTaskDraft, setJamTaskDraft] = useState('');
  const [jamPomoDraft, setJamPomoDraft] = useState<string | null>(null);
  const [startingJam, setStartingJam] = useState(false);
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalDraft, setGoalDraft] = useState(group.week_goal_hours ?? 10);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmKick, setConfirmKick] = useState<{ userId: string; username: string } | null>(
    null,
  );
  const [confirmDemote, setConfirmDemote] = useState<{
    userId: string;
    username: string;
  } | null>(null);
  const { pushToast } = useToast();

  const reload = useCallback(() => {
    groups
      .listGroupMessages(group.id)
      .then(setMessages)
      .catch((err) => onError(String(err)));
  }, [group.id, onError]);

  useEffect(reload, [reload, refetchKey]);

  // ---- DM-parity scroll: column-reverse pins the view to the bottom
  // natively; scrolling up + new incoming shows the "↓ N new" catcher ----
  const listRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const lastMsgIdRef = useRef<number | null>(null);
  const [newCount, setNewCount] = useState(0);
  const msgRefs = useRef(new Map<number, HTMLDivElement>());
  const [flashId, setFlashId] = useState<number | null>(null);

  const scrollToBottom = useCallback((smooth = false) => {
    const el = listRef.current;
    if (!el) return;
    if (smooth) el.scrollTo({ top: 0, behavior: 'smooth' });
    else el.scrollTop = 0;
  }, []);

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
  }, [messages, scrollToBottom]);

  function onListScroll() {
    const el = listRef.current;
    if (!el) return;
    const atBottom = el.scrollTop > -80;
    atBottomRef.current = atBottom;
    if (atBottom) setNewCount(0);
  }

  function jumpToMessage(id: number) {
    const el = msgRefs.current.get(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setFlashId(id);
    window.setTimeout(() => setFlashId((f) => (f === id ? null : f)), 1400);
  }

  // ---- pin + theme (localStorage, per group — same model as the DM chat) ----
  const [pinId, setPinId] = useState<number | null>(() => groupPinsMap()[group.id] ?? null);
  function setPin(id: number | null) {
    const map = groupPinsMap();
    if (id === null) delete map[group.id];
    else map[group.id] = id;
    localStorage.setItem(GROUP_PINS_KEY, JSON.stringify(map));
    setPinId(id);
  }
  const [theme, setTheme] = useState<string | null>(() => groupThemesMap()[group.id] ?? null);
  const [themeOpen, setThemeOpen] = useState(false);
  function setGroupTheme(hex: string | null) {
    const map = groupThemesMap();
    if (hex === null) delete map[group.id];
    else map[group.id] = hex;
    localStorage.setItem(GROUP_THEME_KEY, JSON.stringify(map));
    setTheme(hex);
    setThemeOpen(false);
  }

  // ---- live "who's typing" (fed by the app-wide private inbox) ----
  const typingNames = [...(typing?.entries() ?? [])]
    .filter(([uid, ts]) => uid !== myUserId && Date.now() - ts < 3000)
    .map(([uid]) => members.find((mm) => mm.user_id === uid)?.username)
    .filter((u): u is string => !!u);
  const typingChanRef = useRef<TypingChannel | null>(null);
  useEffect(() => {
    const chan = chat.joinGroupTyping(
      myUserId,
      group.id,
      members.map((mm) => mm.user_id),
    );
    typingChanRef.current = chan;
    return () => {
      typingChanRef.current = null;
      chan.close();
    };
    // members roster changes are rare; key on the ids actually present
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myUserId, group.id, members.map((mm) => mm.user_id).join(',')]);

  // @mention highlight — my own name glows in group messages
  const myName = members.find((mm) => mm.user_id === myUserId)?.username ?? '';
  const renderBody = (body: string) => {
    if (!myName || !body.toLowerCase().includes(`@${myName.toLowerCase()}`)) return body;
    const parts = body.split(new RegExp(`(@${myName})`, 'ig'));
    return parts.map((p, i) =>
      p.toLowerCase() === `@${myName.toLowerCase()}` ? (
        <mark key={i} className="rounded bg-accent/30 px-0.5 font-bold text-text">
          {p}
        </mark>
      ) : (
        p
      ),
    );
  };

  // a member counts as in the jam only if in_jam AND presence says they're
  // FOCUSING now (or it's me). The flag alone desyncs on force-close (stale
  // presence) and on stop-with-app-open (fresh presence, focusing=false) —
  // cross-checking the live focusing state kills both ghost kinds.
  const jamMembers = members.filter(
    (m) => m.in_jam && (m.user_id === myUserId || isLive(m.user_id)),
  );
  // a start time with nobody actually alive inside is a ghost — treat as no
  // active jam so the "start" button shows again
  const jamActive = !!group.jam_started_at && (jamMembers.length > 0 || meInJam);
  const addable = friends.filter((f) => !members.some((m) => m.user_id === f.userId));
  const canAddMore = members.length < groups.GROUP_MAX;

  // staged image + reply + voice recording (mirrors the DM composer)
  const [pendingImg, setPendingImg] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<GroupMessage | null>(null);
  const [reactFor, setReactFor] = useState<number | null>(null);
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const [confirmDel, setConfirmDel] = useState<number | null>(null);
  const [editing, setEditing] = useState<GroupMessage | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [viewImg, setViewImg] = useState<string | null>(null);
  const [micAsk, setMicAsk] = useState(false);
  const [stickerOpen, setStickerOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recSec, setRecSec] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recChunksRef = useRef<Blob[]>([]);
  const recTimerRef = useRef<number | null>(null);
  const imgInputRef = useRef<HTMLInputElement>(null);

  // click outside any [data-pop] closes the floating pickers
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if ((e.target as Element | null)?.closest?.('[data-pop]')) return;
      setReactFor(null);
      setMenuFor(null);
      setThemeOpen(false);
      setStickerOpen(false);
      setEmojiOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  async function saveEdit() {
    if (!editing) return;
    const text = editDraft.trim();
    if (!text) return;
    const err = await groups.editGroupMessage(editing.id, text);
    setEditing(null);
    if (err) onError(err);
    reload();
  }

  async function send() {
    if (pendingImg) {
      const img = pendingImg;
      setPendingImg(null);
      const marker = await media.uploadEncrypted(img);
      if (!marker) {
        setPendingImg(img);
        onError(t('msg.img.toobig'));
        return;
      }
      const ei = await groups.sendGroupMessage(group.id, 'image', marker, replyTo?.id ?? null);
      if (ei) {
        setPendingImg(img);
        onError(ei);
        return;
      }
      setReplyTo(null);
    }
    const text = draft.trim();
    if (text) {
      const reply = replyTo?.id ?? null;
      setDraft('');
      setReplyTo(null);
      const err = await groups.sendGroupMessage(group.id, 'text', text, reply);
      if (err) {
        setDraft(text);
        onError(err);
      }
    }
    reload();
  }

  async function sendSticker(mood: MascotMood) {
    setStickerOpen(false);
    const err = await groups.sendGroupMessage(group.id, 'text', `[sticker:${mood}]`);
    if (err) onError(err);
    reload();
  }

  async function stageImage(file: File | undefined) {
    if (!file || !file.type.startsWith('image/')) return;
    const dataUrl = await fileToChatImage(file);
    if (!dataUrl) {
      onError(t('msg.img.toobig'));
      return;
    }
    setPendingImg(dataUrl);
  }

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
        const marker = await media.uploadEncrypted(dataUrl);
        if (!marker) {
          onError(t('msg.voice.toobig'));
          return;
        }
        const err = await groups.sendGroupMessage(group.id, 'voice', marker, null);
        if (err) onError(err);
        reload();
      };
      recorderRef.current = rec;
      rec.start();
      setRecording(true);
      setRecSec(0);
      recTimerRef.current = window.setInterval(() => {
        setRecSec((s) => {
          if (s + 1 >= 60) stopRecording();
          return s + 1;
        });
      }, 1000);
    } catch {
      onError(t('msg.voice.nomic'));
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

  async function react(id: number, emoji: string) {
    setReactFor(null);
    await groups.toggleGroupReaction(id, emoji).catch(() => {});
    reload();
  }

  // two-step inline confirm inside the ⋯ menu (same pattern as the DM chat)
  async function removeMsg(id: number) {
    if (confirmDel !== id) {
      setConfirmDel(id);
      window.setTimeout(() => setConfirmDel((c) => (c === id ? null : c)), 3000);
      return;
    }
    setConfirmDel(null);
    setMenuFor(null);
    const doomed = messages?.find((x) => x.id === id);
    await groups.deleteGroupMessage(id);
    if (doomed?.mine && doomed.mediaMarker) media.deleteMedia(doomed.mediaMarker);
    reload();
  }

  async function startJam() {
    const task = jamTaskDraft.trim();
    if (!task) return;
    setStartingJam(false);
    const err = await groups.startGroupJam(group.id, task, jamPomoDraft);
    if (err) return onError(err);
    onStartJam(task, jamPomoDraft);
  }

  async function joinJam() {
    if (!group.jam_task || !group.jam_started_at) return;
    await groups.setJamMembership(group.id, true);
    onJoinJam(group.jam_task, group.jam_started_at, group.jam_pomo ?? null);
  }

  async function saveWeekGoal(hours: number | null) {
    setEditingGoal(false);
    const err = await groups.setWeekGoal(group.id, hours);
    if (err) onError(err);
    else onChanged?.();
  }

  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [inviteCopied, setInviteCopied] = useState(false);

  function uploadGroupAvatar(file: File) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = async () => {
      URL.revokeObjectURL(url);
      const S = 256;
      const canvas = document.createElement('canvas');
      canvas.width = S;
      canvas.height = S;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      // center-crop square
      const side = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, S, S);
      const err = await groups.setGroupAvatar(group.id, canvas.toDataURL('image/jpeg', 0.8));
      if (err) onError(err);
      else onChanged?.();
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  }

  async function copyInvite() {
    const code = await groups.ensureInviteCode(group.id);
    if (!code) {
      onError(t('fr.err.generic'));
      return;
    }
    try {
      await navigator.clipboard.writeText(`lockedin:group/${code}`);
      setInviteCopied(true);
      window.setTimeout(() => setInviteCopied(false), 3000);
    } catch {
      onError(t('img.copy.fail'));
    }
  }

  async function leaveJam() {
    await groups.setJamMembership(group.id, false);
    await groups.maybeEndGroupJam(group.id);
    onLeaveJam();
  }

  async function doRename() {
    const err = await groups.renameGroup(group.id, nameDraft);
    setRenaming(false);
    if (err && err !== 'empty') onError(err);
    else onChanged?.();
  }

  async function kick(userId: string) {
    const err = await groups.removeMember(group.id, userId);
    if (err) onError(err);
    else onChanged?.();
  }

  async function promote(userId: string) {
    const err = await groups.promoteMember(group.id, userId);
    if (err) onError(err);
    else onChanged?.();
  }

  async function demote(userId: string) {
    const err = await groups.demoteMember(group.id, userId);
    if (err) onError(err);
    else onChanged?.();
  }

  async function add(userId: string) {
    const err = await groups.addMember(group.id, userId);
    if (err) onError(err);
    else onChanged?.();
    setShowAdd(false);
  }

  async function leave() {
    if (group.owner === myUserId) {
      await groups.deleteGroup(group.id);
    } else {
      if (meInJam) await leaveJam();
      await groups.leaveGroup(group.id);
    }
    onBack();
  }

  return (
    <div
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
            className="rounded-lg px-1.5 py-1 text-sm font-bold text-text-dim hover:bg-surface-hover hover:text-text"
          >
            ←
          </button>
          <div className="flex min-w-0 items-center gap-2 text-left">
            {/* stacked member avatars */}
            <div className="flex -space-x-2">
              {members.slice(0, 3).map((m) => (
                <div
                  key={m.user_id}
                  className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border-2 border-bg bg-surface text-[10px] font-extrabold uppercase text-text-dim"
                >
                  {m.avatar ? (
                    <img src={m.avatar} alt="" className="h-full w-full object-cover" />
                  ) : (
                    m.username.slice(0, 2)
                  )}
                </div>
              ))}
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-bold text-text">{cleanProfanity(group.name)}</div>
              <div className="text-[11px] text-text-faint">
                {t('grp.members', String(members.length))}
              </div>
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
                    onClick={() => setGroupTheme(c)}
                    className={`h-6 w-6 rounded-full border-2 ${theme === c ? 'border-text' : 'border-transparent'}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
                <button
                  type="button"
                  onClick={() => setGroupTheme(null)}
                  className="px-1 text-[10px] font-bold text-text-faint hover:text-text"
                >
                  ✕
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* jam banner */}
      <div className="shrink-0 bg-accent-dim/40 px-4 py-2.5">
        {jamActive ? (
          <div className="flex items-center gap-2.5">
            <HeadphonesIcon size={15} className="text-accent" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-bold text-text">
                {cleanProfanity(group.jam_task ?? '')}
                {group.jam_pomo && (
                  <span className="ml-2 rounded-full border border-danger/50 px-2 py-px font-mono text-[10px] font-bold text-danger">
                    {group.jam_pomo}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                <div className="flex -space-x-1.5">
                  {jamMembers.slice(0, 4).map((m) => (
                    <div
                      key={m.user_id}
                      title={`@${m.username}`}
                      className="flex h-5 w-5 items-center justify-center overflow-hidden rounded-full border border-accent bg-bg text-[8px] font-extrabold uppercase text-accent"
                    >
                      {m.avatar ? (
                        <img src={m.avatar} alt="" className="h-full w-full object-cover" />
                      ) : (
                        m.username.slice(0, 1)
                      )}
                    </div>
                  ))}
                </div>
                <span className="text-[11px] font-semibold text-accent">
                  {t('grp.jam.count', String(jamMembers.length))}
                  {group.jam_started_at &&
                    ` · ${formatDurationShort(Math.max(0, (Date.now() - new Date(group.jam_started_at).getTime()) / 1000))}`}
                </span>
              </div>
            </div>
            {meInJam ? (
              <button
                type="button"
                onClick={leaveJam}
                className="chunk-btn shrink-0 px-3 py-1.5 text-xs text-danger"
              >
                {t('grp.jam.leave')}
              </button>
            ) : (
              <button
                type="button"
                onClick={joinJam}
                className="chunk-btn chunk-btn-accent shrink-0 px-3 py-1.5 text-xs"
              >
                {t('grp.jam.join')}
              </button>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setStartingJam(true)}
            className="flex w-full items-center justify-center gap-2 py-0.5 text-[13px] font-bold text-accent"
          >
            <HeadphonesIcon size={14} /> {t('grp.jam.start')}
          </button>
        )}
      </div>

      {/* collective weekly goal — sum of the week_sec every member already
          publishes to groupmates; no new data is exposed */}
      {(group.week_goal_hours || meAdmin) && (
        <div className="shrink-0 bg-white/[0.02] px-4 py-2">
          {group.week_goal_hours ? (
            (() => {
              // ONLY time focused inside THIS group's jam counts — personal
              // solo hours stay out of the group goal
              const wkNow = weekKey();
              const doneSec = members.reduce(
                (acc, m) => acc + (m.week_key === wkNow ? (m.week_jam_sec ?? 0) : 0),
                0,
              );
              const goalSec = group.week_goal_hours * 3600;
              const frac = Math.min(1, doneSec / goalSec);
              return (
                <button
                  type="button"
                  disabled={!meAdmin}
                  onClick={() => {
                    setGoalDraft(group.week_goal_hours ?? 10);
                    setEditingGoal(true);
                  }}
                  className="block w-full text-left disabled:cursor-default"
                  title={meAdmin ? t('grp.goal.edit') : undefined}
                >
                  <div className="flex items-center justify-between text-[11px] font-bold">
                    <span className="flex items-center gap-1 text-text-dim"><TargetIcon size={11} /> {t('grp.goal.label')}</span>
                    <span className={frac >= 1 ? 'text-accent' : 'text-text-dim'}>
                      {formatDurationShort(doneSec)} / {group.week_goal_hours}h
                      {frac >= 1 ? ' ✓' : ''}
                    </span>
                  </div>
                  <div className="mt-1 h-2 w-full overflow-hidden rounded-full border border-border-strong bg-bg">
                    <div
                      className="h-full rounded-full bg-accent"
                      style={{ width: `${frac * 100}%`, transition: 'width 600ms ease' }}
                    />
                  </div>
                </button>
              );
            })()
          ) : (
            <button
              type="button"
              onClick={() => setEditingGoal(true)}
              className="text-[11px] font-bold text-text-faint hover:text-accent"
            >
              + {t('grp.goal.set')}
            </button>
          )}
        </div>
      )}

      {/* pinned message bar */}
      {pinId !== null &&
        (() => {
          const pm = messages?.find((x) => x.id === pinId);
          if (!pm) return null;
          return (
            <div className="flex shrink-0 items-center gap-2 bg-surface/70 px-4 py-1.5">
              <PinIcon size={13} className="shrink-0 text-accent" />
              <button
                type="button"
                onClick={() => jumpToMessage(pm.id)}
                className="min-w-0 flex-1 truncate text-left text-[12px] font-semibold text-text-dim hover:text-text"
              >
                <span className="font-bold">@{pm.senderName}</span>{' '}
                {pm.kind === 'image'
                  ? t('msg.kind.image')
                  : pm.kind === 'voice'
                    ? t('msg.kind.voice')
                    : (pm.body ?? '🔒')}
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

      {/* messages — column-reverse pins the view to the bottom natively */}
      <div
        ref={listRef}
        onScroll={onListScroll}
        style={{ scrollbarGutter: 'stable' }}
        className="chat-backdrop flex min-h-0 flex-1 flex-col-reverse overflow-y-auto px-5 py-4"
      >
      <div>
        {messages === null && (
          <div className="flex justify-center py-8">
            <span className="skeleton h-5 w-40">.</span>
          </div>
        )}
        {messages?.length === 0 && (
          <div className="py-8 text-center text-sm font-semibold text-text-faint">
            {t('grp.empty')}
          </div>
        )}
        {messages?.map((m, i) => {
          const prev = messages[i - 1];
          const newDay =
            !prev ||
            new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString();
          const tight =
            prev &&
            !newDay &&
            prev.sender === m.sender &&
            prev.kind === m.kind &&
            new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < 5 * 60_000;
          const firstOfGroup = !tight;
          const next = messages[i + 1];
          const lastOfGroup =
            !next ||
            next.kind === 'system' ||
            next.sender !== m.sender ||
            next.kind !== m.kind ||
            new Date(next.created_at).toDateString() !== new Date(m.created_at).toDateString() ||
            new Date(next.created_at).getTime() - new Date(m.created_at).getTime() >= 5 * 60_000;
          if (m.kind === 'system') {
            return (
              <div key={m.id}>
                {newDay && <DaySeparator iso={m.created_at} />}
                <div className="flex justify-center py-1">
                  <span className="rounded-full border border-accent/40 bg-accent-dim/40 px-3 py-0.5 text-[11px] font-bold text-accent">
                    {m.body}
                  </span>
                </div>
              </div>
            );
          }
          const quoted = m.reply_to ? messages.find((x) => x.id === m.reply_to) : null;
          const isEditing = editing?.id === m.id;
          return (
            <div key={m.id}>
              {newDay && <DaySeparator iso={m.created_at} />}
              <div
                ref={(el) => {
                  if (el) msgRefs.current.set(m.id, el);
                  else msgRefs.current.delete(m.id);
                }}
                className={`group/gmsg flex ${m.mine ? 'justify-end' : 'justify-start'} ${
                  firstOfGroup ? 'mt-4 animate-msg-in' : 'mt-1'
                } ${flashId === m.id ? 'flash-msg rounded-2xl' : ''}`}
              >
                <div
                  className={`flex max-w-[80%] items-end gap-2.5 ${m.mine ? 'flex-row-reverse' : ''}`}
                >
                  {!m.mine && (
                    <div className="w-7 shrink-0">
                      {lastOfGroup && (
                        <div className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border-2 border-border-strong bg-bg text-[10px] font-extrabold uppercase text-text">
                          {(() => {
                            const av = members.find((mm) => mm.user_id === m.sender)?.avatar;
                            return av ? (
                              <img src={av} alt="" className="h-full w-full object-cover" />
                            ) : (
                              m.senderName.slice(0, 2)
                            );
                          })()}
                        </div>
                      )}
                    </div>
                  )}
                  <div className="min-w-0">
                  {!m.mine && firstOfGroup && (
                    <div className="mb-0.5 ml-1 text-[10px] font-bold text-text-faint">
                      @{m.senderName}
                    </div>
                  )}
                  {quoted && (
                    <button
                      type="button"
                      onClick={() => jumpToMessage(quoted.id)}
                      title={t('msg.jump')}
                      className={`mb-0.5 block max-w-full truncate rounded-lg border-l-4 border-accent bg-surface-hover px-2.5 py-1 text-[11px] text-text-dim transition-colors hover:bg-surface ${
                        m.mine ? 'ml-auto text-right' : 'text-left'
                      }`}
                    >
                      <span className="font-bold">@{quoted.senderName}</span>{' '}
                      {quoted.kind === 'image'
                        ? t('msg.kind.image')
                        : quoted.kind === 'voice'
                          ? t('msg.kind.voice')
                          : (quoted.body ?? '🔒').slice(0, 80)}
                    </button>
                  )}
                  {isEditing ? (
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
                  ) : m.kind === 'text' && stickerMoodOf(m.body) ? (
                    <div className="px-1 py-1">
                      <Mascot mood={stickerMoodOf(m.body) as MascotMood} size={80} />
                    </div>
                  ) : m.kind === 'text' && m.body && !quoted && isJumbo(m.body) ? (
                    <div className="px-1 py-0.5 text-[44px] leading-tight">{m.body}</div>
                  ) : m.kind === 'image' ? (
                    <div
                      className={`bubble-shadow overflow-hidden rounded-2xl border-2 border-border-strong ${
                        m.mine ? 'rounded-br-md' : 'rounded-bl-md'
                      }`}
                    >
                      {m.body ? (
                        <button
                          type="button"
                          onClick={() => setViewImg(m.body)}
                          title={t('img.open')}
                          className="block cursor-zoom-in"
                        >
                          <img
                            src={m.body}
                            alt=""
                            className="img-fade block max-h-72 w-auto max-w-full"
                            onLoad={(e) => {
                              e.currentTarget.classList.add('img-loaded');
                              if (atBottomRef.current) scrollToBottom();
                            }}
                          />
                        </button>
                      ) : (
                        <div className="bg-surface px-4 py-3 text-xs italic text-text-faint">
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
                      {m.body ? (
                        <VoicePlayer src={m.body} mine={m.mine && !!theme} />
                      ) : (
                        <span className="px-2 py-1 text-xs italic text-text-faint">
                          🔒 {t('msg.undecryptable')}
                        </span>
                      )}
                    </div>
                  ) : (
                    <div
                      className={`bubble-shadow rounded-2xl px-4 py-3 text-base font-medium leading-relaxed ${
                        m.mine
                          ? `rounded-br-md ${theme ? 'text-bg' : 'bg-white/[0.08] text-text'} ${firstOfGroup ? '' : 'rounded-tr-md'}`
                          : `rounded-bl-md bg-bg/60 text-text ${firstOfGroup ? '' : 'rounded-tl-md'}`
                      }`}
                      style={m.mine && theme ? { backgroundColor: theme } : undefined}
                    >
                      {m.body === null ? (
                        <span className="text-xs italic opacity-70">
                          🔒 {t('msg.undecryptable')}
                        </span>
                      ) : (
                        renderBody(m.body)
                      )}
                      <span
                        className={`ml-2 align-baseline font-mono text-[11px] tabular-nums ${
                          m.mine && theme ? 'text-bg/60' : 'text-text-faint'
                        }`}
                      >
                        {m.edited_at ? `${t('msg.edited')} · ` : ''}
                        {timeLabel(m.created_at)}
                      </span>
                    </div>
                  )}
                  {m.reactions.length > 0 && (
                    <div className={`mt-1 flex gap-1 ${m.mine ? 'justify-end' : ''}`}>
                      {m.reactions.map((r) => (
                        <button
                          key={r.emoji}
                          type="button"
                          onClick={() => react(m.id, r.emoji)}
                          className={`flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[12px] ${
                            r.mine
                              ? 'border-accent bg-accent-dim'
                              : 'border-border bg-surface hover:border-border-strong'
                          }`}
                        >
                          {r.emoji}
                          {r.count > 1 && (
                            <span className="font-mono text-[10px] font-bold text-text-dim">
                              {r.count}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                  </div>

                  {/* hover actions beside the bubble: react · reply · ⋯ */}
                  <div
                    data-pop
                    className={`flex shrink-0 items-center gap-0.5 pb-1 transition-opacity duration-150 ${
                      reactFor === m.id || menuFor === m.id
                        ? 'opacity-100'
                        : 'opacity-0 group-hover/gmsg:opacity-100'
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
                          {GROUP_REACTIONS.map((em) => (
                            <button
                              key={em}
                              type="button"
                              onClick={() => react(m.id, em)}
                              className="text-xl"
                            >
                              {em}
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
                            <PinIcon size={13} /> {pinId === m.id ? t('msg.unpin') : t('msg.pin')}
                          </button>
                          {groups.canEditGroupMsg(m) && !stickerMoodOf(m.body) && (
                            <button
                              type="button"
                              onClick={() => {
                                setMenuFor(null);
                                setEditing(m);
                                setEditDraft(m.body ?? '');
                              }}
                              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-semibold text-text hover:bg-surface-hover"
                            >
                              <PencilIcon /> {t('msg.edit')}
                            </button>
                          )}
                          {m.mine && (
                            <button
                              type="button"
                              onClick={() => removeMsg(m.id)}
                              className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-semibold hover:bg-surface-hover ${
                                confirmDel === m.id ? 'text-danger' : 'text-text'
                              }`}
                            >
                              <TrashIcon />{' '}
                              {confirmDel === m.id ? t('misc.sure') : t('msg.delete')}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        {typingNames.length > 0 && (
          <div className="animate-msg-in mt-4 flex items-end gap-2.5">
            <div className="bubble-shadow rounded-2xl rounded-bl-md border-2 border-border-strong bg-surface px-4 py-3">
              <span className="flex items-center gap-2">
                <span className="flex gap-1">
                  {[0, 1, 2].map((d) => (
                    <span
                      key={d}
                      className="typing-dot h-1.5 w-1.5 rounded-full bg-text-dim"
                      style={{ animationDelay: `${d * 180}ms` }}
                    />
                  ))}
                </span>
                <span className="text-[11px] font-bold text-text-dim">
                  {typingNames.length === 1
                    ? t('grp.typing.one', typingNames[0])
                    : typingNames.length === 2
                      ? t('grp.typing.two', typingNames[0], typingNames[1])
                      : t('grp.typing.many', String(typingNames.length))}
                </span>
              </span>
            </div>
          </div>
        )}
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
          onToast={(msg) => pushToast(msg, 'info')}
        />
      )}

      {/* composer */}
      <div className="shrink-0 bg-white/[0.03]">
        {replyTo && (
          <div className="flex items-center justify-between gap-2 bg-surface px-4 py-1.5">
            <div className="min-w-0 truncate text-[11px] text-text-dim">
              <ReplyIcon size={11} className="mr-1 inline" />
              <span className="font-bold">@{replyTo.senderName}</span>{' '}
              {replyTo.kind === 'image'
                ? t('msg.kind.image')
                : replyTo.kind === 'voice'
                  ? t('msg.kind.voice')
                  : (replyTo.body ?? '').slice(0, 80)}
            </div>
            <button
              type="button"
              onClick={() => setReplyTo(null)}
              className="shrink-0 text-xs font-bold text-text-faint hover:text-text"
            >
              ✕
            </button>
          </div>
        )}
        {pendingImg && (
          <div className="flex items-center gap-3 bg-surface px-4 py-2">
            <img src={pendingImg} alt="" className="h-14 rounded-lg border border-border" />
            <button
              type="button"
              onClick={() => setPendingImg(null)}
              className="text-xs font-bold text-text-faint hover:text-danger"
            >
              ✕ {t('misc.cancel')}
            </button>
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          className="flex items-center px-4 py-3.5"
        >
          <div className="flex w-full items-center gap-1 rounded-full bg-bg/60 py-1.5 pl-2 pr-1.5">
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
          <button
            type="button"
            onClick={() => imgInputRef.current?.click()}
            title={t('attach.image')}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-text-dim transition-colors hover:bg-white/5 hover:text-text"
          >
            <ImageIcon size={16} />
          </button>
          <div data-pop className="relative shrink-0">
            <button
              type="button"
              onClick={() => {
                setStickerOpen((o) => !o);
                setEmojiOpen(false);
              }}
              title={t('attach.sticker')}
              className="flex h-9 w-9 items-center justify-center rounded-full text-text-dim transition-colors hover:bg-white/5 hover:text-text"
            >
              <HeadphonesIcon size={16} />
            </button>
            {stickerOpen && (
              <div className="animate-scale-in absolute bottom-14 left-0 z-30 grid w-64 grid-cols-4 gap-1.5 rounded-xl border-2 border-border-strong bg-surface p-2 shadow-2xl shadow-black/50">
                {STICKER_MOODS.map((mood) => (
                  <button
                    key={mood}
                    type="button"
                    onClick={() => sendSticker(mood)}
                    className="flex items-center justify-center rounded-lg border border-border bg-bg py-2.5 hover:border-accent"
                  >
                    <Mascot mood={mood} size={34} effects={false} />
                  </button>
                ))}
              </div>
            )}
          </div>
          <div data-pop className="relative shrink-0">
            <button
              type="button"
              onClick={() => {
                setEmojiOpen((o) => !o);
                setStickerOpen(false);
              }}
              title={t('attach.emoji')}
              className="flex h-9 w-9 items-center justify-center rounded-full text-text-dim transition-colors hover:bg-white/5 hover:text-text"
            >
              <SmileIcon size={16} />
            </button>
            {emojiOpen && (
              <div className="animate-scale-in absolute bottom-14 left-0 z-30 grid w-64 grid-cols-8 gap-0.5 rounded-2xl border-2 border-border-strong bg-surface p-2 shadow-2xl">
                {GROUP_EMOJIS.map((em) => (
                  <button
                    key={em}
                    type="button"
                    onClick={() => setDraft((d) => d + em)}
                    className="rounded-lg p-1 text-xl transition-transform hover:bg-surface-hover"
                  >
                    {em}
                  </button>
                ))}
              </div>
            )}
          </div>
          <input
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              typingChanRef.current?.sendTyping();
            }}
            onPaste={(e) => {
              const file = Array.from(e.clipboardData.files).find((f) =>
                f.type.startsWith('image/'),
              );
              if (file) {
                e.preventDefault();
                stageImage(file);
              }
            }}
            placeholder={t('msg.placeholder.group')}
            maxLength={2000}
            className="min-w-0 flex-1 bg-transparent px-2 py-2 text-[15px] font-semibold text-text placeholder:font-medium placeholder:text-text-faint focus:outline-none"
          />
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
            !draft.trim() &&
            !pendingImg && (
              <button
                type="button"
                onClick={startRecording}
                title={t('msg.voice.rec')}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-text-dim transition-colors hover:bg-white/5 hover:text-text"
              >
                <MicIcon size={16} />
              </button>
            )
          )}
          <button
            type="submit"
            disabled={!draft.trim() && !pendingImg}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-bg transition-all disabled:opacity-40"
            style={theme ? { backgroundColor: theme } : undefined}
          >
            <SendIcon size={15} />
          </button>
          </div>
        </form>
      </div>

      {/* start-jam modal: what to focus on + who's aboard */}
      {startingJam && (
        <div
          className="animate-fade-in fixed inset-0 z-[60] flex items-center justify-center bg-black/80 px-6"
          onMouseDown={(e) => e.target === e.currentTarget && setStartingJam(false)}
        >
          <div className="chunk animate-scale-in w-full max-w-sm p-6 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-accent-dim">
              <HeadphonesIcon size={30} className="text-accent" />
            </div>
            <h2 className="mt-3 text-lg font-extrabold text-text">{t('grp.jam.modal.title')}</h2>
            <p className="mt-1 text-xs font-medium text-text-dim">
              {t('grp.jam.modal.body', cleanProfanity(group.name))}
            </p>
            <div className="mt-3 flex justify-center -space-x-2">
              {members.slice(0, 5).map((m) => (
                <div
                  key={m.user_id}
                  title={`@${m.username}`}
                  className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border-2 border-bg bg-surface text-[10px] font-extrabold uppercase text-text-dim"
                >
                  {m.avatar ? (
                    <img src={m.avatar} alt="" className="h-full w-full object-cover" />
                  ) : (
                    m.username.slice(0, 2)
                  )}
                </div>
              ))}
            </div>
            <input
              autoFocus
              value={jamTaskDraft}
              onChange={(e) => setJamTaskDraft(e.target.value.slice(0, 120))}
              onKeyDown={(e) => e.key === 'Enter' && startJam()}
              placeholder={t('grp.jam.task')}
              className="chunk-input mt-4 w-full px-4 py-3 text-center text-[15px] font-bold text-text placeholder:font-medium placeholder:text-text-faint"
            />
            {/* optional synced pomodoro — advisory rhythm shared by everyone;
                joiners see it on the banner before hopping in */}
            <div className="mt-3 flex items-center justify-center gap-1.5">
              {([
                [null, t('grp.jam.pomo.off')],
                ['25/5', '25/5'],
                ['50/10', '50/10'],
              ] as [string | null, string][]).map(([val, label]) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setJamPomoDraft(val)}
                  className={`rounded-full border px-3 py-1 text-[11px] font-bold ${
                    jamPomoDraft === val
                      ? 'border-accent bg-accent-dim text-accent'
                      : 'border-border text-text-dim hover:border-border-strong hover:text-text'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {jamPomoDraft && (
              <p className="mt-2 text-[10px] font-medium text-text-faint">
                {t('grp.jam.pomo.hint')}
              </p>
            )}
            <button
              type="button"
              disabled={!jamTaskDraft.trim()}
              onClick={startJam}
              className="chunk-btn chunk-btn-accent glow-pulse mt-4 w-full py-3.5 text-sm disabled:animate-none"
            >
              {t('grp.jam.modal.cta')}
            </button>
            <button
              type="button"
              onClick={() => setStartingJam(false)}
              className="mt-2.5 text-xs font-bold text-text-faint hover:text-text"
            >
              {t('misc.cancel')}
            </button>
          </div>
        </div>
      )}

      {/* group management — lives in the right-hand rail (portal) */}
      {railEl &&
        createPortal(
          <div className="flex flex-col gap-4">
            {/* identity — one calm card: photo IS the change button, name IS
                the rename button (admins), invite as a small chip */}
            <div className="flex flex-col items-center gap-2 rounded-2xl bg-bg/60 p-6 text-center">
              <button
                type="button"
                disabled={!meAdmin}
                onClick={() => avatarInputRef.current?.click()}
                title={meAdmin ? t('grp.photo.set') : undefined}
                className="group/gph relative disabled:cursor-default"
              >
                <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full border border-border-strong bg-bg text-xl font-extrabold uppercase text-text-dim">
                  {group.avatar_b64 ? (
                    <img src={group.avatar_b64} alt="" className="h-full w-full object-cover" />
                  ) : (
                    cleanProfanity(group.name).slice(0, 2)
                  )}
                </div>
                {meAdmin && (
                  <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/55 text-lg opacity-0 transition-opacity group-hover/gph:opacity-100">
                    ✎
                  </span>
                )}
              </button>
              {renaming ? (
                <input
                  autoFocus
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value.slice(0, 40))}
                  onKeyDown={(e) => e.key === 'Enter' && doRename()}
                  onBlur={doRename}
                  className="w-full rounded-xl bg-bg px-3 py-1.5 text-center text-base font-extrabold text-text focus:outline-none focus:ring-1 focus:ring-accent/40"
                />
              ) : (
                <button
                  type="button"
                  disabled={!meAdmin}
                  onClick={() => {
                    setNameDraft(group.name);
                    setRenaming(true);
                  }}
                  title={meAdmin ? t('grp.rename') : undefined}
                  className="mt-1 w-full truncate text-base font-extrabold text-text disabled:cursor-default"
                >
                  {cleanProfanity(group.name)}
                  {meAdmin && <span className="ml-1.5 text-[11px] text-text-faint">✎</span>}
                </button>
              )}
              <div className="text-xs font-semibold text-text-faint">
                {t('grp.members', String(members.length))}
              </div>
              <button
                type="button"
                onClick={copyInvite}
                className="no-press mt-1 rounded-full bg-accent-dim px-3.5 py-1.5 text-[11px] font-bold text-accent transition-colors hover:bg-accent/20"
              >
                {inviteCopied ? t('grp.invite.copied') : t('grp.invite.copy')}
              </button>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) uploadGroupAvatar(f);
                }}
              />
            </div>

            {/* members — flat rows, admin actions only on hover */}
            <div className="rounded-2xl bg-bg/60 p-3">
              <div className="mb-1.5 flex items-center justify-between px-1">
                <span className="text-[10px] font-extrabold uppercase tracking-wide text-text-dim">
                  {t('grp.memberlist')}
                </span>
                {meAdmin && canAddMore && (
                  <button
                    type="button"
                    onClick={() => setShowAdd(true)}
                    title={t('grp.add')}
                    className="flex h-6 w-6 items-center justify-center rounded-full text-sm font-bold text-accent transition-colors hover:bg-accent-dim"
                  >
                    +
                  </button>
                )}
              </div>
              <div className="space-y-1">
                {members.map((m) => {
                  const isOwner = m.user_id === group.owner;
                  const canManage = meAdmin && m.user_id !== myUserId && !isOwner;
                  return (
                    <div
                      key={m.user_id}
                      className="group/mrow flex items-center gap-2.5 rounded-xl px-1.5 py-1.5 transition-colors hover:bg-white/[0.04]"
                    >
                      <MiniAvatar name={m.username} photo={m.avatar} live={isLive(m.user_id)} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-bold text-text">
                          {m.user_id === myUserId ? t('fr.me') : `@${m.username}`}
                        </div>
                        <div className="flex items-center gap-1.5 text-[10px] font-bold">
                          {isOwner ? (
                            <span className="text-accent">{t('grp.owner')}</span>
                          ) : m.is_admin ? (
                            <span className="text-sky-400">{t('grp.admin')}</span>
                          ) : (
                            <span className="text-text-faint">{t('grp.member')}</span>
                          )}
                          {m.in_jam && <HeadphonesIcon size={10} className="text-accent" />}
                        </div>
                      </div>
                      {canManage && (
                        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/mrow:opacity-100">
                          <button
                            type="button"
                            title={m.is_admin ? t('grp.demote') : t('grp.promote')}
                            onClick={() =>
                              m.is_admin
                                ? setConfirmDemote({ userId: m.user_id, username: m.username })
                                : promote(m.user_id)
                            }
                            className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-white/5 ${
                              m.is_admin ? 'text-sky-400' : 'text-text-faint hover:text-sky-400'
                            }`}
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                              <path d="M12 3 4.5 6v5c0 4.6 3.2 8.6 7.5 10 4.3-1.4 7.5-5.4 7.5-10V6z" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            title={t('grp.kick')}
                            onClick={() =>
                              setConfirmKick({ userId: m.user_id, username: m.username })
                            }
                            className="flex h-7 w-7 items-center justify-center rounded-full text-text-faint transition-colors hover:bg-danger/10 hover:text-danger"
                          >
                            ✕
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <button
              type="button"
              onClick={() => setConfirmLeave(true)}
              className="no-press rounded-full py-2 text-[13px] font-bold text-danger/80 transition-colors hover:bg-danger/10 hover:text-danger"
            >
              {group.owner === myUserId ? t('grp.delete') : t('grp.leave')}
            </button>
          </div>,
          railEl,
        )}

      {/* add-member modal — real popup, big rows */}
      {showAdd && (
        <div
          className="animate-fade-in fixed inset-0 z-[65] flex items-center justify-center bg-black/80 px-6"
          onMouseDown={(e) => e.target === e.currentTarget && setShowAdd(false)}
        >
          <div className="chunk animate-scale-in flex max-h-[70vh] w-full max-w-sm flex-col p-5">
            <h2 className="text-lg font-extrabold text-text">{t('grp.add')}</h2>
            <p className="mt-0.5 text-xs font-medium text-text-faint">
              {t('grp.pick')} ({members.length}/{groups.GROUP_MAX})
            </p>
            <div className="mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto">
              {addable.length === 0 && (
                <div className="py-6 text-center text-sm font-semibold text-text-faint">
                  {t('grp.noone')}
                </div>
              )}
              {addable.map((f) => (
                <button
                  key={f.userId}
                  type="button"
                  onClick={() => add(f.userId)}
                  className="flex w-full items-center gap-3 rounded-xl border-2 border-border px-3 py-2.5 text-left hover:border-accent hover:bg-accent-dim"
                >
                  <MiniAvatar name={f.username} photo={f.avatar} />
                  <span className="min-w-0 flex-1 truncate text-sm font-bold text-text">
                    @{f.username}
                  </span>
                  <span className="text-lg font-extrabold text-accent">+</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setShowAdd(false)}
              className="mt-3 text-xs font-bold text-text-faint hover:text-text"
            >
              {t('misc.cancel')}
            </button>
          </div>
        </div>
      )}

      {/* weekly goal modal — its own proper popup */}
      {editingGoal && (
        <div
          className="animate-fade-in fixed inset-0 z-[65] flex items-center justify-center bg-black/80 px-6"
          onMouseDown={(e) => e.target === e.currentTarget && setEditingGoal(false)}
        >
          <div className="chunk animate-scale-in w-full max-w-sm p-6 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-dim">
              <TargetIcon size={26} className="text-accent" />
            </div>
            <h2 className="mt-3 text-lg font-extrabold text-text">{t('grp.goal.label')}</h2>
            <p className="mt-1 text-xs font-medium text-text-dim">{t('grp.goal.modal.body')}</p>
            <div className="mt-4 flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => setGoalDraft(Math.max(1, goalDraft - 5))}
                className="chunk-btn h-11 w-11 text-lg text-text"
              >
                −
              </button>
              <span className="min-w-24 font-mono text-2xl font-bold tabular-nums text-text">
                {goalDraft}h
              </span>
              <button
                type="button"
                onClick={() => setGoalDraft(Math.min(500, goalDraft + 5))}
                className="chunk-btn h-11 w-11 text-lg text-text"
              >
                +
              </button>
            </div>
            <button
              type="button"
              onClick={() => saveWeekGoal(Math.max(1, Math.min(500, goalDraft)))}
              className="chunk-btn chunk-btn-accent mt-5 w-full py-3 text-sm"
            >
              {t('misc.save')}
            </button>
            {group.week_goal_hours && (
              <button
                type="button"
                onClick={() => saveWeekGoal(null)}
                className="mt-2 w-full py-1.5 text-xs font-bold text-danger hover:underline"
              >
                {t('grp.goal.remove')}
              </button>
            )}
            <button
              type="button"
              onClick={() => setEditingGoal(false)}
              className="mt-1 text-xs font-bold text-text-faint hover:text-text"
            >
              {t('misc.cancel')}
            </button>
          </div>
        </div>
      )}

      {confirmKick && (
        <ConfirmModal
          title={t('grp.kick.title')}
          body={t('grp.kick.body', confirmKick.username, group.name)}
          confirmLabel={t('grp.kick')}
          onConfirm={() => kick(confirmKick.userId)}
          onClose={() => setConfirmKick(null)}
        />
      )}
      {confirmDemote && (
        <ConfirmModal
          title={t('grp.demote.title')}
          body={t('grp.demote.body', confirmDemote.username)}
          confirmLabel={t('grp.demote')}
          onConfirm={() => demote(confirmDemote.userId)}
          onClose={() => setConfirmDemote(null)}
        />
      )}
      {confirmLeave && (
        <ConfirmModal
          title={group.owner === myUserId ? t('grp.delete.title') : t('grp.leave.title')}
          body={
            group.owner === myUserId
              ? t('grp.delete.body', group.name)
              : t('grp.leave.body', group.name)
          }
          confirmLabel={group.owner === myUserId ? t('grp.delete') : t('grp.leave')}
          onConfirm={leave}
          onClose={() => setConfirmLeave(false)}
        />
      )}
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import * as groups from '../lib/groups';
import type { GroupMessage, GroupSummary } from '../lib/groups';
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
  ReplyIcon,
  SendIcon,
  SmileIcon,
  TargetIcon,
  TrashIcon,
} from './Icons';
import {
  DaySeparator,
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

const GROUP_REACTIONS = ['👍', '❤️', '😂', '🔥', '😮', '😢'];
const GROUP_EMOJIS = [
  '😀', '😂', '🥹', '😍', '😎', '🤔', '😴', '😭', '😤', '🥳',
  '👍', '👎', '👏', '🙏', '💪', '🔥', '❤️', '💯', '✨', '🎉',
  '👀', '🤝', '🫡', '☕', '🚀', '⚡', '🧠', '📚', '⏰', '🎯',
];

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
      className="animate-fade-in fixed inset-0 z-[60] flex items-center justify-center bg-black/80 px-6 backdrop-blur-sm"
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
  meInJam: boolean;
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
}: GroupViewProps) {
  const { group, members, meAdmin } = summary;
  const [messages, setMessages] = useState<GroupMessage[] | null>(null);
  const [draft, setDraft] = useState('');
  const [showMembers, setShowMembers] = useState(false);
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
  const bottomRef = useRef<HTMLDivElement>(null);

  const reload = useCallback(() => {
    groups
      .listGroupMessages(group.id)
      .then(setMessages)
      .catch((err) => onError(String(err)));
  }, [group.id, onError]);

  useEffect(reload, [reload, refetchKey]);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

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
  const [confirmDel, setConfirmDel] = useState<number | null>(null);
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
      setStickerOpen(false);
      setEmojiOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

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

  async function removeMsg(m: GroupMessage) {
    setConfirmDel(null);
    await groups.deleteGroupMessage(m.id);
    if (m.mine && m.mediaMarker) media.deleteMedia(m.mediaMarker);
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
  }

  async function kick(userId: string) {
    const err = await groups.removeMember(group.id, userId);
    if (err) onError(err);
  }

  async function promote(userId: string) {
    const err = await groups.promoteMember(group.id, userId);
    if (err) onError(err);
  }

  async function demote(userId: string) {
    const err = await groups.demoteMember(group.id, userId);
    if (err) onError(err);
  }

  async function add(userId: string) {
    const err = await groups.addMember(group.id, userId);
    if (err) onError(err);
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
    <div className="animate-fade-in flex h-full min-h-0 flex-col">
      {/* header */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <button
            type="button"
            onClick={onBack}
            className="rounded-lg px-1.5 py-1 text-sm font-bold text-text-dim hover:bg-surface-hover hover:text-text"
          >
            ←
          </button>
          <button
            type="button"
            onClick={() => setShowMembers((s) => !s)}
            className="flex min-w-0 items-center gap-2 text-left"
          >
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
          </button>
        </div>
        <button
          type="button"
          onClick={() => setShowMembers((s) => !s)}
          className="rounded-lg p-1.5 text-text-dim hover:bg-surface-hover hover:text-text"
        >
          <DotsIcon size={16} />
        </button>
      </div>

      {/* jam banner */}
      <div className="shrink-0 border-b border-border bg-accent-dim/40 px-4 py-2.5">
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
        <div className="shrink-0 border-b border-border px-4 py-2">
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

      {/* messages */}
      <div className="chat-backdrop min-h-0 flex-1 overflow-y-auto px-5 py-4">
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
          return (
            <div key={m.id}>
              {newDay && <DaySeparator iso={m.created_at} />}
              <div
                className={`group/gmsg flex ${m.mine ? 'justify-end' : 'justify-start'} ${
                  firstOfGroup ? 'mt-4 animate-msg-in' : 'mt-1'
                }`}
              >
                <div className={`relative max-w-[80%] ${m.mine ? 'items-end' : 'items-start'}`}>
                  {!m.mine && firstOfGroup && (
                    <div className="mb-0.5 ml-1 text-[10px] font-bold text-text-faint">
                      @{m.senderName}
                    </div>
                  )}
                  {/* hover toolbar: react / reply / delete-own */}
                  <div
                    data-pop
                    className={`absolute -top-3 z-10 hidden items-center gap-0.5 rounded-lg border border-border bg-surface p-0.5 shadow-lg group-hover/gmsg:flex ${
                      m.mine ? 'right-1' : 'left-1'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setReactFor(reactFor === m.id ? null : m.id)}
                      className="rounded-md p-1 text-text-dim hover:bg-surface-hover hover:text-text"
                    >
                      <SmileIcon size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setReplyTo(m)}
                      className="rounded-md p-1 text-text-dim hover:bg-surface-hover hover:text-text"
                    >
                      <ReplyIcon size={13} />
                    </button>
                    {m.mine && (
                      <button
                        type="button"
                        onClick={() => setConfirmDel(m.id)}
                        className="rounded-md p-1 text-text-dim hover:bg-danger/20 hover:text-danger"
                      >
                        <TrashIcon size={13} />
                      </button>
                    )}
                  </div>
                  {reactFor === m.id && (
                    <div
                      data-pop
                      className={`absolute -top-12 z-20 flex gap-1 rounded-xl border border-border bg-surface p-1.5 shadow-xl ${
                        m.mine ? 'right-0' : 'left-0'
                      }`}
                    >
                      {GROUP_REACTIONS.map((em) => (
                        <button
                          key={em}
                          type="button"
                          onClick={() => react(m.id, em)}
                          className="rounded-lg px-1 text-lg transition-transform"
                        >
                          {em}
                        </button>
                      ))}
                    </div>
                  )}
                  {quoted && (
                    <div
                      className={`mb-0.5 max-w-full truncate rounded-lg border-l-4 border-accent bg-surface-hover px-2.5 py-1 text-[11px] text-text-dim ${
                        m.mine ? 'text-right' : ''
                      }`}
                    >
                      <span className="font-bold">@{quoted.senderName}</span>{' '}
                      {quoted.kind === 'image'
                        ? t('msg.kind.image')
                        : quoted.kind === 'voice'
                          ? t('msg.kind.voice')
                          : (quoted.body ?? '🔒').slice(0, 80)}
                    </div>
                  )}
                  {m.kind === 'text' && stickerMoodOf(m.body) ? (
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
                        <img src={m.body} alt="" className="max-h-72 w-auto max-w-full" />
                      ) : (
                        <div className="bg-surface px-4 py-3 text-xs italic text-text-faint">
                          🔒 {t('msg.undecryptable')}
                        </div>
                      )}
                    </div>
                  ) : m.kind === 'voice' ? (
                    <div
                      className={`bubble-shadow flex items-center gap-2 rounded-2xl border-2 border-border-strong px-3 py-2 ${
                        m.mine ? 'rounded-br-md bg-accent' : 'rounded-bl-md bg-surface'
                      }`}
                    >
                      {m.body ? (
                        <VoicePlayer src={m.body} mine={m.mine} />
                      ) : (
                        <span className="px-2 py-1 text-xs italic text-text-faint">
                          🔒 {t('msg.undecryptable')}
                        </span>
                      )}
                    </div>
                  ) : (
                    <div
                      className={`bubble-shadow rounded-2xl border-2 border-border-strong px-4 py-2.5 text-[15px] font-medium leading-relaxed ${
                        m.mine
                          ? `rounded-br-md bg-accent text-bg ${firstOfGroup ? '' : 'rounded-tr-md'}`
                          : `rounded-bl-md bg-surface text-text ${firstOfGroup ? '' : 'rounded-tl-md'}`
                      }`}
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
                          m.mine ? 'text-bg/60' : 'text-text-faint'
                        }`}
                      >
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
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* composer */}
      <div className="shrink-0 border-t border-border">
        {replyTo && (
          <div className="flex items-center justify-between gap-2 border-b border-border bg-surface px-4 py-1.5">
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
          <div className="flex items-center gap-3 border-b border-border bg-surface px-4 py-2">
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
          className="flex items-center gap-2 px-4 py-3.5"
        >
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
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border-2 border-border-strong text-text-dim transition-colors hover:border-accent hover:text-text"
          >
            <ImageIcon size={17} />
          </button>
          <div data-pop className="relative shrink-0">
            <button
              type="button"
              onClick={() => {
                setStickerOpen((o) => !o);
                setEmojiOpen(false);
              }}
              title={t('attach.sticker')}
              className="flex h-11 w-11 items-center justify-center rounded-xl border-2 border-border-strong text-text-dim transition-colors hover:border-accent hover:text-text"
            >
              <HeadphonesIcon size={17} />
            </button>
            {stickerOpen && (
              <div className="animate-scale-in absolute bottom-14 left-0 z-30 grid grid-cols-4 gap-1 rounded-2xl border-2 border-border-strong bg-surface p-2 shadow-2xl">
                {STICKER_MOODS.map((mood) => (
                  <button
                    key={mood}
                    type="button"
                    onClick={() => sendSticker(mood)}
                    className="rounded-xl p-1.5 transition-transform hover:bg-surface-hover"
                  >
                    <Mascot mood={mood} size={48} />
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
              className="flex h-11 w-11 items-center justify-center rounded-xl border-2 border-border-strong text-text-dim transition-colors hover:border-accent hover:text-text"
            >
              <SmileIcon size={17} />
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
            onChange={(e) => setDraft(e.target.value)}
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
            className="chunk-input min-w-0 flex-1 px-4 py-3 text-sm font-semibold text-text placeholder:font-medium placeholder:text-text-faint"
          />
          {recording ? (
            <button
              type="button"
              onClick={stopRecording}
              className="flex h-11 shrink-0 items-center gap-2 rounded-xl border-2 border-danger bg-danger/15 px-3 font-mono text-xs font-extrabold tabular-nums text-danger"
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
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border-2 border-border-strong text-text-dim transition-colors hover:border-accent hover:text-text"
              >
                <MicIcon size={17} />
              </button>
            )
          )}
          <button
            type="submit"
            disabled={!draft.trim() && !pendingImg}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent text-bg transition-all disabled:opacity-40"
          >
            <SendIcon size={17} />
          </button>
        </form>
      </div>

      {confirmDel !== null && (
        <ConfirmModal
          title={t('msg.delete')}
          body={t('grp.msg.delete.body')}
          confirmLabel={t('misc.delete')}
          danger
          onConfirm={() => {
            const m = messages?.find((x) => x.id === confirmDel);
            if (m) removeMsg(m);
          }}
          onClose={() => setConfirmDel(null)}
        />
      )}

      {/* start-jam modal: what to focus on + who's aboard */}
      {startingJam && (
        <div
          className="animate-fade-in fixed inset-0 z-[60] flex items-center justify-center bg-black/80 px-6 backdrop-blur-sm"
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

      {/* members drawer */}
      {showMembers && (
        <div
          className="animate-fade-in absolute inset-0 z-30 flex justify-end bg-black/50"
          onMouseDown={(e) => e.target === e.currentTarget && setShowMembers(false)}
        >
          <div className="animate-slide-in-right flex h-full w-72 flex-col border-l-2 border-border-strong bg-surface">
            <div className="flex items-center justify-between border-b border-border p-3">
              {renaming ? (
                <input
                  autoFocus
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value.slice(0, 40))}
                  onKeyDown={(e) => e.key === 'Enter' && doRename()}
                  onBlur={doRename}
                  className="chunk-input min-w-0 flex-1 px-2 py-1 text-sm font-bold text-text"
                />
              ) : (
                <button
                  type="button"
                  disabled={!meAdmin}
                  onClick={() => {
                    setNameDraft(group.name);
                    setRenaming(true);
                  }}
                  className="min-w-0 truncate text-left text-sm font-extrabold text-text disabled:cursor-default"
                  title={meAdmin ? t('grp.rename') : undefined}
                >
                  {group.name}
                  {meAdmin && <span className="ml-1.5 text-[11px] text-text-faint">✎</span>}
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowMembers(false)}
                className="shrink-0 pl-2 text-text-faint hover:text-text"
              >
                ✕
              </button>
            </div>

            {/* group identity: photo (admins upload) + invite link */}
            <div className="flex items-center gap-3 border-b border-border p-3">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl border-2 border-border-strong bg-bg text-base font-extrabold uppercase text-text-dim">
                {group.avatar_b64 ? (
                  <img src={group.avatar_b64} alt="" className="h-full w-full object-cover" />
                ) : (
                  cleanProfanity(group.name).slice(0, 2)
                )}
              </div>
              <div className="min-w-0 flex-1 space-y-1.5">
                {meAdmin && (
                  <button
                    type="button"
                    onClick={() => avatarInputRef.current?.click()}
                    className="block w-full truncate rounded-lg border border-border px-2.5 py-1.5 text-left text-[11px] font-bold text-text-dim hover:border-accent hover:text-text"
                  >
                    {t('grp.photo.set')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={copyInvite}
                  className="block w-full truncate rounded-lg border border-border px-2.5 py-1.5 text-left text-[11px] font-bold text-accent hover:border-accent"
                >
                  {inviteCopied ? t('grp.invite.copied') : t('grp.invite.copy')}
                </button>
              </div>
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

            <div className="scrollbar-none min-h-0 flex-1 space-y-1.5 overflow-y-auto p-3">
              <div className="px-1 py-1 text-[10px] font-extrabold uppercase tracking-wide text-text-dim">
                {t('grp.members', String(members.length))}
              </div>

              {members.map((m) => {
                const isOwner = m.user_id === group.owner;
                const canManage = meAdmin && m.user_id !== myUserId && !isOwner;
                return (
                  <div
                    key={m.user_id}
                    className="rounded-xl border border-border bg-bg/40 px-3 py-2.5"
                  >
                    <div className="flex items-center gap-2.5">
                      <MiniAvatar name={m.username} photo={m.avatar} live={isLive(m.user_id)} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-bold text-text">
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
                          {m.in_jam && (
                            <HeadphonesIcon size={10} className="text-accent" />
                          )}
                        </div>
                      </div>
                    </div>
                    {canManage && (
                      <div className="mt-2 flex gap-1.5">
                        {m.is_admin ? (
                          <button
                            type="button"
                            onClick={() =>
                              setConfirmDemote({ userId: m.user_id, username: m.username })
                            }
                            className="chunk-btn flex-1 py-1.5 text-[11px] font-bold text-sky-400"
                          >
                            {t('grp.demote')}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => promote(m.user_id)}
                            className="chunk-btn flex-1 py-1.5 text-[11px] font-bold text-sky-400"
                          >
                            {t('grp.promote')}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            setConfirmKick({ userId: m.user_id, username: m.username })
                          }
                          className="chunk-btn flex-1 py-1.5 text-[11px] font-bold text-danger"
                        >
                          {t('grp.kick')}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}

              {meAdmin && canAddMore && (
                <button
                  type="button"
                  onClick={() => setShowAdd(true)}
                  className="chunk-btn chunk-btn-accent w-full py-2.5 text-[13px]"
                >
                  + {t('grp.add')}
                </button>
              )}
            </div>

            <div className="border-t border-border p-3">
              <button
                type="button"
                onClick={() => setConfirmLeave(true)}
                className="chunk-btn w-full py-2.5 text-[13px] font-bold text-danger"
              >
                {group.owner === myUserId ? t('grp.delete') : t('grp.leave')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* add-member modal — real popup, big rows */}
      {showAdd && (
        <div
          className="animate-fade-in fixed inset-0 z-[65] flex items-center justify-center bg-black/80 px-6 backdrop-blur-sm"
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
          className="animate-fade-in fixed inset-0 z-[65] flex items-center justify-center bg-black/80 px-6 backdrop-blur-sm"
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

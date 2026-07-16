import { useCallback, useEffect, useRef, useState } from 'react';
import * as groups from '../lib/groups';
import type { GroupMessage, GroupSummary } from '../lib/groups';
import { cleanProfanity } from '../lib/filter';
import { dateLocale, t } from '../lib/i18n';
import { formatDurationShort } from '../lib/time';
import type { FriendEntry } from '../lib/social';
import { DotsIcon, HeadphonesIcon, SendIcon, TargetIcon } from './Icons';
import { DaySeparator } from './Chat';

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
  /** this week's published seconds for a member (0 when unknown/stale) */
  weekSecOf: (userId: string) => number;
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
  weekSecOf,
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

  async function send() {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    const err = await groups.sendGroupMessage(group.id, text);
    if (err) onError(err);
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
          {editingGoal ? (
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1 text-[11px] font-bold text-text-dim"><TargetIcon size={11} /> {t('grp.goal.label')}</span>
              <input
                type="number"
                min={1}
                max={500}
                value={goalDraft}
                onChange={(e) => setGoalDraft(Number(e.target.value))}
                className="chunk-input w-20 px-2 py-1 text-center text-xs font-bold text-text"
              />
              <span className="text-[11px] text-text-faint">h</span>
              <button
                type="button"
                onClick={() => saveWeekGoal(Math.max(1, Math.min(500, goalDraft)))}
                className="chunk-btn chunk-btn-accent px-2.5 py-1 text-[11px]"
              >
                {t('misc.save')}
              </button>
              {group.week_goal_hours && (
                <button
                  type="button"
                  onClick={() => saveWeekGoal(null)}
                  className="px-1 text-[11px] font-bold text-danger hover:underline"
                >
                  {t('grp.goal.remove')}
                </button>
              )}
              <button
                type="button"
                onClick={() => setEditingGoal(false)}
                className="px-1 text-[11px] font-bold text-text-faint hover:text-text"
              >
                {t('misc.cancel')}
              </button>
            </div>
          ) : group.week_goal_hours ? (
            (() => {
              const doneSec = members.reduce((acc, m) => acc + weekSecOf(m.user_id), 0);
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
      <div className="chat-backdrop min-h-0 flex-1 overflow-y-auto px-4 py-3">
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
          return (
            <div key={m.id}>
              {newDay && <DaySeparator iso={m.created_at} />}
              <div
                className={`flex ${m.mine ? 'justify-end' : 'justify-start'} ${
                  firstOfGroup ? 'mt-2 animate-msg-in' : 'mt-[3px]'
                }`}
              >
                <div className={`max-w-[80%] ${m.mine ? 'items-end' : 'items-start'}`}>
                  {!m.mine && firstOfGroup && (
                    <div className="mb-0.5 ml-1 text-[10px] font-bold text-text-faint">
                      @{m.senderName}
                    </div>
                  )}
                  <div
                    className={`bubble-shadow rounded-2xl border-2 border-border-strong px-3.5 py-2 text-sm font-medium leading-relaxed ${
                      m.mine
                        ? `rounded-br-md bg-accent text-bg ${firstOfGroup ? '' : 'rounded-tr-md'}`
                        : `rounded-bl-md bg-surface text-text ${firstOfGroup ? '' : 'rounded-tl-md'}`
                    }`}
                  >
                    {m.body}
                    <span
                      className={`ml-2 align-baseline font-mono text-[9px] tabular-nums ${
                        m.mine ? 'text-bg/60' : 'text-text-faint'
                      }`}
                    >
                      {timeLabel(m.created_at)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* composer */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="flex shrink-0 items-center gap-2 border-t border-border p-3"
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t('msg.placeholder.group')}
          maxLength={2000}
          className="chunk-input min-w-0 flex-1 px-4 py-3 text-sm font-semibold text-text placeholder:font-medium placeholder:text-text-faint"
        />
        <button
          type="submit"
          disabled={!draft.trim()}
          className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-bg transition-all hover:scale-105 active:scale-90 disabled:opacity-40"
        >
          <SendIcon size={17} />
        </button>
      </form>

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

            <div className="scrollbar-none min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
              <div className="flex items-center justify-between px-1 py-1">
                <span className="text-[10px] font-extrabold uppercase tracking-wide text-text-dim">
                  {t('grp.members', String(members.length))}
                </span>
                {meAdmin && canAddMore && addable.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowAdd((s) => !s)}
                    className="text-[11px] font-bold text-accent hover:underline"
                  >
                    + {t('grp.add')}
                  </button>
                )}
              </div>

              {showAdd && (
                <div className="mb-1 space-y-0.5 rounded-xl border-2 border-border-strong bg-bg p-1.5">
                  {addable.length === 0 && (
                    <div className="py-2 text-center text-[11px] text-text-faint">
                      {t('grp.noone')}
                    </div>
                  )}
                  {addable.map((f) => (
                    <button
                      key={f.userId}
                      type="button"
                      onClick={() => add(f.userId)}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-surface-hover"
                    >
                      <MiniAvatar name={f.username} photo={f.avatar} />
                      <span className="truncate text-xs font-bold text-text">@{f.username}</span>
                    </button>
                  ))}
                </div>
              )}

              {members.map((m) => {
                const isOwner = m.user_id === group.owner;
                const canManage = meAdmin && m.user_id !== myUserId && !isOwner;
                return (
                  <div
                    key={m.user_id}
                    className="group flex items-center gap-2.5 rounded-xl px-2 py-1.5 hover:bg-surface-hover"
                  >
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
                        {m.in_jam && <span className="text-accent">· 🎧</span>}
                      </div>
                    </div>
                    {canManage && (
                      <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        {!m.is_admin && (
                          <button
                            type="button"
                            title={t('grp.promote')}
                            onClick={() => promote(m.user_id)}
                            className="rounded-md px-1.5 py-0.5 text-[10px] font-bold text-sky-400 hover:bg-bg"
                          >
                            ↑adm
                          </button>
                        )}
                        <button
                          type="button"
                          title={t('grp.kick')}
                          onClick={() => kick(m.user_id)}
                          className="rounded-md px-1.5 py-0.5 text-[10px] font-bold text-danger hover:bg-bg"
                        >
                          ✕
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="border-t border-border p-2">
              {!confirmLeave ? (
                <button
                  type="button"
                  onClick={() => setConfirmLeave(true)}
                  className="chunk-btn w-full py-2 text-xs text-danger"
                >
                  {group.owner === myUserId ? t('grp.delete') : t('grp.leave')}
                </button>
              ) : (
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={leave}
                    className="chunk-btn flex-1 bg-danger py-2 text-xs font-extrabold text-white"
                  >
                    {t('fr.unfriend.yes')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmLeave(false)}
                    className="chunk-btn flex-1 py-2 text-xs text-text"
                  >
                    {t('misc.cancel')}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

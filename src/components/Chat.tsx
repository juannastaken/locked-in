import { useCallback, useEffect, useRef, useState } from 'react';
import * as chat from '../lib/chat';
import type { DecryptedMessage, TypingChannel } from '../lib/chat';
import { dateLocale, t } from '../lib/i18n';
import { formatDurationShort } from '../lib/time';
import type { FriendEntry } from '../lib/social';
import {
  ClipIcon,
  DotsIcon,
  HeadphonesIcon,
  ImageIcon,
  PencilIcon,
  ReplyIcon,
  SendIcon,
  SmileIcon,
  TrashIcon,
} from './Icons';

const REACTION_SET = ['👍', '❤️', '😂', '🔥', '👀'];
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
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' });
}

/** picked image → data-url, capped so the encrypted payload fits the row */
function fileToChatImage(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const MAX = 512;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve(null);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      for (const q of [0.72, 0.55, 0.4]) {
        const out = canvas.toDataURL('image/jpeg', q);
        if (out.length <= 110_000) return resolve(out);
      }
      resolve(null);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
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
  const joinable = !m.mine && friendLive && !inJam;
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
              ? 'bg-accent text-bg hover:scale-[1.02] active:scale-95'
              : 'cursor-default border border-border text-text-faint'
          }`}
        >
          {m.mine
            ? t('jamcard.sent')
            : inJam
              ? t('jamcard.already')
              : friendLive
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
}: ChatProps) {
  const [messages, setMessages] = useState<DecryptedMessage[] | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [replyTo, setReplyTo] = useState<DecryptedMessage | null>(null);
  const [reactFor, setReactFor] = useState<number | null>(null);
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const [editing, setEditing] = useState<DecryptedMessage | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [peerTyping, setPeerTyping] = useState(false);
  const [clipOpen, setClipOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const typingChanRef = useRef<TypingChannel | null>(null);
  const typingTimeoutRef = useRef<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const imgInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(() => {
    chat
      .listConversation(friend.userId)
      .then(setMessages)
      .catch((err) => onError(String(err)));
  }, [friend.userId, onError]);

  useEffect(reload, [reload, refetchKey]);
  useEffect(() => {
    chat.markConversationRead(friend.userId);
  }, [friend.userId, refetchKey]);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, peerTyping]);

  useEffect(() => {
    const chan = chat.joinTyping(myUserId, friend.userId, () => {
      setPeerTyping(true);
      if (typingTimeoutRef.current) window.clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = window.setTimeout(() => setPeerTyping(false), 3000);
    });
    typingChanRef.current = chan;
    return () => {
      chan.close();
      typingChanRef.current = null;
      if (typingTimeoutRef.current) window.clearTimeout(typingTimeoutRef.current);
      setPeerTyping(false);
    };
  }, [myUserId, friend.userId]);

  function handleSendError(r: chat.SendResult) {
    if (r === 'friend-no-key') onError(t('msg.err.oldfriend', friend.username));
    else if (r === 'no-key') onError(t('msg.err.nokey'));
    else if (r !== 'ok') onError(t('fr.err.generic'));
  }

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const r = await chat.sendMessage(friend.userId, 'text', text, replyTo?.id ?? null);
      if (r === 'ok') {
        setDraft('');
        setReplyTo(null);
        reload();
      } else handleSendError(r);
    } finally {
      setSending(false);
    }
  }

  async function sendImage(file: File | undefined) {
    setClipOpen(false);
    if (!file) return;
    setSending(true);
    try {
      const dataUrl = await fileToChatImage(file);
      if (!dataUrl) {
        onError(t('msg.img.toobig'));
        return;
      }
      const r = await chat.sendMessage(friend.userId, 'image', dataUrl);
      if (r === 'ok') reload();
      else handleSendError(r);
    } finally {
      setSending(false);
    }
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
    const err = await chat.deleteMessage(id);
    if (err) onError(err);
    reload();
  }

  const byId = new Map((messages ?? []).map((m) => [m.id, m]));

  return (
    <div key={friend.userId} className="animate-fade-in flex h-full min-h-0 flex-col">
      {/* header */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2.5">
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
              <span
                className="shrink-0 rounded-md border border-border px-1.5 py-0.5 text-[9px] font-bold text-text-faint"
                title={t('msg.e2e.hint')}
              >
                🔒 E2E
              </span>
            </div>
            <div className={`truncate text-[11px] font-semibold ${statusColor}`}>
              {peerTyping ? <span className="text-accent">{t('msg.typing')}</span> : statusLine}
            </div>
          </div>
        </div>
        {jamAction && (
          <button
            type="button"
            onClick={jamAction.run}
            className="chunk-btn chunk-btn-accent flex shrink-0 items-center gap-1.5 px-3.5 py-2 text-xs"
          >
            <HeadphonesIcon size={13} /> {jamAction.label}
          </button>
        )}
      </div>

      {/* messages */}
      <div className="chat-backdrop min-h-0 flex-1 space-y-1 overflow-y-auto px-4 py-3">
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
          const firstOfGroup = !prev || prev.mine !== m.mine;
          const quoted = m.reply_to ? byId.get(m.reply_to) : null;
          const isEditing = editing?.id === m.id;
          return (
            <div
              key={m.id}
              className={`group animate-msg-in flex ${m.mine ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`flex max-w-[78%] items-end gap-2 ${m.mine ? 'flex-row-reverse' : ''}`}
              >
                {!m.mine && (
                  <div className="w-7 shrink-0">{firstOfGroup && <AvatarSm friend={friend} />}</div>
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
                        <img src={m.text} alt="" className="block max-h-72 max-w-[300px]" />
                      ) : (
                        <div className="bg-surface px-4 py-3 text-xs italic text-text-faint">
                          🔒 {t('msg.undecryptable')}
                        </div>
                      )}
                    </div>
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
                      className={`bubble-shadow relative rounded-2xl border-2 px-3.5 py-2 text-sm font-medium leading-relaxed ${
                        m.mine
                          ? 'rounded-br-md border-border-strong bg-accent text-bg'
                          : 'rounded-bl-md border-border-strong bg-surface text-text'
                      }`}
                    >
                      {quoted && (
                        <div
                          className={`mb-1.5 rounded-lg border-l-4 px-2 py-1 text-[11px] ${
                            m.mine
                              ? 'border-bg/40 bg-bg/10 text-bg/80'
                              : 'border-accent/60 bg-bg/40 text-text-dim'
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
                        </div>
                      )}
                      {m.text === null ? (
                        <span className="text-xs italic opacity-70">
                          🔒 {t('msg.undecryptable')}
                        </span>
                      ) : (
                        m.text
                      )}
                      <span
                        className={`ml-2 align-baseline font-mono text-[9px] tabular-nums ${
                          m.mine ? 'text-bg/60' : 'text-text-faint'
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
                          className={`rounded-full border-2 px-2 py-0.5 text-[14px] transition-transform hover:scale-110 ${
                            r.mine
                              ? 'border-accent bg-accent-dim'
                              : 'border-border bg-surface hover:border-border-strong'
                          }`}
                        >
                          {r.emoji}
                          {r.count > 1 && (
                            <span className="ml-1 text-[10px] font-bold text-text-dim">
                              {r.count}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* hover actions: react · reply · ⋯ */}
                <div
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
                            className="text-xl transition-transform hover:scale-125"
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
                  {m.mine && (
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
                          {chat.canEdit(m) && (
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
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {peerTyping && (
          <div className="animate-msg-in flex items-end gap-2">
            <div className="w-7 shrink-0">
              <AvatarSm friend={friend} />
            </div>
            <div className="bubble-shadow rounded-2xl rounded-bl-md border-2 border-border-strong bg-surface px-4 py-2.5">
              <span className="flex gap-1">
                {[0, 1, 2].map((d) => (
                  <span
                    key={d}
                    className="h-1.5 w-1.5 animate-bounce rounded-full bg-text-dim"
                    style={{ animationDelay: `${d * 150}ms` }}
                  />
                ))}
              </span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

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
        className="flex shrink-0 items-center gap-2 border-t border-border p-3"
      >
        {/* clip menu: emoji / image / jam */}
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setEmojiOpen(false);
              setClipOpen((o) => !o);
            }}
            className={`flex h-11 w-11 items-center justify-center rounded-xl border-2 transition-all duration-150 ${
              clipOpen
                ? 'rotate-45 border-accent text-accent'
                : 'border-border-strong text-text-dim hover:border-accent hover:text-text'
            }`}
          >
            <ClipIcon size={17} />
          </button>
          {clipOpen && (
            <div className="animate-scale-in absolute bottom-14 left-0 z-30 w-52 rounded-xl border-2 border-border-strong bg-surface p-1.5 shadow-2xl shadow-black/50">
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
          {emojiOpen && (
            <div className="animate-scale-in absolute bottom-14 left-0 z-30 grid w-64 grid-cols-8 gap-0.5 rounded-xl border-2 border-border-strong bg-surface p-2 shadow-2xl shadow-black/50">
              {EMOJI_GRID.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => {
                    setDraft((d) => d + e);
                    inputRef.current?.focus();
                  }}
                  className="rounded-lg p-1 text-lg transition-transform hover:scale-125 hover:bg-surface-hover"
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
              sendImage(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>

        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            typingChanRef.current?.sendTyping();
          }}
          placeholder={t('msg.placeholder')}
          maxLength={chat.MESSAGE_MAX_CHARS}
          autoFocus
          className="chunk-input min-w-0 flex-1 px-4 py-3 text-sm font-semibold text-text placeholder:font-medium placeholder:text-text-faint"
        />
        <button
          type="submit"
          disabled={sending || !draft.trim()}
          title={t('msg.send')}
          className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-bg transition-all duration-150 hover:scale-105 hover:brightness-110 active:scale-90 disabled:scale-100 disabled:opacity-40"
        >
          <SendIcon size={17} />
        </button>
      </form>
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import * as chat from '../lib/chat';
import type { DecryptedMessage, TypingChannel } from '../lib/chat';
import { dateLocale, t } from '../lib/i18n';
import type { FriendEntry } from '../lib/social';

const REACTION_SET = ['👍', '❤️', '😂', '🔥', '👀'];

interface ChatProps {
  friend: FriendEntry;
  myUserId: string;
  /** live status line under the name (already localized) */
  statusLine: string;
  statusColor: string;
  onError: (m: string) => void;
  onBack: () => void;
  refetchKey: number;
  jamAction: { label: string; run: () => void } | null;
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' });
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

export function ChatView({
  friend,
  myUserId,
  statusLine,
  statusColor,
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
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [peerTyping, setPeerTyping] = useState(false);
  const typingChanRef = useRef<TypingChannel | null>(null);
  const typingTimeoutRef = useRef<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

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

  // typing channel: join per conversation, show dots ~3s after a peer keystroke
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
      } else if (r === 'friend-no-key') {
        onError(t('msg.err.oldfriend', friend.username));
      } else if (r === 'no-key') {
        onError(t('msg.err.nokey'));
      } else {
        onError(t('fr.err.generic'));
      }
    } finally {
      setSending(false);
    }
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
    const err = await chat.deleteMessage(id);
    if (err) onError(err);
    reload();
  }

  const byId = new Map((messages ?? []).map((m) => [m.id, m]));

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* header */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <button
            type="button"
            onClick={onBack}
            className="text-sm font-bold text-text-dim hover:text-text"
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
              {peerTyping ? (
                <span className="text-accent">{t('msg.typing')}</span>
              ) : (
                statusLine
              )}
            </div>
          </div>
        </div>
        {jamAction && (
          <button
            type="button"
            onClick={jamAction.run}
            className="chunk-btn chunk-btn-accent shrink-0 px-3.5 py-2 text-xs"
          >
            🎧 {jamAction.label}
          </button>
        )}
      </div>

      {/* messages */}
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-4 py-3">
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
          return (
            <div key={m.id} className={`group flex ${m.mine ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`flex max-w-[78%] items-end gap-2 ${m.mine ? 'flex-row-reverse' : ''}`}
              >
                {/* their photo beside the bubble (first message of a run) */}
                {!m.mine && (
                  <div className="w-7 shrink-0">{firstOfGroup && <AvatarSm friend={friend} />}</div>
                )}

                <div className="min-w-0">
                  <div
                    className={`relative rounded-2xl border-2 px-3.5 py-2 text-sm font-medium leading-relaxed ${
                      m.kind === 'jam'
                        ? 'border-accent bg-accent-dim text-accent'
                        : m.mine
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
                          {quoted.text === null ? '🔒' : quoted.text.slice(0, 80)}
                        </span>
                      </div>
                    )}
                    {m.text === null ? (
                      <span className="text-xs italic opacity-70">
                        🔒 {t('msg.undecryptable')}
                      </span>
                    ) : m.kind === 'jam' ? (
                      <span className="font-bold">🎧 {m.text}</span>
                    ) : (
                      m.text
                    )}
                    <span
                      className={`ml-2 align-baseline font-mono text-[9px] tabular-nums ${
                        m.mine && m.kind !== 'jam' ? 'text-bg/60' : 'text-text-faint'
                      }`}
                    >
                      {timeLabel(m.created_at)}
                    </span>
                  </div>

                  {/* reaction chips */}
                  {m.reactions.length > 0 && (
                    <div className={`mt-0.5 flex gap-1 ${m.mine ? 'justify-end' : ''}`}>
                      {m.reactions.map((r) => (
                        <button
                          key={r.emoji}
                          type="button"
                          onClick={() => react(m.id, r.emoji)}
                          className={`rounded-full border px-1.5 py-px text-[11px] ${
                            r.mine
                              ? 'border-accent bg-accent-dim'
                              : 'border-border bg-surface hover:border-border-strong'
                          }`}
                        >
                          {r.emoji} {r.count > 1 ? r.count : ''}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* hover actions: react · reply · delete */}
                <div
                  className={`flex shrink-0 items-center gap-0.5 pb-1 opacity-0 transition-opacity group-hover:opacity-100 ${
                    reactFor === m.id ? 'opacity-100' : ''
                  }`}
                >
                  <div className="relative">
                    <button
                      type="button"
                      title={t('msg.react')}
                      onClick={() => setReactFor(reactFor === m.id ? null : m.id)}
                      className="rounded-md px-1 text-[13px] text-text-faint hover:text-text"
                    >
                      😀
                    </button>
                    {reactFor === m.id && (
                      <div className="animate-scale-in absolute bottom-7 left-1/2 z-20 flex -translate-x-1/2 gap-1 rounded-full border-2 border-border-strong bg-surface px-2 py-1 shadow-xl shadow-black/40">
                        {REACTION_SET.map((e) => (
                          <button
                            key={e}
                            type="button"
                            onClick={() => react(m.id, e)}
                            className="text-base transition-transform hover:scale-125"
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
                    className="rounded-md px-1 text-[12px] text-text-faint hover:text-text"
                  >
                    ↩
                  </button>
                  {m.mine && (
                    <button
                      type="button"
                      onClick={() => remove(m.id)}
                      className={`rounded-md px-1 text-[11px] ${
                        confirmDelete === m.id
                          ? 'font-bold text-danger'
                          : 'text-text-faint hover:text-danger'
                      }`}
                    >
                      {confirmDelete === m.id ? t('misc.sure') : '✕'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {/* typing dots */}
        {peerTyping && (
          <div className="flex items-end gap-2">
            <div className="w-7 shrink-0">
              <AvatarSm friend={friend} />
            </div>
            <div className="rounded-2xl rounded-bl-md border-2 border-border-strong bg-surface px-4 py-2.5">
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
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border bg-surface px-4 py-2">
          <div className="min-w-0 border-l-4 border-accent pl-2 text-xs">
            <span className="font-bold text-text">
              {replyTo.mine ? t('fr.me') : `@${friend.username}`}
            </span>
            <span className="ml-1.5 text-text-dim">
              {replyTo.text === null ? '🔒' : replyTo.text.slice(0, 90)}
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
        <input
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
          className="chunk-btn chunk-btn-accent flex items-center gap-1.5 px-5 py-3 text-sm"
        >
          {sending ? '…' : `${t('msg.send')} ➤`}
        </button>
      </form>
    </div>
  );
}

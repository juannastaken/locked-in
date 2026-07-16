import { useCallback, useEffect, useRef, useState } from 'react';
import * as chat from '../lib/chat';
import type { DecryptedMessage } from '../lib/chat';
import * as e2e from '../lib/e2e';
import { dateLocale, t } from '../lib/i18n';
import type { FriendEntry } from '../lib/social';

interface ChatProps {
  friend: FriendEntry;
  onError: (m: string) => void;
  onBack: () => void;
  /** bumped by the app when a realtime message for this conversation lands */
  refetchKey: number;
  /** send a jam invite from inside the chat (visibility decided by caller) */
  jamAction: { label: string; run: () => void } | null;
  onOpenBackup: () => void;
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' });
}

export function ChatView({ friend, onError, onBack, refetchKey, jamAction, onOpenBackup }: ChatProps) {
  const [messages, setMessages] = useState<DecryptedMessage[] | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [backedUp, setBackedUp] = useState(true);
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
    e2e.hasCloudBackup().then((b) => setBackedUp(b)).catch(() => {});
  }, []);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const r = await chat.sendMessage(friend.userId, 'text', text);
      if (r === 'ok') {
        setDraft('');
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
          <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border-2 border-border-strong bg-bg text-[11px] font-extrabold uppercase text-text">
            {friend.avatar ? (
              <img src={friend.avatar} alt="" className="h-full w-full object-cover" />
            ) : (
              friend.username.slice(0, 2)
            )}
          </div>
          <span className="truncate text-sm font-bold text-text">@{friend.username}</span>
          <span
            className="shrink-0 rounded-md border border-border px-1.5 py-0.5 text-[10px] font-bold text-text-faint"
            title={t('msg.e2e.hint')}
          >
            🔒 E2E
          </span>
        </div>
        {jamAction && (
          <button
            type="button"
            onClick={jamAction.run}
            className="chunk-btn shrink-0 px-3 py-1.5 text-xs text-text"
          >
            🎧 {jamAction.label}
          </button>
        )}
      </div>

      {/* backup nag — losing this device without a backup = losing history */}
      {!backedUp && (
        <button
          type="button"
          onClick={onOpenBackup}
          className="shrink-0 border-b border-warn/40 bg-warn/10 px-4 py-2 text-left text-[11px] font-bold text-warn hover:bg-warn/15"
        >
          ⚠ {t('msg.backup.nag')}
        </button>
      )}

      {/* messages */}
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-4 py-3">
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
        {messages?.map((m) => (
          <div key={m.id} className={`group flex ${m.mine ? 'justify-end' : 'justify-start'}`}>
            <div className={`flex max-w-[78%] items-end gap-1.5 ${m.mine ? 'flex-row-reverse' : ''}`}>
              <div
                className={`rounded-2xl border-2 px-3.5 py-2 text-sm font-medium leading-relaxed ${
                  m.kind === 'jam'
                    ? 'border-accent bg-accent-dim text-accent'
                    : m.mine
                      ? 'border-border-strong bg-accent text-bg'
                      : 'border-border-strong bg-surface text-text'
                }`}
              >
                {m.text === null ? (
                  <span className="text-xs italic opacity-70">🔒 {t('msg.undecryptable')}</span>
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
              {m.mine && (
                <button
                  type="button"
                  onClick={() => remove(m.id)}
                  className={`pb-1 text-[10px] transition-opacity ${
                    confirmDelete === m.id
                      ? 'font-bold text-danger opacity-100'
                      : 'text-text-faint opacity-0 hover:text-danger group-hover:opacity-100'
                  }`}
                >
                  {confirmDelete === m.id ? t('misc.sure') : '✕'}
                </button>
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* composer */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="flex shrink-0 gap-2 border-t border-border p-3"
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t('msg.placeholder')}
          maxLength={chat.MESSAGE_MAX_CHARS}
          autoFocus
          className="chunk-input min-w-0 flex-1 px-3.5 py-2.5 text-sm font-semibold text-text placeholder:font-medium placeholder:text-text-faint"
        />
        <button
          type="submit"
          disabled={sending || !draft.trim()}
          className="chunk-btn chunk-btn-accent px-4 py-2.5 text-sm"
        >
          {sending ? '…' : t('msg.send')}
        </button>
      </form>
    </div>
  );
}

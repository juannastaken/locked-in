import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import * as db from '../lib/db';
import { setLang, t } from '../lib/i18n';
import { formatDurationShort } from '../lib/time';
import type { BlockerState } from '../types';
import { Mascot } from './Mascot';

const INITIAL: BlockerState = {
  usedSec: 0,
  allowanceSec: 30 * 60,
  focusToNextSec: 60 * 60,
  bonusMin: 30,
  snoozesLeft: 3,
};

export function Blocker() {
  const [s, setS] = useState<BlockerState>(INITIAL);
  const [closing, setClosing] = useState(false);

  async function closeInsta() {
    setClosing(true);
    // rust finds the instagram window, focuses it, sends Ctrl+W;
    // the watcher hides this screen a moment later
    await invoke<boolean>('close_insta_tab').catch(() => false);
    window.setTimeout(() => setClosing(false), 3000);
  }

  useEffect(() => {
    db.getAllSettings()
      .then((cfg) => setLang(cfg.language === 'pt' ? 'pt' : 'en'))
      .catch(() => {});
    let unlisten: (() => void) | undefined;
    listen<BlockerState>('blocker:state', (e) => setS(e.payload)).then((u) => {
      unlisten = u;
    });
    return () => unlisten?.();
  }, []);

  async function snooze() {
    // rust decrements the counter and hides this window
    const left = await invoke<number>('insta_snooze').catch(() => 0);
    setS((prev) => ({ ...prev, snoozesLeft: left }));
  }

  async function goFocus() {
    const main = await WebviewWindow.getByLabel('main');
    await main?.show();
    await main?.setFocus();
  }

  return (
    <div className="relative flex h-screen w-screen flex-col items-center justify-center gap-7 overflow-hidden bg-bg px-8 text-center">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(circle 63vh at 50% 42%, color-mix(in srgb, var(--color-accent) 6.5%, transparent), transparent 72%)',
        }}
        aria-hidden
      />
      <div className="cascade relative flex flex-col items-center gap-7">
        <Mascot mood="sad" size={140} />

        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-text">{t('bl.title')}</h1>
          <p className="mx-auto mt-2.5 max-w-md text-sm font-medium leading-relaxed text-text-dim">
            {t('bl.body.a')}{' '}
            <span className="font-bold tabular-nums text-text">
              {formatDurationShort(s.usedSec)}
            </span>{' '}
            {t('bl.body.b')}{' '}
            <span className="font-bold tabular-nums text-text">
              {formatDurationShort(s.allowanceSec)}
            </span>{' '}
            {t('bl.body.c')}
          </p>
        </div>

        <div className="w-full max-w-sm rounded-2xl border bg-surface p-5">
          <div className="text-xs font-extrabold uppercase tracking-wide text-text-faint">
            {t('bl.earn')}
          </div>
          <div className="mt-2 text-sm font-medium text-text">
            {t('bl.earn.a')}{' '}
            <span className="text-lg font-extrabold tabular-nums text-accent">
              {formatDurationShort(s.focusToNextSec)}
            </span>{' '}
            {t('bl.earn.b')}{' '}
            <span className="font-extrabold text-accent">+{s.bonusMin}min</span>
          </div>
        </div>

        <div className="flex flex-col items-center gap-3">
          <div className="flex gap-2.5">
            <button
              type="button"
              onClick={closeInsta}
              disabled={closing}
              className="no-press rounded-xl bg-white/[0.06] px-6 py-3 text-sm font-bold text-text-dim transition-colors hover:bg-white/10 hover:text-text disabled:opacity-50"
            >
              {closing ? t('bl.closing') : t('bl.close')}
            </button>
            <button
              type="button"
              onClick={goFocus}
              className="rounded-xl bg-accent px-6 py-3 text-sm font-extrabold text-bg"
            >
              {t('bl.focus')}
            </button>
          </div>
          {s.snoozesLeft > 0 ? (
            <button
              type="button"
              onClick={snooze}
              className="text-xs font-semibold text-text-faint transition-colors hover:text-text-dim"
            >
              {t('bl.snooze', s.snoozesLeft)}
            </button>
          ) : (
            <span className="text-xs font-semibold text-text-faint">{t('bl.snooze.out')}</span>
          )}
        </div>

        <p className="text-[11px] font-medium text-text-faint">{t('bl.hint')}</p>
      </div>
    </div>
  );
}

// Canvas Mode — an embedded Excalidraw: infinite Figma-style canvas to plan
// anything. Draw, boxes, arrows, text, paste/drag images — all in one window.
// The scene autosaves to APPCONFIG/canvas.json through Rust.

import { useEffect, useRef, useState } from 'react';
import { Excalidraw, serializeAsJSON } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import * as db from '../lib/db';
import { setLang, t } from '../lib/i18n';

const RESIZE_EDGES: { dir: string; className: string }[] = [
  { dir: 'East', className: 'right-0 top-2 bottom-2 w-1.5 cursor-e-resize' },
  { dir: 'South', className: 'bottom-0 left-2 right-2 h-1.5 cursor-s-resize' },
  { dir: 'West', className: 'left-0 top-2 bottom-2 w-1.5 cursor-w-resize' },
  { dir: 'North', className: 'top-8 left-2 right-2 h-1 cursor-n-resize' },
  { dir: 'SouthEast', className: 'bottom-0 right-0 h-3 w-3 cursor-se-resize' },
  { dir: 'SouthWest', className: 'bottom-0 left-0 h-3 w-3 cursor-sw-resize' },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Scene = any;

export function CanvasMode() {
  const [initialData, setInitialData] = useState<Scene | null>(null);
  const [ready, setReady] = useState(false);
  const [pinned, setPinned] = useState(true);
  const [lang, setLangState] = useState<'pt' | 'en'>('pt');
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    db.getAllSettings()
      .then((s) => {
        const l = s.language === 'pt' ? 'pt' : 'en';
        setLang(l);
        setLangState(l);
      })
      .catch(() => {});
    invoke<string>('load_canvas')
      .then((raw) => {
        if (raw) {
          try {
            const scene = JSON.parse(raw);
            // collaborators from a serialized scene break restore — drop them
            if (scene?.appState) delete scene.appState.collaborators;
            setInitialData(scene);
          } catch {
            setInitialData(null);
          }
        }
      })
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function onChange(elements: any, appState: any, files: any) {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      try {
        const json = serializeAsJSON(elements, appState, files ?? {}, 'local');
        invoke('save_canvas', { data: json }).catch(() => {});
      } catch {
        // serialization hiccup — next change tries again
      }
    }, 1200);
  }

  function togglePin() {
    const next = !pinned;
    setPinned(next);
    getCurrentWindow().setAlwaysOnTop(next).catch(() => {});
  }

  function closeBoard() {
    emit('refboard:closed').catch(() => {});
    getCurrentWindow().hide().catch(() => {});
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden border border-border-strong bg-bg">
      <div
        data-tauri-drag-region
        className="flex h-8 shrink-0 items-center justify-between border-b border-border bg-surface px-2.5"
      >
        <div data-tauri-drag-region className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          <span data-tauri-drag-region className="text-[11px] font-semibold text-text">
            {t('canvas.title')}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={togglePin}
            title={t('ref.pin')}
            className={`flex h-5 w-6 items-center justify-center rounded text-[11px] ${
              pinned ? 'bg-accent-dim text-accent' : 'text-text-faint hover:text-text'
            }`}
          >
            📌
          </button>
          <button
            type="button"
            onClick={closeBoard}
            title={t('ref.close')}
            className="flex h-5 w-6 items-center justify-center rounded text-[13px] text-text-faint hover:bg-danger/15 hover:text-danger"
          >
            ×
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {ready && (
          <Excalidraw
            theme="dark"
            langCode={lang === 'en' ? 'en' : 'pt-BR'}
            initialData={initialData}
            onChange={onChange}
          />
        )}
      </div>

      {RESIZE_EDGES.map((edge) => (
        <div
          key={edge.dir}
          className={`absolute z-[10000] ${edge.className}`}
          onPointerDown={(e) => {
            e.preventDefault();
            getCurrentWindow()
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              .startResizeDragging(edge.dir as any)
              .catch(() => {});
          }}
        />
      ))}
    </div>
  );
}

export default CanvasMode;

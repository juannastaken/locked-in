import { useCallback, useEffect, useRef, useState } from 'react';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import * as db from '../lib/db';
import { setLang, t } from '../lib/i18n';
import type { RefImage } from '../types';

type DragState =
  | { kind: 'move'; id: number; startX: number; startY: number; origX: number; origY: number }
  | {
      kind: 'resize';
      id: number;
      startX: number;
      origW: number;
      origH: number;
      ratio: number;
    }
  | null;

const RESIZE_EDGES: { dir: string; className: string }[] = [
  { dir: 'East', className: 'right-0 top-2 bottom-2 w-1.5 cursor-e-resize' },
  { dir: 'South', className: 'bottom-0 left-2 right-2 h-1.5 cursor-s-resize' },
  { dir: 'West', className: 'left-0 top-2 bottom-2 w-1.5 cursor-w-resize' },
  { dir: 'North', className: 'top-8 left-2 right-2 h-1 cursor-n-resize' },
  { dir: 'SouthEast', className: 'bottom-0 right-0 h-3 w-3 cursor-se-resize' },
  { dir: 'SouthWest', className: 'bottom-0 left-0 h-3 w-3 cursor-sw-resize' },
];

export function Refboard() {
  const [images, setImages] = useState<RefImage[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [pinned, setPinned] = useState(false);
  const [dropHint, setDropHint] = useState(false);
  const dragRef = useRef<DragState>(null);
  const imagesRef = useRef(images);
  imagesRef.current = images;

  const reload = useCallback(() => {
    db.listRefImages().then(setImages).catch(() => {});
  }, []);

  useEffect(() => {
    db.getAllSettings()
      .then((s) => setLang(s.language === 'en' ? 'en' : 'pt'))
      .catch(() => {});
    reload();
  }, [reload]);

  // native file drag & drop from the OS
  useEffect(() => {
    const win = getCurrentWebviewWindow();
    let unlisten: (() => void) | undefined;
    win
      .onDragDropEvent(async (event) => {
        const payload = event.payload;
        if (payload.type === 'enter' || payload.type === 'over') {
          setDropHint(true);
          return;
        }
        if (payload.type === 'leave') {
          setDropHint(false);
          return;
        }
        if (payload.type !== 'drop') return;
        setDropHint(false);
        const scale = window.devicePixelRatio || 1;
        let dropX = payload.position.x / scale;
        let dropY = payload.position.y / scale;
        const current = imagesRef.current;
        let z = current.reduce((m, i) => Math.max(m, i.z), 0);
        for (const path of payload.paths) {
          try {
            const stored = await invoke<string>('import_ref_image', { src: path });
            const { w, h } = await measure(stored);
            z += 1;
            const id = await db.addRefImage(stored, dropX, dropY, w, h, z);
            setImages((prev) => [
              ...prev,
              { id, file: stored, x: dropX, y: dropY, w, h, z, created_at: '' },
            ]);
            dropX += 28;
            dropY += 28;
          } catch {
            // not an image / copy failed — skip this file
          }
        }
      })
      .then((u) => {
        unlisten = u;
      });
    return () => unlisten?.();
  }, []);

  function measure(path: string): Promise<{ w: number; h: number }> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const max = 320;
        const ratio = img.naturalWidth / Math.max(1, img.naturalHeight);
        const w = Math.min(max, img.naturalWidth || max);
        resolve({ w, h: w / Math.max(0.05, ratio) });
      };
      img.onerror = () => resolve({ w: 240, h: 240 });
      img.src = convertFileSrc(path);
    });
  }

  // ---- image move / resize ----
  function bringToFront(id: number) {
    const maxZ = imagesRef.current.reduce((m, i) => Math.max(m, i.z), 0);
    const img = imagesRef.current.find((i) => i.id === id);
    if (!img || img.z === maxZ) return;
    setImages((prev) => prev.map((i) => (i.id === id ? { ...i, z: maxZ + 1 } : i)));
    db.updateRefImage(id, { z: maxZ + 1 }).catch(() => {});
  }

  function sendToBack(id: number) {
    const minZ = imagesRef.current.reduce((m, i) => Math.min(m, i.z), 1);
    setImages((prev) => prev.map((i) => (i.id === id ? { ...i, z: minZ - 1 } : i)));
    db.updateRefImage(id, { z: minZ - 1 }).catch(() => {});
  }

  async function removeImage(id: number) {
    const img = imagesRef.current.find((i) => i.id === id);
    if (!img) return;
    setImages((prev) => prev.filter((i) => i.id !== id));
    setSelected(null);
    db.deleteRefImage(id).catch(() => {});
    invoke('delete_ref_image', { path: img.file }).catch(() => {});
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (selected === null) return;
      if (e.key === 'Delete' || e.key === 'Backspace') removeImage(selected);
      if (e.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  function onImagePointerDown(e: React.PointerEvent, img: RefImage) {
    e.preventDefault();
    e.stopPropagation();
    setSelected(img.id);
    bringToFront(img.id);
    dragRef.current = {
      kind: 'move',
      id: img.id,
      startX: e.clientX,
      startY: e.clientY,
      origX: img.x,
      origY: img.y,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onResizePointerDown(e: React.PointerEvent, img: RefImage) {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = {
      kind: 'resize',
      id: img.id,
      startX: e.clientX,
      origW: img.w,
      origH: img.h,
      ratio: img.w / Math.max(1, img.h),
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.kind === 'move') {
      const x = drag.origX + (e.clientX - drag.startX);
      const y = drag.origY + (e.clientY - drag.startY);
      setImages((prev) => prev.map((i) => (i.id === drag.id ? { ...i, x, y } : i)));
    } else {
      const w = Math.max(48, drag.origW + (e.clientX - drag.startX));
      const h = w / Math.max(0.05, drag.ratio);
      setImages((prev) => prev.map((i) => (i.id === drag.id ? { ...i, w, h } : i)));
    }
  }

  function onPointerUp() {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    const img = imagesRef.current.find((i) => i.id === drag.id);
    if (!img) return;
    if (drag.kind === 'move') db.updateRefImage(img.id, { x: img.x, y: img.y }).catch(() => {});
    else db.updateRefImage(img.id, { w: img.w, h: img.h }).catch(() => {});
  }

  async function togglePin() {
    const next = !pinned;
    setPinned(next);
    getCurrentWindow().setAlwaysOnTop(next).catch(() => {});
  }

  function closeBoard() {
    // closing the board turns the setting off — reopen from Settings
    emit('refboard:closed').catch(() => {});
    getCurrentWindow().hide().catch(() => {});
  }

  const selectedImg = images.find((i) => i.id === selected) ?? null;

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden border border-border-strong bg-bg">
      {/* title bar */}
      <div
        data-tauri-drag-region
        className="flex h-8 shrink-0 items-center justify-between border-b border-border bg-surface px-2.5"
      >
        <div data-tauri-drag-region className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          <span data-tauri-drag-region className="text-[11px] font-semibold text-text">
            {t('ref.title')}
          </span>
          <span data-tauri-drag-region className="text-[10px] text-text-faint">
            {images.length > 0 ? images.length : ''}
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

      {/* canvas */}
      <div
        className="relative min-h-0 flex-1 overflow-hidden"
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerDown={() => setSelected(null)}
      >
        {images.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1.5">
            <span className="text-2xl opacity-40">🖼️</span>
            <span className="text-xs text-text-faint">{t('ref.empty')}</span>
          </div>
        )}

        {[...images]
          .sort((a, b) => a.z - b.z)
          .map((img) => (
            <div
              key={img.id}
              className="absolute select-none"
              style={{ left: img.x, top: img.y, width: img.w, height: img.h, zIndex: 10 + img.z }}
              onPointerDown={(e) => onImagePointerDown(e, img)}
            >
              <img
                src={convertFileSrc(img.file)}
                alt=""
                draggable={false}
                className={`h-full w-full object-fill ${
                  selected === img.id ? 'ring-2 ring-accent' : ''
                }`}
              />
              {selected === img.id && (
                <div
                  onPointerDown={(e) => onResizePointerDown(e, img)}
                  className="absolute -bottom-1.5 -right-1.5 h-4 w-4 cursor-se-resize rounded-sm border border-bg bg-accent"
                />
              )}
            </div>
          ))}

        {/* floating toolbar for the selection */}
        {selectedImg && (
          <div
            className="absolute z-[9999] flex items-center gap-1 rounded-lg border border-border bg-surface/95 px-1.5 py-1 shadow-lg shadow-black/40"
            style={{
              left: Math.max(4, selectedImg.x),
              top: Math.max(36, selectedImg.y - 34),
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => bringToFront(selectedImg.id)}
              className="rounded px-2 py-0.5 text-[11px] text-text-dim hover:bg-surface-hover hover:text-text"
            >
              {t('ref.front')}
            </button>
            <button
              type="button"
              onClick={() => sendToBack(selectedImg.id)}
              className="rounded px-2 py-0.5 text-[11px] text-text-dim hover:bg-surface-hover hover:text-text"
            >
              {t('ref.back')}
            </button>
            <button
              type="button"
              onClick={() => removeImage(selectedImg.id)}
              className="rounded px-2 py-0.5 text-[11px] text-danger hover:bg-danger/15"
            >
              {t('ref.delete')}
            </button>
          </div>
        )}

        {dropHint && (
          <div className="pointer-events-none absolute inset-1 z-[9998] flex items-center justify-center rounded-xl border-2 border-dashed border-accent bg-accent-dim">
            <span className="text-sm font-semibold text-accent">{t('ref.drop')}</span>
          </div>
        )}
      </div>

      {/* window resize grips (undecorated window) */}
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

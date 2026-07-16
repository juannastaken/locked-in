// Week share card — a 1200×675 PNG drawn entirely by hand on canvas, in the
// app's visual identity: near-black bg, lime accent, mono numbers and the
// pixel mascot. Built to be thrown into a Discord group and cause envy.

import { t } from './i18n';

export interface WeekCardData {
  weekLabel: string;
  /** already-translated subtitle under the big number */
  subtitle: string;
  totalSec: number;
  /** days in the range (7 for weeks, 28–31 for months); empty label = no tick */
  days: { label: string; sec: number; isToday: boolean }[];
  bestDayLabel: string | null;
  bestDaySec: number;
  blocks: number;
  avgRating: number | null;
  goalStreakDays: number;
  vsAvgPct: number | null;
  goalHitDays: number;
  userName: string;
}

const BG = '#0a0a0b';
const SURFACE = '#141416';
const BORDER = '#2a2a2e';
const TEXT = '#ededef';
const DIM = '#8a8a93';
const FAINT = '#55555e';
const ACCENT = '#d4ff3f';

// the mascot, happy, at rest (14 cols × 11 rows)
const MASCOT = [
  '......BB......',
  '....BBBBBB....',
  '..BBBBBBBBBB..',
  '.BBBBBBBBBBBB.',
  '.BBDDBBBBDDBB.',
  '.BBDDBBBBDDBB.',
  '.BBBDDDDDDBBB.',
  '..BBBBBBBBBB..',
  '..BBBBBBBBBB..',
  '.BB.BB..BB.BB.',
  '.BB.BB..BB.BB.',
];

function fmt(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h === 0) return `${m}min`;
  if (m === 0) return `${h}h`;
  return `${h}h${String(m).padStart(2, '0')}`;
}

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function drawMascot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  px: number,
  sparkles: boolean,
) {
  for (let row = 0; row < MASCOT.length; row++) {
    for (let col = 0; col < MASCOT[row].length; col++) {
      const ch = MASCOT[row][col];
      if (ch === '.') continue;
      ctx.fillStyle = ch === 'B' ? ACCENT : BG;
      ctx.fillRect(x + col * px, y + row * px, px + 0.5, px + 0.5);
    }
  }
  if (sparkles) {
    ctx.fillStyle = ACCENT;
    ctx.font = '28px "Inter Variable", sans-serif';
    ctx.fillText('✦', x - 26, y + 14);
    ctx.font = '18px "Inter Variable", sans-serif';
    ctx.fillText('✦', x + 14 * px + 8, y - 6);
  }
}

export async function generateWeekCard(d: WeekCardData): Promise<Blob> {
  await document.fonts.ready;

  const W = 1200;
  const H = 675;
  const S = 2; // supersample for crisp output
  const canvas = document.createElement('canvas');
  canvas.width = W * S;
  canvas.height = H * S;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(S, S);

  const mono = '"JetBrains Mono Variable", ui-monospace, monospace';
  const sans = '"Inter Variable", system-ui, sans-serif';

  // ---- background ----
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.78, -60, 0, W * 0.78, -60, 620);
  glow.addColorStop(0, 'rgba(212,255,63,0.10)');
  glow.addColorStop(1, 'rgba(212,255,63,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // pixel-dust texture, bottom-left corner
  ctx.fillStyle = 'rgba(212,255,63,0.05)';
  for (let gx = 0; gx < 9; gx++) {
    for (let gy = 0; gy < 6; gy++) {
      if ((gx * 7 + gy * 13) % 4 === 0) {
        ctx.fillRect(34 + gx * 18, H - 130 + gy * 18, 7, 7);
      }
    }
  }

  // card frame
  ctx.strokeStyle = BORDER;
  ctx.lineWidth = 2;
  rr(ctx, 14, 14, W - 28, H - 28, 26);
  ctx.stroke();
  // accent hairline along the top
  const hair = ctx.createLinearGradient(60, 0, W - 60, 0);
  hair.addColorStop(0, 'rgba(212,255,63,0)');
  hair.addColorStop(0.5, 'rgba(212,255,63,0.75)');
  hair.addColorStop(1, 'rgba(212,255,63,0)');
  ctx.fillStyle = hair;
  ctx.fillRect(60, 14, W - 120, 2);

  // ---- header ----
  ctx.fillStyle = ACCENT;
  ctx.fillRect(64, 62, 10, 10);
  ctx.font = `600 22px ${mono}`;
  ctx.fillStyle = TEXT;
  ctx.fillText('LOCKED IN', 88, 73);
  ctx.font = `400 20px ${mono}`;
  ctx.fillStyle = FAINT;
  ctx.fillText(`· ${d.weekLabel.toLowerCase()}`, 88 + ctx.measureText('LOCKED IN').width + 62, 73);

  // ---- the big number ----
  ctx.font = `700 148px ${mono}`;
  ctx.fillStyle = ACCENT;
  ctx.shadowColor = 'rgba(212,255,63,0.35)';
  ctx.shadowBlur = 42;
  ctx.fillText(fmt(d.totalSec), 60, 268);
  ctx.shadowBlur = 0;
  ctx.font = `400 26px ${sans}`;
  ctx.fillStyle = DIM;
  ctx.fillText(d.subtitle, 66, 316);

  // vs average pill
  if (d.vsAvgPct !== null) {
    const label = `${d.vsAvgPct >= 0 ? '▲ +' : '▼ '}${d.vsAvgPct}% ${t('card.vsavg')}`;
    ctx.font = `600 20px ${mono}`;
    const tw = ctx.measureText(label).width;
    const up = d.vsAvgPct >= 0;
    ctx.fillStyle = up ? 'rgba(212,255,63,0.12)' : 'rgba(251,191,36,0.10)';
    rr(ctx, 64, 340, tw + 36, 42, 21);
    ctx.fill();
    ctx.fillStyle = up ? ACCENT : '#fbbf24';
    ctx.fillText(label, 82, 368);
  }

  // ---- stat chips ----
  const chips: { label: string; value: string }[] = [
    {
      label: t('card.bestday'),
      value: d.bestDayLabel ? `${d.bestDayLabel} · ${fmt(d.bestDaySec)}` : '—',
    },
    { label: t('card.blocks'), value: String(d.blocks) },
    { label: t('card.focus'), value: d.avgRating !== null ? `★ ${d.avgRating.toFixed(1)}` : '—' },
    {
      label: t('card.streak'),
      value: d.goalStreakDays > 0 ? `🔥 ${d.goalStreakDays}` : '—',
    },
  ];
  let cx = 64;
  const cy = 430;
  for (const chip of chips) {
    ctx.font = `600 24px ${mono}`;
    const vw = ctx.measureText(chip.value).width;
    ctx.font = `400 15px ${sans}`;
    const lw = ctx.measureText(chip.label.toUpperCase()).width;
    const w = Math.max(vw, lw) + 44;
    ctx.fillStyle = SURFACE;
    rr(ctx, cx, cy, w, 84, 16);
    ctx.fill();
    ctx.strokeStyle = BORDER;
    ctx.lineWidth = 1.5;
    rr(ctx, cx, cy, w, 84, 16);
    ctx.stroke();
    ctx.fillStyle = FAINT;
    ctx.font = `600 13px ${sans}`;
    ctx.fillText(chip.label.toUpperCase(), cx + 22, cy + 30);
    ctx.fillStyle = TEXT;
    ctx.font = `600 25px ${mono}`;
    ctx.fillText(chip.value, cx + 22, cy + 64);
    cx += w + 16;
  }

  // ---- right side: mascot over the week bars ----
  const chartX = 820;
  const chartW = 316;
  const chartY = 420;
  const chartH = 150;
  const px = 13;
  const mascotW = 14 * px;
  const hype = d.vsAvgPct !== null ? d.vsAvgPct >= 0 : d.goalHitDays >= 3;
  drawMascot(ctx, chartX + chartW / 2 - mascotW / 2, 160, px, hype);

  const maxSec = Math.max(1, ...d.days.map((x) => x.sec));
  const n = d.days.length;
  const gap = n > 10 ? 4 : 13;
  const barW = (chartW - (n - 1) * gap) / n;
  const radius = Math.min(7, barW / 2);
  d.days.forEach((day, i) => {
    const bh = Math.max(day.sec > 0 ? 6 : 4, (day.sec / maxSec) * chartH);
    const bx = chartX + i * (barW + gap);
    const by = chartY + chartH - bh;
    const grad = ctx.createLinearGradient(0, by, 0, by + bh);
    if (day.sec > 0) {
      grad.addColorStop(0, day.isToday ? ACCENT : 'rgba(212,255,63,0.82)');
      grad.addColorStop(1, 'rgba(212,255,63,0.25)');
      ctx.fillStyle = grad;
    } else {
      ctx.fillStyle = '#1c1c20';
    }
    rr(ctx, bx, by, barW, bh, radius);
    ctx.fill();
    if (day.label) {
      ctx.fillStyle = day.isToday ? ACCENT : FAINT;
      ctx.font = `500 ${n > 10 ? 12 : 15}px ${mono}`;
      const lw = ctx.measureText(day.label).width;
      ctx.fillText(day.label, bx + barW / 2 - lw / 2, chartY + chartH + 28);
    }
  });

  // ---- footer ----
  ctx.strokeStyle = BORDER;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(64, H - 62);
  ctx.lineTo(W - 64, H - 62);
  ctx.stroke();
  ctx.font = `500 17px ${sans}`;
  ctx.fillStyle = DIM;
  ctx.fillText(d.userName ? `${d.userName} 🔒` : '🔒 locked in', 64, H - 30);
  ctx.font = `400 16px ${mono}`;
  ctx.fillStyle = FAINT;
  const url = 'github.com/JuanArtxz/locked-in';
  ctx.fillText(url, W - 64 - ctx.measureText(url).width, H - 30);

  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas toBlob failed'))), 'image/png');
  });
}

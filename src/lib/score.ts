// Daily productivity score, 0–100. Local rules, no AI:
//   60% — goal progress (focused seconds vs the daily goal, capped)
//   25% — purity (share of mirror time NOT spent on distraction apps)
//   15% — average focus rating of the day (unrated days get a neutral 3★)
// App categories reuse the lists the user already curates: the auto-track
// whitelist = productive, the nudge watchlist = distraction.

import * as db from './db';
import { parseAppUsage } from './apps';
import { localDayKey } from './time';

export interface DayScore {
  score: number;
  goalPart: number;
  purityPart: number;
  ratingPart: number;
  focusedSec: number;
  distractionSec: number;
  mirrorSec: number;
}

function parseList(csv: string): string[] {
  return csv
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export async function computeDayScore(
  dayKey: string,
  dailyGoalHours: number,
  nudgeApps: string,
): Promise<DayScore> {
  const sinceIso = new Date(Date.now() - 2 * 86_400_000).toISOString();
  const sessions = await db.listSessions({ fromIso: sinceIso, limit: 500 });
  const distractions = parseList(nudgeApps);

  let focusedSec = 0;
  let mirrorSec = 0;
  let distractionSec = 0;
  let ratingSum = 0;
  let ratingCount = 0;

  for (const s of sessions) {
    if (localDayKey(new Date(s.started_at)) !== dayKey) continue;
    focusedSec += s.duration_sec ?? 0;
    if (s.focus_rating != null) {
      ratingSum += s.focus_rating;
      ratingCount++;
    }
    for (const a of parseAppUsage(s.app_usage)) {
      mirrorSec += a.sec;
      const lower = a.name.toLowerCase();
      if (distractions.some((d) => lower.includes(d) || d.includes(lower))) {
        distractionSec += a.sec;
      }
    }
  }

  const goalFrac = Math.min(1, focusedSec / Math.max(1, dailyGoalHours * 3600));
  const purityFrac = mirrorSec > 0 ? 1 - distractionSec / mirrorSec : 1;
  const ratingFrac = (ratingCount > 0 ? ratingSum / ratingCount : 3) / 5;

  const goalPart = Math.round(goalFrac * 60);
  const purityPart = Math.round(purityFrac * 25);
  const ratingPart = Math.round(ratingFrac * 15);

  return {
    score: Math.max(0, Math.min(100, goalPart + purityPart + ratingPart)),
    goalPart,
    purityPart,
    ratingPart,
    focusedSec,
    distractionSec,
    mirrorSec,
  };
}

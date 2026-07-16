import Database from '@tauri-apps/plugin-sql';
import type {
  Break,
  EndSessionInput,
  HourlyLog,
  NewSession,
  ProjectBreakdown,
  Session,
  Settings,
} from '../types';
import { clipIntervals, intervalsOverlapSec, localMidnightMs, nowIso } from './time';

const DB_URL = 'sqlite:locked-in.db';

let dbPromise: Promise<Database> | null = null;

function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = Database.load(DB_URL).catch((err) => {
      dbPromise = null;
      console.error('[db] failed to load database', err);
      throw err;
    });
  }
  return dbPromise;
}

async function run<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.error(`[db] ${label} failed`, err);
    throw err;
  }
}

// ---------- sessions ----------

export async function createSession(input: NewSession): Promise<Session> {
  return run('createSession', async () => {
    const db = await getDb();
    const startedAt = nowIso();
    const result = await db.execute(
      `INSERT INTO sessions (task, project, started_at, mode, last_heartbeat_at)
       VALUES ($1, $2, $3, $4, $3)`,
      [input.task, input.project, startedAt, input.mode],
    );
    const session = await getSessionById(result.lastInsertId as number);
    if (!session) throw new Error('createSession: session not found after insert');
    return session;
  });
}

export async function getSessionById(id: number): Promise<Session | null> {
  return run('getSessionById', async () => {
    const db = await getDb();
    const rows = await db.select<Session[]>('SELECT * FROM sessions WHERE id = $1', [id]);
    return rows[0] ?? null;
  });
}

export async function getActiveSession(): Promise<Session | null> {
  return run('getActiveSession', async () => {
    const db = await getDb();
    const rows = await db.select<Session[]>(
      `SELECT * FROM sessions WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1`,
    );
    return rows[0] ?? null;
  });
}

export async function heartbeatSession(id: number): Promise<void> {
  return run('heartbeatSession', async () => {
    const db = await getDb();
    await db.execute('UPDATE sessions SET last_heartbeat_at = $1 WHERE id = $2', [
      nowIso(),
      id,
    ]);
  });
}

export interface SessionTelemetry {
  appUsage: Record<string, number>;
  afkSec: number;
  afkIntervals: [string, string][];
  /** closed pause periods (already clipped to the session) */
  pauseIntervals?: [string, string][];
}

export async function endSession(
  id: number,
  durationSec: number,
  input: EndSessionInput,
  endedAt?: string,
  telemetry?: SessionTelemetry,
): Promise<void> {
  return run('endSession', async () => {
    const db = await getDb();
    await db.execute(
      `UPDATE sessions
       SET ended_at = $1, duration_sec = $2, focus_rating = $3, notes = $4,
           app_usage = $5, afk_sec = $6, afk_intervals = $7
       WHERE id = $8`,
      [
        endedAt ?? nowIso(),
        durationSec,
        input.focus_rating,
        input.notes,
        telemetry && Object.keys(telemetry.appUsage).length > 0
          ? JSON.stringify(telemetry.appUsage)
          : null,
        telemetry?.afkSec ?? 0,
        telemetry && telemetry.afkIntervals.length > 0
          ? JSON.stringify(telemetry.afkIntervals)
          : null,
        id,
      ],
    );
  });
}

/** Persists live pause state so a crash mid-pause still recovers correctly. */
export async function updateSessionPause(
  id: number,
  pausedSec: number,
  intervals: [string, string | null][],
): Promise<void> {
  return run('updateSessionPause', async () => {
    const db = await getDb();
    await db.execute('UPDATE sessions SET paused_sec = $1, pause_intervals = $2 WHERE id = $3', [
      pausedSec,
      intervals.length > 0 ? JSON.stringify(intervals) : null,
      id,
    ]);
  });
}

export interface SessionEndData {
  endedAt: string;
  rating: number | null;
  notes: string | null;
  appUsage: Record<string, number>;
  /** total AFK seconds the user approved deducting */
  afkDiscountSec: number;
  /** all detected AFK periods (may sum to more than the approved discount) */
  afkIntervals: [string, string][];
  /** closed pause periods */
  pauseIntervals: [string, string][];
}

/**
 * Ends a session, splitting it into one row per LOCAL day when it crosses
 * midnight — so a 23:00→03:00 night session counts 1h yesterday + 3h today.
 * AFK deduction is distributed proportionally to each segment's detected AFK;
 * app usage proportionally to each segment's focused duration.
 */
export async function endSessionSplit(session: Session, data: SessionEndData): Promise<void> {
  return run('endSessionSplit', async () => {
    const startMs = new Date(session.started_at).getTime();
    const endMs = new Date(data.endedAt).getTime();

    // local-midnight boundaries strictly inside (start, end)
    const boundaries: number[] = [];
    let cursor = localMidnightMs(new Date(startMs)) + 24 * 3600_000;
    while (cursor < endMs) {
      boundaries.push(cursor);
      cursor += 24 * 3600_000;
    }

    const totalAfkDetected = intervalsOverlapSec(data.afkIntervals, startMs, endMs);
    const afkScale =
      totalAfkDetected > 0 ? Math.min(1, data.afkDiscountSec / totalAfkDetected) : 0;

    interface Segment {
      fromMs: number;
      toMs: number;
      durationSec: number;
      afkSec: number;
      afkIntervals: [string, string][];
      pausedSec: number;
      pauseIntervals: [string, string][];
    }

    const edges = [startMs, ...boundaries, endMs];
    const segments: Segment[] = [];
    for (let i = 0; i < edges.length - 1; i++) {
      const fromMs = edges[i];
      const toMs = edges[i + 1];
      const wallSec = Math.round((toMs - fromMs) / 1000);
      const pausedSec = intervalsOverlapSec(data.pauseIntervals, fromMs, toMs);
      const afkDetected = intervalsOverlapSec(data.afkIntervals, fromMs, toMs);
      const afkSec = Math.round(afkDetected * afkScale);
      segments.push({
        fromMs,
        toMs,
        durationSec: Math.max(0, wallSec - pausedSec - afkSec),
        afkSec,
        afkIntervals: clipIntervals(data.afkIntervals, fromMs, toMs),
        pausedSec,
        pauseIntervals: clipIntervals(data.pauseIntervals, fromMs, toMs),
      });
    }

    // app usage split proportional to focused duration per segment
    const totalDuration = segments.reduce((a, s) => a + s.durationSec, 0);
    const appUsageFor = (seg: Segment): string | null => {
      const entries = Object.entries(data.appUsage);
      if (entries.length === 0 || totalDuration === 0) return null;
      const share = seg.durationSec / totalDuration;
      if (share === 0) return null;
      const out: Record<string, number> = {};
      for (const [name, sec] of entries) {
        const part = Math.round(sec * share);
        if (part > 0) out[name] = part;
      }
      return Object.keys(out).length > 0 ? JSON.stringify(out) : null;
    };

    const db = await getDb();

    // first segment updates the original row (keeps id + started_at)
    const first = segments[0];
    await db.execute(
      `UPDATE sessions
       SET ended_at = $1, duration_sec = $2, focus_rating = $3, notes = $4,
           app_usage = $5, afk_sec = $6, afk_intervals = $7,
           paused_sec = $8, pause_intervals = $9
       WHERE id = $10`,
      [
        new Date(first.toMs).toISOString(),
        first.durationSec,
        data.rating,
        data.notes,
        appUsageFor(first),
        first.afkSec,
        first.afkIntervals.length > 0 ? JSON.stringify(first.afkIntervals) : null,
        first.pausedSec,
        first.pauseIntervals.length > 0 ? JSON.stringify(first.pauseIntervals) : null,
        session.id,
      ],
    );

    // remaining segments become their own rows (skip empty ones)
    for (const seg of segments.slice(1)) {
      if (seg.durationSec <= 0) continue;
      const endIso = new Date(seg.toMs).toISOString();
      await db.execute(
        `INSERT INTO sessions
           (task, project, started_at, ended_at, duration_sec, focus_rating, mode, notes,
            last_heartbeat_at, app_usage, afk_sec, afk_intervals, paused_sec, pause_intervals)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $4, $9, $10, $11, $12, $13)`,
        [
          session.task,
          session.project,
          new Date(seg.fromMs).toISOString(),
          endIso,
          seg.durationSec,
          data.rating,
          session.mode,
          data.notes,
          appUsageFor(seg),
          seg.afkSec,
          seg.afkIntervals.length > 0 ? JSON.stringify(seg.afkIntervals) : null,
          seg.pausedSec,
          seg.pauseIntervals.length > 0 ? JSON.stringify(seg.pauseIntervals) : null,
        ],
      );
    }
  });
}

export async function discardSession(id: number): Promise<void> {
  return run('discardSession', async () => {
    const db = await getDb();
    await db.execute('DELETE FROM sessions WHERE id = $1', [id]);
  });
}

export interface UpdateSessionInput {
  task?: string;
  project?: string | null;
  notes?: string | null;
  focus_rating?: number | null;
}

export async function updateSession(id: number, patch: UpdateSessionInput): Promise<void> {
  return run('updateSession', async () => {
    const db = await getDb();
    const fields = Object.keys(patch) as (keyof UpdateSessionInput)[];
    if (fields.length === 0) return;
    const setClause = fields.map((f, i) => `${f} = $${i + 1}`).join(', ');
    const values = fields.map((f) => patch[f]);
    await db.execute(`UPDATE sessions SET ${setClause} WHERE id = $${fields.length + 1}`, [
      ...values,
      id,
    ]);
  });
}

export async function deleteSession(id: number): Promise<void> {
  return run('deleteSession', async () => {
    const db = await getDb();
    await db.execute('DELETE FROM breaks WHERE session_id = $1', [id]);
    await db.execute('DELETE FROM sessions WHERE id = $1', [id]);
  });
}

export interface ListSessionsOptions {
  fromIso?: string;
  toIso?: string;
  limit?: number;
}

export async function listSessions(opts: ListSessionsOptions = {}): Promise<Session[]> {
  return run('listSessions', async () => {
    const db = await getDb();
    const clauses: string[] = ['ended_at IS NOT NULL'];
    const params: unknown[] = [];
    if (opts.fromIso) {
      params.push(opts.fromIso);
      clauses.push(`started_at >= $${params.length}`);
    }
    if (opts.toIso) {
      params.push(opts.toIso);
      clauses.push(`started_at < $${params.length}`);
    }
    let query = `SELECT * FROM sessions WHERE ${clauses.join(' AND ')} ORDER BY started_at DESC`;
    if (opts.limit) {
      params.push(opts.limit);
      query += ` LIMIT $${params.length}`;
    }
    return db.select<Session[]>(query, params);
  });
}

export async function listProjects(): Promise<string[]> {
  return run('listProjects', async () => {
    const db = await getDb();
    const rows = await db.select<{ project: string }[]>(
      `SELECT project, COUNT(*) as cnt FROM sessions
       WHERE project IS NOT NULL AND project != ''
       GROUP BY project ORDER BY cnt DESC, project ASC`,
    );
    return rows.map((r) => r.project);
  });
}

// ---------- breaks ----------

export async function createBreak(sessionId: number, plannedSec: number): Promise<Break> {
  return run('createBreak', async () => {
    const db = await getDb();
    const startedAt = nowIso();
    const result = await db.execute(
      `INSERT INTO breaks (session_id, started_at, planned_sec) VALUES ($1, $2, $3)`,
      [sessionId, startedAt, plannedSec],
    );
    const rows = await db.select<Break[]>('SELECT * FROM breaks WHERE id = $1', [
      result.lastInsertId,
    ]);
    return rows[0];
  });
}

export async function endBreak(id: number, overrunSec: number): Promise<void> {
  return run('endBreak', async () => {
    const db = await getDb();
    await db.execute('UPDATE breaks SET ended_at = $1, overrun_sec = $2 WHERE id = $3', [
      nowIso(),
      overrunSec,
      id,
    ]);
  });
}

export async function getAverageBreakOverrunSec(): Promise<number> {
  return run('getAverageBreakOverrunSec', async () => {
    const db = await getDb();
    const rows = await db.select<{ avg_overrun: number | null }[]>(
      `SELECT AVG(overrun_sec) as avg_overrun FROM breaks WHERE overrun_sec IS NOT NULL`,
    );
    return rows[0]?.avg_overrun ?? 0;
  });
}

// ---------- chat (read-only SQL for the AI assistant) ----------

/** Runs a single read-only SELECT (WITH ... SELECT also allowed). */
export async function rawSelect(sql: string): Promise<Record<string, unknown>[]> {
  const trimmed = sql.trim().replace(/;\s*$/, '');
  if (!/^(select|with)\b/i.test(trimmed)) throw new Error('Só consultas SELECT são permitidas');
  if (trimmed.includes(';')) throw new Error('Uma query por vez');
  if (/\b(pragma|attach|vacuum)\b/i.test(trimmed)) throw new Error('Comando não permitido');
  return run('rawSelect', async () => {
    const db = await getDb();
    return db.select<Record<string, unknown>[]>(trimmed);
  });
}

// ---------- chat conversations ----------

export async function listConversations(): Promise<import('../types').ChatConversation[]> {
  return run('listConversations', async () => {
    const db = await getDb();
    return db.select<import('../types').ChatConversation[]>(
      'SELECT id, title, updated_at FROM chat_conversations ORDER BY updated_at DESC',
    );
  });
}

export async function getConversation(
  id: number,
): Promise<{ display: string; history: string } | null> {
  return run('getConversation', async () => {
    const db = await getDb();
    const rows = await db.select<{ display: string; history: string }[]>(
      'SELECT display, history FROM chat_conversations WHERE id = $1',
      [id],
    );
    return rows[0] ?? null;
  });
}

export async function createConversation(
  title: string,
  display: string,
  history: string,
): Promise<number> {
  return run('createConversation', async () => {
    const db = await getDb();
    const result = await db.execute(
      `INSERT INTO chat_conversations (title, display, history, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $4)`,
      [title, display, history, nowIso()],
    );
    return result.lastInsertId as number;
  });
}

export async function updateConversation(
  id: number,
  display: string,
  history: string,
): Promise<void> {
  return run('updateConversation', async () => {
    const db = await getDb();
    await db.execute(
      'UPDATE chat_conversations SET display = $1, history = $2, updated_at = $3 WHERE id = $4',
      [display, history, nowIso(), id],
    );
  });
}

export async function deleteConversation(id: number): Promise<void> {
  return run('deleteConversation', async () => {
    const db = await getDb();
    await db.execute('DELETE FROM chat_conversations WHERE id = $1', [id]);
  });
}

// ---------- chat persistence (legacy single-thread state) ----------

export async function getChatState(): Promise<{ display: string; history: string } | null> {
  return run('getChatState', async () => {
    const db = await getDb();
    const rows = await db.select<{ display: string; history: string }[]>(
      'SELECT display, history FROM chat_state WHERE id = 1',
    );
    return rows[0] ?? null;
  });
}

export async function saveChatState(display: string, history: string): Promise<void> {
  return run('saveChatState', async () => {
    const db = await getDb();
    await db.execute(
      `INSERT INTO chat_state (id, display, history, updated_at) VALUES (1, $1, $2, $3)
       ON CONFLICT(id) DO UPDATE SET display = excluded.display, history = excluded.history, updated_at = excluded.updated_at`,
      [display, history, nowIso()],
    );
  });
}

export async function clearChatState(): Promise<void> {
  return run('clearChatState', async () => {
    const db = await getDb();
    await db.execute('DELETE FROM chat_state WHERE id = 1');
  });
}

// ---------- breaks (timeline) ----------

export async function listBreaksSince(sinceIso: string): Promise<Break[]> {
  return run('listBreaksSince', async () => {
    const db = await getDb();
    return db.select<Break[]>(
      'SELECT * FROM breaks WHERE started_at >= $1 ORDER BY started_at ASC',
      [sinceIso],
    );
  });
}

// ---------- habits ----------

export async function listHabits(): Promise<import('../types').Habit[]> {
  return run('listHabits', async () => {
    const db = await getDb();
    return db.select<import('../types').Habit[]>(
      'SELECT * FROM habits WHERE archived = 0 ORDER BY created_at ASC',
    );
  });
}

export async function createHabit(
  name: string,
  emoji: string,
  weeklyTarget: number,
): Promise<void> {
  return run('createHabit', async () => {
    const db = await getDb();
    await db.execute(
      'INSERT INTO habits (name, emoji, weekly_target, created_at) VALUES ($1, $2, $3, $4)',
      [name, emoji, weeklyTarget, nowIso()],
    );
  });
}

export async function archiveHabit(id: number): Promise<void> {
  return run('archiveHabit', async () => {
    const db = await getDb();
    await db.execute('UPDATE habits SET archived = 1 WHERE id = $1', [id]);
  });
}

/** Toggles a habit log for the given date. Returns true if it is now logged. */
export async function toggleHabitLog(habitId: number, date: string): Promise<boolean> {
  return run('toggleHabitLog', async () => {
    const db = await getDb();
    const existing = await db.select<{ id: number }[]>(
      'SELECT id FROM habit_logs WHERE habit_id = $1 AND date = $2',
      [habitId, date],
    );
    if (existing.length > 0) {
      await db.execute('DELETE FROM habit_logs WHERE id = $1', [existing[0].id]);
      return false;
    }
    await db.execute('INSERT INTO habit_logs (habit_id, date) VALUES ($1, $2)', [habitId, date]);
    return true;
  });
}

export async function getHabitLogsSince(
  sinceDate: string,
): Promise<import('../types').HabitLog[]> {
  return run('getHabitLogsSince', async () => {
    const db = await getDb();
    return db.select<import('../types').HabitLog[]>(
      'SELECT habit_id, date FROM habit_logs WHERE date >= $1',
      [sinceDate],
    );
  });
}

// ---------- milestones ----------

export async function getSessionCount(): Promise<number> {
  return run('getSessionCount', async () => {
    const db = await getDb();
    const rows = await db.select<{ c: number }[]>(
      'SELECT COUNT(*) as c FROM sessions WHERE ended_at IS NOT NULL',
    );
    return rows[0]?.c ?? 0;
  });
}

export async function getMilestoneKeys(): Promise<string[]> {
  return run('getMilestoneKeys', async () => {
    const db = await getDb();
    const rows = await db.select<{ key: string }[]>('SELECT key FROM milestones');
    return rows.map((r) => r.key);
  });
}

/** Returns true if the key was newly inserted (not seen before). */
export async function insertMilestone(key: string): Promise<boolean> {
  return run('insertMilestone', async () => {
    const db = await getDb();
    const result = await db.execute(
      'INSERT OR IGNORE INTO milestones (key, achieved_at) VALUES ($1, $2)',
      [key, nowIso()],
    );
    return result.rowsAffected > 0;
  });
}

// ---------- settings ----------

const SETTINGS_DEFAULTS: Settings = {
  daily_goal_hours: 4,
  pomodoro_work_min: 25,
  pomodoro_break_min: 5,
  overlay_enabled: false,
  autostart_enabled: false,
  sound_enabled: true,
  theme: 'dark',
  overlay_opacity: 40,
  overlay_size: 'md',
  overlay_show_task: true,
  overlay_show_goal: true,
  accent_color: '#d4ff3f',
  user_name: '',
  notify_milestones: true,
  notify_break_end: true,
  mirror_enabled: true,
  afk_enabled: true,
  afk_threshold_min: 5,
  burnout_enabled: true,
  burnout_limit_hours: 10,
  anthropic_api_key: '',
  auto_end_enabled: true,
  auto_end_afk_min: 40,
  insta_enabled: true,
  insta_limit_min: 30,
  insta_work_min: 60,
  insta_bonus_min: 30,
  language: '',
  checkin_enabled: true,
  checkin_interval_min: 60,
  checkin_only_session: false,
  nudge_enabled: true,
  nudge_threshold_min: 5,
  nudge_apps:
    'discord, whatsapp, instagram, twitter, x.com, tiktok, facebook, reddit, youtube shorts, twitch, kick, netflix, telegram, pinterest, 9gag, kwai',
  refboard_enabled: false,
  autotrack_enabled: false,
  autotrack_apps: 'roblox studio, visual studio code, blender, photoshop, figma',
  autotrack_show_overlay: true,
  quotes_enabled: false,
  quotes_interval_min: 30,
};

// ---------- reference board ----------

export async function listRefImages(): Promise<import('../types').RefImage[]> {
  return run('listRefImages', async () => {
    const db = await getDb();
    return db.select<import('../types').RefImage[]>('SELECT * FROM ref_images ORDER BY z ASC');
  });
}

export async function addRefImage(
  file: string,
  x: number,
  y: number,
  w: number,
  h: number,
  z: number,
): Promise<number> {
  return run('addRefImage', async () => {
    const db = await getDb();
    const result = await db.execute(
      'INSERT INTO ref_images (file, x, y, w, h, z, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [file, x, y, w, h, z, nowIso()],
    );
    return result.lastInsertId as number;
  });
}

export async function updateRefImage(
  id: number,
  patch: Partial<Pick<import('../types').RefImage, 'x' | 'y' | 'w' | 'h' | 'z'>>,
): Promise<void> {
  return run('updateRefImage', async () => {
    const db = await getDb();
    const fields = Object.keys(patch) as ('x' | 'y' | 'w' | 'h' | 'z')[];
    if (fields.length === 0) return;
    const setClause = fields.map((f, i) => `${f} = $${i + 1}`).join(', ');
    const values = fields.map((f) => patch[f]);
    await db.execute(`UPDATE ref_images SET ${setClause} WHERE id = $${fields.length + 1}`, [
      ...values,
      id,
    ]);
  });
}

export async function deleteRefImage(id: number): Promise<void> {
  return run('deleteRefImage', async () => {
    const db = await getDb();
    await db.execute('DELETE FROM ref_images WHERE id = $1', [id]);
  });
}

// ---------- anti-instagram ----------

export async function getInstaUsedSec(date: string): Promise<number> {
  return run('getInstaUsedSec', async () => {
    const db = await getDb();
    const rows = await db.select<{ used_sec: number }[]>(
      'SELECT used_sec FROM insta_usage WHERE date = $1',
      [date],
    );
    return rows[0]?.used_sec ?? 0;
  });
}

export async function setInstaUsedSec(date: string, usedSec: number): Promise<void> {
  return run('setInstaUsedSec', async () => {
    const db = await getDb();
    await db.execute(
      `INSERT INTO insta_usage (date, used_sec) VALUES ($1, $2)
       ON CONFLICT(date) DO UPDATE SET used_sec = excluded.used_sec`,
      [date, usedSec],
    );
  });
}

function parseSettingValue<K extends keyof Settings>(key: K, raw: string): Settings[K] {
  if (typeof SETTINGS_DEFAULTS[key] === 'number') {
    return Number(raw) as Settings[K];
  }
  if (typeof SETTINGS_DEFAULTS[key] === 'boolean') {
    return (raw === 'true') as Settings[K];
  }
  return raw as Settings[K];
}

export async function getAllSettings(): Promise<Settings> {
  return run('getAllSettings', async () => {
    const db = await getDb();
    const rows = await db.select<{ key: string; value: string }[]>('SELECT key, value FROM settings');
    const result = { ...SETTINGS_DEFAULTS };
    for (const row of rows) {
      const key = row.key as keyof Settings;
      if (key in result) {
        (result as Record<keyof Settings, unknown>)[key] = parseSettingValue(key, row.value);
      }
    }
    return result;
  });
}

export async function setSetting<K extends keyof Settings>(
  key: K,
  value: Settings[K],
): Promise<void> {
  return run('setSetting', async () => {
    const db = await getDb();
    await db.execute(
      `INSERT INTO settings (key, value) VALUES ($1, $2)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, String(value)],
    );
  });
}

// ---------- hourly check-in log ----------

export async function addHourlyLog(
  day: string,
  periodStart: string,
  periodEnd: string,
  text: string | null,
  skipped: boolean,
): Promise<void> {
  return run('addHourlyLog', async () => {
    const db = await getDb();
    await db.execute(
      `INSERT INTO hourly_logs (day, period_start, period_end, text, skipped, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [day, periodStart, periodEnd, text, skipped ? 1 : 0, nowIso()],
    );
  });
}

export async function listHourlyLogs(day: string): Promise<HourlyLog[]> {
  return run('listHourlyLogs', async () => {
    const db = await getDb();
    return db.select<HourlyLog[]>(
      'SELECT * FROM hourly_logs WHERE day = $1 ORDER BY created_at DESC',
      [day],
    );
  });
}

export async function listAllHourlyLogs(): Promise<HourlyLog[]> {
  return run('listAllHourlyLogs', async () => {
    const db = await getDb();
    return db.select<HourlyLog[]>('SELECT * FROM hourly_logs ORDER BY created_at ASC');
  });
}

/** Consecutive non-skipped check-ins, counting back from the most recent one. */
export async function getCheckinStreak(): Promise<number> {
  return run('getCheckinStreak', async () => {
    const db = await getDb();
    const rows = await db.select<{ skipped: number }[]>(
      'SELECT skipped FROM hourly_logs ORDER BY created_at DESC LIMIT 500',
    );
    let streak = 0;
    for (const r of rows) {
      if (r.skipped) break;
      streak++;
    }
    return streak;
  });
}

export async function clearHourlyLogs(): Promise<void> {
  return run('clearHourlyLogs', async () => {
    const db = await getDb();
    await db.execute('DELETE FROM hourly_logs');
  });
}

// ---------- cloud snapshot (full export/import for account sync) ----------

/** Everything that defines the user's history. API key deliberately excluded. */
export interface Snapshot {
  v: 1;
  sessions: Record<string, unknown>[];
  breaks: Record<string, unknown>[];
  habits: Record<string, unknown>[];
  habit_logs: Record<string, unknown>[];
  hourly_logs: Record<string, unknown>[];
  milestones: Record<string, unknown>[];
  chat_conversations: Record<string, unknown>[];
  settings: Record<string, string>;
}

const SNAPSHOT_TABLES = [
  'sessions',
  'breaks',
  'habits',
  'habit_logs',
  'hourly_logs',
  'milestones',
  'chat_conversations',
] as const;

export async function exportAll(): Promise<Snapshot> {
  return run('exportAll', async () => {
    const dbi = await getDb();
    const out = { v: 1 as const } as Snapshot;
    for (const table of SNAPSHOT_TABLES) {
      (out as unknown as Record<string, unknown>)[table] = await dbi.select<
        Record<string, unknown>[]
      >(`SELECT * FROM ${table}`);
    }
    const settingsRows = await dbi.select<{ key: string; value: string }[]>(
      'SELECT key, value FROM settings',
    );
    out.settings = {};
    for (const row of settingsRows) {
      if (row.key === 'anthropic_api_key') continue; // secrets never leave the machine
      out.settings[row.key] = row.value;
    }
    return out;
  });
}

/** Wipes local tables and rebuilds them from a snapshot (ids preserved). */
export async function importAll(snap: Snapshot): Promise<void> {
  return run('importAll', async () => {
    const dbi = await getDb();
    for (const table of SNAPSHOT_TABLES) {
      await dbi.execute(`DELETE FROM ${table}`);
      const rows = (snap as unknown as Record<string, Record<string, unknown>[]>)[table] ?? [];
      for (const row of rows) {
        const cols = Object.keys(row);
        if (cols.length === 0) continue;
        const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
        await dbi.execute(
          `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`,
          cols.map((c) => row[c]),
        );
      }
    }
    for (const [key, value] of Object.entries(snap.settings ?? {})) {
      if (key === 'anthropic_api_key') continue;
      await dbi.execute(
        `INSERT INTO settings (key, value) VALUES ($1, $2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [key, value],
      );
    }
  });
}

/** Quick signal for "does this install have anything worth keeping?" */
export async function localDataCount(): Promise<number> {
  return run('localDataCount', async () => {
    const dbi = await getDb();
    const rows = await dbi.select<{ c: number }[]>(
      `SELECT (SELECT COUNT(*) FROM sessions) + (SELECT COUNT(*) FROM hourly_logs) + (SELECT COUNT(*) FROM habits) as c`,
    );
    return rows[0]?.c ?? 0;
  });
}

// ---------- stats ----------

export async function getDailyTotals(
  sinceIso: string,
): Promise<{ date: string; total_sec: number }[]> {
  return run('getDailyTotals', async () => {
    const db = await getDb();
    return db.select<{ date: string; total_sec: number }[]>(
      `SELECT date(started_at, 'localtime') as date, SUM(duration_sec) as total_sec
       FROM sessions
       WHERE ended_at IS NOT NULL AND started_at >= $1
       GROUP BY date(started_at, 'localtime')
       ORDER BY date ASC`,
      [sinceIso],
    );
  });
}

export async function getProjectBreakdown(sinceIso?: string): Promise<ProjectBreakdown[]> {
  return run('getProjectBreakdown', async () => {
    const db = await getDb();
    const params: unknown[] = [];
    let query = `SELECT COALESCE(project, 'Sem projeto') as project, SUM(duration_sec) as total_sec
                 FROM sessions WHERE ended_at IS NOT NULL`;
    if (sinceIso) {
      params.push(sinceIso);
      query += ` AND started_at >= $${params.length}`;
    }
    query += ' GROUP BY project ORDER BY total_sec DESC';
    return db.select<ProjectBreakdown[]>(query, params);
  });
}

export interface DayStat {
  date: string;
  total_sec: number;
  block_count: number;
  best_block_sec: number;
  top_project: string | null;
}

export async function getDaySummary(dateKey: string): Promise<DayStat> {
  return run('getDaySummary', async () => {
    const db = await getDb();
    const totals = await db.select<
      { total_sec: number | null; block_count: number; best_block_sec: number | null }[]
    >(
      `SELECT SUM(duration_sec) as total_sec, COUNT(*) as block_count, MAX(duration_sec) as best_block_sec
       FROM sessions WHERE ended_at IS NOT NULL AND date(started_at, 'localtime') = $1`,
      [dateKey],
    );
    const topProjectRows = await db.select<{ project: string }[]>(
      `SELECT COALESCE(project, 'Sem projeto') as project
       FROM sessions WHERE ended_at IS NOT NULL AND date(started_at, 'localtime') = $1
       GROUP BY project ORDER BY SUM(duration_sec) DESC LIMIT 1`,
      [dateKey],
    );
    return {
      date: dateKey,
      total_sec: totals[0]?.total_sec ?? 0,
      block_count: totals[0]?.block_count ?? 0,
      best_block_sec: totals[0]?.best_block_sec ?? 0,
      top_project: topProjectRows[0]?.project ?? null,
    };
  });
}

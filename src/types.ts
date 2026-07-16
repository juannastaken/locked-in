export type SessionMode = 'open' | 'pomodoro';

export interface Session {
  id: number;
  task: string;
  project: string | null;
  started_at: string;
  ended_at: string | null;
  duration_sec: number | null;
  focus_rating: number | null;
  mode: SessionMode;
  notes: string | null;
  last_heartbeat_at: string | null;
  /** JSON: Record<friendly app name, seconds in foreground> */
  app_usage: string | null;
  /** seconds discounted from duration because the user was away */
  afk_sec: number;
  /** JSON: [startIso, endIso][] — away periods, kept for the timeline */
  afk_intervals: string | null;
  /** seconds the session spent paused (never counted as focus) */
  paused_sec: number;
  /** JSON: string[] — usernames of everyone in the jam; null when solo */
  jam_members: string | null;
  /** JSON: [startIso, endIso | null][] — pause periods; null end = pause open at crash */
  pause_intervals: string | null;
}

export interface NewSession {
  task: string;
  project: string | null;
  mode: SessionMode;
  /** usernames of everyone in the jam (me included); omitted when solo */
  jamMembers?: string[];
}

export interface EndSessionInput {
  focus_rating: number | null;
  notes: string | null;
}

export interface Break {
  id: number;
  session_id: number;
  started_at: string;
  planned_sec: number;
  ended_at: string | null;
  overrun_sec: number | null;
}

export type OverlaySize = 'sm' | 'md' | 'lg';

export interface Settings {
  daily_goal_hours: number;
  pomodoro_work_min: number;
  pomodoro_break_min: number;
  overlay_enabled: boolean;
  autostart_enabled: boolean;
  sound_enabled: boolean;
  theme: string;
  overlay_opacity: number;
  overlay_size: string;
  overlay_show_task: boolean;
  overlay_show_goal: boolean;
  accent_color: string;
  user_name: string;
  notify_milestones: boolean;
  notify_break_end: boolean;
  mirror_enabled: boolean;
  afk_enabled: boolean;
  afk_threshold_min: number;
  burnout_enabled: boolean;
  burnout_limit_hours: number;
  anthropic_api_key: string;
  auto_end_enabled: boolean;
  auto_end_afk_min: number;
  insta_enabled: boolean;
  insta_limit_min: number;
  insta_work_min: number;
  insta_bonus_min: number;
  language: string;
  checkin_enabled: boolean;
  checkin_interval_min: number;
  checkin_only_session: boolean;
  nudge_enabled: boolean;
  nudge_threshold_min: number;
  nudge_apps: string;
  refboard_enabled: boolean;
  autotrack_enabled: boolean;
  autotrack_apps: string;
  autotrack_show_overlay: boolean;
  quotes_enabled: boolean;
  quotes_interval_min: number;
  profile_projects_public: boolean;
  friends_bar_enabled: boolean;
  pomodoro_enabled: boolean;
}

/** One image pinned on the PureRef-style reference board. */
export interface RefImage {
  id: number;
  /** absolute path of the copied file inside the app's refboard folder */
  file: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  created_at: string;
}

export interface ChatConversation {
  id: number;
  title: string;
  updated_at: string;
}

/** State broadcast to the fullscreen anti-Instagram blocker window. */
export interface BlockerState {
  usedSec: number;
  allowanceSec: number;
  focusToNextSec: number;
  bonusMin: number;
  snoozesLeft: number;
}

export interface ProjectGoal {
  id: number;
  project: string;
  target_hours: number;
  deadline: string | null;
  created_at: string;
  archived: number;
}

export interface Habit {
  id: number;
  name: string;
  emoji: string;
  weekly_target: number;
  created_at: string;
  archived: number;
}

export interface HabitLog {
  habit_id: number;
  date: string;
}

export type SettingKey = keyof Settings;

export type FocusPhase = 'idle' | 'focusing' | 'paused' | 'rating' | 'break';

export interface HourlyLog {
  id: number;
  day: string;
  period_start: string;
  period_end: string;
  text: string | null;
  skipped: number;
  created_at: string;
}

/** Payload the Rust watchers send to the bottom-right popup window. */
export type PopupPayload =
  | {
      kind: 'checkin';
      day: string;
      periodStart: string;
      periodEnd: string;
      lang: string;
      sound: boolean;
      accent: string;
      /** preview fired from Settings — render everything, persist nothing */
      test?: boolean;
    }
  | {
      kind: 'nudge';
      app: string;
      minutes: number;
      lang: string;
      sound: boolean;
      accent: string;
    }
  | {
      kind: 'notice';
      title: string;
      body: string;
      /** mascot mood name, e.g. 'hyped' | 'sad' | 'happy' | 'sleep' */
      mood: string;
      /** optional click action forwarded to the main window (JSON string) */
      data?: string | null;
      lang: string;
      sound: boolean;
      accent: string;
    }
  | {
      kind: 'jamcall';
      username: string;
      task: string;
      /** 'invite' = they call me in; 'request' = they want into my jam */
      incomingKind: string;
      lang: string;
      sound: boolean;
      accent: string;
    }
  | {
      kind: 'update';
      version: string;
      url: string;
      lang: string;
      sound: boolean;
      accent: string;
    }
  | {
      kind: 'quote';
      lang: string;
      sound: boolean;
      accent: string;
    };

export interface DaySummary {
  date: string;
  total_sec: number;
  block_count: number;
  top_project: string | null;
  best_block_sec: number;
}

export interface ProjectBreakdown {
  project: string;
  total_sec: number;
}

/** Overlay display config, derived from settings in the main window. */
export interface OverlayConfig {
  opacity: number;
  size: OverlaySize;
  showTask: boolean;
  showGoal: boolean;
  accent: string;
  lang: 'pt' | 'en';
}

/** State broadcast from the main window to the floating overlay. */
export interface OverlayState {
  phase: 'idle' | 'focusing' | 'paused' | 'break';
  task: string | null;
  elapsedSec: number;
  breakRemainingSec: number;
  breakOverrunSec: number;
  goalProgress: number;
  todaySec: number;
  cfg: OverlayConfig;
}

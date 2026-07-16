import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { friendlyAppName } from '../lib/apps';
import * as db from '../lib/db';
import { t } from '../lib/i18n';
import { intervalsOverlapSec, localMidnightMs, nowIso, secondsBetween } from '../lib/time';
import type { FocusPhase, Session } from '../types';

const HEARTBEAT_INTERVAL_MS = 30_000;
const ABSURD_SESSION_SEC = 6 * 60 * 60;
const APP_SAMPLE_SEC = 5;
const AFK_POLL_MS = 10_000;
/** a session left paused this long gets auto-ended at the pause start */
const PAUSE_AUTO_END_SEC = 2 * 60 * 60;

export interface StopSessionInput {
  focus_rating: number | null;
  notes: string | null;
}

export interface FocusOptions {
  mirrorEnabled: boolean;
  afkEnabled: boolean;
  afkThresholdMin: number;
  autoEndEnabled: boolean;
  autoEndAfkMin: number;
  onAutoEnd?: (task: string, afkMinutes: number, reason: 'afk' | 'paused') => void;
}

export interface JamMeta {
  /** when the HOST's session started — the shared timer counts from here */
  startedAt: string;
  /** usernames of everyone in the jam, me included */
  members: string[];
}

export interface UseFocusSession {
  phase: FocusPhase;
  activeSession: Session | null;
  /** focused seconds of the whole session (pauses already excluded) */
  elapsedSec: number;
  /** what the timer SHOWS: my elapsed + the jam head start (solo: same as elapsedSec) */
  displayElapsedSec: number;
  /** set while this session is part of a jam */
  jam: JamMeta | null;
  /** focused seconds that belong to TODAY (sessions crossing midnight split correctly) */
  todayElapsedSec: number;
  isAbsurd: boolean;
  activeBreak: { plannedSec: number; startedAt: string } | null;
  breakRemainingSec: number;
  breakOverrunSec: number;
  error: string | null;
  pendingAfkSec: number | null;
  resolveAfk: (discount: boolean) => void;
  startSession: (task: string, project: string | null, jam?: JamMeta) => Promise<void>;
  /** upgrade the running session to a jam (host side) — merges member lists */
  markJam: (members: string[]) => void;
  /** REPLACE the jam member list (group jams sync it from the server) */
  syncJamMembers: (members: string[]) => void;
  pauseSession: () => void;
  resumeSession: () => void;
  stopSession: () => void;
  resumeFromRating: () => void;
  confirmStop: (input: StopSessionInput, breakPlannedSec: number | null) => Promise<void>;
  endBreakNow: () => Promise<void>;
  recoveredSession: Session | null;
  keepRecoveredSession: () => Promise<void>;
  discardRecoveredSession: () => Promise<void>;
}

export function useFocusSession(opts: FocusOptions): UseFocusSession {
  const [phase, setPhase] = useState<FocusPhase>('idle');
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [todayElapsedSec, setTodayElapsedSec] = useState(0);
  const [activeBreakId, setActiveBreakId] = useState<number | null>(null);
  const [activeBreak, setActiveBreak] = useState<{ plannedSec: number; startedAt: string } | null>(
    null,
  );
  const [breakRemainingSec, setBreakRemainingSec] = useState(0);
  const [breakOverrunSec, setBreakOverrunSec] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [recoveredSession, setRecoveredSession] = useState<Session | null>(null);
  const [pendingAfkSec, setPendingAfkSec] = useState<number | null>(null);
  const [jam, setJam] = useState<JamMeta | null>(null);

  const heartbeatTimer = useRef<number | null>(null);
  const tickTimer = useRef<number | null>(null);
  // moment the user hit "stop" — time spent on the rating modal must not count
  const stoppedAtRef = useRef<string | null>(null);
  // phase to go back to if the user leaves the rating modal
  const phaseBeforeRatingRef = useRef<'focusing' | 'paused'>('focusing');

  // session telemetry (focus mirror + afk + pauses)
  const appUsageRef = useRef<Record<string, number>>({});
  const afkDiscountRef = useRef(0);
  const afkIntervalsRef = useRef<[string, string][]>([]);
  const afkActiveRef = useRef<{ startIso: string } | null>(null);
  const pendingAfkRef = useRef(0);
  const pauseIntervalsRef = useRef<[string, string][]>([]);
  const pauseActiveRef = useRef<{ startIso: string } | null>(null);

  const optsRef = useRef(opts);
  optsRef.current = opts;

  function resetTelemetry() {
    appUsageRef.current = {};
    afkDiscountRef.current = 0;
    afkIntervalsRef.current = [];
    afkActiveRef.current = null;
    pendingAfkRef.current = 0;
    pauseIntervalsRef.current = [];
    pauseActiveRef.current = null;
    setPendingAfkSec(null);
  }

  /** closed pause intervals + the open one clipped at `endIso` (if any). */
  function pausesUntil(endIso: string): [string, string][] {
    const list = [...pauseIntervalsRef.current];
    if (pauseActiveRef.current) {
      const start = pauseActiveRef.current.startIso;
      if (new Date(start).getTime() < new Date(endIso).getTime()) list.push([start, endIso]);
    }
    return list;
  }

  /** ends the session, splitting across local midnights when needed. */
  const finishSession = useCallback(
    async (
      session: Session,
      endedAt: string,
      rating: number | null,
      notes: string | null,
      pauseList: [string, string][],
    ) => {
      await db.endSessionSplit(session, {
        endedAt,
        rating,
        notes,
        appUsage: appUsageRef.current,
        afkDiscountSec: afkDiscountRef.current,
        afkIntervals: afkIntervalsRef.current,
        pauseIntervals: pauseList,
      });
    },
    [],
  );

  // on mount: check for a crashed/orphaned active session
  useEffect(() => {
    db.getActiveSession()
      .then((session) => {
        if (session) setRecoveredSession(session);
      })
      .catch((err) => setError(String(err)));
  }, []);

  // count-up ticker while focusing/paused (paused: subtracting the open pause freezes it)
  useEffect(() => {
    if ((phase !== 'focusing' && phase !== 'paused') || !activeSession) return;
    const session = activeSession;
    const tick = () => {
      const now = new Date();
      const nowMs = now.getTime();
      const startMs = new Date(session.started_at).getTime();
      const closed = pauseIntervalsRef.current;
      const open = pauseActiveRef.current;
      const openOverlap = (fromMs: number) =>
        open ? Math.max(0, (nowMs - Math.max(new Date(open.startIso).getTime(), fromMs)) / 1000) : 0;

      const wall = Math.max(0, (nowMs - startMs) / 1000);
      const paused = intervalsOverlapSec(closed, startMs, nowMs) + openOverlap(startMs);
      setElapsedSec(Math.max(0, Math.round(wall - paused)));

      const todayStartMs = Math.max(startMs, localMidnightMs(now));
      const wallToday = Math.max(0, (nowMs - todayStartMs) / 1000);
      const pausedToday = intervalsOverlapSec(closed, todayStartMs, nowMs) + openOverlap(todayStartMs);
      setTodayElapsedSec(Math.max(0, Math.round(wallToday - pausedToday)));
    };
    tick();
    tickTimer.current = window.setInterval(tick, 1000);
    return () => {
      if (tickTimer.current) window.clearInterval(tickTimer.current);
    };
  }, [phase, activeSession]);

  // heartbeat persistence every 30s while a session exists (paused included — crash safety)
  useEffect(() => {
    if ((phase !== 'focusing' && phase !== 'paused') || !activeSession) return;
    heartbeatTimer.current = window.setInterval(() => {
      db.heartbeatSession(activeSession.id).catch((err) => setError(String(err)));
    }, HEARTBEAT_INTERVAL_MS);
    return () => {
      if (heartbeatTimer.current) window.clearInterval(heartbeatTimer.current);
    };
  }, [phase, activeSession]);

  // focus mirror: sample the foreground app every 5s while focusing
  useEffect(() => {
    if (phase !== 'focusing' || !activeSession) return;
    const id = window.setInterval(() => {
      if (!optsRef.current.mirrorEnabled) return;
      if (afkActiveRef.current) return; // away — nobody is "using" the app
      invoke<string | null>('get_foreground_app')
        .then((exe) => {
          if (!exe) return;
          const name = friendlyAppName(exe);
          appUsageRef.current[name] = (appUsageRef.current[name] ?? 0) + APP_SAMPLE_SEC;
        })
        .catch(() => {});
    }, APP_SAMPLE_SEC * 1000);
    return () => window.clearInterval(id);
  }, [phase, activeSession]);

  // afk watcher: detect away periods while focusing; auto-end forgotten sessions
  const autoEndingRef = useRef(false);
  useEffect(() => {
    if (phase !== 'focusing' || !activeSession) return;
    const session = activeSession;
    const id = window.setInterval(() => {
      if (!optsRef.current.afkEnabled && !optsRef.current.autoEndEnabled) return;
      const thresholdSec = optsRef.current.afkThresholdMin * 60;
      const autoEndSec = optsRef.current.autoEndAfkMin * 60;
      invoke<number>('get_idle_seconds')
        .then(async (idleSec) => {
          const now = Date.now();

          // forgotten session: continuously AFK past the auto-end limit → close at last input
          if (
            optsRef.current.autoEndEnabled &&
            idleSec >= autoEndSec &&
            !autoEndingRef.current
          ) {
            autoEndingRef.current = true;
            try {
              const endedAt = new Date(now - idleSec * 1000).toISOString();
              await finishSession(
                session,
                endedAt,
                null,
                t('sess.autoend.note'),
                pausesUntil(endedAt),
              );
              stoppedAtRef.current = null;
              resetTelemetry();
              setActiveSession(null);
              setJam(null);
              setPhase('idle');
              optsRef.current.onAutoEnd?.(session.task, Math.round(idleSec / 60), 'afk');
            } catch (err) {
              setError(String(err));
            } finally {
              autoEndingRef.current = false;
            }
            return;
          }

          if (!optsRef.current.afkEnabled) return;
          if (!afkActiveRef.current && idleSec >= thresholdSec) {
            afkActiveRef.current = {
              startIso: new Date(now - idleSec * 1000).toISOString(),
            };
          } else if (afkActiveRef.current && idleSec < 30) {
            const startIso = afkActiveRef.current.startIso;
            const endIso = new Date(now - idleSec * 1000).toISOString();
            afkActiveRef.current = null;
            const period = secondsBetween(startIso, endIso);
            if (period >= thresholdSec) {
              afkIntervalsRef.current.push([startIso, endIso]);
              pendingAfkRef.current += period;
              setPendingAfkSec(pendingAfkRef.current);
            }
          }
        })
        .catch(() => {});
    }, AFK_POLL_MS);
    return () => window.clearInterval(id);
  }, [phase, activeSession, finishSession]);

  // paused watchdog: a session forgotten in pause auto-ends at the pause start
  useEffect(() => {
    if (phase !== 'paused' || !activeSession) return;
    const session = activeSession;
    const id = window.setInterval(async () => {
      if (!optsRef.current.autoEndEnabled || autoEndingRef.current) return;
      const open = pauseActiveRef.current;
      if (!open) return;
      const pausedFor = secondsBetween(open.startIso, nowIso());
      if (pausedFor < PAUSE_AUTO_END_SEC) return;
      autoEndingRef.current = true;
      try {
        const endedAt = open.startIso;
        // the open pause ends the session — only closed pauses count as telemetry
        await finishSession(
          session,
          endedAt,
          null,
          t('sess.pausedend.note'),
          [...pauseIntervalsRef.current],
        );
        stoppedAtRef.current = null;
        resetTelemetry();
        setActiveSession(null);
        setJam(null);
        setPhase('idle');
        optsRef.current.onAutoEnd?.(session.task, Math.round(pausedFor / 60), 'paused');
      } catch (err) {
        setError(String(err));
      } finally {
        autoEndingRef.current = false;
      }
    }, 60_000);
    return () => window.clearInterval(id);
  }, [phase, activeSession, finishSession]);

  const resolveAfk = useCallback((discount: boolean) => {
    if (discount) afkDiscountRef.current += pendingAfkRef.current;
    pendingAfkRef.current = 0;
    setPendingAfkSec(null);
  }, []);

  // break countdown ticker
  useEffect(() => {
    if (phase !== 'break' || !activeBreak) return;
    const tick = () => {
      const elapsed = secondsBetween(activeBreak.startedAt, nowIso());
      const remaining = activeBreak.plannedSec - elapsed;
      setBreakRemainingSec(remaining);
      setBreakOverrunSec(remaining < 0 ? -remaining : 0);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [phase, activeBreak]);

  /** usernames are identity keys — collapse case-duplicates of the same person */
  function dedupeUsers(list: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const u of list) {
      const k = u.toLowerCase();
      if (!seen.has(k)) {
        seen.add(k);
        out.push(u);
      }
    }
    return out;
  }

  const startSession = useCallback(
    async (task: string, project: string | null, jamMeta?: JamMeta) => {
      try {
        const session = await db.createSession({
          task,
          project,
          mode: 'open',
          jamMembers: jamMeta?.members,
        });
        resetTelemetry();
        setActiveSession(session);
        setJam(jamMeta ? { ...jamMeta, members: dedupeUsers(jamMeta.members) } : null);
        setElapsedSec(0);
        setTodayElapsedSec(0);
        setPhase('focusing');
        setError(null);
      } catch (err) {
        setError(String(err));
      }
    },
    [],
  );

  const markJam = useCallback(
    (members: string[]) => {
      if (!activeSession) return;
      const current = jam;
      const merged = dedupeUsers([...(current?.members ?? []), ...members]);
      db.setSessionJamMembers(activeSession.id, merged).catch((err) => setError(String(err)));
      // host keeps their own clock — the jam started when THEIR session did
      setJam({ startedAt: current?.startedAt ?? activeSession.started_at, members: merged });
      // keep the in-memory row in sync: a midnight split copies jam_members
      // from this object, not from the database
      setActiveSession({ ...activeSession, jam_members: JSON.stringify(merged) });
    },
    [activeSession, jam],
  );

  const syncJamMembers = useCallback(
    (members: string[]) => {
      if (!activeSession || !jam) return;
      const next = dedupeUsers(members);
      const same =
        next.length === jam.members.length && next.every((m) => jam.members.includes(m));
      if (same) return;
      // everyone else left → I'm no longer in a jam, keep focusing solo
      if (next.length <= 1) {
        db.setSessionJamMembers(activeSession.id, []).catch((err) => setError(String(err)));
        setJam(null);
        setActiveSession({ ...activeSession, jam_members: null });
        return;
      }
      db.setSessionJamMembers(activeSession.id, next).catch((err) => setError(String(err)));
      setJam({ startedAt: jam.startedAt, members: next });
      setActiveSession({ ...activeSession, jam_members: JSON.stringify(next) });
    },
    [activeSession, jam],
  );

  /** persists current pause state so a crash mid-pause recovers correctly */
  function persistPauseState(sessionId: number) {
    const closed = pauseIntervalsRef.current;
    const closedSec = closed.reduce((acc, [a, b]) => acc + secondsBetween(a, b), 0);
    const list: [string, string | null][] = [...closed];
    if (pauseActiveRef.current) list.push([pauseActiveRef.current.startIso, null]);
    db.updateSessionPause(sessionId, closedSec, list).catch((err) => setError(String(err)));
  }

  const pauseSession = useCallback(() => {
    if (!activeSession) return;
    // pausing while an AFK stretch is open: close it at the pause start
    if (afkActiveRef.current) {
      const startIso = afkActiveRef.current.startIso;
      const endIso = nowIso();
      afkActiveRef.current = null;
      const period = secondsBetween(startIso, endIso);
      if (period >= optsRef.current.afkThresholdMin * 60) {
        afkIntervalsRef.current.push([startIso, endIso]);
        pendingAfkRef.current += period;
        setPendingAfkSec(pendingAfkRef.current);
      }
    }
    pauseActiveRef.current = { startIso: nowIso() };
    persistPauseState(activeSession.id);
    setPhase('paused');
  }, [activeSession]);

  const resumeSession = useCallback(() => {
    if (!activeSession) return;
    if (pauseActiveRef.current) {
      pauseIntervalsRef.current.push([pauseActiveRef.current.startIso, nowIso()]);
      pauseActiveRef.current = null;
    }
    persistPauseState(activeSession.id);
    setPhase('focusing');
  }, [activeSession]);

  const stopSession = useCallback(() => {
    const stoppedAt = nowIso();
    stoppedAtRef.current = stoppedAt;
    // stopping while paused: close the open pause here — rating time never counts anyway
    if (pauseActiveRef.current) {
      phaseBeforeRatingRef.current = 'paused';
      pauseIntervalsRef.current.push([pauseActiveRef.current.startIso, stoppedAt]);
      pauseActiveRef.current = null;
    } else {
      phaseBeforeRatingRef.current = 'focusing';
    }
    if (activeSession) persistPauseState(activeSession.id);
    setPhase('rating');
  }, [activeSession]);

  const resumeFromRating = useCallback(() => {
    stoppedAtRef.current = null;
    if (phaseBeforeRatingRef.current === 'paused') {
      // was paused before stopping — go back to paused with a fresh open pause
      pauseActiveRef.current = { startIso: nowIso() };
      if (activeSession) persistPauseState(activeSession.id);
      setPhase('paused');
    } else {
      setPhase('focusing');
    }
  }, [activeSession]);

  const confirmStop = useCallback(
    async (input: StopSessionInput, breakPlannedSec: number | null) => {
      if (!activeSession) return;
      try {
        // unanswered AFK prompt at stop time: discount it — honest default
        if (pendingAfkRef.current > 0) {
          afkDiscountRef.current += pendingAfkRef.current;
          pendingAfkRef.current = 0;
          setPendingAfkSec(null);
        }
        const endedAt = stoppedAtRef.current ?? nowIso();
        await finishSession(
          activeSession,
          endedAt,
          input.focus_rating,
          input.notes,
          pausesUntil(endedAt),
        );
        stoppedAtRef.current = null;

        if (breakPlannedSec && breakPlannedSec > 0) {
          const brk = await db.createBreak(activeSession.id, breakPlannedSec);
          setActiveBreakId(brk.id);
          setActiveBreak({ plannedSec: breakPlannedSec, startedAt: brk.started_at });
          setBreakRemainingSec(breakPlannedSec);
          setBreakOverrunSec(0);
          setPhase('break');
        } else {
          setPhase('idle');
        }
        setActiveSession(null);
        setJam(null);
        resetTelemetry();
        setError(null);
      } catch (err) {
        setError(String(err));
      }
    },
    [activeSession, finishSession],
  );

  const endBreakNow = useCallback(async () => {
    if (activeBreakId === null) {
      setPhase('idle');
      return;
    }
    try {
      await db.endBreak(activeBreakId, breakOverrunSec);
      setActiveBreakId(null);
      setActiveBreak(null);
      setPhase('idle');
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }, [activeBreakId, breakOverrunSec]);

  const keepRecoveredSession = useCallback(async () => {
    if (!recoveredSession) return;
    try {
      // pause state persisted before the crash: closed pauses + maybe an open one
      let closed: [string, string][] = [];
      let openStart: string | null = null;
      try {
        const raw = recoveredSession.pause_intervals
          ? (JSON.parse(recoveredSession.pause_intervals) as [string, string | null][])
          : [];
        for (const [a, b] of raw) {
          if (b === null) openStart = a;
          else closed.push([a, b]);
        }
      } catch {
        closed = [];
      }

      const heartbeat = recoveredSession.last_heartbeat_at ?? recoveredSession.started_at;
      // crashed while paused → the session effectively ended when the pause began
      const endedAt =
        openStart && new Date(openStart).getTime() < new Date(heartbeat).getTime()
          ? openStart
          : heartbeat;

      await db.endSessionSplit(recoveredSession, {
        endedAt,
        rating: null,
        notes: t('sess.recovered.note'),
        appUsage: {},
        afkDiscountSec: 0,
        afkIntervals: [],
        pauseIntervals: closed,
      });
      setRecoveredSession(null);
    } catch (err) {
      setError(String(err));
    }
  }, [recoveredSession]);

  const discardRecoveredSession = useCallback(async () => {
    if (!recoveredSession) return;
    try {
      await db.discardSession(recoveredSession.id);
      setRecoveredSession(null);
    } catch (err) {
      setError(String(err));
    }
  }, [recoveredSession]);

  // shared timer: the jam started before I joined — show the host's clock,
  // while everything SAVED (elapsedSec, history) stays my own time only
  const jamHeadStartSec =
    jam && activeSession
      ? Math.max(0, secondsBetween(jam.startedAt, activeSession.started_at))
      : 0;

  return {
    phase,
    activeSession,
    elapsedSec,
    displayElapsedSec: elapsedSec + jamHeadStartSec,
    jam,
    todayElapsedSec,
    isAbsurd: elapsedSec >= ABSURD_SESSION_SEC,
    activeBreak,
    breakRemainingSec,
    breakOverrunSec,
    error,
    pendingAfkSec,
    resolveAfk,
    startSession,
    markJam,
    syncJamMembers,
    pauseSession,
    resumeSession,
    stopSession,
    resumeFromRating,
    confirmStop,
    endBreakNow,
    recoveredSession,
    keepRecoveredSession,
    discardRecoveredSession,
  };
}

// Cloud accounts + backup sync, built on Supabase.
//
// SECURITY MODEL (read before touching):
// - The URL and anon key below are PUBLIC BY DESIGN — they only identify the
//   project. All authorization lives server-side in Postgres Row Level
//   Security: every policy is `auth.uid() = user_id`, so a signed-in user can
//   only ever read/write their own snapshot row. The privileged service_role
//   key must NEVER appear anywhere in this repository or binary.
// - Passwords are handled entirely by Supabase Auth (bcrypt server-side).
// - The user's Anthropic API key is deliberately EXCLUDED from snapshots.

import { createClient } from '@supabase/supabase-js';
import type { Session as AuthSession } from '@supabase/supabase-js';
import { invoke } from '@tauri-apps/api/core';
import * as db from './db';

const SUPABASE_URL = 'https://popvdufwbupjnrrablgr.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBvcHZkdWZ3YnVwam5ycmFibGdyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxNTg1OTIsImV4cCI6MjA5OTczNDU5Mn0.blL7kIEKCwXjfErbv6PuzVd32lZsenRSldSXACHJyoU';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

export interface CloudSnapshotMeta {
  updatedAt: string;
  sessionCount: number;
}

export async function currentUser(): Promise<{ id: string; email: string } | null> {
  const { data } = await supabase.auth.getSession();
  const s: AuthSession | null = data.session;
  if (!s?.user) return null;
  return { id: s.user.id, email: s.user.email ?? '' };
}

/**
 * Proactively refreshes the access token. WebView2 freezes JS timers while the
 * window is hidden/minimized, so the library's auto-refresh can miss a beat and
 * queries briefly 401 with "JWT expired" — this is NOT a real logout. Call this
 * on window focus / regaining connectivity to heal it silently.
 */
let refreshing: Promise<boolean> | null = null;
export async function ensureFreshSession(): Promise<boolean> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) return false;
      const { error } = await supabase.auth.refreshSession();
      return !error;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export type SignUpResult =
  | { kind: 'ok' }
  | { kind: 'exists' }
  | { kind: 'error'; message: string };

export async function signUp(email: string, password: string): Promise<SignUpResult> {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) {
    if (/already|registered|exists/i.test(error.message)) return { kind: 'exists' };
    return { kind: 'error', message: error.message };
  }
  // with email confirmations off, an EXISTING email is obfuscated as a user
  // with no identities and no session — treat that as "already exists"
  if (data.user && (data.user.identities?.length ?? 0) === 0 && !data.session) {
    return { kind: 'exists' };
  }
  return { kind: 'ok' };
}

export async function signIn(email: string, password: string): Promise<string | null> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return error ? error.message : null;
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

export type LogoutResult =
  | { kind: 'ok' }
  | { kind: 'sync-failed'; message: string }
  | { kind: 'canvas-too-big' };

/**
 * Signing out turns this device back into a fresh guest: the account's data
 * lives in the cloud, not on the machine. Order matters — push a final
 * snapshot FIRST and abort if it fails (never wipe data that isn't safely
 * backed up), then sign out and wipe everything account-scoped. The caller
 * reloads the window afterwards.
 */
export async function logoutAndReset(): Promise<LogoutResult> {
  await ensureFreshSession(); // heal a WebView2-frozen token before the final push
  // a canvas over the snapshot size cap silently skips backup — wiping it after
  // that would be permanent data loss, so refuse and let the user trim it first
  try {
    const canvas = await invoke<string>('load_canvas');
    if (canvas.length > 8_000_000) return { kind: 'canvas-too-big' };
  } catch {
    /* no canvas — nothing at risk */
  }
  const err = await uploadSnapshot();
  if (err) return { kind: 'sync-failed', message: err };
  await supabase.auth.signOut();
  await db.wipeAll();
  await invoke('save_canvas', { data: '' }).catch(() => {});
  // account-scoped browser state — the E2E private key must never survive
  // into another account's session on this machine
  localStorage.removeItem('e2e-priv');
  localStorage.removeItem('cloud-last-sync');
  localStorage.removeItem('jams-blocked');
  localStorage.removeItem('pokes-blocked');
  localStorage.setItem('guest-mode', '1');
  return { kind: 'ok' };
}

/** Uploads the full local state as this user's snapshot (last write wins). */
export async function uploadSnapshot(): Promise<string | null> {
  const user = await currentUser();
  if (!user) return 'not signed in';
  const data = await db.exportAll();
  let canvas = '';
  try {
    canvas = await invoke<string>('load_canvas');
  } catch {
    canvas = '';
  }
  // guard the free tier: a canvas stuffed with images can get huge
  if (canvas.length > 8_000_000) canvas = '';
  const { error } = await supabase.from('snapshots').upsert({
    user_id: user.id,
    data,
    canvas: canvas || null,
    updated_at: new Date().toISOString(),
  });
  return error ? error.message : null;
}

export interface CloudSnapshot {
  data: db.Snapshot;
  canvas: string | null;
  updated_at: string;
}

export async function downloadSnapshot(): Promise<CloudSnapshot | null> {
  const user = await currentUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('snapshots')
    .select('data, canvas, updated_at')
    .eq('user_id', user.id)
    .maybeSingle();
  if (error || !data) return null;
  return data as CloudSnapshot;
}

/** Replaces ALL local data with the cloud snapshot. */
export async function restoreSnapshot(snap: CloudSnapshot): Promise<void> {
  await db.importAll(snap.data);
  if (snap.canvas) {
    await invoke('save_canvas', { data: snap.canvas }).catch(() => {});
  }
}

export type ReconcileResult =
  | { kind: 'uploaded' } // no cloud backup existed → local pushed up
  | { kind: 'restored' } // fresh install → cloud pulled down
  | { kind: 'conflict'; cloud: CloudSnapshot; localCount: number }
  | { kind: 'error'; message: string };

/**
 * Right after login, decides what to do with local vs cloud data:
 * - no cloud backup  → upload local
 * - local is empty   → restore cloud
 * - both have data   → let the caller ask the user (conflict)
 */
export async function reconcileAfterLogin(): Promise<ReconcileResult> {
  const cloudSnap = await downloadSnapshot();
  const localCount = await db.localDataCount();
  if (!cloudSnap) {
    const err = await uploadSnapshot();
    return err ? { kind: 'error', message: err } : { kind: 'uploaded' };
  }
  if (localCount === 0) {
    await restoreSnapshot(cloudSnap);
    return { kind: 'restored' };
  }
  return { kind: 'conflict', cloud: cloudSnap, localCount };
}

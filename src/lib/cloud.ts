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

export async function signUp(email: string, password: string): Promise<string | null> {
  const { error } = await supabase.auth.signUp({ email, password });
  return error ? error.message : null;
}

export async function signIn(email: string, password: string): Promise<string | null> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return error ? error.message : null;
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
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

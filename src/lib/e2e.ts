// End-to-end encryption for messages. THREAT MODEL & GUARANTEES:
//
// - Bodies are encrypted with crypto_box (X25519 ECDH + XSalsa20-Poly1305,
//   authenticated): only the two key holders can read or undetectably alter
//   a message. The server (Supabase) stores ciphertext only.
// - The PRIVATE key lives exclusively on this machine: wrapped with Windows
//   DPAPI (tied to the Windows account) and kept in WebView storage. It is
//   NEVER part of cloud snapshots or the messages table.
// - Optional cloud backup of the private key is itself encrypted client-side
//   with a passphrase (Argon2id, moderate params → 32-byte key → secretbox).
//   Losing the passphrase = losing the backup, by design.
// - Every message row snapshots the two PUBLIC keys used, so rotating keys
//   never breaks old history for whoever still holds their private key.
// - What E2EE does NOT hide: metadata (who talks to whom, when, how often).
//
// Wire formats: all binary values travel as base64 (ORIGINAL variant).

import sodium from 'libsodium-wrappers-sumo';
import { invoke } from '@tauri-apps/api/core';
import { currentUser, supabase } from './cloud';

const PRIV_STORAGE_KEY = 'e2e-priv'; // localStorage, value = "dpapi:<blob>"
const DPAPI_PREFIX = 'dpapi:';

let sodiumReady: Promise<void> | null = null;
function ready(): Promise<void> {
  if (!sodiumReady) sodiumReady = sodium.ready;
  return sodiumReady;
}

const b64 = (u: Uint8Array) => sodium.to_base64(u, sodium.base64_variants.ORIGINAL);
const unb64 = (s: string) => sodium.from_base64(s, sodium.base64_variants.ORIGINAL);

// ---------- private key at rest (DPAPI + local storage) ----------

async function storePrivateKey(priv: Uint8Array): Promise<void> {
  const blob = await invoke<string>('dpapi_encrypt', { plain: b64(priv) });
  localStorage.setItem(PRIV_STORAGE_KEY, DPAPI_PREFIX + blob);
}

export async function loadPrivateKey(): Promise<Uint8Array | null> {
  await ready();
  const stored = localStorage.getItem(PRIV_STORAGE_KEY);
  if (!stored?.startsWith(DPAPI_PREFIX)) return null;
  try {
    const plain = await invoke<string>('dpapi_decrypt', {
      blob: stored.slice(DPAPI_PREFIX.length),
    });
    return unb64(plain);
  } catch {
    return null; // different Windows user / corrupted blob
  }
}

function derivePub(priv: Uint8Array): Uint8Array {
  return sodium.crypto_scalarmult_base(priv);
}

async function publishPub(pub: Uint8Array): Promise<string | null> {
  const user = await currentUser();
  if (!user) return 'not signed in';
  const { error } = await supabase
    .from('profiles')
    .update({ e2e_pub: b64(pub) })
    .eq('user_id', user.id);
  return error ? error.message : null;
}

export type KeyStatus = 'ok' | 'restore-needed' | 'error';

/**
 * Makes sure this device holds a private key matching the published public
 * key. Covers every scenario:
 * - fresh account/device, nothing anywhere → generate + publish + store
 * - key here, none published (interrupted setup) → publish the derived pub
 * - key here but a DIFFERENT pub published (another device rotated) → restore-needed
 * - pub published but no key here (new PC / reinstall) → restore-needed
 */
export async function ensureKeys(publishedPub: string | null): Promise<KeyStatus> {
  await ready();
  try {
    const priv = await loadPrivateKey();
    if (priv) {
      const myPub = b64(derivePub(priv));
      if (!publishedPub) {
        return (await publishPub(derivePub(priv))) ? 'error' : 'ok';
      }
      return publishedPub === myPub ? 'ok' : 'restore-needed';
    }
    if (publishedPub) return 'restore-needed';
    const pair = sodium.crypto_box_keypair();
    await storePrivateKey(pair.privateKey);
    return (await publishPub(pair.publicKey)) ? 'error' : 'ok';
  } catch {
    return 'error';
  }
}

/** Fresh keypair: publishes the new pub and drops any stale cloud backup. */
export async function rotateKeys(): Promise<string | null> {
  await ready();
  const user = await currentUser();
  if (!user) return 'not signed in';
  const pair = sodium.crypto_box_keypair();
  await storePrivateKey(pair.privateKey);
  const err = await publishPub(pair.publicKey);
  if (err) return err;
  await supabase.from('key_backups').delete().eq('user_id', user.id);
  return null;
}

// ---------- message encryption ----------

export interface CipherEnvelope {
  nonce: string;
  bodyCt: string;
  senderPub: string;
  recipientPub: string;
}

export async function encryptTo(plaintext: string, recipientPubB64: string): Promise<CipherEnvelope | null> {
  await ready();
  const priv = await loadPrivateKey();
  if (!priv) return null;
  const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
  const ct = sodium.crypto_box_easy(
    sodium.from_string(plaintext),
    nonce,
    unb64(recipientPubB64),
    priv,
  );
  return {
    nonce: b64(nonce),
    bodyCt: b64(ct),
    senderPub: b64(derivePub(priv)),
    recipientPub: recipientPubB64,
  };
}

/**
 * Opens a message row. `mine` = I authored it. Uses the pubkeys snapshotted
 * on the row, so friend-side rotation can't brick old history. Returns null
 * when this device's key can't open it (e.g. the row predates a rotation).
 */
export async function decryptRow(
  row: { nonce: string; body_ct: string; sender_pub: string; recipient_pub: string },
  mine: boolean,
): Promise<string | null> {
  await ready();
  const priv = await loadPrivateKey();
  if (!priv) return null;
  try {
    const otherPub = mine ? row.recipient_pub : row.sender_pub;
    const plain = sodium.crypto_box_open_easy(
      unb64(row.body_ct),
      unb64(row.nonce),
      unb64(otherPub),
      priv,
    );
    return sodium.to_string(plain);
  } catch {
    return null; // wrong/rotated key or tampered ciphertext
  }
}

// ---------- passphrase-encrypted cloud backup of the private key ----------

function kdf(passphrase: string, salt: Uint8Array): Uint8Array {
  return sodium.crypto_pwhash(
    sodium.crypto_secretbox_KEYBYTES,
    passphrase,
    salt,
    sodium.crypto_pwhash_OPSLIMIT_MODERATE,
    sodium.crypto_pwhash_MEMLIMIT_MODERATE,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
  );
}

export async function backupKeyToCloud(passphrase: string): Promise<string | null> {
  await ready();
  const user = await currentUser();
  if (!user) return 'not signed in';
  const priv = await loadPrivateKey();
  if (!priv) return 'no key on this device';
  const salt = sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES);
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const ct = sodium.crypto_secretbox_easy(priv, nonce, kdf(passphrase, salt));
  const { error } = await supabase.from('key_backups').upsert({
    user_id: user.id,
    salt: b64(salt),
    nonce: b64(nonce),
    key_ct: b64(ct),
    updated_at: new Date().toISOString(),
  });
  return error ? error.message : null;
}

export async function hasCloudBackup(): Promise<boolean> {
  const user = await currentUser();
  if (!user) return false;
  const { data } = await supabase
    .from('key_backups')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle();
  return !!data;
}

export type RestoreResult = 'ok' | 'no-backup' | 'wrong-pass' | 'error';

export async function restoreKeyFromCloud(passphrase: string): Promise<RestoreResult> {
  await ready();
  const user = await currentUser();
  if (!user) return 'error';
  const { data } = await supabase
    .from('key_backups')
    .select('salt, nonce, key_ct')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!data) return 'no-backup';
  try {
    const row = data as { salt: string; nonce: string; key_ct: string };
    const priv = sodium.crypto_secretbox_open_easy(
      unb64(row.key_ct),
      unb64(row.nonce),
      kdf(passphrase, unb64(row.salt)),
    );
    await storePrivateKey(priv);
    // re-publish so the published pub always matches the restored key
    const err = await publishPub(derivePub(priv));
    return err ? 'error' : 'ok';
  } catch {
    return 'wrong-pass'; // secretbox MAC failed — bad passphrase (or corrupt)
  }
}

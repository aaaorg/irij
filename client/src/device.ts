// Device ID — stabilní identifier pro guest auth (Nakama authenticateDevice).
// Persistujeme v localStorage, aby se hráč po reloadu vrátil ke stejnému Nakama userId.
// Prázdný localStorage (incognito, vymazaná data) = nový account; to je očekávané.

const STORAGE_KEY = 'irij.device_id';

// Nakama vyžaduje device_id délky 10–128 znaků.
const MIN_LEN = 10;
const MAX_LEN = 128;

export function getOrCreateDeviceId(): string {
  const existing = readStored();
  if (existing) return existing;

  const fresh = generateDeviceId();
  try {
    localStorage.setItem(STORAGE_KEY, fresh);
  } catch {
    // localStorage nemusí být dostupný (Safari private mode, blokované storage).
    // V takovém případě jen vrátíme freshly-generated ID — appka pojede,
    // ale po reloadu dostane nový account. Nechceme blokovat run.
  }
  return fresh;
}

function readStored(): string | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (!value) return null;
    if (value.length < MIN_LEN || value.length > MAX_LEN) return null;
    return value;
  } catch {
    return null;
  }
}

function generateDeviceId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `irij-${crypto.randomUUID()}`;
  }
  // Fallback pro starší prostředí bez crypto.randomUUID.
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `irij-${hex}`;
}

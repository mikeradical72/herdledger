// Data layer. v1 keeps everything in this browser (localStorage).
// Phase 2: add a SupabaseStore with the same async interface
// (load / save / clear) and pick it in getStore() when the user is signed in.

const KEY = "herdledger.v1";
export const SCHEMA_VERSION = 1;

export const emptyState = () => ({
  schema: SCHEMA_VERSION,
  operation: { name: "My Operation", owner: "" },
  lots: [],
  expenses: [],
  positions: [],
  snapshots: [],
  settings: { plan: "choice" },
});

class LocalStore {
  async load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return emptyState();
      return normalize(JSON.parse(raw));
    } catch (e) {
      console.warn("HerdLedger: could not read saved data", e);
      return emptyState();
    }
  }
  async save(state) {
    localStorage.setItem(KEY, JSON.stringify(state));
  }
  async clear() {
    localStorage.removeItem(KEY);
  }
}

export function normalize(s) {
  const base = emptyState();
  const out = { ...base, ...s };
  for (const k of ["lots", "expenses", "positions", "snapshots"]) if (!Array.isArray(out[k])) out[k] = [];
  out.operation = { ...base.operation, ...(s.operation || {}) };
  out.settings = { ...base.settings, ...(s.settings || {}) };
  return out;
}

export function validateBackup(obj) {
  if (!obj || typeof obj !== "object") throw new Error("Not a HerdLedger backup file.");
  if (!Array.isArray(obj.lots)) throw new Error("Backup is missing the lots list.");
  return normalize(obj);
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

let store;
export function getStore() {
  return (store ||= new LocalStore());
}

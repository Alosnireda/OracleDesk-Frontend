export type PendingState = "submitted" | "verifying" | "verified" | "failed-terminal" | "needs-auth";

export interface PendingPayment {
  /** Lowercase 64-character hex transaction hash; the primary key. */
  txHash: string;
  kind: "DAILY_PASS";
  amountRaw: string;
  from: string;
  recipient: string;
  networkPassphrase: string;
  createdAt: number;
  attempts: number;
  lastError?: { code: string; status: number };
  state: PendingState;
}

const STORAGE_KEY = "oracledesk_pending_payments_v1";
const VERIFIED_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type PendingMap = Record<string, PendingPayment>;

function isPendingPayment(value: unknown): value is PendingPayment {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.txHash === "string" &&
    typeof candidate.amountRaw === "string" &&
    /^\d+$/.test(candidate.amountRaw) &&
    typeof candidate.from === "string" &&
    typeof candidate.recipient === "string" &&
    typeof candidate.networkPassphrase === "string" &&
    typeof candidate.createdAt === "number" &&
    typeof candidate.attempts === "number" &&
    typeof candidate.state === "string"
  );
}

function readAll(): PendingMap {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};

    const map: PendingMap = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (isPendingPayment(value)) map[key] = value;
    }
    return map;
  } catch {
    return {};
  }
}

function writeAll(map: PendingMap): boolean {
  const now = Date.now();
  const pruned: PendingMap = {};
  for (const [key, entry] of Object.entries(map)) {
    if (entry.state === "verified" && now - entry.createdAt > VERIFIED_TTL_MS) continue;
    pruned[key] = entry;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(pruned));
    return true;
  } catch {
    return false;
  }
}

/** Stores a payment before verification starts. Returns false if the browser refused the write. */
export function savePending(payment: PendingPayment): boolean {
  const txHash = payment.txHash.toLowerCase();
  const map = readAll();
  map[txHash] = { ...payment, txHash };
  return writeAll(map);
}

export function updatePending(txHash: string, patch: Partial<PendingPayment>): void {
  const key = txHash.toLowerCase();
  const map = readAll();
  const existing = map[key];
  if (!existing) return;
  map[key] = { ...existing, ...patch, txHash: key };
  writeAll(map);
}

/** Payments for one wallet on one network, oldest first. */
export function listPending(wallet: string, network: string): PendingPayment[] {
  return Object.values(readAll())
    .filter((entry) => entry.from === wallet && entry.networkPassphrase === network)
    .sort((a, b) => a.createdAt - b.createdAt);
}

export function removePending(txHash: string): void {
  const key = txHash.toLowerCase();
  const map = readAll();
  if (!(key in map)) return;
  delete map[key];
  writeAll(map);
}

/** A payment still needs the user's attention or a retry; the purchase button stays blocked. */
export function isUnfinishedPayment(entry: PendingPayment): boolean {
  return entry.state !== "verified" && entry.state !== "failed-terminal";
}

"use client";
import { Icon } from "@/components/ui/icon";

import React, { Suspense, useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { getTrace } from "@/lib/api/traces";
import { CONTRACTS, explorerAccount } from "@/lib/stellar/config";
import { reasoningRegistry } from "@/lib/stellar/clients";
import { read, bytesToHex } from "@/lib/stellar/typed-call";
import { ipfsUrl, verifyTraceInWorker, type GatewayAttempt, type CidCheck, type TraceCheck } from "@/lib/stellar/trace";
import { SafeTraceViewer } from "@/components/safe-trace-viewer";
import { MarketTraceAudit } from "@/components/market-trace-audit";

interface VerificationResult {
  verified: boolean;
  status: TraceCheck["status"];
  onChainTraceId: string;
  ipfsCid: string;
  storedHash: string;
  computedHash: string | null;
  reason?: string;
  attempts?: GatewayAttempt[];
  cidCheck?: CidCheck;
  content?: unknown;
}

const GATEWAY_OUTCOME_LABEL: Record<GatewayAttempt["outcome"], string> = {
  verified: "Verified",
  mismatch: "Bytes don't match",
  "http-error": "HTTP error",
  timeout: "Timed out",
  "too-large": "Over size limit",
  network: "Unreachable",
  aborted: "Stopped",
  skipped: "Not needed",
};

const formatBytes = (bytes: number) => (bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

const hostOf = (gateway: string) => {
  try {
    return new URL(gateway).host;
  } catch {
    return gateway;
  }
};

function describeCid(cidCheck: CidCheck | undefined, status: TraceCheck["status"]): string | null {
  switch (cidCheck) {
    case "match":
      return "CID check: the CID names these exact bytes.";
    case "mismatch":
      return status === "verified"
        ? "CID check: the CID doesn't name these bytes, but the on-chain hash does. The publish is inconsistent."
        : "CID check: the CID doesn't name these bytes either. The gateway may have served the wrong object.";
    case "unsupported":
      return "CID check: not checkable here (only single-block raw CIDs are checked).";
    case "invalid":
      return "CID check: not a valid CID, so it wasn't checked.";
    default:
      return null;
  }
}

export default function VerifyTracePage() {
  return (
    <Suspense fallback={<main className="min-h-[calc(100vh-64px)] flex items-center justify-center">Loading…</main>}>
      <VerifyTraceContent />
    </Suspense>
  );
}

function VerifyTraceContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const traceId = searchParams.get("traceId");
  const onChainTraceIdParam = searchParams.get("onChainTraceId");
  const marketIdParam = searchParams.get("marketId");
  const onChainMarketIdParam = searchParams.get("onChainMarketId");

  const [activeTab, setActiveTab] = useState<"trace" | "market">(
    marketIdParam || onChainMarketIdParam ? "market" : "trace",
  );
  const [marketIdInput, setMarketIdInput] = useState(
    onChainMarketIdParam || marketIdParam || "1",
  );

  const [isVerifying, setIsVerifying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [terminalLogs, setTerminalLogs] = useState<string[]>([]);
  const [isComplete, setIsComplete] = useState(false);
  const [statusLabel, setStatusLabel] = useState("Ready to check this trace against the chain");
  const [verificationResult, setVerificationResult] = useState<VerificationResult | null>(null);
  const terminalRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [terminalLogs]);

  // Leaving the page stops any download still running.
  useEffect(() => () => abortRef.current?.abort(), []);

  const log = (line: string, pct: number) => {
    setTerminalLogs((prev) => [...prev, line]);
    setProgress(pct);
  };

  const fail = (message: string) => {
    setIsVerifying(false);
    setStatusLabel("Verification Failed");
    setTerminalLogs((prev) => [...prev, `>> [ERROR] ${message}`]);
  };

  const startVerification = async () => {
    if (isVerifying || isComplete || (!traceId && !onChainTraceIdParam)) return;
    setIsVerifying(true);
    setStatusLabel("Checking…");
    setTerminalLogs([]);

    try {
      // 1. Which on-chain trace?
      let onChainTraceId = onChainTraceIdParam;
      if (!onChainTraceId && traceId) {
        log(">> [INIT] Looking up the trace in OracleDesk…", 10);
        const trace = await getTrace(traceId);
        onChainTraceId = trace.onChainTraceId ?? null;
        if (!onChainTraceId) return fail("This trace hasn't been published on-chain yet, so there is nothing to verify against.");
      }

      // 2. Read the commitment from reasoning-registry.
      log(`>> [CHAIN] reasoning_registry.get_trace(${onChainTraceId}) on ${CONTRACTS.reasoningRegistry.slice(0, 8)}…`, 30);
      const onChain = read(
        await reasoningRegistry().get_trace({ trace_id: BigInt(onChainTraceId as string) }),
        "reasoningRegistry",
      );
      const storedHash = bytesToHex(onChain.trace_hash);
      log(`>> [CHAIN] On-chain hash: ${storedHash}`, 50);
      log(`>> [IPFS] Fetching ${onChain.ipfs_cid}`, 60);

      // 3. Fetch the exact bytes and hash them in the trace worker.
      const controller = new AbortController();
      abortRef.current = controller;
      const check = await verifyTraceInWorker(onChain.ipfs_cid, storedHash, {
        signal: controller.signal,
        onProgress: ({ received, total }) => {
          setStatusLabel(`Downloading ${formatBytes(received)}${total ? ` of ${formatBytes(total)}` : ""}`);
          setProgress(total ? 60 + Math.min(29, Math.floor((received / total) * 30)) : 60);
        },
      });
      abortRef.current = null;
      if (controller.signal.aborted) {
        setIsVerifying(false);
        setStatusLabel("Verification stopped");
        setTerminalLogs((prev) => [...prev, ">> [STOP] Download stopped. Nothing was verified."]);
        return;
      }

      const result: VerificationResult = {
        verified: check.status === "verified",
        status: check.status,
        onChainTraceId: onChainTraceId as string,
        ipfsCid: onChain.ipfs_cid,
        storedHash,
        computedHash: check.status === "unavailable" ? null : check.computedHash,
        reason: check.status === "unavailable" ? check.reason : undefined,
        attempts: check.attempts,
        cidCheck: check.status === "unavailable" ? undefined : check.cidCheck,
        content: check.status === "verified" ? check.content : undefined,
      };
      if (check.status === "unavailable") {
        log(`>> [IPFS] ${check.reason}. The content can't be checked.`, 90);
      } else {
        log(`>> [LOCAL] sha256 of the bytes received: ${check.computedHash}`, 90);
      }
      queryClient.setQueryData(["stellar", "trace", onChainTraceId], undefined);
      completeVerification(result);
    } catch (err) {
      abortRef.current = null;
      fail(err instanceof Error ? err.message : "Couldn't read the trace from the chain.");
    }
  };

  const stopDownload = () => abortRef.current?.abort();

  const completeVerification = (result: VerificationResult) => {
    setVerificationResult(result);
    setStatusLabel(
      result.status === "verified" ? "Verification Complete" : result.status === "mismatch" ? "Verification Failed" : "Content Unavailable",
    );
    setTerminalLogs((prev) => [
      ...prev,
      result.status === "verified"
        ? ">> [SUCCESS] The content matches the on-chain hash."
        : result.status === "mismatch"
          ? ">> [FAIL] The content does NOT match the on-chain hash. Don't trust it."
          : ">> [FAIL] The content couldn't be fetched, so it wasn't verified.",
    ]);
    setIsComplete(true);
    setIsVerifying(false);
    setProgress(100);
  };

  return (
    <main className="relative min-h-[calc(100vh-64px)] pt-24 pb-16 px-gutter max-w-container-max-width mx-auto overflow-hidden">
      <style jsx global>{`
        @keyframes scanline {
          0% { transform: translateY(-100%); opacity: 0; }
          50% { opacity: 1; }
          100% { transform: translateY(1000%); opacity: 0; }
        }
        .scan-effect {
          position: relative;
          overflow: hidden;
        }
        .scan-effect::after {
          content: "";
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 2px;
          background: linear-gradient(to right, transparent, #005f73, transparent);
          animation: scanline 3s linear infinite;
        }
        @keyframes pulse-ring {
          0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(0, 108, 73, 0.4); }
          70% { transform: scale(1); box-shadow: 0 0 0 10px rgba(0, 108, 73, 0); }
          100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(0, 108, 73, 0); }
        }
        .success-pulse {
          animation: pulse-ring 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }
      `}</style>

      <div className="grid grid-cols-12 gap-6 opacity-40 pointer-events-none filter blur-sm transition-all duration-700">
        <div className="col-span-12 md:col-span-8 bg-surface-container-lowest border border-outline-variant p-6 rounded-xl">
          <div className="h-6 w-48 bg-surface-container rounded mb-4"></div>
          <div className="h-32 bg-surface-container rounded mb-4"></div>
          <div className="space-y-2">
            <div className="h-4 w-full bg-surface-container rounded"></div>
            <div className="h-4 w-5/6 bg-surface-container rounded"></div>
            <div className="h-4 w-4/6 bg-surface-container rounded"></div>
          </div>
        </div>
        <div className="col-span-12 md:col-span-4 space-y-6">
          <div className="bg-surface-container-lowest border border-outline-variant p-6 rounded-xl">
            <div className="h-6 w-24 bg-surface-container rounded mb-4"></div>
            <div className="h-20 bg-surface-container rounded"></div>
          </div>
          <div className="bg-surface-container-lowest border border-outline-variant p-6 rounded-xl">
            <div className="h-40 bg-surface-container rounded"></div>
          </div>
        </div>
      </div>

      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-on-background/10 backdrop-blur-sm overflow-y-auto">
        <motion.div 
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          className={`bg-white w-full ${activeTab === "market" ? "max-w-5xl" : "max-w-2xl"} my-8 rounded-xl border border-outline-variant shadow-2xl overflow-hidden flex flex-col max-h-[90vh]`}
        >
          <div className="p-6 border-b border-outline-variant flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-surface-container-low shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary-container flex items-center justify-center">
                <Icon name="verified_user" filled className="text-on-primary-container" />
              </div>
              <div>
                <h2 className="font-headline-sm text-headline-sm text-on-surface">
                  {activeTab === "market" ? "Market Trace Integrity Audit" : "Verify Trace Integrity"}
                </h2>
                <p className="font-label-caps text-label-caps text-on-surface-variant">
                  {activeTab === "market"
                    ? `MARKET #${marketIdInput}`
                    : onChainTraceIdParam ? `ON-CHAIN TRACE #${onChainTraceIdParam}` : traceId ? `TRACE-ID: ${traceId.substring(0, 12)}…` : "NO TRACE SELECTED"}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end">
              <div className="flex bg-surface-container p-1 rounded-lg">
                <button
                  type="button"
                  onClick={() => setActiveTab("trace")}
                  className={`px-3 py-1 rounded text-xs font-label-caps font-bold transition-colors ${activeTab === "trace" ? "bg-surface text-primary shadow-sm" : "text-on-surface-variant hover:text-on-surface"}`}
                >
                  Single Trace
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("market")}
                  className={`px-3 py-1 rounded text-xs font-label-caps font-bold transition-colors ${activeTab === "market" ? "bg-surface text-primary shadow-sm" : "text-on-surface-variant hover:text-on-surface"}`}
                >
                  Market Audit
                </button>
              </div>
              <Link href="/reasoning" aria-label="Close" className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-surface-variant transition-colors">
                <span className="material-symbols-outlined text-on-surface-variant">close</span>
              </Link>
            </div>
          </div>

          {activeTab === "market" ? (
            <div className="p-6 space-y-6 overflow-y-auto">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-surface-container-low p-4 rounded-lg border border-outline-variant">
                <div className="flex items-center gap-3">
                  <label htmlFor="audit-market-id" className="text-xs font-label-caps text-on-surface font-bold">
                    Market ID:
                  </label>
                  <input
                    id="audit-market-id"
                    type="text"
                    value={marketIdInput}
                    onChange={(e) => setMarketIdInput(e.target.value)}
                    placeholder="e.g. 1"
                    className="border border-outline-variant rounded px-3 py-1.5 text-xs font-data-mono bg-surface text-on-surface w-28"
                  />
                </div>
                <p className="text-xs text-on-surface-variant">
                  Queries reasoning-registry for all published traces on this market and verifies content against IPFS.
                </p>
              </div>

              <MarketTraceAudit
                key={marketIdInput}
                onChainMarketId={marketIdInput}
                marketId={marketIdParam}
              />
            </div>
          ) : (
            <div className="p-8 space-y-8 overflow-y-auto">
              <div className="relative">
                <div className="flex justify-between mb-2">
                  <span className={`font-label-caps text-label-caps ${isComplete ? (verificationResult?.verified ? 'text-secondary' : 'text-error') : 'text-primary'}`}>{statusLabel}</span>
                  <span className="font-data-mono text-data-mono text-primary">{progress}%</span>
                </div>
                <div className="h-2 w-full bg-surface-container rounded-full overflow-hidden">
                  <div 
                    className={`h-full ${isComplete && !verificationResult?.verified ? 'bg-error' : 'bg-primary'} transition-all duration-300 ease-out`} 
                    style={{ width: `${progress}%` }}
                  ></div>
                </div>
              </div>

              <div className="bg-on-background rounded-lg p-6 font-data-mono text-data-mono h-64 overflow-y-auto scan-effect shadow-inner custom-scrollbar" ref={terminalRef}>
                <div className="space-y-1 text-secondary-fixed">
                  {terminalLogs.map((log, i) => (
                    <motion.p 
                      key={i}
                      initial={{ opacity: 0, x: 10 }}
                      animate={{ opacity: 1, x: 0 }}
                      className={log && log.includes("[SUCCESS]") ? "text-secondary font-bold" : log.includes("[FAIL]") || log.includes("[ERROR]") ? "text-error font-bold" : "text-secondary-fixed opacity-80"}
                    >
                      {log}
                    </motion.p>
                  ))}
                  {!isVerifying && !isComplete && (
                    <p className="text-surface-variant opacity-50">&gt;&gt; Fetches the content, hashes the exact bytes and compares them with reasoning-registry.</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 bg-surface-container-low border border-outline-variant rounded-lg">
                  <label className="font-label-caps text-label-caps text-on-surface-variant block mb-2">STORED HASH (ON-CHAIN)</label>
                  <code className="text-xs break-all text-on-surface font-data-mono">
                    {isComplete && verificationResult ? verificationResult.storedHash : "****************************************"}
                  </code>
                </div>
                <div className="p-4 bg-surface-container-low border border-outline-variant rounded-lg relative overflow-hidden">
                  {!isComplete && (
                    <div className="absolute inset-0 bg-surface-container-low/80 flex items-center justify-center backdrop-blur-[1px]">
                      <span className={`${isVerifying ? 'animate-pulse' : ''} text-primary font-label-caps`}>
                        {isVerifying ? 'COMPUTING...' : 'AWAITING START'}
                      </span>
                    </div>
                  )}
                  <label className="font-label-caps text-label-caps text-on-surface-variant block mb-2">COMPUTED HASH (LOCAL)</label>
                  <code className={`text-xs break-all font-data-mono ${isComplete ? (verificationResult?.verified ? 'text-secondary font-bold' : 'text-error font-bold') : 'text-on-surface'}`}>
                    {isComplete && verificationResult ? verificationResult.computedHash ?? "not available" : "****************************************"}
                  </code>
                </div>
              </div>

              <AnimatePresence>
                {isComplete && verificationResult && (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className={`transform ${verificationResult.verified ? 'bg-primary-container border-secondary text-on-primary-container' : 'bg-error-container/20 border-error text-error'} border p-4 rounded-lg flex items-center gap-4`}
                  >
                    <div className="w-10 h-10 rounded-lg bg-primary-container flex items-center justify-center">
                      <span className="material-symbols-outlined text-on-primary-container" style={{ fontVariationSettings: "'FILL' 1" }}>verified_user</span>
                    </div>
                    <div className="flex-1">
                      <h3 className="font-headline-sm text-headline-sm">
                        {verificationResult.verified ? 'Trace verified' : verificationResult.status === 'mismatch' ? 'Integrity check failed' : 'Content unavailable'}
                      </h3>
                      <p className="text-sm opacity-80">
                        {verificationResult.verified
                          ? 'The content hashes to exactly the value recorded in reasoning-registry.'
                          : verificationResult.status === 'mismatch'
                            ? "The content doesn't match the on-chain hash. It may have been altered."
                            : `${verificationResult.reason ?? "The content couldn't be fetched"}, so it wasn't verified.`}
                      </p>
                    </div>
                    <div className="flex flex-col gap-2">
                      {verificationResult.ipfsCid && (
                        <a className={`flex items-center gap-2 px-4 py-2 bg-white border ${verificationResult.verified ? 'border-secondary text-secondary' : 'border-error text-error'} font-label-caps rounded hover:brightness-95 transition-all text-xs`} href={ipfsUrl(verificationResult.ipfsCid)} target="_blank" rel="noopener noreferrer">
                          <span className="material-symbols-outlined text-sm">link</span>
                          View IPFS
                        </a>
                      )}
                      <a className={`flex items-center gap-2 px-4 py-2 bg-white border ${verificationResult.verified ? 'border-secondary text-secondary' : 'border-error text-error'} font-label-caps rounded hover:brightness-95 transition-all text-xs`} href={explorerAccount(CONTRACTS.reasoningRegistry)} target="_blank" rel="noopener noreferrer">
                        <span className="material-symbols-outlined text-sm">search</span>
                        View on Stellar Expert
                      </a>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {isComplete && verificationResult?.verified && verificationResult.content && (
                <SafeTraceViewer
                  content={verificationResult.content}
                  verified={true}
                  ipfsCid={verificationResult.ipfsCid}
                  traceHash={verificationResult.storedHash}
                  title="Verified Reasoning Content"
                />
              )}

              {isComplete && verificationResult?.attempts && verificationResult.attempts.length > 0 && (
                <div className="p-4 bg-surface-container-low border border-outline-variant rounded-lg space-y-3">
                  <label className="font-label-caps text-label-caps text-on-surface-variant block">GATEWAY ATTEMPTS</label>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs font-data-mono text-on-surface">
                      <thead>
                        <tr className="text-left text-on-surface-variant">
                          <th className="pr-3 pb-1 font-normal">Gateway</th>
                          <th className="pr-3 pb-1 font-normal">Outcome</th>
                          <th className="pr-3 pb-1 font-normal">Time</th>
                          <th className="pb-1 font-normal">Bytes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {verificationResult.attempts.map((attempt, i) => (
                          <tr key={`${attempt.gateway}-${i}`}>
                            <td className="pr-3 py-1">{hostOf(attempt.gateway)}</td>
                            <td className="pr-3 py-1">
                              {GATEWAY_OUTCOME_LABEL[attempt.outcome]}
                              {attempt.status ? ` (${attempt.status})` : ""}
                            </td>
                            <td className="pr-3 py-1">{attempt.outcome === "skipped" ? "—" : `${attempt.ms} ms`}</td>
                            <td className="py-1">{attempt.bytes !== undefined ? formatBytes(attempt.bytes) : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {describeCid(verificationResult.cidCheck, verificationResult.status) && (
                    <p className="text-xs text-on-surface-variant">
                      {describeCid(verificationResult.cidCheck, verificationResult.status)}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {activeTab === "market" ? (
            <div className="p-4 bg-surface-container-low border-t border-outline-variant flex justify-between items-center text-xs text-on-surface-variant font-data-mono shrink-0">
              <span>Contract: {CONTRACTS.reasoningRegistry.slice(0, 10)}…</span>
              <Link href="/reasoning" className="px-4 py-2 font-label-caps text-primary hover:underline font-bold uppercase">
                Back to Feed
              </Link>
            </div>
          ) : (
            <div className="p-6 bg-surface-container-low border-t border-outline-variant flex justify-end gap-3 shrink-0">
              <Link href="/reasoning" className="px-6 py-2 font-label-caps text-on-surface-variant hover:text-on-surface transition-colors uppercase">
                {isComplete ? "BACK TO FEED" : "CANCEL AUDIT"}
              </Link>

              {isVerifying && !isComplete && (
                <button className="px-6 py-2 font-label-caps text-error hover:brightness-95 transition-all uppercase" onClick={stopDownload}>
                  STOP DOWNLOAD
                </button>
              )}

              <button 
                className={`px-8 py-2 text-primary-foreground font-label-caps rounded transition-all active:scale-95 ${isComplete ? (verificationResult?.verified ? 'bg-secondary' : 'bg-error') : 'bg-primary hover:bg-primary-container'} ${(isVerifying && !isComplete) ? 'opacity-50 cursor-not-allowed' : ''}`}
                onClick={() => isComplete ? router.push('/reasoning') : startVerification()}
                disabled={isVerifying && !isComplete}
              >
                {isComplete ? "DONE" : isVerifying ? "VERIFYING..." : "BEGIN VERIFICATION"}
              </button>
            </div>
          )}
        </motion.div>
      </div>
    </main>
  );
}

import type { TrackedJobStatus } from "@/lib/admin/job-store";

const CHIP: Record<TrackedJobStatus, { label: string; className: string }> = {
  RUNNING: { label: "Running", className: "bg-primary-container text-on-primary-container" },
  COMPLETED: { label: "Completed", className: "bg-secondary-container text-on-secondary-container" },
  FAILED: { label: "Failed", className: "bg-error-container text-on-error-container" },
  UNKNOWN: { label: "Unknown", className: "bg-tertiary-container text-on-tertiary-container" },
  NOT_FOUND: { label: "Not tracked", className: "bg-surface-container-highest text-on-surface-variant" },
};

/** Status pill for a market-generation job. */
export function JobStatusChip({ status }: { status: TrackedJobStatus }) {
  const chip = CHIP[status];
  return <span className={`px-2 py-0.5 rounded font-label-caps text-[10px] uppercase ${chip.className}`}>{chip.label}</span>;
}

"use client";

import { useReportWebVitals } from "next/web-vitals";
import { sendVitals } from "@/lib/observability/vitals";

export function WebVitals() {
  useReportWebVitals((metric) => {
    sendVitals(metric);
  });

  return null;
}

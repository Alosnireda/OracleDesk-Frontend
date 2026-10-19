"use client";

import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
  useSyncExternalStore,
} from "react";
import {
  useWindowVirtualizer,
  useVirtualizer,
  defaultRangeExtractor,
  type Range,
} from "@tanstack/react-virtual";
import {
  columnsForWidth,
  rowsFromItems,
  type ColumnConfig,
} from "@/lib/ui/virtual-math";

export interface VirtualListProps<T> {
  items: readonly T[];
  getKey: (item: T, index: number) => string;
  estimateSize: (index: number) => number;
  renderItem: (
    item: T,
    index: number,
    a11y: { "aria-posinset": number; "aria-setsize": number }
  ) => ReactNode;
  columns?: ColumnConfig;
  overscan?: number;
  mode?: "window" | "container";
  ariaLabel: string;
  role?: "feed" | "list";
  totalCount?: number;
  onEndReached?: () => void;
  restorationKey?: string;
  className?: string;
}

function useWindowWidth(): number {
  const subscribe = useCallback((callback: () => void) => {
    window.addEventListener("resize", callback, { passive: true });
    return () => window.removeEventListener("resize", callback);
  }, []);

  const getSnapshot = () => (typeof window !== "undefined" ? window.innerWidth : 1280);
  const getServerSnapshot = () => 1280;

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

function loadRestoration(key?: string): { offset: number; measurements: any; cols?: number } | null {
  if (!key || typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(`vl_restore_${key}`);
    if (raw) return JSON.parse(raw);
  } catch {
    // sessionStorage disabled or unavailable
  }
  return null;
}

function saveRestoration(key?: string, data?: { offset: number; measurements: any; cols?: number }) {
  if (!key || typeof window === "undefined" || !data) return;
  try {
    sessionStorage.setItem(`vl_restore_${key}`, JSON.stringify(data));
  } catch {
    // ignore
  }
}

export function VirtualList<T>({
  items,
  getKey,
  estimateSize,
  renderItem,
  columns,
  overscan = 3,
  mode = "window",
  ariaLabel,
  role = "list",
  totalCount,
  onEndReached,
  restorationKey,
  className = "",
}: VirtualListProps<T>) {
  const width = useWindowWidth();
  const currentCols = columnsForWidth(width, columns);
  const rows = rowsFromItems(items, currentCols);

  const containerRef = useRef<HTMLDivElement>(null);
  const [focusedRowIndex, setFocusedRowIndex] = useState<number | null>(null);

  // Focus preservation range extractor
  const rangeExtractor = useCallback(
    (range: Range) => {
      const active = defaultRangeExtractor(range);
      if (focusedRowIndex !== null && !active.includes(focusedRowIndex)) {
        active.push(focusedRowIndex);
        active.sort((a, b) => a - b);
      }
      return active;
    },
    [focusedRowIndex]
  );

  const initialRestored = useRef(loadRestoration(restorationKey));

  // Shared virtualizer options
  const count = rows.length;
  const initialOffset = initialRestored.current?.cols === currentCols ? initialRestored.current?.offset : 0;
  const initialMeasurementsCache =
    initialRestored.current?.cols === currentCols ? initialRestored.current?.measurements : undefined;

  const windowVirtualizer = useWindowVirtualizer({
    count,
    estimateSize,
    overscan,
    scrollMargin: 64, // Sticky navbar height (h-16 = 64px)
    rangeExtractor,
    initialOffset,
    initialMeasurementsCache,
    enabled: mode === "window",
  });

  const containerVirtualizer = useVirtualizer({
    count,
    getScrollElement: () => containerRef.current,
    estimateSize,
    overscan,
    rangeExtractor,
    initialOffset,
    initialMeasurementsCache,
    enabled: mode === "container",
  });

  const virtualizer = mode === "window" ? windowVirtualizer : containerVirtualizer;

  // Track end reached
  const lastIndex = count - 1;
  const virtualItems = virtualizer.getVirtualItems();
  const lastRendered = virtualItems.length > 0 ? virtualItems[virtualItems.length - 1].index : -1;

  useEffect(() => {
    if (onEndReached && lastIndex >= 0 && lastRendered >= lastIndex - overscan) {
      onEndReached();
    }
  }, [lastRendered, lastIndex, overscan, onEndReached]);

  // Save restoration state on unmount and pagehide
  useEffect(() => {
    if (!restorationKey) return;
    const handleSave = () => {
      saveRestoration(restorationKey, {
        offset: virtualizer.scrollOffset ?? 0,
        measurements: (virtualizer as any).measurementsCache ?? [],
        cols: currentCols,
      });
    };

    window.addEventListener("pagehide", handleSave);
    return () => {
      window.removeEventListener("pagehide", handleSave);
      handleSave();
    };
  }, [restorationKey, virtualizer, currentCols]);

  // Handle focus tracking to prevent unmounting focused items
  const handleFocus = (e: React.FocusEvent) => {
    const target = e.target as HTMLElement;
    const rowEl = target.closest<HTMLElement>("[data-virtual-row-index]");
    if (rowEl && rowEl.dataset.virtualRowIndex) {
      setFocusedRowIndex(parseInt(rowEl.dataset.virtualRowIndex, 10));
    }
  };

  const handleBlur = (e: React.FocusEvent) => {
    // If focus is leaving the virtual list entirely, clear
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setFocusedRowIndex(null);
    }
  };

  const effectiveSetSize = totalCount !== undefined ? totalCount : -1;

  return (
    <div
      ref={containerRef}
      role={role}
      aria-label={ariaLabel}
      onFocusCapture={handleFocus}
      onBlurCapture={handleBlur}
      className={`relative w-full ${mode === "container" ? "overflow-y-auto max-h-[80vh]" : ""} ${className}`}
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {virtualItems.map((virtualRow) => {
          const rowItems = rows[virtualRow.index] ?? [];
          const rowStartItemIndex = virtualRow.index * currentCols;

          return (
            <div
              key={virtualRow.key}
              data-virtual-row-index={virtualRow.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualRow.start - (mode === "window" ? virtualizer.options.scrollMargin : 0)}px)`,
              }}
            >
              <div
                className={
                  currentCols > 1
                    ? `grid gap-6 ${
                        currentCols === 2
                          ? "grid-cols-1 md:grid-cols-2"
                          : currentCols === 3
                          ? "grid-cols-1 md:grid-cols-2 xl:grid-cols-3"
                          : `grid-cols-${currentCols}`
                      }`
                    : ""
                }
              >
                {rowItems.map((item, colIdx) => {
                  const itemIndex = rowStartItemIndex + colIdx;
                  return (
                    <React.Fragment key={getKey(item, itemIndex)}>
                      {renderItem(item, itemIndex, {
                        "aria-posinset": itemIndex + 1,
                        "aria-setsize": effectiveSetSize,
                      })}
                    </React.Fragment>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export interface VirtualTableBodyProps<T> {
  items: readonly T[];
  getKey: (item: T, index: number) => string;
  estimateSize: (index: number) => number;
  renderRow: (
    item: T,
    index: number,
    a11y: { "aria-rowindex": number }
  ) => ReactNode;
  colSpan: number;
  overscan?: number;
  mode?: "window" | "container";
  totalCount?: number;
  onEndReached?: () => void;
  restorationKey?: string;
}

export function VirtualTableBody<T>({
  items,
  getKey,
  estimateSize,
  renderRow,
  colSpan,
  overscan = 4,
  mode = "window",
  totalCount,
  onEndReached,
  restorationKey,
}: VirtualTableBodyProps<T>) {
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);

  const rangeExtractor = useCallback(
    (range: Range) => {
      const active = defaultRangeExtractor(range);
      if (focusedIndex !== null && !active.includes(focusedIndex)) {
        active.push(focusedIndex);
        active.sort((a, b) => a - b);
      }
      return active;
    },
    [focusedIndex]
  );

  const initialRestored = useRef(loadRestoration(restorationKey));

  const windowVirtualizer = useWindowVirtualizer({
    count: items.length,
    estimateSize,
    overscan,
    scrollMargin: 64,
    rangeExtractor,
    initialOffset: initialRestored.current?.offset ?? 0,
    initialMeasurementsCache: initialRestored.current?.measurements,
    enabled: mode === "window",
  });

  const containerVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => null,
    estimateSize,
    overscan,
    rangeExtractor,
    initialOffset: initialRestored.current?.offset ?? 0,
    initialMeasurementsCache: initialRestored.current?.measurements,
    enabled: mode === "container",
  });

  const virtualizer = mode === "window" ? windowVirtualizer : containerVirtualizer;
  const virtualRows = virtualizer.getVirtualItems();

  const lastIndex = items.length - 1;
  const lastRendered = virtualRows.length > 0 ? virtualRows[virtualRows.length - 1].index : -1;

  useEffect(() => {
    if (onEndReached && lastIndex >= 0 && lastRendered >= lastIndex - overscan) {
      onEndReached();
    }
  }, [lastRendered, lastIndex, overscan, onEndReached]);

  useEffect(() => {
    if (!restorationKey) return;
    const handleSave = () => {
      saveRestoration(restorationKey, {
        offset: virtualizer.scrollOffset ?? 0,
        measurements: (virtualizer as any).measurementsCache ?? [],
      });
    };
    window.addEventListener("pagehide", handleSave);
    return () => {
      window.removeEventListener("pagehide", handleSave);
      handleSave();
    };
  }, [restorationKey, virtualizer]);

  const paddingTop = virtualRows.length > 0 ? virtualRows[0]?.start ?? 0 : 0;
  const totalSize = virtualizer.getTotalSize();
  const paddingBottom =
    virtualRows.length > 0
      ? totalSize - (virtualRows[virtualRows.length - 1]?.end ?? 0)
      : 0;

  const handleFocus = (e: React.FocusEvent) => {
    const target = e.target as HTMLElement;
    const rowEl = target.closest<HTMLElement>("[data-virtual-table-row]");
    if (rowEl && rowEl.dataset.virtualTableRow) {
      setFocusedIndex(parseInt(rowEl.dataset.virtualTableRow, 10));
    }
  };

  const handleBlur = (e: React.FocusEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setFocusedIndex(null);
    }
  };

  return (
    <tbody onFocusCapture={handleFocus} onBlurCapture={handleBlur}>
      {paddingTop > 0 && (
        <tr aria-hidden="true" style={{ height: `${paddingTop}px` }}>
          <td colSpan={colSpan} style={{ padding: 0, border: 0 }} />
        </tr>
      )}
      {virtualRows.map((virtualRow) => {
        const item = items[virtualRow.index];
        if (!item) return null;
        // aria-rowindex: header is row 1, data rows are 2..N
        const a11yRowIndex = virtualRow.index + 2;

        return (
          <React.Fragment key={getKey(item, virtualRow.index)}>
            {renderRow(item, virtualRow.index, {
              "aria-rowindex": a11yRowIndex,
            })}
          </React.Fragment>
        );
      })}
      {paddingBottom > 0 && (
        <tr aria-hidden="true" style={{ height: `${paddingBottom}px` }}>
          <td colSpan={colSpan} style={{ padding: 0, border: 0 }} />
        </tr>
      )}
    </tbody>
  );
}

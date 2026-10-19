import { describe, it, expect } from "vitest";
import { nextPageParam } from "@/lib/ui/virtual-math";

describe("nextPageParam calculation for infinite queries", () => {
  it("increments page when more pages are available", () => {
    expect(nextPageParam({ page: 1, totalPages: 5 })).toBe(2);
    expect(nextPageParam({ page: 4, totalPages: 5 })).toBe(5);
  });

  it("returns undefined on the last page", () => {
    expect(nextPageParam({ page: 5, totalPages: 5 })).toBeUndefined();
    expect(nextPageParam({ page: 6, totalPages: 5 })).toBeUndefined();
  });

  it("returns undefined when meta is missing or undefined", () => {
    expect(nextPageParam(undefined)).toBeUndefined();
    expect(nextPageParam(null)).toBeUndefined();
    expect(nextPageParam({} as any)).toBeUndefined();
  });
});

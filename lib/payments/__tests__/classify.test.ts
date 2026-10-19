import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/client";
import { classifyUnlockError, terminalMessage } from "../classify";

const apiError = (code: string, status: number) => new ApiError({ code, message: code }, status);

describe("classifyUnlockError", () => {
  it.each(["PAYMENT_NOT_FOUND", "CHAIN_READ_FAILED", "BACKEND_UNREACHABLE"])("retries %s", (code) => {
    expect(classifyUnlockError(apiError(code, 402))).toBe("retry");
  });

  it("retries any 5xx response", () => {
    expect(classifyUnlockError(apiError("HTTP_503", 503))).toBe("retry");
  });

  it.each(["TOKEN_EXPIRED", "INVALID_TOKEN", "UNAUTHORIZED"])("needs auth for %s", (code) => {
    expect(classifyUnlockError(apiError(code, 401))).toBe("needs-auth");
  });

  it.each([
    "PAYMENT_FAILED",
    "PAYMENT_WRONG_TOKEN",
    "PAYMENT_WRONG_SENDER",
    "PAYMENT_WRONG_RECIPIENT",
    "PAYMENT_INSUFFICIENT",
    "PAYMENT_ALREADY_USED",
    "ALLOWANCE_DAILY_LIMIT",
    "VALIDATION_ERROR",
  ])("treats %s as terminal", (code) => {
    expect(classifyUnlockError(apiError(code, 402))).toBe("terminal");
  });

  it("retries errors that are not API errors", () => {
    expect(classifyUnlockError(new TypeError("boom"))).toBe("retry");
  });
});

describe("terminalMessage", () => {
  it("explains the recipient mismatch", () => {
    expect(terminalMessage("PAYMENT_WRONG_RECIPIENT")).toContain("different recipient");
  });

  it("falls back to a generic message for unknown codes", () => {
    expect(terminalMessage("SOMETHING_NEW")).toContain("Contact support");
  });
});

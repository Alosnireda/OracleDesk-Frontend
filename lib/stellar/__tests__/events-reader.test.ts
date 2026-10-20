import { describe, expect, it, vi } from "vitest";
import { nativeToScVal, xdr, type rpc } from "@stellar/stellar-sdk";
import { eventWindow, fetchContractEvents } from "../events";
import { CONTRACTS } from "../config";

const contractId = CONTRACTS.reasoningRegistry;
const agentTopic = (address: string) => nativeToScVal(address, { type: "address" });

function event(id: string, ledger: number, topic0 = "agent_registered"): rpc.Api.EventResponse {
  return {
    id,
    type: "contract",
    ledger,
    ledgerClosedAt: `2026-01-01T00:00:${String(ledger % 60).padStart(2, "0")}Z`,
    txHash: "ab".repeat(32),
    contractId: { contractId: () => contractId },
    topic: [xdr.ScVal.scvSymbol(topic0), agentTopic("GCM7WU3RADBCIKBLGPPAEYV5WHASWMEQX6BU524QR3QFWSE7BIWCXAIF")],
    value: xdr.ScVal.scvVoid(),
    inSuccessfulContractCall: true,
    pagingToken: id,
  } as unknown as rpc.Api.EventResponse;
}

function page(
  events: rpc.Api.EventResponse[],
  cursor: string,
  latestLedger = 1000,
): rpc.Api.GetEventsResponse {
  return {
    events,
    cursor,
    latestLedger,
    oldestLedger: 900,
    latestLedgerCloseTime: "0",
    oldestLedgerCloseTime: "0",
  };
}

function serverWith(health: Partial<rpc.Api.GetHealthResponse>, pages: rpc.Api.GetEventsResponse[]) {
  const getEvents = vi.fn(async (request: rpc.Api.GetEventsRequest) => {
    void request;
    return pages.shift() ?? page([], "", health.latestLedger ?? 1000);
  });
  return {
    getHealth: vi.fn(async () => ({
      status: "healthy",
      latestLedger: 1000,
      oldestLedger: 900,
      ledgerRetentionWindow: 100,
      latestLedgerCloseTime: "0",
      oldestLedgerCloseTime: "0",
      ...health,
    } as rpc.Api.GetHealthResponse)),
    getEvents,
  };
}

describe("generic contract event reader", () => {
  it("reads the event window from getHealth", async () => {
    const server = serverWith({ oldestLedger: 800, latestLedger: 1000, ledgerRetentionWindow: 200 }, []);
    await expect(eventWindow(server)).resolves.toEqual({
      oldestLedger: 800,
      latestLedger: 1000,
      ledgerRetentionWindow: 200,
    });
  });

  it("falls back to the retention guess when oldestLedger is absent", async () => {
    const server = serverWith({ oldestLedger: 0, latestLedger: 1000, ledgerRetentionWindow: 10 }, []);
    const window = await eventWindow(server);
    expect(window.oldestLedger).toBe(990);
  });

  it("builds a topic0 + wildcard filter for a two-topic event", async () => {
    const server = serverWith({}, [page([], "")]);
    await fetchContractEvents({
      contractId,
      topic0: "agent_registered",
      topicCount: 2,
      server,
      startLedger: 900,
      endLedger: 1001,
    });
    const request = server.getEvents.mock.calls[0][0] as rpc.Api.GetEventsRequest;
    expect(request.filters?.[0].topics).toEqual([
      [xdr.ScVal.scvSymbol("agent_registered").toXDR("base64"), "*"],
    ]);
    expect(request.startLedger).toBe(900);
    expect(request.endLedger).toBe(1001);
  });

  it("honours an explicit topic filter from the binding spec", async () => {
    const server = serverWith({}, [page([], "")]);
    await fetchContractEvents({
      contractId,
      topics: ["prefix", "*", "*"],
      server,
      startLedger: 900,
      endLedger: 1001,
    });
    const request = server.getEvents.mock.calls[0][0] as rpc.Api.GetEventsRequest;
    expect(request.filters?.[0].topics).toEqual([["prefix", "*", "*"]]);
  });

  it("paginates with cursors, dedupes ids and stops on a short page", async () => {
    const server = serverWith({}, [
      page([event("1", 901), event("2", 902)], "c1"),
      page([event("2", 902), event("3", 903)], "c2"),
      page([], ""),
    ]);
    const result = await fetchContractEvents({
      contractId,
      topic0: "agent_registered",
      topicCount: 2,
      pageLimit: 2,
      server,
      startLedger: 900,
      endLedger: 1001,
    });
    expect(result.events.map((item) => item.id)).toEqual(["1", "2", "3"]);
    expect(result.pages).toBe(3);
    expect(result.partial).toBe(false);
    expect(server.getEvents).toHaveBeenCalledTimes(3);
    const second = server.getEvents.mock.calls[1][0] as rpc.Api.GetEventsRequest;
    expect(second.cursor).toBe("c1");
    expect(second.startLedger).toBeUndefined();
  });

  it("stops at maxPages and flags the read as partial", async () => {
    const server = serverWith({}, [
      page([event("1", 901)], "c1"),
      page([event("2", 902)], "c2"),
      page([event("3", 903)], "c3"),
    ]);
    const result = await fetchContractEvents({
      contractId,
      topic0: "agent_registered",
      topicCount: 2,
      pageLimit: 1,
      maxPages: 3,
      server,
      startLedger: 900,
      endLedger: 1001,
    });
    expect(result.partial).toBe(true);
    expect(result.pages).toBe(3);
    expect(result.events).toHaveLength(3);
  });

  it("ignores failed or non-contract events", async () => {
    const good = event("good", 901);
    const failed = { ...event("failed", 902), inSuccessfulContractCall: false } as rpc.Api.EventResponse;
    const system = { ...event("system", 903), type: "system" } as unknown as rpc.Api.EventResponse;
    const server = serverWith({}, [page([failed, system, good], "")]);
    const result = await fetchContractEvents({
      contractId,
      topic0: "agent_registered",
      topicCount: 2,
      server,
      startLedger: 900,
      endLedger: 1001,
    });
    expect(result.events.map((item) => item.id)).toEqual(["good"]);
  });
});

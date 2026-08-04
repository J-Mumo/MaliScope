import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  discover: vi.fn(),
  list: vi.fn(),
  recordJobRun: vi.fn(),
}));

vi.mock("@/db/discovery-repository", () => ({
  PostgresDiscoveryRepository: class {
    list = mocks.list;
  },
}));

vi.mock("@/db/repository", () => ({
  recordJobRun: mocks.recordJobRun,
}));

vi.mock("@/sources/discovery-crawler", () => ({
  discoverAllApprovedSources: mocks.discover,
}));

import { GET, POST } from "./route";

describe("/api/discovery", () => {
  beforeEach(() => {
    mocks.list.mockReset().mockResolvedValue([]);
    mocks.discover.mockReset();
    mocks.recordJobRun.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("passes supported filters to the discovery repository", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/discovery?source=buyrentkenya&county=Nairobi&status=new&search=block",
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith({
      sourceId: "buyrentkenya",
      county: "Nairobi",
      status: "new",
      search: "block",
    });
    expect(await response.json()).toMatchObject({ records: [] });
  });

  it("rejects interactive discovery in production", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const response = await POST(
      new Request("http://localhost/api/discovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceIds: ["buyrentkenya"] }),
      }),
    );

    expect(response.status).toBe(403);
    expect(mocks.discover).not.toHaveBeenCalled();
  });
});

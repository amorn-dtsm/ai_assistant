const express = require("express");
const http = require("http");

// ---------------------------------------------------------------------------
// Mocks — intercept every module the factory will require
// ---------------------------------------------------------------------------
jest.mock("../../../models/externalCommunicationConnector", () => ({
  ExternalCommunicationConnector: {
    get: jest.fn(),
    upsert: jest.fn(),
    updateConfig: jest.fn(),
    delete: jest.fn(),
  },
}));

jest.mock("../../../utils/channels/crypto", () => ({
  encryptCredential: jest.fn((val) => `encrypted_${val}`),
  decryptCredential: jest.fn((val) =>
    val.startsWith("encrypted_") ? val.slice(10) : val
  ),
}));

jest.mock("../../../utils/channels", () => ({
  getAdapter: jest.fn(),
}));

jest.mock("../../../models/eventLogs", () => ({
  EventLogs: { logEvent: jest.fn().mockResolvedValue(undefined) },
}));

jest.mock("../../../models/telemetry", () => ({
  Telemetry: { sendTelemetry: jest.fn().mockResolvedValue(undefined) },
}));

jest.mock("../../../utils/http", () => ({
  reqBody: jest.fn((req) => req.body),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------
const { makeChannelEndpoints } = require("../../../endpoints/channels/factory");
const {
  ExternalCommunicationConnector,
} = require("../../../models/externalCommunicationConnector");
const { encryptCredential } = require("../../../utils/channels/crypto");
const { getAdapter } = require("../../../utils/channels");

// ---------------------------------------------------------------------------
// Mock LINE adapter class — mirrors the real LineAdapter shape
// ---------------------------------------------------------------------------
const mockAdapterInstance = {
  start: jest.fn().mockResolvedValue(undefined),
  stop: jest.fn().mockResolvedValue(undefined),
  isRunning: false,
};

class MockLineAdapter {
  static type = "line";
  static deliveryMode = "webhook";
  static supportsPairing = false;
  static credentialsSchema = {
    channel_access_token: {
      required: true,
      description: "LINE channel access token",
    },
    channel_secret: {
      required: true,
      description: "LINE channel secret",
    },
  };
  static configUpdateSchema = {
    allow_users: { type: "array", itemPrefix: "U" },
    allow_groups: { type: "array", itemPrefix: "C" },
    allow_rooms: { type: "array", itemPrefix: "R" },
    default_workspace: { type: "string" },
  };
  static verifyCredentials = jest.fn();
}

// ---------------------------------------------------------------------------
// Helper: native HTTP request via fetch against ephemeral server
// ---------------------------------------------------------------------------
let server;
let baseUrl;

function createServer() {
  const app = express();
  app.use(express.json());

  // Mount factory with pass-through middleware (simulates validatedRequest + isSingleUserMode)
  makeChannelEndpoints(app, MockLineAdapter, {
    middleware: [(_req, _res, next) => next(), (_req, _res, next) => next()],
  });

  return app;
}

// ---------------------------------------------------------------------------
// Setup / teardown — ephemeral http server per test
// ---------------------------------------------------------------------------
afterAll(() => {
  jest.restoreAllMocks();
  jest.resetModules();
});

beforeEach((done) => {
  jest.clearAllMocks();
  mockAdapterInstance.isRunning = false;
  getAdapter.mockReturnValue(mockAdapterInstance);

  const app = createServer();
  server = http.createServer(app);
  server.listen(0, () => {
    const port = server.address().port;
    baseUrl = `http://localhost:${port}`;
    done();
  });
});

afterEach((done) => {
  if (server) {
    server.close(done);
  } else {
    done();
  }
});

/**
 * Helper: send HTTP request and return { status, body } using native fetch.
 */
async function httpRequest(method, path, body) {
  const opts = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body !== undefined) {
    opts.body = JSON.stringify(body);
  }
  const response = await fetch(`${baseUrl}${path}`, opts);
  let json;
  try {
    json = await response.json();
  } catch (_e) {
    json = null;
  }
  return { status: response.status, body: json };
}

// ===========================================================================
describe("Channel endpoint factory", () => {
  // -----------------------------------------------------------------------
  // (a) Connect — happy path
  // -----------------------------------------------------------------------
  test("POST /line/connect — valid creds → encrypted upsert, adapter start, 200", async () => {
    MockLineAdapter.verifyCredentials.mockResolvedValue({
      valid: true,
      basic_id: "@line123",
    });
    ExternalCommunicationConnector.upsert.mockResolvedValue({
      connector: { id: 1 },
      error: null,
    });

    const res = await httpRequest("POST", "/line/connect", {
      channel_access_token: "tok_abc",
      channel_secret: "sec_xyz",
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.basic_id).toBe("@line123");

    // verifyCredentials received both fields
    expect(MockLineAdapter.verifyCredentials).toHaveBeenCalledWith({
      channel_access_token: "tok_abc",
      channel_secret: "sec_xyz",
    });

    // Both credentials encrypted
    expect(encryptCredential).toHaveBeenCalledWith("tok_abc");
    expect(encryptCredential).toHaveBeenCalledWith("sec_xyz");

    // Upsert payload has encrypted values (≠ plaintext)
    const upsertCall = ExternalCommunicationConnector.upsert.mock.calls[0];
    expect(upsertCall[0]).toBe("line");
    const stored = upsertCall[1];
    expect(stored.channel_access_token).toBe("encrypted_tok_abc");
    expect(stored.channel_secret).toBe("encrypted_sec_xyz");
    expect(stored.channel_access_token).not.toBe("tok_abc");
    expect(stored.channel_secret).not.toBe("sec_xyz");
    expect(stored.active).toBe(true);

    // Adapter started
    expect(mockAdapterInstance.start).toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // (b) Connect — missing required field
  // -----------------------------------------------------------------------
  test("POST /line/connect — missing channel_secret → 400 naming field", async () => {
    const res = await httpRequest("POST", "/line/connect", {
      channel_access_token: "tok_abc",
    });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain("channel_secret");
  });

  // -----------------------------------------------------------------------
  // (c) Connect — invalid credentials
  // -----------------------------------------------------------------------
  test("POST /line/connect — invalid creds → 400", async () => {
    MockLineAdapter.verifyCredentials.mockResolvedValue({
      valid: false,
      error: "Unauthorized",
    });

    const res = await httpRequest("POST", "/line/connect", {
      channel_access_token: "bad",
      channel_secret: "bad",
    });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  // -----------------------------------------------------------------------
  // (d) Disconnect
  // -----------------------------------------------------------------------
  test("POST /line/disconnect → adapter stop + connector delete → 200", async () => {
    ExternalCommunicationConnector.delete.mockResolvedValue(true);

    const res = await httpRequest("POST", "/line/disconnect");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockAdapterInstance.stop).toHaveBeenCalled();
    expect(ExternalCommunicationConnector.delete).toHaveBeenCalledWith("line");
  });

  // -----------------------------------------------------------------------
  // (e) Status
  // -----------------------------------------------------------------------
  test("GET /line/status → { active, basic_id }", async () => {
    ExternalCommunicationConnector.get.mockResolvedValue({
      active: true,
      config: {
        basic_id: "@line123",
        channel_access_token: "enc:secret",
        channel_secret: "enc:secret2",
      },
    });
    mockAdapterInstance.isRunning = true;

    const res = await httpRequest("GET", "/line/status");

    expect(res.status).toBe(200);
    expect(res.body.active).toBe(true);
    expect(res.body.basic_id).toBe("@line123");
    // Secrets must NOT appear in status
    expect(res.body.channel_access_token).toBeUndefined();
    expect(res.body.channel_secret).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // (f) Config — no secrets
  // -----------------------------------------------------------------------
  test("GET /line/config → non-secret config only", async () => {
    ExternalCommunicationConnector.get.mockResolvedValue({
      active: true,
      config: {
        channel_access_token: "encrypted_tok",
        channel_secret: "encrypted_sec",
        basic_id: "@line123",
        default_workspace: "ws-1",
      },
    });

    const res = await httpRequest("GET", "/line/config");

    expect(res.status).toBe(200);
    expect(res.body.config).toBeDefined();
    expect(res.body.config.active).toBe(true);
    expect(res.body.config.basic_id).toBe("@line123");
    expect(res.body.config.default_workspace).toBe("ws-1");
    // NO secrets in response
    expect(res.body.config.channel_access_token).toBeUndefined();
    expect(res.body.config.channel_secret).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // (g) Update config — valid
  // -----------------------------------------------------------------------
  test("POST /line/update-config — valid keys → merged via updateConfig", async () => {
    ExternalCommunicationConnector.updateConfig.mockResolvedValue({
      connector: { id: 1 },
      error: null,
    });

    const res = await httpRequest("POST", "/line/update-config", {
      allow_users: ["Uabc123"],
      allow_groups: ["Cdef456"],
      allow_rooms: ["Rghi789"],
      default_workspace: "ws-1",
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(ExternalCommunicationConnector.updateConfig).toHaveBeenCalledWith(
      "line",
      expect.objectContaining({
        allow_users: ["Uabc123"],
        allow_groups: ["Cdef456"],
        allow_rooms: ["Rghi789"],
        default_workspace: "ws-1",
      })
    );
  });

  // -----------------------------------------------------------------------
  // (g) Update config — unknown keys rejected
  // -----------------------------------------------------------------------
  test("POST /line/update-config — unknown keys → 400", async () => {
    const res = await httpRequest("POST", "/line/update-config", {
      allow_users: ["Uabc"],
      evil_key: "hack",
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("evil_key");
  });

  // -----------------------------------------------------------------------
  // (g.2) Update config — wrong ID prefix
  // -----------------------------------------------------------------------
  test("POST /line/update-config — wrong user ID prefix → 400", async () => {
    const res = await httpRequest("POST", "/line/update-config", {
      allow_users: ["Xinvalid_id"],
    });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/U/);
  });

  // -----------------------------------------------------------------------
  // (c.2) Connect — verifyCredentials throws (LineAdapter pattern)
  // -----------------------------------------------------------------------
  test("POST /line/connect — verifyCredentials throws → 400", async () => {
    MockLineAdapter.verifyCredentials.mockRejectedValue(
      new Error("Invalid LINE credentials")
    );

    const res = await httpRequest("POST", "/line/connect", {
      channel_access_token: "bad",
      channel_secret: "bad",
    });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/Invalid/);
  });

  // -----------------------------------------------------------------------
  // (h) Pairing routes — 404 when supportsPairing=false
  // -----------------------------------------------------------------------
  test("GET /line/pending-users → 404 when supportsPairing=false", async () => {
    const res = await httpRequest("GET", "/line/pending-users");
    expect(res.status).toBe(404);
  });
});

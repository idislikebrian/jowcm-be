import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('../src/db/client.js', () => ({
  default: { query: (...args: unknown[]) => queryMock(...args) },
}));

const checkWatchFolderWritableMock = vi.fn();
vi.mock('../src/services/azurecast.js', () => ({
  addToPlaylist: vi.fn(),
  checkWatchFolderWritable: () => checkWatchFolderWritableMock(),
}));

const getSchedulerStatusMock = vi.fn();
vi.mock('../src/services/playlist-cron.js', () => ({
  getSchedulerStatus: () => getSchedulerStatusMock(),
}));

const { getHealthReport } = await import('../src/services/health.js');

const originalEnv = { ...process.env };

function mockFetchResponse(opts: { ok: boolean; status: number; contentType?: string | null }) {
  return {
    ok: opts.ok,
    status: opts.status,
    body: null,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'content-type' ? (opts.contentType ?? null) : null),
    },
  };
}

beforeEach(() => {
  queryMock.mockReset().mockResolvedValue({ rows: [{ '?column?': 1 }] });
  checkWatchFolderWritableMock.mockReset().mockResolvedValue(undefined);
  getSchedulerStatusMock.mockReset().mockReturnValue({
    state: 'idle',
    configured: true,
    started: true,
    lastRunAt: '2026-01-01T00:00:00.000Z',
    lastSuccessAt: '2026-01-01T00:00:00.000Z',
    lastError: null,
  });

  process.env.TWILIO_ACCOUNT_SID = 'ACxxxx';
  process.env.TWILIO_AUTH_TOKEN = 'secret-token';
  process.env.VOICEMAIL_STORAGE_PATH = '/tmp';
  process.env.AZURECAST_API_URL = 'https://azuracast.example.com';
  process.env.AZURECAST_API_KEY = 'super-secret-key';
  process.env.PUBLIC_STREAM_URL = 'https://stream.example.com/radio.mp3';

  global.fetch = vi.fn().mockResolvedValue(
    mockFetchResponse({ ok: true, status: 200, contentType: 'audio/mpeg' })
  ) as unknown as typeof fetch;
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('getHealthReport', () => {
  it('reports overall ok when every component is healthy', async () => {
    const report = await getHealthReport();
    expect(report.status).toBe('ok');
    expect(report.checks.database.status).toBe('ok');
    expect(report.checks.publicStream.status).toBe('ok');
  });

  it('degrades overall status on a broadcast failure without erasing hotline component status', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      mockFetchResponse({ ok: false, status: 502 })
    ) as unknown as typeof fetch;

    const report = await getHealthReport();

    expect(report.status).toBe('degraded');
    // Hotline receiving-path components remain visibly ok, not swallowed by the broadcast failure
    expect(report.checks.database.status).toBe('ok');
    expect(report.checks.twilio.status).toBe('ok');
    expect(report.checks.voicemailStorage.status).toBe('ok');
    expect(report.checks.publicStream.status).toBe('error');
  });

  it('treats a reachable stream endpoint with a non-audio response as degraded, not ok or error', async () => {
    // e.g. an auth wall or proxy returning a 200 HTML error/login page
    global.fetch = vi.fn().mockResolvedValue(
      mockFetchResponse({ ok: true, status: 200, contentType: 'text/html; charset=utf-8' })
    ) as unknown as typeof fetch;

    const report = await getHealthReport();

    expect(report.checks.publicStream.status).toBe('degraded');
    expect(report.checks.publicStream.message).toMatch(/does not look like an audio stream/);
    // Should not be conflated with a hard "unreachable" failure
    expect(report.status).toBe('degraded');
  });

  it('reports a healthy audio content-type as ok', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      mockFetchResponse({ ok: true, status: 200, contentType: 'application/ogg' })
    ) as unknown as typeof fetch;

    const report = await getHealthReport();

    expect(report.checks.publicStream.status).toBe('ok');
  });

  it('reports overall error when the database (a receiving-path dependency) is down', async () => {
    queryMock.mockRejectedValue(new Error('connection refused'));

    const report = await getHealthReport();

    expect(report.status).toBe('error');
    expect(report.checks.database.status).toBe('error');
  });

  it('never leaks secrets, tokens, URLs, or filesystem paths in the response', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      mockFetchResponse({ ok: false, status: 500 })
    ) as unknown as typeof fetch;
    queryMock.mockRejectedValue(new Error('connection to postgresql://user:pw@db.internal:5432/app failed'));

    const report = await getHealthReport();
    const serialized = JSON.stringify(report);

    expect(serialized).not.toContain('super-secret-key');
    expect(serialized).not.toContain('secret-token');
    expect(serialized).not.toContain('/tmp');
    expect(serialized).not.toContain('postgresql://');
    expect(serialized).not.toContain('azuracast.example.com');
  });
});

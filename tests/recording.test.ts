import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const queryMock = vi.fn();
const connectMock = vi.fn();

vi.mock('../src/db/client.js', () => ({
  default: {
    query: (...args: unknown[]) => queryMock(...args),
    connect: (...args: unknown[]) => connectMock(...args),
  },
}));

const downloadAudioMock = vi.fn();
vi.mock('../src/services/storage.js', () => ({
  downloadAudio: (...args: unknown[]) => downloadAudioMock(...args),
}));

const updateUserStreakMock = vi.fn();
vi.mock('../src/services/user-streak.js', () => ({
  updateUserStreak: (...args: unknown[]) => updateUserStreakMock(...args),
}));

const sendConfirmationMock = vi.fn();
vi.mock('../src/services/twilio.js', () => ({
  sendConfirmation: (...args: unknown[]) => sendConfirmationMock(...args),
}));

const addToPlaylistMock = vi.fn();
vi.mock('../src/services/azurecast.js', () => ({
  addToPlaylist: (...args: unknown[]) => addToPlaylistMock(...args),
  checkWatchFolderWritable: vi.fn(),
}));

vi.mock('../src/utils/validateTwilio.js', () => ({
  validateTwilioWebhook: () => true,
}));

const { default: recordingHandler } = await import('../src/routes/recording.js');

function makeRes(): Response {
  const res: Partial<Response> = {
    status: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
  };
  return res as Response;
}

function makeReq(body: Record<string, unknown>): Request {
  return {
    headers: {},
    body,
    protocol: 'https',
    originalUrl: '/recording-complete',
    get: () => 'example.com',
  } as unknown as Request;
}

// Fake transactional client used by persistVoicemail's pool.connect()
function makeTxClient(existingRow: { id: number; voice_number: number } | null) {
  return {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM voicemails WHERE recording_sid')) {
        return { rows: existingRow ? [existingRow] : [] };
      }
      if (sql.includes('SELECT value FROM meta')) {
        return { rows: [{ value: '41' }] };
      }
      if (sql.startsWith('UPDATE meta')) {
        return { rows: [] };
      }
      if (sql.startsWith('INSERT INTO voicemails')) {
        return { rows: [{ id: 99 }] };
      }
      return { rows: [] };
    }),
    release: vi.fn(),
  };
}

beforeEach(() => {
  queryMock.mockReset();
  connectMock.mockReset();
  downloadAudioMock.mockReset().mockResolvedValue(undefined);
  updateUserStreakMock.mockReset().mockResolvedValue({ streakCount: 1 });
  sendConfirmationMock.mockReset().mockResolvedValue(undefined);
  addToPlaylistMock.mockReset();
});

describe('recordingHandler', () => {
  it('persists a new voicemail even when the AzuraCast handoff fails', async () => {
    addToPlaylistMock.mockRejectedValue(new Error('watch folder unavailable'));
    queryMock.mockResolvedValue({ rows: [] }); // outer duplicate-check: no existing row
    const txClient = makeTxClient(null);
    connectMock.mockResolvedValue(txClient);

    const req = makeReq({
      From: '+15551234567',
      RecordingUrl: 'https://api.twilio.com/recording/RE123',
      RecordingDuration: '12',
      RecordingSid: 'RE123',
    });
    const res = makeRes();

    await recordingHandler(req, res);

    // Voicemail was persisted (insert ran, transaction committed) regardless of AzuraCast failure
    expect(txClient.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO voicemails'),
      expect.any(Array)
    );
    expect(addToPlaylistMock).toHaveBeenCalledTimes(1);
    // Twilio still gets a normal TwiML 200-style response, not an error
    expect(res.send).toHaveBeenCalledWith(expect.stringContaining('<Response>'));
    expect(res.status).not.toHaveBeenCalledWith(500);
  });

  it('does not hand off to AzuraCast twice for a duplicate webhook once already synced', async () => {
    // Outer check finds an existing, already-synced row for this RecordingSid -> short-circuits before persistVoicemail
    queryMock.mockResolvedValue({
      rows: [{ id: 1, voice_number: 41, local_path: '/var/voicemails/41_RE123.mp3', azuracast_synced_at: new Date('2026-01-01') }],
    });

    const req = makeReq({
      From: '+15551234567',
      RecordingUrl: 'https://api.twilio.com/recording/RE123',
      RecordingDuration: '12',
      RecordingSid: 'RE123',
    });
    const res = makeRes();

    await recordingHandler(req, res);

    expect(addToPlaylistMock).not.toHaveBeenCalled();
    expect(connectMock).not.toHaveBeenCalled();
    expect(res.send).toHaveBeenCalledWith(expect.stringContaining('<Response>'));
  });

  it('repairs a previously-failed AzuraCast handoff on a replayed webhook without duplicating DB/streak/SMS', async () => {
    // Simulates the second delivery of a webhook whose first delivery persisted
    // the voicemail successfully but whose AzuraCast handoff failed:
    // the row exists with azuracast_synced_at still null.
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM voicemails WHERE recording_sid')) {
        return {
          rows: [{ id: 1, voice_number: 41, local_path: '/var/voicemails/41_RE123.mp3', azuracast_synced_at: null }],
        };
      }
      if (sql.startsWith('UPDATE voicemails SET azuracast_synced_at')) {
        return { rows: [] };
      }
      return { rows: [] };
    });
    addToPlaylistMock.mockResolvedValue(undefined);

    const req = makeReq({
      From: '+15551234567',
      RecordingUrl: 'https://api.twilio.com/recording/RE123',
      RecordingDuration: '12',
      RecordingSid: 'RE123',
    });
    const res = makeRes();

    await recordingHandler(req, res);

    // Handoff was retried and repaired using the deterministic destination
    expect(addToPlaylistMock).toHaveBeenCalledTimes(1);
    expect(addToPlaylistMock).toHaveBeenCalledWith('/var/voicemails/41_RE123.mp3', 41);
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE voicemails SET azuracast_synced_at'),
      [1]
    );

    // No duplicate DB row, streak update, or SMS on the replay
    expect(connectMock).not.toHaveBeenCalled();
    expect(updateUserStreakMock).not.toHaveBeenCalled();
    expect(sendConfirmationMock).not.toHaveBeenCalled();

    expect(res.send).toHaveBeenCalledWith(expect.stringContaining('<Response>'));
  });
});

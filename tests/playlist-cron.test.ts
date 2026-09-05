import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('playlist-cron scheduler', () => {
  const originalKey = process.env.AZURECAST_API_KEY;

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env.AZURECAST_API_KEY = originalKey;
  });

  it('stays disabled and does not schedule an interval when API config is missing', async () => {
    delete process.env.AZURECAST_API_KEY;
    const setIntervalSpy = vi.spyOn(global, 'setInterval');

    const { startPlaylistCron, getSchedulerStatus } = await import('../src/services/playlist-cron.js');

    expect(() => startPlaylistCron()).not.toThrow();
    expect(setIntervalSpy).not.toHaveBeenCalled();

    const status = getSchedulerStatus();
    expect(status.state).toBe('disabled');
    expect(status.configured).toBe(false);
    expect(status.started).toBe(false);
  });

  it('starts exactly one interval even if start is called multiple times', async () => {
    process.env.AZURECAST_API_KEY = 'test-key';
    const setIntervalSpy = vi.spyOn(global, 'setInterval');
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => [] }) as unknown as typeof fetch;

    const { startPlaylistCron, getSchedulerStatus, stopPlaylistCron } = await import('../src/services/playlist-cron.js');

    startPlaylistCron();
    startPlaylistCron();
    startPlaylistCron();

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);

    const status = getSchedulerStatus();
    expect(status.configured).toBe(true);
    expect(status.started).toBe(true);

    stopPlaylistCron();
  });
});

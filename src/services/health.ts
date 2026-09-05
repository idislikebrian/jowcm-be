import fs from 'fs/promises';
import pool from '../db/client.js';
import { withTimeout } from '../utils/withTimeout.js';
import { checkWatchFolderWritable } from './azurecast.js';
import { getSchedulerStatus } from './playlist-cron.js';

const CHECK_TIMEOUT_MS = 3000;

export type ComponentStatus = 'ok' | 'degraded' | 'error';

export interface ComponentCheck {
  status: ComponentStatus;
  message?: string;
}

export interface HealthReport {
  status: ComponentStatus;
  checks: {
    database: ComponentCheck;
    twilio: ComponentCheck;
    voicemailStorage: ComponentCheck;
    azuracastApi: ComponentCheck;
    azuracastMedia: ComponentCheck;
    playlistAutomation: ComponentCheck;
    publicStream: ComponentCheck;
  };
  timestamp: string;
}

async function checkDatabase(): Promise<ComponentCheck> {
  try {
    await withTimeout(pool.query('SELECT 1'), CHECK_TIMEOUT_MS);
    return { status: 'ok' };
  } catch {
    return { status: 'error', message: 'Database is not reachable' };
  }
}

function checkTwilioConfig(): ComponentCheck {
  const hasSid = !!process.env.TWILIO_ACCOUNT_SID;
  const hasToken = !!process.env.TWILIO_AUTH_TOKEN;

  if (hasSid && hasToken) {
    return { status: 'ok' };
  }
  if (hasSid || hasToken) {
    return { status: 'degraded', message: 'Twilio configuration is incomplete' };
  }
  return { status: 'error', message: 'Twilio is not configured' };
}

async function checkVoicemailStorage(): Promise<ComponentCheck> {
  const voicemailStoragePath = process.env.VOICEMAIL_STORAGE_PATH || '/var/voicemails';
  try {
    await withTimeout(fs.access(voicemailStoragePath, fs.constants.W_OK), CHECK_TIMEOUT_MS);
    return { status: 'ok' };
  } catch {
    return { status: 'error', message: 'Voicemail storage is not writable' };
  }
}

async function checkAzuracastApi(): Promise<ComponentCheck> {
  const azuracastApiUrl = process.env.AZURECAST_API_URL || '';
  const azuracastApiKey = process.env.AZURECAST_API_KEY || '';
  const azuracastStationId = process.env.AZURECAST_STATION_ID || '1';

  if (!azuracastApiKey || !azuracastApiUrl) {
    return { status: 'error', message: 'AzuraCast API is not configured' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${azuracastApiUrl}/api/station/${azuracastStationId}`,
      {
        headers: { 'X-API-Key': azuracastApiKey },
        signal: controller.signal,
      }
    );

    if (!response.ok) {
      return { status: 'error', message: `AzuraCast API returned ${response.status}` };
    }
    return { status: 'ok' };
  } catch {
    return { status: 'error', message: 'AzuraCast API is not reachable' };
  } finally {
    clearTimeout(timer);
  }
}

async function checkAzuracastMedia(): Promise<ComponentCheck> {
  try {
    await withTimeout(checkWatchFolderWritable(), CHECK_TIMEOUT_MS);
    return { status: 'ok' };
  } catch {
    return { status: 'error', message: 'AzuraCast media watch folder is not writable' };
  }
}

function checkPlaylistAutomation(): ComponentCheck {
  const scheduler = getSchedulerStatus();

  switch (scheduler.state) {
    case 'idle':
      return { status: 'ok' };
    case 'disabled':
      return { status: 'error', message: 'Playlist automation is not configured' };
    case 'error':
      return { status: 'error', message: 'Playlist automation encountered an error' };
    default:
      return { status: 'error', message: 'Playlist automation state unknown' };
  }
}

// Content-types Icecast/AzuraCast mounts can legitimately serve for an audio
// stream. Kept intentionally permissive (broad `audio/*` plus Ogg's
// `application/ogg`) rather than pinned to one codec, since the configured
// mount's encoding can change independently of this check.
const STREAM_CONTENT_TYPE_PATTERN = /^(audio\/|application\/ogg)/i;

function looksLikeAudioStream(response: Response): boolean {
  const contentType = response.headers.get('content-type');
  if (!contentType) {
    return false;
  }
  return STREAM_CONTENT_TYPE_PATTERN.test(contentType.trim());
}

async function checkPublicStream(): Promise<ComponentCheck> {
  const publicStreamUrl = process.env.PUBLIC_STREAM_URL || '';
  if (!publicStreamUrl) {
    return { status: 'error', message: 'Public stream endpoint is not configured' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);

  try {
    let response = await fetch(publicStreamUrl, { method: 'HEAD', signal: controller.signal });

    // Some Icecast/AzuraCast mounts don't support HEAD — fall back to a bounded GET
    // and abort immediately after reading headers, without consuming the audio body.
    if (response.status === 405 || response.status === 501) {
      response = await fetch(publicStreamUrl, { method: 'GET', signal: controller.signal });
      // Cancel the body stream right away; we only need the response headers/status.
      response.body?.cancel().catch(() => {});
    }

    if (!response.ok) {
      return { status: 'error', message: 'Stream endpoint is not currently playable' };
    }

    // Reachable with a 2xx, but not necessarily a real stream — e.g. a proxy
    // or auth wall can return 200 with an HTML error/login page. Distinguish
    // that from an actually-healthy audio response rather than calling both "ok".
    if (!looksLikeAudioStream(response)) {
      return { status: 'degraded', message: 'Stream endpoint reachable but response does not look like an audio stream' };
    }

    return { status: 'ok' };
  } catch {
    return { status: 'error', message: 'Stream endpoint is not currently playable' };
  } finally {
    clearTimeout(timer);
  }
}

function severityRank(status: ComponentStatus): number {
  return status === 'error' ? 2 : status === 'degraded' ? 1 : 0;
}

function worstOf(checks: ComponentCheck[]): ComponentStatus {
  return checks.reduce<ComponentStatus>(
    (worst, check) => (severityRank(check.status) > severityRank(worst) ? check.status : worst),
    'ok'
  );
}

export async function getHealthReport(): Promise<HealthReport> {
  const [database, voicemailStorage, azuracastApi, azuracastMedia, publicStream] = await Promise.all([
    checkDatabase(),
    checkVoicemailStorage(),
    checkAzuracastApi(),
    checkAzuracastMedia(),
    checkPublicStream(),
  ]);

  const twilio = checkTwilioConfig();
  const playlistAutomation = checkPlaylistAutomation();

  const checks = {
    database,
    twilio,
    voicemailStorage,
    azuracastApi,
    azuracastMedia,
    playlistAutomation,
    publicStream,
  };

  // The hotline can still receive and store voicemails even when the broadcast
  // pipeline is degraded — don't let broadcast issues masquerade as an outage
  // of the receiving path, but a receiving-path failure is always an error.
  const receivingStatus = worstOf([database, twilio, voicemailStorage]);
  const broadcastStatus = worstOf([azuracastApi, azuracastMedia, playlistAutomation, publicStream]);

  let status: ComponentStatus;
  if (receivingStatus === 'error') {
    status = 'error';
  } else if (receivingStatus === 'degraded' || broadcastStatus !== 'ok') {
    status = 'degraded';
  } else {
    status = 'ok';
  }

  return {
    status,
    checks,
    timestamp: new Date().toISOString(),
  };
}

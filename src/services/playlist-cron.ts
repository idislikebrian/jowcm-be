const AZURECAST_API_URL = process.env.AZURECAST_API_URL || 'https://stream.journalingoutdoorswouldcureme.live';
const AZURECAST_API_KEY = process.env.AZURECAST_API_KEY || '';
const AZURECAST_STATION_ID = process.env.AZURECAST_STATION_ID || '1';
const AZURECAST_PLAYLIST_ID = process.env.AZURECAST_PLAYLIST_ID || '1';

const INTERVAL_MS = 10 * 60 * 1000;

interface MediaFile {
  id: string;
  path: string;
  name: string;
  playlists: Array<{ id: number; name: string }>;
}

export type SchedulerState = 'disabled' | 'idle' | 'running' | 'error';

interface SchedulerStatus {
  state: SchedulerState;
  configured: boolean;
  started: boolean;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let lastRunAt: string | null = null;
let lastSuccessAt: string | null = null;
let lastError: string | null = null;

/**
 * Fetch all media files for the station and return those not assigned to any playlist
 */
async function getUnassignedFiles(): Promise<MediaFile[]> {
  const response = await fetch(
    `${AZURECAST_API_URL}/api/station/${AZURECAST_STATION_ID}/files`,
    {
      headers: {
        'X-API-Key': AZURECAST_API_KEY,
        'Content-Type': 'application/json',
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch files: ${response.status} ${response.statusText}`);
  }

  const files = await response.json() as MediaFile[];

  // Filter files with no playlists assigned
  return files.filter((file) => !file.playlists || file.playlists.length === 0);
}

/**
 * Assign a file to the default playlist
 */
async function assignToPlaylist(fileId: string): Promise<void> {
  const response = await fetch(
    `${AZURECAST_API_URL}/api/station/${AZURECAST_STATION_ID}/file/${fileId}`,
    {
      method: 'PUT',
      headers: {
        'X-API-Key': AZURECAST_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        playlists: [{ id: parseInt(AZURECAST_PLAYLIST_ID) }],
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to assign file ${fileId}: ${response.status} ${response.statusText}`);
  }
}

/**
 * Run the playlist assignment job
 */
export async function runPlaylistAssignment(): Promise<void> {
  const timestamp = new Date().toISOString();
  lastRunAt = timestamp;
  console.log(`[PlaylistCron] Running playlist assignment job at ${timestamp}`);

  if (!AZURECAST_API_KEY) {
    console.warn('[PlaylistCron] AZURECAST_API_KEY not set — skipping');
    return;
  }

  try {
    const unassigned = await getUnassignedFiles();

    if (unassigned.length === 0) {
      console.log('[PlaylistCron] No unassigned files found');
      lastSuccessAt = new Date().toISOString();
      lastError = null;
      return;
    }

    console.log(`[PlaylistCron] Found ${unassigned.length} unassigned file(s)`);

    for (const file of unassigned) {
      const fileName = file.path?.split('/').pop() || file.id;
      try {
        await assignToPlaylist(file.id);
        console.log(`[PlaylistCron] Assigned "${fileName}" to playlist ${AZURECAST_PLAYLIST_ID}`);
      } catch (err) {
        console.error(`[PlaylistCron] Failed to assign "${fileName}":`, err);
      }
    }

    console.log(`[PlaylistCron] Completed — processed ${unassigned.length} file(s)`);
    lastSuccessAt = new Date().toISOString();
    lastError = null;
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
    console.error('[PlaylistCron] Job failed:', err);
  }
}

/**
 * Start the cron scheduler — runs every 10 minutes.
 * Safe to call multiple times: only the first call schedules an interval.
 * Missing AzuraCast API configuration disables the scheduler visibly, without throwing.
 */
export function startPlaylistCron(): void {
  if (!AZURECAST_API_KEY) {
    console.warn('[PlaylistCron] AZURECAST_API_KEY not set — cron disabled');
    return;
  }

  if (intervalHandle) {
    console.warn('[PlaylistCron] Scheduler already started — ignoring duplicate start');
    return;
  }

  intervalHandle = setInterval(runPlaylistAssignment, INTERVAL_MS);

  console.log('[PlaylistCron] Playlist assignment scheduler started (every 10 minutes)');

  // Run once immediately on startup to catch any backlog
  void runPlaylistAssignment();
}

/**
 * Stop the scheduler, if running. Primarily for tests.
 */
export function stopPlaylistCron(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

/**
 * Observable scheduler state for health reporting. Never exposes API keys/URLs.
 */
export function getSchedulerStatus(): SchedulerStatus {
  const configured = !!AZURECAST_API_KEY;
  const started = intervalHandle !== null;

  let state: SchedulerState;
  if (!configured) {
    state = 'disabled';
  } else if (!started) {
    state = 'error';
  } else if (lastError) {
    state = 'error';
  } else {
    state = 'idle';
  }

  return {
    state,
    configured,
    started,
    lastRunAt,
    lastSuccessAt,
    lastError,
  };
}

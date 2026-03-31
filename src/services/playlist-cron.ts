import fs from 'fs/promises';

const AZURECAST_API_URL = process.env.AZURECAST_API_URL || 'https://stream.journalingoutdoorswouldcureme.live';
const AZURECAST_API_KEY = process.env.AZURECAST_API_KEY || '';
const AZURECAST_STATION_ID = process.env.AZURECAST_STATION_ID || '1';
const AZURECAST_PLAYLIST_ID = process.env.AZURECAST_PLAYLIST_ID || '1';

interface MediaFile {
  id: string;
  path: string;
  name: string;
  playlists: Array<{ id: number; name: string }>;
}

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
async function runPlaylistAssignment(): Promise<void> {
  const timestamp = new Date().toISOString();
  console.log(`[PlaylistCron] Running playlist assignment job at ${timestamp}`);

  if (!AZURECAST_API_KEY) {
    console.warn('[PlaylistCron] AZURECAST_API_KEY not set — skipping');
    return;
  }

  try {
    const unassigned = await getUnassignedFiles();

    if (unassigned.length === 0) {
      console.log('[PlaylistCron] No unassigned files found');
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
  } catch (err) {
    console.error('[PlaylistCron] Job failed:', err);
  }
}

/**
 * Start the cron scheduler — runs every 10 minutes
 */
export function startPlaylistCron(): void {
  if (!AZURECAST_API_KEY) {
    console.warn('[PlaylistCron] AZURECAST_API_KEY not set — cron disabled');
    return;
  }

  // Run every 10 minutes (600,000 ms)
  const INTERVAL_MS = 10 * 60 * 1000;

  setInterval(runPlaylistAssignment, INTERVAL_MS);

  console.log('[PlaylistCron] Playlist assignment scheduler started (every 10 minutes)');

  // Run once immediately on startup to catch any backlog
  runPlaylistAssignment();
}

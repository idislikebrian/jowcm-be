import fs from 'fs/promises';
import path from 'path';

const AZURECAST_WATCH_FOLDER = process.env.AZURECAST_WATCH_FOLDER || '/var/azuracast/stations/journaling_outdoors_would_cure_me/media/';

/**
 * Drop a file into the AzuraCast watch folder.
 * No waiting, no retrying — the cron job handles playlist assignment.
 *
 * The source file is downloaded from Twilio as MP3 (recording.ts requests the
 * `.mp3` rendition explicitly), so it is copied through as `.mp3`. Renaming
 * the bytes to `.wav` would mislabel the container without transcoding it.
 */
export async function addToPlaylist(filePath: string, voiceNumber: number): Promise<void> {
  const audioBuffer = await fs.readFile(filePath);
  const extension = path.extname(filePath) || '.mp3';
  const fileName = `voice-${voiceNumber}${extension}`;
  const destination = path.join(AZURECAST_WATCH_FOLDER, fileName);
  await fs.writeFile(destination, audioBuffer);
  console.log(`[Azuracast] Voice ${voiceNumber} dropped to watch folder at ${destination}`);
}

/**
 * Read-only check that the watch folder exists and is writable, for health reporting.
 */
export async function checkWatchFolderWritable(): Promise<void> {
  await fs.access(AZURECAST_WATCH_FOLDER, fs.constants.W_OK);
}

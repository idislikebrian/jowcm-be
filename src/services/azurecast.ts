import fs from 'fs/promises';
import path from 'path';

const AZURECAST_WATCH_FOLDER = process.env.AZURECAST_WATCH_FOLDER || '/var/azuracast/stations/journaling_outdoors_would_cure_me/media/';

/**
 * Drop a file into the AzuraCast watch folder.
 * No waiting, no retrying — the cron job handles playlist assignment.
 */
export async function addToPlaylist(filePath: string, voiceNumber: number): Promise<void> {
  const audioBuffer = await fs.readFile(filePath);
  const fileName = `voice-${voiceNumber}.wav`;
  const destination = path.join(AZURECAST_WATCH_FOLDER, fileName);
  await fs.writeFile(destination, audioBuffer);
  console.log(`[Azuracast] Voice ${voiceNumber} dropped to watch folder at ${destination}`);
}

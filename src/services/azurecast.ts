import fs from 'fs/promises';
import path from 'path';

const AZURECAST_WATCH_FOLDER = process.env.AZURECAST_WATCH_FOLDER || '/var/azuracast/stations/journaling_outdoors_would_cure_me/media/';
const AZURECAST_API_URL = process.env.AZURECAST_API_URL || 'https://stream.journalingoutdoorswouldcureme.live';
const AZURECAST_API_KEY = process.env.AZURECAST_API_KEY || '';
const AZURECAST_STATION_ID = process.env.AZURECAST_STATION_ID || '1';
const AZURECAST_PLAYLIST_ID = process.env.AZURECAST_PLAYLIST_ID || '1';

export async function addToPlaylist(filePath: string, voiceNumber: number): Promise<void> {
  const audioBuffer = await fs.readFile(filePath);
  const fileName = `voice-${voiceNumber}.wav`;
  const destination = path.join(AZURECAST_WATCH_FOLDER, fileName);
  await fs.writeFile(destination, audioBuffer);
  console.log(`[Azuracast] Voice ${voiceNumber} dropped to watch folder at ${destination}`);

  // Retry search with increasing delays
  let mediaFile: any = null;
  const maxRetries = 6;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const waitTime = attempt * 5000; // 5s, 10s, 15s, 20s, 25s, 30s
    console.log(`[Azuracast] Waiting ${waitTime/1000}s before search attempt ${attempt}/${maxRetries}`);
    await new Promise(resolve => setTimeout(resolve, waitTime));

    const searchUrl = `${AZURECAST_API_URL}/api/station/${AZURECAST_STATION_ID}/files?searchPhrase=${fileName}`;
    const searchRes = await fetch(
      searchUrl,
      { headers: { 'X-API-Key': AZURECAST_API_KEY } }
    );
    
    if (!searchRes.ok) {
      console.warn(`[Azuracast] Search API failed: ${searchRes.status} ${searchRes.statusText}`);
      continue;
    }
    
    const files = await searchRes.json() as any[];
    console.log(`[Azuracast] Search attempt ${attempt} returned ${files.length} files`);
    
    mediaFile = files.find((f: any) => f.path && f.path.endsWith(fileName));
    
    if (mediaFile) {
      console.log(`[Azuracast] Found media file on attempt ${attempt}: id=${mediaFile.id}`);
      break;
    }
  }

  if (!mediaFile) {
    console.warn(`[Azuracast] Could not find media file ${fileName} after ${maxRetries} attempts — skipping playlist assignment`);
    return;
  }

  // Assign to default playlist
  const updateRes = await fetch(
    `${AZURECAST_API_URL}/api/station/${AZURECAST_STATION_ID}/file/${mediaFile.id}`,
    {
      method: 'PUT',
      headers: {
        'X-API-Key': AZURECAST_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...mediaFile, playlists: [{ id: parseInt(AZURECAST_PLAYLIST_ID) }] }),
    }
  );

  if (updateRes.ok) {
    console.log(`[Azuracast] Voice ${voiceNumber} assigned to default playlist`);
  } else {
    console.warn(`[Azuracast] Playlist assignment failed: ${updateRes.status}`);
  }
}

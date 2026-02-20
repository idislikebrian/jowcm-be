import fs from 'fs/promises';
import path from 'path';

const AZURECAST_WATCH_FOLDER = process.env.AZURECAST_WATCH_FOLDER || '/var/azuracast/stations/default/media/';

export async function addToPlaylist(filePath: string, voiceNumber: number): Promise<void> {
  // Read the voicemail file
  const audioBuffer = await fs.readFile(filePath);
  
  // Copy to Azurecast watch folder with descriptive name
  const destination = path.join(AZURECAST_WATCH_FOLDER, `voice-${voiceNumber}.wav`);
  await fs.writeFile(destination, audioBuffer);
  
  console.log(`[Azurecast] Voice ${voiceNumber} added to playlist at ${destination}`);
}

// Alternative API method (commented out for future):
// export async function uploadViaApi(filePath: string, voiceNumber: number): Promise<void> {
//   // Uses axios to POST to AZURECAST_API_URL with API key
//   // import axios from 'axios';
//   // const AZURECAST_API_URL = process.env.AZURECAST_API_URL;
//   // const AZURECAST_API_KEY = process.env.AZURECAST_API_KEY;
//   // 
//   // const audioBuffer = await fs.readFile(filePath);
//   // await axios.post(`${AZURECAST_API_URL}/files`, audioBuffer, {
//   //   headers: {
//   //     'Authorization': `Bearer ${AZURECAST_API_KEY}`,
//   //     'Content-Type': 'audio/wav',
//   //   },
//   //   params: {
//   //     name: `voice-${voiceNumber}.wav`,
//   //   },
//   // });
// }

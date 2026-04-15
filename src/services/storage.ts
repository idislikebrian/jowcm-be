import axios from 'axios';
import fs from 'fs';
import path from 'path';

/**
 * Downloads audio from a URL and saves it to a local path
 * @param url - URL to download from (RecordingUrl + explicit extension)
 * @param localPath - Local file path to save to
 */
export async function downloadAudio(url: string, localPath: string): Promise<void> {
  // Ensure the directory exists
  const dir = path.dirname(localPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Twilio recording URLs require authentication
  const accountSid = process.env.TWILIO_ACCOUNT_SID || '';
  const authToken = process.env.TWILIO_AUTH_TOKEN || '';
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

  const response = await axios({
    method: 'GET',
    url: url,
    responseType: 'stream',
    timeout: 30000,
    headers: {
      'Authorization': `Basic ${auth}`
    }
  });

  const writer = fs.createWriteStream(localPath);

  return new Promise((resolve, reject) => {
    response.data.pipe(writer);

    writer.on('finish', () => {
      writer.close();
      resolve();
    });

    writer.on('error', (err) => {
      writer.close();
      // Clean up partial file on error
      fs.unlink(localPath, () => {});
      reject(err);
    });

    response.data.on('error', (err: Error) => {
      writer.close();
      fs.unlink(localPath, () => {});
      reject(err);
    });
  });
}

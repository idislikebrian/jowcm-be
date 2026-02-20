import { Request, Response } from 'express';
import pool from '../db/client.js';
import { downloadAudio } from '../services/storage.js';
import { validateTwilioWebhook } from '../utils/validateTwilio.js';
import { addToPlaylist } from '../services/azurecast.js';
import { sendConfirmation } from '../services/twilio.js';

/**
 * Atomically increments the global_voice_count in the meta table
 * Uses a transaction with FOR UPDATE to prevent race conditions
 * @returns The new voice number (incremented count)
 */
async function incrementVoiceCounter(): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      'SELECT value FROM meta WHERE key = $1 FOR UPDATE',
      ['global_voice_count']
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      throw new Error('global_voice_count not found in meta table');
    }

    const current = parseInt(result.rows[0].value, 10);
    const next = current + 1;

    await client.query(
      'UPDATE meta SET value = $1 WHERE key = $2',
      [next, 'global_voice_count']
    );
    await client.query('COMMIT');
    return next;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/**
 * POST /recording-complete
 * Handles recording completion from Twilio
 * - Validates Twilio signature
 * - Atomically increments counter
 * - Downloads audio file
 * - Saves to database
 * - Adds to Azurecast playlist (best effort)
 * - Sends SMS confirmation (best effort)
 */
export default async function recordingHandler(req: Request, res: Response): Promise<void> {
  try {
    // 1. Validate Twilio signature
    const authToken = process.env.TWILIO_AUTH_TOKEN || '';
    const signature = req.headers['x-twilio-signature'] as string || '';
    const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;

    const isValid = validateTwilioWebhook(authToken, signature, url, req.body);

    if (!isValid) {
      console.error('Invalid Twilio signature');
      res.status(403).send('Forbidden');
      return;
    }

    // 2. Extract data from request body
    const { From, RecordingUrl, RecordingDuration } = req.body;

    if (!From || !RecordingUrl) {
      console.error('Missing required fields:', { From, RecordingUrl });
      res.status(400).send('Bad Request');
      return;
    }

    console.log(`Processing recording from ${From}, URL: ${RecordingUrl}`);

    // 3. Atomically increment global_voice_count
    const voiceNumber = await incrementVoiceCounter();
    console.log(`Assigned voice number: ${voiceNumber}`);

    // 4. Download audio file
    const audioUrl = `${RecordingUrl}.wav`;
    const localPath = `/var/voicemails/voice-${voiceNumber}.wav`;

    await downloadAudio(audioUrl, localPath);
    console.log(`Downloaded audio to: ${localPath}`);

    // 5. Insert into voicemails table
    await pool.query(
      `INSERT INTO voicemails (
        voice_number,
        caller_number,
        recording_url,
        recording_duration,
        local_path,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, NOW())`,
      [
        voiceNumber,
        From,
        RecordingUrl,
        parseInt(RecordingDuration || '0', 10),
        localPath
      ]
    );
    console.log(`Inserted voicemail record for voice-${voiceNumber}`);

    // After: INSERT INTO voicemails ...

    // 6. Add to Azurecast (fire and forget, but log errors)
    try {
      await addToPlaylist(localPath, voiceNumber);
    } catch (err) {
      console.error('[Azurecast] Failed to add to playlist:', err);
      // Don't throw - we don't want to fail the webhook
    }

    // 7. Send SMS confirmation
    try {
      await sendConfirmation(From, voiceNumber);
    } catch (err) {
      console.error('[SMS] Failed to send confirmation:', err);
      // Don't throw - SMS failure shouldn't break the flow
    }

    // 8. Return empty TwiML (call ends naturally)
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Thank you for your message. Goodbye.</Say>
  <Hangup/>
</Response>`;

    res.set('Content-Type', 'text/xml');
    res.send(twiml);

  } catch (error) {
    console.error('Error processing recording:', error);
    // Return 200 to Twilio anyway so they don't retry indefinitely
    // But log the error for monitoring
    res.set('Content-Type', 'text/xml');
    res.send('<?xml version="1.0" encoding="UTF-8"?><Response/>');
  }
}

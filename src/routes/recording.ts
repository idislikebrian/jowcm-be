import { Request, Response } from 'express';
import { PoolClient } from 'pg';
import pool from '../db/client.js';
import { downloadAudio } from '../services/storage.js';
import { validateTwilioWebhook } from '../utils/validateTwilio.js';
import { updateUserStreak } from '../services/user-streak.js';
import { sendConfirmation } from '../services/twilio.js';
import { normalizePhoneNumber } from '../utils/normalizePhoneNumber.js';
import { logEvent } from '../utils/logEvent.js';

const VOICEMAIL_STORAGE_PATH = process.env.VOICEMAIL_STORAGE_PATH || '/var/voicemails';

interface ExistingVoicemailRow {
  id: number;
  voice_number: number;
}

interface MetaRow {
  value: string;
}

/**
 * Atomically increments the global_voice_count in the meta table
 * Uses a transaction with FOR UPDATE to prevent race conditions
 * @returns The new voice number (incremented count)
 */
async function incrementVoiceCounter(client: PoolClient): Promise<number> {
  const result = await client.query<MetaRow>(
    'SELECT value FROM meta WHERE key = $1 FOR UPDATE',
    ['global_voice_count']
  );

  if (result.rows.length === 0) {
    throw new Error('global_voice_count not found in meta table');
  }

  const current = parseInt(result.rows[0].value, 10);
  const next = current + 1;

  await client.query(
    'UPDATE meta SET value = $1 WHERE key = $2',
    [next, 'global_voice_count']
  );

  return next;
}

async function findExistingVoicemail(
  client: Pick<PoolClient, 'query'>,
  recordingSid: string
): Promise<ExistingVoicemailRow | null> {
  const existingResult = await client.query<ExistingVoicemailRow>(
    'SELECT id, voice_number FROM voicemails WHERE recording_sid = $1 LIMIT 1',
    [recordingSid]
  );

  return existingResult.rows[0] ?? null;
}

async function persistVoicemail(params: {
  recordingSid: string;
  phoneNumber: string | null;
  recordingUrl: string;
  recordingDuration: string | undefined;
}): Promise<{ voiceNumber: number; localPath: string } | null> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [params.recordingSid]);

    const existing = await findExistingVoicemail(client, params.recordingSid);
    if (existing) {
      logEvent('idempotent_retry_skipped', {
        recording_sid: params.recordingSid,
        voice_number: existing.voice_number,
      });
      await client.query('COMMIT');
      return null;
    }

    const voiceNumber = await incrementVoiceCounter(client);
    const localPath = `${VOICEMAIL_STORAGE_PATH}/${voiceNumber}_${params.recordingSid}.mp3`;
    const audioUrl = `${params.recordingUrl}.mp3`;

    await downloadAudio(audioUrl, localPath);

    await client.query(
      `INSERT INTO voicemails (
        voice_number,
        phone_number,
        recording_sid,
        recording_url,
        duration,
        local_path,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [
        voiceNumber,
        params.phoneNumber,
        params.recordingSid,
        params.recordingUrl,
        parseInt(params.recordingDuration || '0', 10),
        localPath,
      ]
    );

    await client.query('COMMIT');

    logEvent('voicemail_persisted', {
      recording_sid: params.recordingSid,
      voice_number: voiceNumber,
      phone_number: params.phoneNumber,
      local_path: localPath,
    });

    return { voiceNumber, localPath };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function twimlResponse(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Thank you for your message. Goodbye.</Say>
  <Hangup/>
</Response>`;
}

/**
 * POST /recording-complete
 * Handles recording completion from Twilio
 * - Validates Twilio signature
 * - Atomically increments counter
 * - Downloads audio file
 * - Saves to database
 * - Sends SMS confirmation (best effort)
 */
export default async function recordingHandler(req: Request, res: Response): Promise<void> {
  try {
    // 1. Validate Twilio signature (skip if no webhook secret configured)
    const authToken = process.env.TWILIO_AUTH_TOKEN || '';
    const signature = req.headers['x-twilio-signature'] as string || '';
    
    // Use X-Forwarded-Proto and X-Forwarded-Host for proxied requests
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.get('host');
    const url = `${protocol}://${host}${req.originalUrl}`;

    // Only validate if we have a signature and auth token
    if (signature && authToken) {
      const isValid = validateTwilioWebhook(authToken, signature, url, req.body);
      if (!isValid) {
        console.error('Invalid Twilio signature');
        res.status(403).send('Forbidden');
        return;
      }
    } else {
      console.log('Skipping Twilio signature validation (no signature or auth token)');
    }

    // 2. Extract data from request body
    const { From, RecordingUrl, RecordingDuration, RecordingSid } = req.body;

    if (!RecordingUrl || !RecordingSid) {
      console.error('Missing required fields:', { RecordingUrl, RecordingSid });
      res.status(400).send('Bad Request');
      return;
    }

    const normalizedPhoneNumber = normalizePhoneNumber(From);

    const existingVoicemailResult = await pool.query<ExistingVoicemailRow>(
      'SELECT id, voice_number FROM voicemails WHERE recording_sid = $1 LIMIT 1',
      [RecordingSid]
    );
    const existingVoicemail = existingVoicemailResult.rows[0] ?? null;

    if (existingVoicemail) {
      logEvent('idempotent_retry_skipped', {
        recording_sid: RecordingSid,
        voice_number: existingVoicemail.voice_number,
      });
      res.set('Content-Type', 'text/xml');
      res.send(twimlResponse());
      return;
    }

    const persistedVoicemail = await persistVoicemail({
      recordingSid: RecordingSid,
      phoneNumber: normalizedPhoneNumber,
      recordingUrl: RecordingUrl,
      recordingDuration: RecordingDuration,
    });

    if (!persistedVoicemail) {
      res.set('Content-Type', 'text/xml');
      res.send(twimlResponse());
      return;
    }

    const { voiceNumber } = persistedVoicemail;

    if (normalizedPhoneNumber) {
      try {
        const userState = await updateUserStreak(normalizedPhoneNumber, new Date());
        try {
          await sendConfirmation(normalizedPhoneNumber, voiceNumber, userState.streakCount);
        } catch (err) {
          logEvent('sms_failure', {
            phone_number: normalizedPhoneNumber,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      } catch (err) {
        logEvent('streak_update_failed', {
          phone_number: normalizedPhoneNumber,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } else if (From) {
      logEvent('phone_number_skipped', {
        raw_from: From,
        reason: 'unusable_phone_number',
      });
    } else {
      logEvent('phone_number_skipped', {
        reason: 'missing_from',
      });
    }

    res.set('Content-Type', 'text/xml');
    res.send(twimlResponse());

  } catch (error) {
    console.error('Error processing recording:', error);
    // Return 200 to Twilio anyway so they don't retry indefinitely
    // But log the error for monitoring
    res.set('Content-Type', 'text/xml');
    res.send('<?xml version="1.0" encoding="UTF-8"?><Response/>');
  }
}

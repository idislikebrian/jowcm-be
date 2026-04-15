import express from 'express';
import dotenv from 'dotenv';
import voiceHandler from './routes/voice.js';
import recordingHandler from './routes/recording.js';
import pool from './db/client.js';
import fs from 'fs/promises';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint with detailed status
app.get('/health', async (req, res) => {
  const checks = {
    db: false,
    twilio: false,
    storage: false,
  };

  // Check DB
  try {
    await pool.query('SELECT 1');
    checks.db = true;
  } catch (e) {
    console.error('DB health check failed:', e);
  }

  // Check Twilio env
  checks.twilio = !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);

  // Check storage
  try {
    await fs.access(process.env.VOICEMAIL_STORAGE_PATH || '/var/voicemails', fs.constants.W_OK);
    checks.storage = true;
  } catch (e) {
    console.error('Storage health check failed:', e);
  }

  const status = checks.db && checks.twilio && checks.storage ? 'ok' : 'degraded';
  res.json({ status, checks, timestamp: new Date().toISOString() });
});

// Twilio webhook routes
app.post('/voice', voiceHandler);
app.post('/recording-complete', recordingHandler);

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Internal server error' });
});

app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`JOWCM Hotline server running on port ${PORT}`);
});

export default app;

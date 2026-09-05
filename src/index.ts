import express from 'express';
import dotenv from 'dotenv';
import voiceHandler from './routes/voice.js';
import recordingHandler from './routes/recording.js';
import { startPlaylistCron } from './services/playlist-cron.js';
import { getHealthReport } from './services/health.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint — see src/services/health.ts for the component contract
app.get('/health', async (req, res) => {
  const report = await getHealthReport();
  const httpStatus = report.status === 'error' ? 503 : 200;
  res.status(httpStatus).json(report);
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

// Starts only when AzuraCast API config is present; logs and no-ops otherwise.
startPlaylistCron();

export default app;

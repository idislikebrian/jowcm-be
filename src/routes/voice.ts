import { Request, Response } from 'express';

/**
 * POST /voice
 * Returns TwiML to Twilio for handling incoming calls
 * Prompts caller to leave a message and records for up to 60 seconds
 */
export default function voiceHandler(req: Request, res: Response): void {
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Leave a message after the tone. You have 60 seconds.</Say>
  <Record 
    maxLength="60" 
    action="/recording-complete" 
    method="POST" 
    playBeep="true" 
    finishOnKey="#"
  />
  <Say>No recording received. Goodbye.</Say>
  <Hangup/>
</Response>`;

  res.set('Content-Type', 'text/xml');
  res.send(twiml);
}

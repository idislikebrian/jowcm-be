import twilio from 'twilio';
import { logEvent } from '../utils/logEvent.js';

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const FROM_NUMBER = process.env.TWILIO_PHONE_NUMBER;

export async function sendConfirmation(
  phoneNumber: string,
  voiceNumber: number,
  streakCount: number
): Promise<void> {
  const message = `Voice #${voiceNumber}\nStreak: ${streakCount}\nProcessing now\nCall within 24h to keep it alive`;
  
  await client.messages.create({
    body: message,
    from: FROM_NUMBER,
    to: phoneNumber,
  });

  logEvent('sms_sent', {
    phone_number: phoneNumber,
    voice_number: voiceNumber,
    streak_count: streakCount,
  });
}

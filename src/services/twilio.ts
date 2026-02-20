import twilio from 'twilio';

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const FROM_NUMBER = process.env.TWILIO_PHONE_NUMBER;

export async function sendConfirmation(phoneNumber: string, voiceNumber: number): Promise<void> {
  const message = `You are Voice #${voiceNumber}.\nYour message enters the stream in 5 minutes.`;
  
  await client.messages.create({
    body: message,
    from: FROM_NUMBER,
    to: phoneNumber,
  });
  
  console.log(`[SMS] Confirmation sent to ${phoneNumber} for Voice #${voiceNumber}`);
}

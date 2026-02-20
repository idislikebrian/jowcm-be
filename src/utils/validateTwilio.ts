import { validateRequest } from 'twilio';

/**
 * Validates that a webhook request came from Twilio
 * @param authToken - Twilio auth token
 * @param signature - X-Twilio-Signature header value
 * @param url - Full URL of the webhook endpoint
 * @param params - Request body parameters
 * @returns true if valid, false otherwise
 */
export function validateTwilioWebhook(
  authToken: string,
  signature: string,
  url: string,
  params: Record<string, any>
): boolean {
  return validateRequest(authToken, signature, url, params);
}

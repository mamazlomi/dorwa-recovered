import "server-only";

// Sends one text message through Kavenegar (same provider as the notification function).
// Env: SMS_API_KEY, SMS_SENDER (optional line number).
export type SmsResult = "sent" | "failed" | "no_provider";

export async function sendSms(phone: string, text: string): Promise<SmsResult> {
  const key = process.env.SMS_API_KEY;
  if (!key) return "no_provider";
  const q = new URLSearchParams({ receptor: phone, message: text });
  if (process.env.SMS_SENDER) q.set("sender", process.env.SMS_SENDER);
  try {
    const res = await fetch(`https://api.kavenegar.com/v1/${encodeURIComponent(key)}/sms/send.json?${q}`, {
      signal: AbortSignal.timeout(8000),
    });
    return res.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}

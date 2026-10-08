/**
 * Vapi.ai Voice Bot Integration
 *
 * Free tier: 10 minutes/month, then ~$0.05/min
 * Features: AI-powered, dynamic scripts, Hindi/English, webhooks
 *
 * Setup:
 *   1. Sign up at https://vapi.ai (free)
 *   2. Create an Assistant with the recruitment script
 *   3. Get your API key from Dashboard > API Keys
 *   4. Set VAPI_API_KEY and VAPI_ASSISTANT_ID in .env
 *
 * The assistant is configured with a system prompt that handles:
 *   - Greeting in Hindi + English
 *   - Confirming candidate interest
 *   - Providing next steps
 *   - Handling objections
 */

import axios from 'axios';

export interface VapiCallInput {
  phone: string;
  name: string;
  designation: string | null;
  branch: string | null;
  referenceId: string;
  language?: 'hi' | 'en' | 'hi-en';
}

export interface VapiCallResult {
  status: 'triggered' | 'skipped' | 'failed';
  callId: string | null;
  detail: string | null;
}

export function isVapiConfigured(): boolean {
  return Boolean(process.env.VAPI_API_KEY && process.env.VAPI_ASSISTANT_ID);
}

/**
 * The recruitment script template - fully customizable.
 * Variables: {{name}}, {{role}}, {{branch}}, {{referenceId}}
 */
export function buildRecruitmentPrompt(input: VapiCallInput): string {
  const role = input.designation ?? 'Customer Service Executive';
  const branch = input.branch ?? 'our office';

  return `You are a friendly recruitment assistant for MAS Callnet, a BPO company.
You are calling ${input.name} who applied for the ${role} position at ${branch}.

## Your Personality
- Warm, professional, and encouraging
- Speak in a mix of Hindi and English (Hinglish) as is common in Indian business calls
- Be concise - this is a phone call, not a lecture

## Call Flow

### 1. Greeting (Hindi + English)
"Namaste ${input.name} ji, main MAS Callnet se bol raha/rahi hoon. Aapne hamare yahan ${role} ke liye apply kiya tha. Kya aap abhi baat kar sakte hain?"

If they say no or busy:
"Koi baat nahi, main aapko baad mein call karunga/karungi. Thank you!"
[End call]

### 2. Confirm Interest
"Bahut accha! Aapka application shortlist ho gaya hai. Congratulations! Kya aap is opportunity mein interested hain?"

If not interested:
"Koi baat nahi, thank you for your time. Have a nice day!"
[End call]

### 3. Next Steps
"Perfect! Aapko kal ya parson ${branch} aana hoga interview ke liye. Please apna Aadhaar card, PAN card, aur education certificates lekar aayein.

Timing subah 10 baje se shaam 5 baje tak hai. Kya aap aa sakte hain?"

### 4. Confirm & Close
If yes: "Wonderful! Hum aapka wait karenge. Interview ke liye all the best! Reference number hai: ${input.referenceId}. Koi bhi question ho toh WhatsApp par message kar dijiye."

If no/unsure: "Koi problem nahi. Agar aapko koi doubt ho toh WhatsApp par message kar dijiye. Thank you ${input.name} ji, have a nice day!"

## Important Rules
- Never make up information about salary, benefits, or job details
- If asked about salary, say "Salary interview mein discuss hogi, it's competitive for the industry"
- If they ask complex questions, say "Ye details interview mein discuss hongi"
- Keep the call under 2 minutes
- Always be respectful and professional`;
}

/**
 * Trigger a Vapi.ai outbound call with personalized script.
 */
export async function triggerVapiCall(input: VapiCallInput): Promise<VapiCallResult> {
  const apiKey = process.env.VAPI_API_KEY;
  const assistantId = process.env.VAPI_ASSISTANT_ID;

  if (!apiKey || !assistantId) {
    return {
      status: 'skipped',
      callId: null,
      detail: 'VAPI_API_KEY or VAPI_ASSISTANT_ID not configured',
    };
  }

  // Format phone for India (+91)
  let phone = input.phone.replace(/\D/g, '');
  if (phone.length === 10) phone = `+91${phone}`;
  else if (!phone.startsWith('+')) phone = `+${phone}`;

  const callbackUrl = process.env.VAPI_CALLBACK_URL
    ?? `${process.env.BACKEND_PUBLIC_URL ?? ''}/api/meta/vapi-callback`;

  try {
    const { data } = await axios.post(
      'https://api.vapi.ai/call/phone',
      {
        assistantId,
        phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID, // Your Vapi phone number
        customer: {
          number: phone,
          name: input.name,
        },
        // Dynamic variables injected into the assistant's prompt
        assistantOverrides: {
          variableValues: {
            name: input.name,
            role: input.designation ?? 'Customer Service Executive',
            branch: input.branch ?? 'our office',
            referenceId: input.referenceId,
          },
          // Or override the entire system prompt for full customization:
          // model: {
          //   provider: 'openai',
          //   model: 'gpt-4o-mini',
          //   messages: [{ role: 'system', content: buildRecruitmentPrompt(input) }],
          // },
        },
        metadata: {
          referenceId: input.referenceId,
          source: 'meta-campaign',
        },
        // Webhook for call completion
        serverUrl: callbackUrl,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }
    );

    return {
      status: 'triggered',
      callId: data.id ?? data.callId ?? null,
      detail: null,
    };
  } catch (err) {
    const msg = axios.isAxiosError(err)
      ? err.response?.data?.message ?? err.message
      : err instanceof Error ? err.message : String(err);

    return {
      status: 'failed',
      callId: null,
      detail: msg,
    };
  }
}

/**
 * Alternative: Use Vapi's transient assistant (no pre-created assistant needed).
 * The entire script is sent with each call - maximum flexibility.
 */
export async function triggerVapiCallWithInlineScript(input: VapiCallInput): Promise<VapiCallResult> {
  const apiKey = process.env.VAPI_API_KEY;

  if (!apiKey) {
    return {
      status: 'skipped',
      callId: null,
      detail: 'VAPI_API_KEY not configured',
    };
  }

  let phone = input.phone.replace(/\D/g, '');
  if (phone.length === 10) phone = `+91${phone}`;
  else if (!phone.startsWith('+')) phone = `+${phone}`;

  const callbackUrl = process.env.VAPI_CALLBACK_URL
    ?? `${process.env.BACKEND_PUBLIC_URL ?? ''}/api/meta/vapi-callback`;

  try {
    const { data } = await axios.post(
      'https://api.vapi.ai/call/phone',
      {
        phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID,
        customer: {
          number: phone,
          name: input.name,
        },
        // Transient assistant - created just for this call
        assistant: {
          name: `Recruitment Call - ${input.referenceId}`,
          model: {
            provider: 'openai',
            model: 'gpt-4o-mini', // Cost-effective, fast
            messages: [
              {
                role: 'system',
                content: buildRecruitmentPrompt(input),
              },
            ],
          },
          voice: {
            provider: '11labs',
            voiceId: process.env.VAPI_VOICE_ID ?? 'sarah', // Indian English voice
          },
          // First message the AI speaks
          firstMessage: `Namaste ${input.name} ji, main MAS Callnet se bol raha hoon.`,
          // End call phrases
          endCallPhrases: ['goodbye', 'bye', 'thank you bye', 'alvida'],
          // Max call duration (seconds)
          maxDurationSeconds: 180,
          // Transcription settings
          transcriber: {
            provider: 'deepgram',
            language: 'hi', // Hindi primary
          },
        },
        metadata: {
          referenceId: input.referenceId,
          source: 'meta-campaign',
        },
        serverUrl: callbackUrl,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }
    );

    return {
      status: 'triggered',
      callId: data.id ?? null,
      detail: null,
    };
  } catch (err) {
    const msg = axios.isAxiosError(err)
      ? err.response?.data?.message ?? err.message
      : err instanceof Error ? err.message : String(err);

    return {
      status: 'failed',
      callId: null,
      detail: msg,
    };
  }
}

/**
 * Handle Vapi webhook callback when call completes.
 */
export interface VapiCallbackPayload {
  type: 'call-ended' | 'transcript' | 'status-update';
  call?: {
    id: string;
    status: string;
    endedReason?: string;
    duration?: number;
    transcript?: string;
    summary?: string;
    metadata?: { referenceId?: string };
  };
}

export function parseVapiCallback(payload: VapiCallbackPayload): {
  referenceId: string | null;
  status: string;
  duration: number | null;
  transcript: string | null;
  summary: string | null;
  outcome: 'interested' | 'not_interested' | 'no_answer' | 'busy' | 'unknown';
} {
  const call = payload.call;
  if (!call) {
    return {
      referenceId: null,
      status: 'unknown',
      duration: null,
      transcript: null,
      summary: null,
      outcome: 'unknown',
    };
  }

  // Determine outcome from transcript/summary
  let outcome: 'interested' | 'not_interested' | 'no_answer' | 'busy' | 'unknown' = 'unknown';
  const text = (call.transcript ?? '') + ' ' + (call.summary ?? '');
  const lower = text.toLowerCase();

  if (call.endedReason === 'no-answer' || lower.includes('no answer')) {
    outcome = 'no_answer';
  } else if (call.endedReason === 'busy' || lower.includes('busy')) {
    outcome = 'busy';
  } else if (
    lower.includes('not interested') ||
    lower.includes('interested nahi') ||
    lower.includes('nahi chahiye')
  ) {
    outcome = 'not_interested';
  } else if (
    lower.includes('interested') ||
    lower.includes('aa sakta') ||
    lower.includes('aa sakti') ||
    lower.includes('aaunga') ||
    lower.includes('aaungi') ||
    lower.includes('will come') ||
    lower.includes('yes')
  ) {
    outcome = 'interested';
  }

  return {
    referenceId: call.metadata?.referenceId ?? null,
    status: call.status ?? 'completed',
    duration: call.duration ?? null,
    transcript: call.transcript ?? null,
    summary: call.summary ?? null,
    outcome,
  };
}

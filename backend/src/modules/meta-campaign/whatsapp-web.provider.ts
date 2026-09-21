/**
 * Self-Hosted WhatsApp Provider using whatsapp-web.js
 *
 * This connects via WhatsApp Web - scan QR code once, then it stays connected.
 *
 * Setup:
 *   1. npm install whatsapp-web.js qrcode-terminal
 *   2. Set WHATSAPP_SESSION_PATH in .env (default: ./whatsapp-session)
 *   3. On first run, scan the QR code with a dedicated WhatsApp number
 *   4. Session persists after that
 *
 * Note: Use a dedicated number for this, not your personal WhatsApp.
 * Risk: WhatsApp may ban numbers that send too many messages too fast.
 * Best practice: Max 50-100 messages/hour, with random delays.
 */

import { EventEmitter } from 'events';

// Types for whatsapp-web.js (installed separately)
interface WAClient {
  on(event: string, callback: (...args: unknown[]) => void): void;
  initialize(): Promise<void>;
  sendMessage(chatId: string, content: string): Promise<unknown>;
  getState(): Promise<string>;
  destroy(): Promise<void>;
}

interface WAClientConstructor {
  new (options: {
    authStrategy: unknown;
    puppeteer?: { headless: boolean; args: string[] };
  }): WAClient;
}

interface LocalAuthConstructor {
  new (options: { clientId: string; dataPath?: string }): unknown;
}

let Client: WAClientConstructor | null = null;
let LocalAuth: LocalAuthConstructor | null = null;
let qrcodeTerminal: { generate: (text: string, opts: { small: boolean }) => void } | null = null;

// Lazy load the dependencies (they're heavy)
async function loadDependencies(): Promise<boolean> {
  if (Client && LocalAuth) return true;

  try {
    // Dynamic imports to avoid build errors when packages aren't installed
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const wwjs = await (eval('import("whatsapp-web.js")') as Promise<{
      Client: WAClientConstructor;
      LocalAuth: LocalAuthConstructor;
    }>);
    Client = wwjs.Client;
    LocalAuth = wwjs.LocalAuth;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    qrcodeTerminal = await (eval('import("qrcode-terminal")') as Promise<{
      generate: (text: string, opts: { small: boolean }) => void;
    }>);
    return true;
  } catch {
    console.warn('[whatsapp-web] whatsapp-web.js not installed. Run: npm install whatsapp-web.js qrcode-terminal');
    return false;
  }
}

class WhatsAppWebProvider extends EventEmitter {
  private client: WAClient | null = null;
  private ready = false;
  private initializing = false;
  private sessionPath: string;

  constructor() {
    super();
    this.sessionPath = process.env.WHATSAPP_SESSION_PATH ?? './whatsapp-session';
  }

  async initialize(): Promise<boolean> {
    if (this.ready) return true;
    if (this.initializing) {
      // Wait for existing initialization
      return new Promise((resolve) => {
        this.once('ready', () => resolve(true));
        this.once('error', () => resolve(false));
      });
    }

    this.initializing = true;

    const loaded = await loadDependencies();
    if (!loaded || !Client || !LocalAuth) {
      this.initializing = false;
      return false;
    }

    try {
      this.client = new Client({
        authStrategy: new LocalAuth({
          clientId: 'mas-hrms',
          dataPath: this.sessionPath,
        }),
        puppeteer: {
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox'],
        },
      });

      this.client.on('qr', (qr: string) => {
        console.log('\n[WhatsApp] Scan QR code to connect:');
        qrcodeTerminal?.generate(qr, { small: true });
        this.emit('qr', qr);
      });

      this.client.on('ready', () => {
        console.log('[WhatsApp] Connected and ready!');
        this.ready = true;
        this.initializing = false;
        this.emit('ready');
      });

      this.client.on('authenticated', () => {
        console.log('[WhatsApp] Authenticated');
      });

      this.client.on('auth_failure', (msg: string) => {
        console.error('[WhatsApp] Auth failed:', msg);
        this.ready = false;
        this.initializing = false;
        this.emit('error', new Error(msg));
      });

      this.client.on('disconnected', (reason: string) => {
        console.warn('[WhatsApp] Disconnected:', reason);
        this.ready = false;
        this.emit('disconnected', reason);
      });

      await this.client.initialize();
      return true;
    } catch (err) {
      console.error('[WhatsApp] Initialization failed:', err);
      this.initializing = false;
      this.emit('error', err);
      return false;
    }
  }

  isReady(): boolean {
    return this.ready;
  }

  async getStatus(): Promise<'connected' | 'disconnected' | 'not_initialized'> {
    if (!this.client) return 'not_initialized';
    try {
      const state = await this.client.getState();
      return state === 'CONNECTED' ? 'connected' : 'disconnected';
    } catch {
      return 'disconnected';
    }
  }

  /**
   * Send a WhatsApp message.
   * @param phone Phone number (10 digit Indian or with country code)
   * @param message Text message to send
   */
  async sendMessage(phone: string, message: string): Promise<{
    success: boolean;
    messageId?: string;
    error?: string;
  }> {
    if (!this.ready || !this.client) {
      return { success: false, error: 'WhatsApp not connected' };
    }

    // Format phone number to WhatsApp format: 919876543210@c.us
    let formatted = phone.replace(/\D/g, '');
    if (formatted.length === 10) {
      formatted = `91${formatted}`; // Add India code
    }
    if (!formatted.startsWith('91')) {
      formatted = `91${formatted}`;
    }
    const chatId = `${formatted}@c.us`;

    try {
      const result = await this.client.sendMessage(chatId, message) as { id?: { id?: string } };
      return {
        success: true,
        messageId: result?.id?.id ?? 'sent',
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async destroy(): Promise<void> {
    if (this.client) {
      await this.client.destroy();
      this.client = null;
      this.ready = false;
    }
  }
}

// Singleton instance
let instance: WhatsAppWebProvider | null = null;

export function getWhatsAppWebProvider(): WhatsAppWebProvider {
  if (!instance) {
    instance = new WhatsAppWebProvider();
  }
  return instance;
}

export function isWhatsAppWebConfigured(): boolean {
  // Check if the session exists or if we should try to initialize
  return Boolean(process.env.ENABLE_WHATSAPP_WEB);
}

/**
 * Send a recruitment notification via WhatsApp Web.
 */
export async function sendWhatsAppNotification(
  phone: string,
  name: string,
  designation: string | null,
  branch: string | null,
  referenceId: string
): Promise<{ success: boolean; error?: string }> {
  if (!isWhatsAppWebConfigured()) {
    return { success: false, error: 'WhatsApp Web not enabled (set ENABLE_WHATSAPP_WEB=true)' };
  }

  const provider = getWhatsAppWebProvider();

  if (!provider.isReady()) {
    const initialized = await provider.initialize();
    if (!initialized) {
      return { success: false, error: 'WhatsApp Web failed to initialize' };
    }
  }

  const role = designation ?? 'Customer Service Executive';
  const place = branch ? ` (${branch})` : '';

  const message = `नमस्ते ${name} ji! 🙏

*MAS Callnet* में *${role}*${place} के लिए आपका application *shortlist* हो गया है! 🎉

अगले steps:
📋 Interview के लिए office आएं
📄 Aadhaar, PAN, और education proof लाएं
⏰ Timing: सुबह 10 बजे से शाम 5 बजे

— — —

Hello ${name}!

Your application for *${role}*${place} at *MAS Callnet* has been *shortlisted*! 🎉

Next steps:
📋 Visit our office for interview
📄 Bring Aadhaar, PAN & education proof
⏰ Timing: 10 AM to 5 PM

Reference: ${referenceId}

Reply "CALL" if you'd like us to call you! 📞`;

  return provider.sendMessage(phone, message);
}

/**
 * Message templates for different scenarios
 */
export const WHATSAPP_TEMPLATES = {
  shortlisted: (name: string, role: string, branch: string | null) => `
नमस्ते ${name} ji! 🙏

*MAS Callnet* में *${role}*${branch ? ` (${branch})` : ''} के लिए आपका application *shortlist* हो गया है! 🎉

Interview के लिए office आएं:
📄 Aadhaar, PAN, education proof लाएं
⏰ 10 AM - 5 PM

Reply "CALL" for a callback! 📞`.trim(),

  reminder: (name: string, role: string) => `
Hi ${name}!

Reminder: आपका ${role} interview pending है।
क्या आप आ रहे हैं?

Reply:
1️⃣ - हाँ, आ रहा/रही हूँ
2️⃣ - Date change करना है
3️⃣ - Cancel करना है`.trim(),

  interviewConfirm: (name: string, date: string, address: string) => `
${name} ji, आपका interview confirm है!

📅 Date: ${date}
📍 Address: ${address}

Documents लाना न भूलें:
✅ Aadhaar Card
✅ PAN Card
✅ Education Certificates
✅ 2 Passport Photos

All the best! 🍀`.trim(),
};

/**
 * One-off: register the self-hosted OmniRoute gateway as an AI provider and
 * make it the active default, so Mira (and anything else that goes through
 * aiProviderRegistry.getDefault()) routes through it.
 *
 * Purely additive — inserts/updates one row in the existing ai_provider_config
 * table (see backend/sql/500_ai_provider_foundation.sql), no schema change, no
 * table created. Existing rows (rule-based, gemini, openrouter, claude) are
 * left untouched except for is_default being cleared on them, which the
 * existing aiProviderConfigService.create()/setDefault() already does for any
 * new default.
 *
 * OmniRoute runs loopback-only on this same box (127.0.0.1:20128, pm2
 * process "omniroute-gateway") — see hrms2-omniroute-gateway memory. Keyless
 * "auto" mode for now, so no API key is stored here.
 *
 * Usage: ./node_modules/.bin/tsx scripts/wire-omniroute-provider.ts
 */
import { db } from '../src/db/mysql.js';
import { aiProviderConfigService } from '../src/modules/ai/ai-provider-config.service.js';

async function main() {
  const existing = await aiProviderConfigService.getByKey('omniroute', false);

  if (existing) {
    await aiProviderConfigService.update(existing.id!, {
      activeStatus: 'active',
      isDefault: true,
      modelName: 'auto/best-chat',
      baseUrl: 'http://127.0.0.1:20128/v1',
      updatedBy: 'system',
    });
    console.log('[wire-omniroute] updated existing row, id=', existing.id);
  } else {
    const created = await aiProviderConfigService.create({
      providerKey: 'omniroute',
      providerName: 'OmniRoute Gateway',
      activeStatus: 'active',
      isDefault: true,
      modelName: 'auto/best-chat',
      baseUrl: 'http://127.0.0.1:20128/v1',
      fallbackProviderKey: 'gemini',
      createdBy: 'system',
    });
    console.log('[wire-omniroute] created new row, id=', created.id);
  }

  const nowDefault = await aiProviderConfigService.getDefaultProvider(false);
  console.log('[wire-omniroute] current default provider:', nowDefault?.providerKey, nowDefault?.activeStatus, 'isDefault=', nowDefault?.isDefault);

  await db.end();
}

main().catch(async (error) => {
  console.error('[wire-omniroute] failed:', error);
  try { await db.end(); } catch { /* ignore */ }
  process.exit(1);
});

import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/admin-auth';
import {
  MAIL_MODEL_SETTING_KEY,
  MAIL_MODEL_OPTIONS,
  DEFAULT_MAIL_MODEL_OPTION,
  MailModelOptionId,
  getMailModelOption,
  isMailModelOptionId,
  optionFromSettingValue,
  settingValueForOption,
} from '@/lib/mail-model';
import type { SupabaseClient } from '@supabase/supabase-js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Ob ein Nicht-OpenAI-Provider live wirksam werden kann. Das Support-Backend ist
 * der eigentliche Wächter (Kill-Switch <PROVIDER>_MAIL_ENABLED + Key). Die WDB
 * spiegelt die Schalter über eigene Envs, damit die UI eine nicht freigeschaltete
 * Option sauber sperrt und die Admin-API keine Wahl speichert, die ohnehin auf
 * GPT-5.4 zurückfiele.
 */
function featherlessAvailable(): boolean {
  return process.env.FEATHERLESS_MAIL_ENABLED === 'true';
}

function scalewayAvailable(): boolean {
  return process.env.SCALEWAY_MAIL_ENABLED === 'true';
}

/** Verfügbarkeit je Options-ID (OpenAI immer true). */
function availabilityFor(option: MailModelOptionId): boolean {
  const provider = getMailModelOption(option).provider;
  if (provider === 'featherless') return featherlessAvailable();
  if (provider === 'scaleway') return scalewayAvailable();
  return true;
}

/** Verfügbarkeits-Map über alle Optionen für die UI. */
function availabilityMap(): Record<MailModelOptionId, boolean> {
  return MAIL_MODEL_OPTIONS.reduce(
    (acc, o) => {
      acc[o.id] = availabilityFor(o.id);
      return acc;
    },
    {} as Record<MailModelOptionId, boolean>,
  );
}

const OPTIONS_PAYLOAD = MAIL_MODEL_OPTIONS.map((o) => ({
  id: o.id,
  label: o.label,
  provider: o.providerLabel,
  model: o.model,
}));

async function companyExists(
  supabase: SupabaseClient,
  companyId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('companies')
    .select('id')
    .eq('id', companyId)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

async function hasActiveFineTuning(
  supabase: SupabaseClient,
  companyId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('ai_agent_configurations')
    .select('id')
    .eq('company_id', companyId)
    .eq('model_selection', 'fine_tuned')
    .not('fine_tuned_model_id', 'is', null)
    .limit(1);
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

/** Effektive Einstellung + Optionen + Fine-Tuning-Hinweis für die UI. */
async function buildEffectivePayload(
  supabase: SupabaseClient,
  companyId: string,
) {
  const { data: row, error } = await supabase
    .from('app_settings')
    .select('value, updated_at, updated_by')
    .eq('company_id', companyId)
    .eq('key', MAIL_MODEL_SETTING_KEY)
    .maybeSingle();
  if (error) throw error;

  const stored = row ? optionFromSettingValue(row.value) : null;
  const optionId: MailModelOptionId = stored ?? DEFAULT_MAIL_MODEL_OPTION;
  const source = stored ? 'explicit' : 'default';
  const opt = getMailModelOption(optionId);

  const has_active_fine_tuning = await hasActiveFineTuning(supabase, companyId);

  return {
    company_id: companyId,
    effective: {
      option: opt.id,
      provider: opt.provider,
      model: opt.model,
      source,
    },
    options: OPTIONS_PAYLOAD,
    has_active_fine_tuning,
    // Verfügbarkeit je Option; glm_available bleibt für Rückwärtskompatibilität
    // (= Featherless) erhalten.
    availability: availabilityMap(),
    glm_available: featherlessAvailable(),
    updated_at: row?.updated_at ?? null,
    updated_by: row?.updated_by ?? null,
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: { companyId: string } },
) {
  try {
    const auth = await requireSuperAdmin(request);
    if ('error' in auth) return auth.error;
    const { supabase } = auth;
    const { companyId } = params;

    if (!UUID_RE.test(companyId)) {
      return NextResponse.json({ error: 'Ungültige company_id' }, { status: 400 });
    }
    if (!(await companyExists(supabase, companyId))) {
      return NextResponse.json({ error: 'Unternehmen nicht gefunden' }, { status: 404 });
    }

    return NextResponse.json(await buildEffectivePayload(supabase, companyId));
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { companyId: string } },
) {
  try {
    const auth = await requireSuperAdmin(request);
    if ('error' in auth) return auth.error;
    const { supabase, userId } = auth;
    const { companyId } = params;

    if (!UUID_RE.test(companyId)) {
      return NextResponse.json({ error: 'Ungültige company_id' }, { status: 400 });
    }
    if (!(await companyExists(supabase, companyId))) {
      return NextResponse.json({ error: 'Unternehmen nicht gefunden' }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const option: unknown = body?.option;
    // Nur die Options-ID wird akzeptiert — freie provider/model/base_url/key-
    // Felder aus dem Body werden bewusst ignoriert (Server ist die Quelle).
    if (!isMailModelOptionId(option)) {
      return NextResponse.json(
        {
          error:
            'Ungültige Option. Erlaubt: openai_gpt_5_4 | scaleway_glm_5_2 | featherless_glm_5_2',
        },
        { status: 400 },
      );
    }

    if (!availabilityFor(option)) {
      const providerLabel = getMailModelOption(option).providerLabel;
      return NextResponse.json(
        {
          error: `GLM-5.2 (${providerLabel}) ist serverseitig nicht freigeschaltet.`,
        },
        { status: 409 },
      );
    }

    const { error: upsertError } = await supabase.from('app_settings').upsert(
      {
        company_id: companyId,
        key: MAIL_MODEL_SETTING_KEY,
        value: settingValueForOption(option),
        updated_at: new Date().toISOString(),
        updated_by: userId,
      },
      { onConflict: 'company_id,key' },
    );
    if (upsertError) {
      return NextResponse.json({ error: upsertError.message }, { status: 500 });
    }

    // Strukturiertes Audit-Log (kein Secret/Prompt).
    console.info(
      JSON.stringify({
        event: 'mail_model_setting_changed',
        company_id: companyId,
        to: option,
        admin_user_id: userId,
      }),
    );

    return NextResponse.json(await buildEffectivePayload(supabase, companyId));
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

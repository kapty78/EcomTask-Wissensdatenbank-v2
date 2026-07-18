/**
 * Mailagent-Modellwahl pro Unternehmen — geteilte Konstanten für Admin-API +
 * Admin-Panel (Plan MAILAGENT-MODELLWECHSEL-PRO-UNTERNEHMEN).
 *
 * Der Browser sendet NIE eine freie Modell-ID/Base-URL/API-Key — nur eine der
 * Options-IDs. Der Server übersetzt sie in {schema_version, provider, model}
 * und schreibt das nach app_settings.mail_completion_model. Die Werte MÜSSEN
 * exakt der Python-Registry (Support-Backend/app/services/mail_model_provider.py)
 * entsprechen.
 */

export const MAIL_MODEL_SETTING_KEY = 'mail_completion_model';
export const MAIL_MODEL_SCHEMA_VERSION = 1;

export type MailModelOptionId =
  | 'openai_gpt_5_4'
  | 'featherless_glm_5_2'
  | 'scaleway_glm_5_2';
export type MailModelProvider = 'openai' | 'featherless' | 'scaleway';

export interface MailModelOption {
  id: MailModelOptionId;
  /** Verständlicher Modellname für die UI. */
  label: string;
  provider: MailModelProvider;
  /** Verständlicher Providername für die UI. */
  providerLabel: string;
  /** Kanonische Modell-ID (nur im Detailtext, nie als Auswahlwert vom Client). */
  model: string;
}

export const MAIL_MODEL_OPTIONS: MailModelOption[] = [
  {
    id: 'openai_gpt_5_4',
    label: 'GPT-5.4',
    provider: 'openai',
    providerLabel: 'OpenAI',
    model: 'gpt-5.4-2026-03-05',
  },
  {
    id: 'scaleway_glm_5_2',
    label: 'GLM-5.2',
    provider: 'scaleway',
    providerLabel: 'Scaleway (EU)',
    model: 'glm-5.2',
  },
  {
    id: 'featherless_glm_5_2',
    label: 'GLM-5.2',
    provider: 'featherless',
    providerLabel: 'Featherless',
    model: 'zai-org/GLM-5.2',
  },
];

/** Backend-Default, wenn ein Unternehmen (noch) keine Wahl gespeichert hat. */
export const DEFAULT_MAIL_MODEL_OPTION: MailModelOptionId = 'openai_gpt_5_4';

export function getMailModelOption(id: MailModelOptionId): MailModelOption {
  const opt = MAIL_MODEL_OPTIONS.find((o) => o.id === id);
  if (!opt) throw new Error(`Unknown mail model option: ${id}`);
  return opt;
}

export function isMailModelOptionId(value: unknown): value is MailModelOptionId {
  return (
    value === 'openai_gpt_5_4' ||
    value === 'featherless_glm_5_2' ||
    value === 'scaleway_glm_5_2'
  );
}

/** app_settings.value → Options-ID (per Provider). null bei unbekanntem Wert. */
export function optionFromSettingValue(value: unknown): MailModelOptionId | null {
  if (!value || typeof value !== 'object') return null;
  const provider = (value as { provider?: unknown }).provider;
  if (provider === 'openai') return 'openai_gpt_5_4';
  if (provider === 'featherless') return 'featherless_glm_5_2';
  if (provider === 'scaleway') return 'scaleway_glm_5_2';
  return null;
}

/** Options-ID → app_settings.value (Server-seitige Übersetzung, keine freien Felder). */
export function settingValueForOption(id: MailModelOptionId): {
  schema_version: number;
  provider: MailModelProvider;
  model: string;
} {
  const opt = getMailModelOption(id);
  return {
    schema_version: MAIL_MODEL_SCHEMA_VERSION,
    provider: opt.provider,
    model: opt.model,
  };
}

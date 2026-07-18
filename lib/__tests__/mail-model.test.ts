/** @jest-environment node */
import {
  optionFromSettingValue,
  settingValueForOption,
  isMailModelOptionId,
  getMailModelOption,
  DEFAULT_MAIL_MODEL_OPTION,
} from '@/lib/mail-model';

describe('mail-model shared helpers', () => {
  it('maps app_settings value → option by provider', () => {
    expect(optionFromSettingValue({ provider: 'openai', model: 'x' })).toBe('openai_gpt_5_4');
    expect(optionFromSettingValue({ provider: 'featherless', model: 'y' })).toBe('featherless_glm_5_2');
  });

  it('returns null for unknown / malformed values', () => {
    expect(optionFromSettingValue({ provider: 'anthropic' })).toBeNull();
    expect(optionFromSettingValue(null)).toBeNull();
    expect(optionFromSettingValue('nope')).toBeNull();
    expect(optionFromSettingValue({})).toBeNull();
  });

  it('translates option → canonical setting value', () => {
    expect(settingValueForOption('openai_gpt_5_4')).toEqual({
      schema_version: 1,
      provider: 'openai',
      model: 'gpt-5.4-2026-03-05',
    });
    expect(settingValueForOption('featherless_glm_5_2')).toEqual({
      schema_version: 1,
      provider: 'featherless',
      model: 'zai-org/GLM-5.2',
    });
  });

  it('round-trips option → value → option', () => {
    for (const id of ['openai_gpt_5_4', 'featherless_glm_5_2'] as const) {
      expect(optionFromSettingValue(settingValueForOption(id))).toBe(id);
    }
  });

  it('validates option ids', () => {
    expect(isMailModelOptionId('openai_gpt_5_4')).toBe(true);
    expect(isMailModelOptionId('featherless_glm_5_2')).toBe(true);
    expect(isMailModelOptionId('gpt-4')).toBe(false);
    expect(isMailModelOptionId(null)).toBe(false);
  });

  it('default option is OpenAI GPT-5.4', () => {
    expect(DEFAULT_MAIL_MODEL_OPTION).toBe('openai_gpt_5_4');
    expect(getMailModelOption(DEFAULT_MAIL_MODEL_OPTION).model).toBe('gpt-5.4-2026-03-05');
  });
});

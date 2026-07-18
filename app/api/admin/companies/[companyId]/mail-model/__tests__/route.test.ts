/** @jest-environment node */
import { NextResponse } from 'next/server';

jest.mock('@/lib/admin-auth', () => ({ requireSuperAdmin: jest.fn() }));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { requireSuperAdmin } = require('@/lib/admin-auth') as { requireSuperAdmin: jest.Mock };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { GET, PATCH } = require('../route') as typeof import('../route');

const COMPANY_ID = '11111111-1111-1111-1111-111111111111';

interface FakeOpts {
  company?: { id: string } | null;
  fineTuned?: boolean;
  appSettingRow?: { value: unknown; updated_at: string | null; updated_by: string | null } | null;
  upsertError?: string | null;
}

function makeSupabase(opts: FakeOpts) {
  const upsert = jest.fn().mockResolvedValue({
    error: opts.upsertError ? { message: opts.upsertError } : null,
  });
  const supabase = {
    upsert,
    from(table: string) {
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        not: () => builder,
        limit: () =>
          Promise.resolve({ data: opts.fineTuned ? [{ id: 'x' }] : [], error: null }),
        maybeSingle: () => {
          if (table === 'companies') {
            return Promise.resolve({ data: opts.company ?? null, error: null });
          }
          if (table === 'app_settings') {
            return Promise.resolve({ data: opts.appSettingRow ?? null, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        },
        upsert,
      };
      return builder;
    },
  };
  return supabase as any;
}

function asSuperAdmin(opts: FakeOpts) {
  requireSuperAdmin.mockResolvedValue({ userId: 'admin-1', supabase: makeSupabase(opts) });
}

const req = (json?: unknown) => ({ json: async () => json }) as any;
const params = { params: { companyId: COMPANY_ID } };

beforeEach(() => {
  requireSuperAdmin.mockReset();
  delete process.env.FEATHERLESS_MAIL_ENABLED;
  delete process.env.SCALEWAY_MAIL_ENABLED;
});

describe('mail-model route auth + validation', () => {
  it('propagates the auth error (403) from requireSuperAdmin', async () => {
    requireSuperAdmin.mockResolvedValue({ error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) });
    const res = await GET(req() as any, params as any);
    expect(res.status).toBe(403);
  });

  it('rejects a non-UUID companyId with 400', async () => {
    asSuperAdmin({ company: { id: 'x' } });
    const res = await GET(req() as any, { params: { companyId: 'not-a-uuid' } } as any);
    expect(res.status).toBe(400);
  });

  it('returns 404 when the company does not exist', async () => {
    asSuperAdmin({ company: null });
    const res = await GET(req() as any, params as any);
    expect(res.status).toBe(404);
  });

  it('GET returns effective=default when no row is stored', async () => {
    asSuperAdmin({ company: { id: COMPANY_ID }, appSettingRow: null });
    const res = await GET(req() as any, params as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.effective).toEqual(
      expect.objectContaining({ option: 'openai_gpt_5_4', source: 'default' }),
    );
    expect(body.has_active_fine_tuning).toBe(false);
    expect(body.glm_available).toBe(false);
  });

  it('GET reflects a stored GLM setting + fine-tuning flag', async () => {
    process.env.FEATHERLESS_MAIL_ENABLED = 'true';
    asSuperAdmin({
      company: { id: COMPANY_ID },
      fineTuned: true,
      appSettingRow: { value: { provider: 'featherless', model: 'zai-org/GLM-5.2' }, updated_at: 't', updated_by: 'u' },
    });
    const body = await (await GET(req() as any, params as any)).json();
    expect(body.effective).toEqual(
      expect.objectContaining({ option: 'featherless_glm_5_2', source: 'explicit' }),
    );
    expect(body.has_active_fine_tuning).toBe(true);
    expect(body.glm_available).toBe(true);
  });

  it('PATCH rejects an unknown option with 400', async () => {
    asSuperAdmin({ company: { id: COMPANY_ID } });
    const res = await PATCH(req({ option: 'gpt-4' }) as any, params as any);
    expect(res.status).toBe(400);
  });

  it('PATCH rejects GLM with 409 when Featherless is not enabled', async () => {
    asSuperAdmin({ company: { id: COMPANY_ID } });
    const res = await PATCH(req({ option: 'featherless_glm_5_2' }) as any, params as any);
    expect(res.status).toBe(409);
  });

  it('PATCH rejects Scaleway-GLM with 409 when Scaleway is not enabled', async () => {
    asSuperAdmin({ company: { id: COMPANY_ID } });
    const res = await PATCH(req({ option: 'scaleway_glm_5_2' }) as any, params as any);
    expect(res.status).toBe(409);
  });

  it('kill-switches are independent: Featherless on does NOT enable Scaleway', async () => {
    process.env.FEATHERLESS_MAIL_ENABLED = 'true';
    asSuperAdmin({ company: { id: COMPANY_ID } });
    const res = await PATCH(req({ option: 'scaleway_glm_5_2' }) as any, params as any);
    expect(res.status).toBe(409);
  });

  it('PATCH allows Scaleway-GLM when SCALEWAY_MAIL_ENABLED=true', async () => {
    process.env.SCALEWAY_MAIL_ENABLED = 'true';
    asSuperAdmin({
      company: { id: COMPANY_ID },
      appSettingRow: { value: { provider: 'scaleway', model: 'glm-5.2' }, updated_at: 't', updated_by: 'admin-1' },
    });
    const res = await PATCH(req({ option: 'scaleway_glm_5_2' }) as any, params as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.effective.option).toBe('scaleway_glm_5_2');
  });

  it('GET exposes a per-option availability map', async () => {
    process.env.SCALEWAY_MAIL_ENABLED = 'true';
    asSuperAdmin({ company: { id: COMPANY_ID }, appSettingRow: null });
    const body = await (await GET(req() as any, params as any)).json();
    expect(body.availability).toEqual(
      expect.objectContaining({
        scaleway_glm_5_2: true,
        featherless_glm_5_2: false,
        openai_gpt_5_4: true,
      }),
    );
  });

  it('PATCH stores OpenAI and returns the re-read effective setting', async () => {
    asSuperAdmin({
      company: { id: COMPANY_ID },
      appSettingRow: { value: { provider: 'openai', model: 'gpt-5.4-2026-03-05' }, updated_at: 't', updated_by: 'admin-1' },
    });
    const res = await PATCH(req({ option: 'openai_gpt_5_4' }) as any, params as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.effective.option).toBe('openai_gpt_5_4');
  });

  it('PATCH allows GLM when Featherless is enabled', async () => {
    process.env.FEATHERLESS_MAIL_ENABLED = 'true';
    asSuperAdmin({
      company: { id: COMPANY_ID },
      appSettingRow: { value: { provider: 'featherless', model: 'zai-org/GLM-5.2' }, updated_at: 't', updated_by: 'admin-1' },
    });
    const res = await PATCH(req({ option: 'featherless_glm_5_2' }) as any, params as any);
    expect(res.status).toBe(200);
  });
});

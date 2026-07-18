import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CompanyMailModelSetting from '../CompanyMailModelSetting';

jest.mock('@/lib/api-fetch', () => ({ apiFetch: jest.fn() }));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { apiFetch } = require('@/lib/api-fetch') as { apiFetch: jest.Mock };

const COMPANY_ID = '11111111-1111-1111-1111-111111111111';

function fakeResponse(payload: unknown, ok = true) {
  return { ok, json: async () => payload } as unknown as Response;
}

function getPayload(overrides: Record<string, unknown> = {}) {
  return {
    company_id: COMPANY_ID,
    effective: { option: 'openai_gpt_5_4', provider: 'openai', model: 'gpt-5.4-2026-03-05', source: 'default' },
    options: [],
    has_active_fine_tuning: false,
    availability: {
      openai_gpt_5_4: true,
      scaleway_glm_5_2: true,
      featherless_glm_5_2: true,
    },
    glm_available: true,
    updated_at: null,
    updated_by: null,
    ...overrides,
  };
}

beforeEach(() => {
  apiFetch.mockReset();
});

describe('CompanyMailModelSetting', () => {
  it('shows GPT-5.4 as active by default and disables save with no change', async () => {
    apiFetch.mockResolvedValueOnce(fakeResponse(getPayload()));
    render(<CompanyMailModelSetting companyId={COMPANY_ID} companyName="Acme" />);

    await waitFor(() => expect(screen.getByText(/Aktuell aktiv:/)).toBeInTheDocument());
    expect(screen.getByText(/Standard/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Änderung speichern/ })).toBeDisabled();
  });

  it('shows the fine-tuning hint only when a fine-tuned config exists', async () => {
    apiFetch.mockResolvedValueOnce(fakeResponse(getPayload({ has_active_fine_tuning: true })));
    render(<CompanyMailModelSetting companyId={COMPANY_ID} companyName="Acme" />);
    await waitFor(() => expect(screen.getByText(/Fine-Tuning-Modell aktiviert/)).toBeInTheDocument());
  });

  it('disables a GLM option when its provider is not globally available', async () => {
    apiFetch.mockResolvedValueOnce(
      fakeResponse(
        getPayload({
          availability: {
            openai_gpt_5_4: true,
            scaleway_glm_5_2: false,
            featherless_glm_5_2: true,
          },
        }),
      ),
    );
    render(<CompanyMailModelSetting companyId={COMPANY_ID} companyName="Acme" />);
    await waitFor(() => expect(screen.getByRole('radio', { name: /Scaleway/ })).toBeInTheDocument());
    expect(screen.getByRole('radio', { name: /Scaleway/ })).toBeDisabled();
    // Featherless bleibt in diesem Fall verfügbar (unabhängige Kill-Switches).
    expect(screen.getByRole('radio', { name: /Featherless/ })).toBeEnabled();
    expect(screen.getByText(/nicht freigeschaltet/)).toBeInTheDocument();
  });

  it('enables save on change and shows the confirm dialog with company + target, then PATCHes (Scaleway)', async () => {
    apiFetch.mockResolvedValueOnce(fakeResponse(getPayload()));
    render(<CompanyMailModelSetting companyId={COMPANY_ID} companyName="Acme" />);
    await waitFor(() => expect(screen.getByRole('radio', { name: /Scaleway/ })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('radio', { name: /Scaleway/ }));
    const saveBtn = screen.getByRole('button', { name: /Änderung speichern/ });
    expect(saveBtn).toBeEnabled();

    fireEvent.click(saveBtn);
    // Inline-Bestätigung mit Firmenname + Zielmodell (kein Popup).
    expect(screen.getByText(/„Acme"/)).toBeInTheDocument();
    expect(screen.getByText(/umstellen\?/)).toBeInTheDocument();

    apiFetch.mockResolvedValueOnce(
      fakeResponse(getPayload({ effective: { option: 'scaleway_glm_5_2', provider: 'scaleway', model: 'glm-5.2', source: 'explicit' } })),
    );
    fireEvent.click(screen.getByRole('button', { name: /^Umstellen$/ }));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenLastCalledWith(
        `/api/admin/companies/${COMPANY_ID}/mail-model`,
        expect.objectContaining({ method: 'PATCH' }),
      ),
    );
    // PATCH body enthaelt nur die Options-ID.
    const patchInit = apiFetch.mock.calls.at(-1)![1];
    expect(JSON.parse(patchInit.body)).toEqual({ option: 'scaleway_glm_5_2' });
  });

  it('shows an isolated error message when the GET fails (no crash)', async () => {
    apiFetch.mockResolvedValueOnce(fakeResponse({ error: 'Boom' }, false));
    render(<CompanyMailModelSetting companyId={COMPANY_ID} companyName="Acme" />);
    await waitFor(() => expect(screen.getByText('Boom')).toBeInTheDocument());
    // Karte bleibt bestehen (Titel sichtbar).
    expect(screen.getByText('Mailagent-Modell')).toBeInTheDocument();
  });
});

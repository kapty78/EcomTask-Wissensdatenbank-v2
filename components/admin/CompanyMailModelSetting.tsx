"use client"

import { useCallback, useEffect, useState } from 'react';
import { Mail, Loader2, Check } from 'lucide-react';
import { apiFetch } from '@/lib/api-fetch';
import {
  MAIL_MODEL_OPTIONS,
  MailModelOptionId,
  getMailModelOption,
} from '@/lib/mail-model';

interface MailModelResponse {
  company_id: string;
  effective: {
    option: MailModelOptionId;
    provider: string;
    model: string;
    source: 'explicit' | 'default';
  };
  has_active_fine_tuning: boolean;
  glm_available: boolean;
}

interface Props {
  companyId: string;
  companyName: string;
}

const FINE_TUNING_HINT =
  'Für mindestens eine Mail-Konfiguration ist ein Fine-Tuning-Modell aktiviert. ' +
  'Durch Speichern der firmenweiten Auswahl wird dieses Modell im Live-Mailpfad ' +
  'nicht mehr verwendet. Die Fine-Tuning-Konfiguration wird nicht gelöscht.';

export default function CompanyMailModelSetting({ companyId, companyName }: Props) {
  const [data, setData] = useState<MailModelResponse | null>(null);
  const [selected, setSelected] = useState<MailModelOptionId | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setIsConfirming(false);
    try {
      const res = await apiFetch(`/api/admin/companies/${companyId}/mail-model`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Einstellung konnte nicht geladen werden.');
      }
      const json: MailModelResponse = await res.json();
      setData(json);
      setSelected(json.effective.option);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unbekannter Fehler.');
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    load();
  }, [load]);

  const serverOption = data?.effective.option ?? null;
  const isDirty = Boolean(selected && serverOption && selected !== serverOption);
  const canSave = isDirty && !isLoading && !isSaving;

  const save = useCallback(async () => {
    if (!selected) return;
    setIsSaving(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/admin/companies/${companyId}/mail-model`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ option: selected }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Speichern fehlgeschlagen.');
      }
      const json: MailModelResponse = await res.json();
      setData(json);
      setSelected(json.effective.option);
      setIsConfirming(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Speichern fehlgeschlagen.');
      // Serverwert bleibt sichtbar: Auswahl auf den bekannten Serverstand zurück.
      if (serverOption) setSelected(serverOption);
      setIsConfirming(false);
    } finally {
      setIsSaving(false);
    }
  }, [companyId, selected, serverOption]);

  const targetOption = selected ? getMailModelOption(selected) : null;

  return (
    <section
      className="relative overflow-hidden rounded-2xl border border-white/[0.07] bg-[#1d1d1d] p-4"
      aria-labelledby="mail-model-heading"
    >
      {/* obere Lichtkante */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent"
      />
      <div className="flex items-start gap-3">
        <span className="flex size-9 flex-shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary ring-1 ring-primary/25">
          <Mail className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 id="mail-model-heading" className="text-sm font-semibold text-zinc-100">
            Mailagent-Modell
          </h3>
          <p className="text-xs text-zinc-400">
            Modell für alle produktiven Mailantworten dieses Unternehmens
          </p>
        </div>
        {isLoading && <Loader2 className="size-4 animate-spin text-zinc-500" />}
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-white/[0.06] bg-zinc-800/60 px-3 py-2 text-xs text-zinc-300">
          {error}
        </p>
      )}

      {data && !isLoading && (
        <>
          <fieldset
            className="mt-4 grid gap-2 sm:grid-cols-2"
            disabled={isSaving}
            aria-label="Mailagent-Modell wählen"
          >
            {MAIL_MODEL_OPTIONS.map((opt) => {
              const isSelected = selected === opt.id;
              const isGlm = opt.id === 'featherless_glm_5_2';
              const glmDisabled = isGlm && !data.glm_available;
              return (
                <label
                  key={opt.id}
                  className={[
                    'flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors',
                    isSelected
                      ? 'border-primary/60 bg-primary/10 ring-1 ring-primary/40'
                      : 'border-white/[0.07] bg-white/[0.02] hover:border-white/20',
                    glmDisabled ? 'cursor-not-allowed opacity-50' : '',
                  ].join(' ')}
                >
                  <input
                    type="radio"
                    name="mail-model"
                    className="sr-only"
                    value={opt.id}
                    checked={isSelected}
                    disabled={glmDisabled || isSaving}
                    onChange={() => {
                      setSelected(opt.id);
                      setIsConfirming(false);
                      setError(null);
                    }}
                  />
                  <span
                    aria-hidden
                    className={[
                      'mt-0.5 flex size-4 flex-shrink-0 items-center justify-center rounded-full border',
                      isSelected ? 'border-primary bg-primary text-white' : 'border-zinc-500',
                    ].join(' ')}
                  >
                    {isSelected && <Check className="size-3" strokeWidth={3} />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-zinc-100">
                      {opt.label} <span className="text-zinc-500">/ {opt.providerLabel}</span>
                    </span>
                    <span className="block truncate text-[11px] text-zinc-500">{opt.model}</span>
                    {glmDisabled && (
                      <span className="mt-1 block text-[11px] text-zinc-400">
                        Serverseitig nicht freigeschaltet
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </fieldset>

          {data.has_active_fine_tuning && (
            <p className="mt-3 rounded-lg border border-white/[0.06] bg-zinc-800/40 px-3 py-2 text-[11px] leading-relaxed text-zinc-400">
              {FINE_TUNING_HINT}
            </p>
          )}

          {!isConfirming ? (
            <div className="mt-4 flex items-center justify-between gap-3">
              <p className="text-xs text-zinc-400">
                Aktuell aktiv:{' '}
                <span className="font-medium text-zinc-200">
                  {getMailModelOption(data.effective.option).label}
                </span>
                {data.effective.source === 'default' && (
                  <span className="ml-1 text-zinc-500">(Standard)</span>
                )}
              </p>
              <button
                type="button"
                disabled={!canSave}
                onClick={() => setIsConfirming(true)}
                className={[
                  'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                  canSave
                    ? 'bg-primary text-white hover:bg-primary/90'
                    : 'cursor-not-allowed bg-white/[0.04] text-zinc-500',
                ].join(' ')}
              >
                Änderung speichern
              </button>
            </div>
          ) : (
            <div className="mt-4 rounded-xl border border-primary/30 bg-primary/[0.06] p-3">
              <p className="text-xs leading-relaxed text-zinc-300">
                Mailagent für <span className="font-medium text-zinc-100">„{companyName}"</span>{' '}
                auf <span className="font-medium text-zinc-100">{targetOption?.label}</span>{' '}
                umstellen? Neue Mail-Verarbeitungen verwenden danach{' '}
                {targetOption?.providerLabel} {targetOption?.label}. Bereits laufende
                Verarbeitungen werden nicht verändert. Wissensdatenbank, Tools und
                Mailkonten bleiben unverändert.
              </p>
              <div className="mt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() => setIsConfirming(false)}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium text-zinc-300 hover:text-zinc-100"
                >
                  Abbrechen
                </button>
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={save}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary/90 disabled:opacity-60"
                >
                  {isSaving && <Loader2 className="size-3 animate-spin" />}
                  Umstellen
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

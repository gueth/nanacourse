'use client';

import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { orThrow, useCached } from '@/lib/cache';
import { flagTransfersToVerify } from '@/lib/coverage';
import { formatEuros, monthLabel } from '@/lib/finance';
import { fetchEstimatedOperations, lastDayOf, resetEstimatedOperations, saveEstimatedOperations, type EstimatedOperation } from '@/lib/transactions';
import { FIN, FinButton, NumberField } from '@/components/finance/FinanceParts';

// Opérations d'un livret pour un mois sans son relevé : estimées d'après les virements vus sur les autres comptes,
// et modifiables (la version modifiée sert aussi au solde estimé du Bilan)
export function EstimatedOperations({
  account,
  period,
  accounts,
  onSaved
}: {
  account: string;
  period: string;
  accounts: string[];
  onSaved: () => unknown;
}) {
  const query = useCached(`finances:estimes:${account.toLowerCase()}|${period}`, async () => {
    const { error, ...result } = await fetchEstimatedOperations(account, period, accounts);
    return orThrow(result, error);
  });
  const [draft, setDraft] = useState<EstimatedOperation[] | null>(null); // null : pas en cours de modification
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const data = query.data;
  const shown = (data?.operations ?? []).filter((o) => o.amount !== 0 || o.label !== 'Aucune opération');
  const total = shown.reduce((s, o) => s + o.amount, 0);
  const inputClass = 'min-w-0 rounded-sm border bg-white px-2 py-1 text-[12px] outline-none';

  function describe(err: { message: string }) {
    return /estimated_operations/.test(err.message)
      ? "La table « estimated_operations » n'existe pas encore : lance le script supabase/estimated_operations.sql dans Supabase."
      : `Erreur : ${err.message}`;
  }

  async function run(action: () => Promise<{ message: string } | null>) {
    setBusy(true);
    setError(null);
    const err = await action();
    if (err) setError(describe(err));
    else {
      // Les virements du mois sont à revérifier sur le Bilan
      flagTransfersToVerify([period]);
      setDraft(null);
      await query.reload();
      await onSaved();
    }
    setBusy(false);
  }

  const edit = (i: number, change: Partial<EstimatedOperation>) => setDraft((d) => d && d.map((o, j) => (j === i ? { ...o, ...change } : o)));
  const ready = !!draft && draft.every((o) => o.label.trim() && o.date.startsWith(period) && o.amount !== 0);

  return (
    <div className="mb-3 rounded-sm border border-dashed px-3 py-2 text-[12px]" style={{ borderColor: FIN.gold, backgroundColor: FIN.paper, color: FIN.navy }}>
      <p className="text-[11px]" style={{ color: FIN.slate }}>
        Pas de relevé de {account} pour {monthLabel(period)} :{' '}
        {data?.edited ? 'opérations estimées, modifiées par toi.' : "opérations estimées d'après les virements vus sur tes autres comptes."} Modifie-les si
        besoin ; le relevé, une fois importé, fera foi.
      </p>
      {!data ? (
        <p className="mt-2 text-[11px]" style={{ color: FIN.slate }}>
          {query.error ? describe({ message: String(query.error) }) : 'Estimation…'}
        </p>
      ) : draft ? (
        <>
          {draft.map((o, i) => (
            <div key={i} className="mt-2 grid grid-cols-[1fr_auto] items-end gap-2 border-t pt-2" style={{ borderColor: FIN.line }}>
              <div className="flex min-w-0 flex-col gap-1">
                <input value={o.label} onChange={(e) => edit(i, { label: e.target.value })} placeholder="Libellé" className={inputClass} style={{ borderColor: FIN.line }} />
                <div className="grid grid-cols-[1fr_110px] gap-2">
                  <input
                    type="date"
                    value={o.date}
                    min={`${period}-01`}
                    max={lastDayOf(period)}
                    onChange={(e) => edit(i, { date: e.target.value })}
                    className={inputClass}
                    style={{ borderColor: FIN.line }}
                  />
                  <NumberField label="" value={o.amount} placeholder="+ / −" onChange={(n) => edit(i, { amount: n ?? 0 })} />
                </div>
              </div>
              <button type="button" onClick={() => setDraft((d) => d && d.filter((_, j) => j !== i))} aria-label={`Retirer ${o.label}`} style={{ color: FIN.rose }}>
                <X size={14} />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setDraft((d) => [...(d ?? []), { account, month: period, date: lastDayOf(period), label: '', amount: 0 }])}
            className="mt-2 flex items-center gap-1 text-[10px] uppercase tracking-[0.2em]"
            style={{ color: FIN.accent }}
          >
            <Plus size={13} /> Ajouter une opération estimée
          </button>
          <p className="mt-1 text-[10px]" style={{ color: FIN.slate }}>
            Montant positif : argent qui arrive sur le livret ; négatif : argent qui en sort.
          </p>
          <div className="mt-2 flex gap-2">
            <FinButton onClick={() => run(() => saveEstimatedOperations(account, period, draft))} disabled={!ready || busy}>
              {busy ? 'Enregistrement…' : 'Enregistrer'}
            </FinButton>
            <FinButton outline onClick={() => setDraft(null)}>
              Annuler
            </FinButton>
          </div>
        </>
      ) : (
        <>
          {shown.length === 0 ? (
            <p className="mt-2 text-[11px]" style={{ color: FIN.slate }}>
              Aucun virement vers ou depuis {account} vu ce mois-ci.
            </p>
          ) : (
            <ul className="mt-1 divide-y" style={{ borderColor: FIN.line }}>
              {shown.map((o, i) => (
                <li key={o.id ?? i} className="flex items-start justify-between gap-2 py-1.5">
                  <span className="min-w-0">
                    <span className="block break-words">{o.label}</span>
                    <span className="text-[10px]" style={{ color: FIN.slate }}>
                      {new Date(o.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} · estimée
                    </span>
                  </span>
                  <b className="shrink-0" style={{ color: o.amount > 0 ? FIN.sage : FIN.navy }}>
                    {formatEuros(o.amount)}
                  </b>
                </li>
              ))}
            </ul>
          )}
          {shown.length > 1 && (
            <p className="mt-1 text-right text-[11px]" style={{ color: FIN.slate }}>
              Total estimé : <b style={{ color: FIN.navy }}>{formatEuros(total)}</b>
            </p>
          )}
          {data.unclear > 0 && (
            <p className="mt-1 text-[10px]" style={{ color: FIN.slate }}>
              {data.unclear} virement{data.unclear > 1 ? 's' : ''} de ce mois {data.unclear > 1 ? 'ont' : 'a'} un autre compte à préciser sur le Bilan : il
              {data.unclear > 1 ? 's pourraient' : ' pourrait'} concerner {account}.
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-3 text-[10px] uppercase tracking-[0.2em]">
            <button type="button" onClick={() => setDraft(shown.map((o) => ({ ...o })))} style={{ color: FIN.accent }}>
              Modifier
            </button>
            {data.edited && (
              <button type="button" disabled={busy} onClick={() => run(() => resetEstimatedOperations(account, period))} style={{ color: FIN.gold }}>
                Revenir à l&apos;estimation automatique
              </button>
            )}
          </div>
        </>
      )}
      {error && (
        <p className="mt-2 text-[11px]" style={{ color: FIN.rose }}>
          {error}
        </p>
      )}
    </div>
  );
}

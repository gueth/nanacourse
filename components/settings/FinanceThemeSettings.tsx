'use client';

import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { useIncomePlan } from '@/lib/coursesQueries';
import { useCategories } from '@/lib/financeQueries';
import { CATEGORIES, categoryGroups, groupKindOf } from '@/lib/transactions';
import { HEALTH_TONES, type HealthState } from '@/lib/health';
import {
  CHECK_ORDER,
  CONDITION_KINDS,
  DEFAULT_RULES,
  HEALTH_STATES,
  measureOf,
  RULE_OPS,
  saveHealthSettings,
  useHealthSettings,
  type ColorRule,
  type ConditionKind,
  type HealthCondition,
  type HealthSettings,
  type RuleOp,
  type RuledState
} from '@/lib/healthSettings';
import { DEFAULT_PLAN } from '@/lib/budget';

// Onglet « Finances » des paramètres : les couleurs que prennent les pages Finances selon la situation du mois.
// Pour chaque couleur : sa règle, une liste de conditions toutes de la même forme (type, ce qu'on mesure, comparaison,
// valeur), et la répartition du revenu propre à cette situation. Les couleurs sont vérifiées dans l'ordre affiché :
// la première dont la règle est vraie donne sa couleur au mois, le gris sinon (lib/health, assessHealth).
// Enregistré dans Supabase (table finance_health, lib/healthSettings).

const ordinal = (n: number) => (n === 1 ? '1re' : `${n}e`);

// Comparaisons, avec leur sens en toutes lettres
const OP_LABELS: Record<RuleOp, string> = {
  '==': '== égal à',
  '!=': '!= différent de',
  '<': '< moins de',
  '<=': '<= au plus',
  '>': '> plus de',
  '>=': '>= au moins'
};

// Nouvelle condition : le résultat du mois sous 0 €
const NEW_CONDITION: HealthCondition = { kind: 'resultat', measure: 'resultat', op: '<', value: 0 };

// Petit intitulé au-dessus d'un champ
function Field({ label, className = '', children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={`block min-w-0 ${className}`}>
      <span className="mb-0.5 block text-[11px] font-medium text-[#65558f]">{label}</span>
      {children}
    </label>
  );
}

// Une condition : type, puis ce qu'on mesure (pour une catégorie : le sens, puis la catégorie), puis la comparaison et la valeur
function ConditionRow({ condition: c, onChange, onRemove }: { condition: HealthCondition; onChange: (c: HealthCondition) => void; onRemove: () => void }) {
  const kind = CONDITION_KINDS.find((k) => k.id === c.kind) ?? CONDITION_KINDS[0];
  const unit = measureOf(c)?.unit ?? '€';
  const flow = c.flow ?? 'expense';
  // Catégories du sens choisi : grandes catégories, puis catégories, par ordre alphabétique
  const groups = categoryGroups()
    .filter((g) => g.kind === flow)
    .sort((a, b) => a.label.localeCompare(b.label, 'fr'));
  const categories = CATEGORIES.filter((x) => groupKindOf(x) === flow).sort((a, b) => a.label.localeCompare(b.label, 'fr'));
  const selectClass = 'input-hand w-full py-1.5 text-[14px]';

  function setKind(next: ConditionKind) {
    const first = CONDITION_KINDS.find((k) => k.id === next)!.measures[0];
    onChange({ kind: next, measure: first.id, op: c.op, value: c.value, ...(next === 'categorie' ? { flow: 'expense' as const, target: '' } : {}) });
  }

  return (
    <div className="space-y-2 rounded-[16px] bg-[#f3edf7] p-3">
      <div className="flex items-end gap-2">
        <Field label="Type de règle" className="flex-1">
          <select value={c.kind} onChange={(e) => setKind(e.target.value as ConditionKind)} className={selectClass}>
            {CONDITION_KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
        </Field>
        <button type="button" onClick={onRemove} aria-label="Retirer cette condition" className="mb-1 shrink-0 rounded-full p-1.5 opacity-60 hover:bg-black/5 hover:opacity-100">
          <X size={16} />
        </button>
      </div>

      {c.kind === 'categorie' ? (
        <div className="grid grid-cols-[2fr_3fr] gap-2">
          <Field label="Entrée ou sortie">
            <select value={flow} onChange={(e) => onChange({ ...c, flow: e.target.value as 'income' | 'expense', target: '' })} className={selectClass}>
              <option value="expense">Sortie</option>
              <option value="income">Entrée</option>
            </select>
          </Field>
          <Field label="Catégorie">
            <select value={c.target ?? ''} onChange={(e) => onChange({ ...c, target: e.target.value })} className={selectClass}>
              <option value="" disabled>
                Choisir…
              </option>
              {groups.length > 0 && (
                <optgroup label="Grandes catégories">
                  {groups.map((g) => (
                    <option key={g.id} value={`groupe:${g.id}`}>
                      {g.label}
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label="Catégories">
                {categories.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.label}
                  </option>
                ))}
              </optgroup>
            </select>
          </Field>
        </div>
      ) : (
        <Field label="Mesure">
          <select value={c.measure} onChange={(e) => onChange({ ...c, measure: e.target.value })} className={selectClass}>
            {kind.measures.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} ({m.unit})
              </option>
            ))}
          </select>
        </Field>
      )}

      <div className="grid grid-cols-[3fr_2fr] gap-2">
        <Field label="Comparaison">
          <select value={c.op} onChange={(e) => onChange({ ...c, op: e.target.value as RuleOp })} className={`${selectClass} font-mono`}>
            {RULE_OPS.map((op) => (
              <option key={op} value={op}>
                {OP_LABELS[op]}
              </option>
            ))}
          </select>
        </Field>
        <Field label={`Valeur (${unit})`}>
          <input
            type="number"
            inputMode="decimal"
            step={unit === '€' ? 10 : 0.5}
            value={Number.isFinite(c.value) ? c.value : ''}
            onChange={(e) => onChange({ ...c, value: e.target.value === '' ? 0 : Number(e.target.value) })}
            className="input-hand w-full py-1.5 text-right text-[14px] tabular-nums"
          />
        </Field>
      </div>
    </div>
  );
}

export default function FinanceThemeSettings() {
  const settingsQuery = useHealthSettings();
  const parts = (useIncomePlan().data ?? DEFAULT_PLAN).parts;
  // Catégories chargées (listes des conditions de type « Catégorie »)
  useCategories();
  // Brouillon : les modifications ne comptent qu'une fois enregistrées
  const [draft, setDraft] = useState<HealthSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  if (settingsQuery.error) return <p className="text-sm text-[#b3261e]">Les réglages des couleurs n&apos;ont pas pu être chargés.</p>;
  if (!settingsQuery.data) return <p className="text-sm opacity-70">Chargement…</p>;
  const saved = settingsQuery.data;
  const current: HealthSettings = draft ?? { rules: saved.rules, repartitions: saved.repartitions };
  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify({ rules: saved.rules, repartitions: saved.repartitions });

  const edit = (next: HealthSettings) => {
    setMessage(null);
    setDraft(next);
  };
  const setColorRule = (state: RuledState, rule: ColorRule) => edit({ ...current, rules: { ...current.rules, [state]: rule } });
  const setRepartition = (state: HealthState, value: Record<string, number> | null) => {
    const repartitions = { ...current.repartitions };
    if (value) repartitions[state] = value;
    else delete repartitions[state];
    edit({ ...current, repartitions });
  };

  async function save() {
    setBusy(true);
    const err = await saveHealthSettings(current);
    setBusy(false);
    if (err) {
      const missing = /finance_health/.test(err.message) || /relation|schema cache/i.test(err.message);
      return setMessage({
        ok: false,
        text: missing ? 'Lance d’abord le script supabase/finance_health.sql dans l’éditeur SQL de Supabase.' : `Non enregistré : ${err.message}`
      });
    }
    settingsQuery.reload();
    setDraft(null);
    setMessage({ ok: true, text: 'Enregistré : les pages Finances suivent ces règles et ces répartitions.' });
  }

  // Règle d'une couleur : « si l'une / toutes les conditions », la liste, puis l'ajout
  const ruleEditor = (state: RuledState, colorName: string) => {
    const rule = current.rules[state];
    const update = (i: number, c: HealthCondition) => setColorRule(state, { ...rule, conditions: rule.conditions.map((x, j) => (j === i ? c : x)) });
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px]">
          <span>Le mois est {colorName.toLowerCase()} si</span>
          <select
            value={rule.match}
            onChange={(e) => setColorRule(state, { ...rule, match: e.target.value as ColorRule['match'] })}
            aria-label="Une ou toutes les conditions"
            className="input-hand w-auto py-1 text-[14px]"
          >
            <option value="any">l&apos;une des conditions</option>
            <option value="all">toutes les conditions</option>
          </select>
          <span>est vraie :</span>
        </div>
        {rule.conditions.length === 0 && (
          <p className="rounded-[16px] bg-[#f3edf7] px-3 py-2.5 text-[13px] opacity-70">Aucune condition : cette couleur ne s&apos;applique pas.</p>
        )}
        {rule.conditions.map((c, i) => (
          <ConditionRow
            key={i}
            condition={c}
            onChange={(next) => update(i, next)}
            onRemove={() => setColorRule(state, { ...rule, conditions: rule.conditions.filter((_, j) => j !== i) })}
          />
        ))}
        <button
          type="button"
          onClick={() => setColorRule(state, { ...rule, conditions: [...rule.conditions, NEW_CONDITION] })}
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#65558f]"
        >
          <Plus size={15} /> Ajouter une condition
        </button>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="rounded-[24px] bg-white/70 p-5">
        <h3 className="text-[18px] font-medium leading-tight">Comment un mois prend sa couleur</h3>
        <p className="mt-1 text-[13px] leading-relaxed opacity-75">
          Chaque mois, les pages Finances prennent la couleur de ta situation. Les couleurs sont vérifiées dans l&apos;ordre ci-dessous : la première dont la règle
          est vraie donne sa couleur au mois, le gris si le mois n&apos;en respecte aucune. Chaque règle est une liste de conditions : choisis le type (catégorie, compte de résultat, bilan,
          épargne, patrimoine), ce que tu mesures, la comparaison et la valeur. Pour chaque couleur, tu peux aussi fixer la répartition de tes revenus à viser :
          le Budget compare alors le mois à celle-ci.
        </p>
        {saved.missing && (
          <p className="mt-3 rounded-[12px] bg-[#fdf3d8] px-3 py-2 text-[13px] text-[#5c4300]">
            Pour enregistrer ces réglages, lance une fois le script <b>supabase/finance_health.sql</b> dans l&apos;éditeur SQL de Supabase. En attendant, les
            règles par défaut s&apos;appliquent.
          </p>
        )}
      </div>

      {CHECK_ORDER.map((state, i) => {
        const info = HEALTH_STATES.find((h) => h.id === state)!;
        const tone = HEALTH_TONES[state];
        const own = current.repartitions[state];
        const total = own ? parts.reduce((s, p) => s + Number(own[p.id] ?? 0), 0) : 100;
        return (
          <section key={state} className="overflow-hidden rounded-[24px] bg-white/70">
            {/* Bandeau à la couleur de la situation */}
            <div className="flex items-center gap-3 px-5 py-3" style={{ backgroundColor: tone.pale }}>
              <span className="size-9 shrink-0 rounded-full border-4" style={{ backgroundColor: tone.dark, borderColor: '#fff' }} aria-hidden />
              <div className="min-w-0 flex-1">
                <h3 className="text-[17px] font-medium leading-tight" style={{ color: tone.dark }}>
                  {info.color} · {info.name}
                </h3>
                <p className="text-[12px] opacity-70">{state === 'neutre' ? 'Si aucune autre couleur ne s’applique' : `Vérifiée en ${ordinal(i + 1)}`}</p>
              </div>
            </div>

            <div className="space-y-4 p-5">
              <div>
                <p className="field-label">Règle</p>
                {state === 'neutre' ? (
                  <p className="text-[14px]">Le mois ne respecte aucune des règles des autres couleurs : il est gris.</p>
                ) : (
                  ruleEditor(state, info.color)
                )}
              </div>

              <div>
                <p className="field-label">Répartition des revenus dans cette situation</p>
                <label className="flex items-center gap-2 text-[14px]">
                  <input
                    type="checkbox"
                    checked={!!own}
                    onChange={(e) => setRepartition(state, e.target.checked ? Object.fromEntries(parts.map((p) => [p.id, p.pct])) : null)}
                    className="size-4 accent-[#65558f]"
                  />
                  Une répartition propre à cette couleur
                </label>
                {own ? (
                  <>
                    <ul className="mt-2 space-y-1.5">
                      {parts.map((p) => (
                        <li key={p.id} className="flex items-center justify-between gap-3 text-[14px]">
                          <span className="min-w-0">
                            {p.label}
                            {p.savings && <span className="block text-[11px] opacity-60">ce qui reste des revenus</span>}
                          </span>
                          <span className="inline-flex items-baseline gap-1">
                            <input
                              type="number"
                              inputMode="decimal"
                              value={Number(own[p.id] ?? 0)}
                              onChange={(e) => setRepartition(state, { ...own, [p.id]: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })}
                              aria-label={`${p.label} : pourcentage`}
                              className="input-hand w-[5.5rem] py-1 text-right tabular-nums"
                            />
                            %
                          </span>
                        </li>
                      ))}
                    </ul>
                    <p className={`mt-2 text-[12px] ${total === 100 ? 'opacity-60' : 'font-medium text-[#b3261e]'}`}>
                      Total : {total} %{total !== 100 && ' — le total devrait faire 100 %'}
                    </p>
                  </>
                ) : (
                  <p className="mt-1 text-[12px] opacity-60">
                    Suit la répartition par défaut (Finances › Gestion) : {parts.map((p) => `${p.label} ${p.pct} %`).join(', ')}.
                  </p>
                )}
              </div>
            </div>
          </section>
        );
      })}

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={save} disabled={busy || !dirty} className="btn-hand disabled:opacity-40">
          {busy ? 'Enregistrement…' : 'Enregistrer'}
        </button>
        {dirty && (
          <button
            type="button"
            onClick={() => {
              setDraft(null);
              setMessage(null);
            }}
            className="btn-hand bg-line"
          >
            Annuler
          </button>
        )}
        <button type="button" onClick={() => edit({ ...current, rules: DEFAULT_RULES })} className="btn-ghost">
          Règles par défaut
        </button>
      </div>
      {message && <p className={`text-[13px] ${message.ok ? 'text-[#1d6b3a]' : 'text-[#b3261e]'}`}>{message.text}</p>}
    </div>
  );
}

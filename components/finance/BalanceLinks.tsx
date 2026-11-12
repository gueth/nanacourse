'use client';

import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { ErrorNote, FIN, FinButton, FinModal, Panel, useFinConfirm } from '@/components/finance/FinanceParts';
import { orThrow, useCached } from '@/lib/cache';
import { formatEuros } from '@/lib/finance';
import { describeDbError } from '@/lib/financePlans';
import {
  fetchBalanceLinks,
  groupTarget,
  natureOf,
  plainTarget,
  withNature,
  type LinkNature,
  LINKABLE_SECTIONS,
  refreshBalanceLinks,
  removeBalanceLink,
  saveBalanceLink,
  sideOf,
  type BalanceLink
} from '@/lib/balanceLinks';
import {
  annualLimitOf,
  annualPlans,
  byLabel,
  CATEGORIES,
  categoryById,
  categoryGroups,
  groupKindOf,
  linkPlannedToCategory,
  SELF_DEBT_ID,
  type GroupKind,
  type PlannedExpense
} from '@/lib/transactions';
import { useCategoryLimits } from '@/lib/financeQueries';

// Panneau « Créer des connecteurs » de la page Gestion. « Créer une connexion » (ConnectForm) : à l'actif, au passif ou
// aux dépenses annuelles, une catégorie se connecte à une ligne du bilan (ou à une dépense annuelle) avec une nature :
// = (la ligne vaut son montant du mois), + (elle augmente), − (elle diminue). Le crayon d'une liaison existante ouvre
// le formulaire complet (LinkForm : toutes ses catégories, montant et mois de départ ; « Proches » règle d'un coup la
// créance et la dette envers des proches). Le bilan reste non modifiable : c'est ici qu'on
// décide d'où viennent ces montants (calcul dans lib/balanceLinks).


const inputClass = 'w-full min-w-0 rounded-sm border bg-white px-3 py-2 text-[14px] outline-none focus:border-current';
const sectionTitle = (id: string) => LINKABLE_SECTIONS.find((s) => s.id === id)?.title ?? id;

function targetLabel(target: string) {
  if (!target.startsWith('groupe:')) return categoryById(target).label;
  return categoryGroups().find((g) => groupTarget(g.id) === target)?.label ?? 'Grande catégorie supprimée';
}

// Bouton d'un choix parmi plusieurs (À, nature de la liaison)
function Choice({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className="rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.18em]"
      style={on ? { backgroundColor: FIN.accent, borderColor: FIN.accent, color: FIN.paper } : { borderColor: FIN.line, color: FIN.slate }}
    >
      {children}
    </button>
  );
}

type Dest = 'actif' | 'passif' | 'annuel';
// Nature de la liaison ENTRE LES DEUX LIGNES du bilan (la ligne choisie, elle, vaut toujours le montant de la catégorie) :
// = la ligne d'équilibrage vaut la même chose ; + elle vaut son ancienne valeur plus la ligne choisie, mois après mois ;
// − son ancienne valeur moins la ligne choisie (un remboursement)
const NATURES: { id: LinkNature; sign: string; text: (line: string, other: string) => string }[] = [
  { id: '=', sign: '==', text: (line, other) => `${other} est égale à ${line}, chaque mois.` },
  { id: '+', sign: '+=', text: (line, other) => `${other} est égale à son ancienne valeur plus ${line}, mois après mois.` },
  { id: '-', sign: '−=', text: (line, other) => `${other} est égale à son ancienne valeur moins ${line}, mois après mois (un remboursement).` }
];

// Type de liaison entre la ligne du connecteur et la catégorie : += (la ligne augmente du montant de la catégorie, mois
// après mois), −= (elle en diminue), == (elle vaut le montant de la catégorie du mois, gardé tant qu'un autre mois ne le change pas)
const LINE_NATURES: { id: LinkNature; sign: string; text: (line: string, category: string) => string }[] = [
  { id: '+', sign: '+=', text: (line, category) => `${line} augmente du montant de ${category}, mois après mois.` },
  { id: '-', sign: '−=', text: (line, category) => `${line} diminue du montant de ${category}, mois après mois.` },
  { id: '=', sign: '==', text: (line, category) => `${line} est égale au montant de ${category} du mois.` }
];

// Valeur de la liste des lignes pour « Autre ligne… » ('' : aucune ligne choisie)
const CUSTOM_LINE = '__autre__';

// Sens d'une catégorie ou grande catégorie choisie : entrée ou sortie
const kindOfTarget = (target: string): GroupKind | null => {
  if (!target) return null;
  if (target.startsWith('groupe:')) return categoryGroups().find((g) => groupTarget(g.id) === target)?.kind ?? null;
  return groupKindOf(categoryById(target));
};

// CRÉER UNE CONNEXION, en trois temps :
//  1. le type de connecteur (actif, passif ou dépenses annuelles) et, à côté, la ligne du bilan ou la dépense annuelle ;
//  2. la catégorie : une première liste pour le sens (entrée ou sortie), puis à côté les catégories de ce sens
//     (la ligne choisie vaut son montant) ;
//  3. l'équilibrage du bilan : la ligne choisie, la nature (=, + ou −), puis la ligne de l'autre côté du bilan
//     (passif pour l'actif, actif pour le passif) qui vaut, chaque mois, la ligne choisie (=), son ancienne valeur plus
//     la ligne choisie (+), ou son ancienne valeur moins la ligne choisie (−).
// Une dépense annuelle se relie par « = » : la limite de la catégorie (une sortie) vaut ses dépenses annuelles ÷ 12.
// "initial" : connexion existante à modifier (même formulaire, déjà rempli) ; à l'enregistrement, la catégorie est d'abord
// retirée de ses anciennes lignes, puis reliée comme indiqué.
type Connection = { category: string; line: BalanceLink; counter?: { link: BalanceLink; nature: LinkNature } };
const lineValue = (l: BalanceLink) => `${l.section}|${l.label}`;
function ConnectForm({ links, initial, onSaved, onCancel }: { links: BalanceLink[]; initial?: Connection; onSaved: (message: string) => void; onCancel: () => void }) {
  const limitsQuery = useCategoryLimits();
  const initialSide: 'actif' | 'passif' = initial && sideOf(initial.line.section) === 'passif' ? 'passif' : 'actif';
  const [dest, setDest] = useState<Dest>(initialSide);
  const [category, setCategory] = useState(initial?.category ?? '');
  // « rubrique|ligne », CUSTOM_LINE pour une autre ligne, '' tant qu'aucune n'est choisie
  const [line, setLine] = useState(() => (initial ? lineValue(initial.line) : ''));
  // Type de liaison entre cette ligne et la catégorie
  const [lineNature, setLineNature] = useState<LinkNature>(() => (initial ? (natureOf(initial.line, initial.category) ?? '=') : '='));
  const [customSection, setCustomSection] = useState('');
  const [customLabel, setCustomLabel] = useState('');
  const [plan, setPlan] = useState('');
  const [nature, setNature] = useState<LinkNature>(initial?.counter?.nature ?? '=');
  // Sens de la catégorie (première liste) : entrée par défaut pour l'actif, sortie pour le passif et les dépenses annuelles
  const [flow, setFlow] = useState<GroupKind>(() => (initial ? (kindOfTarget(initial.category) ?? 'income') : 'income'));
  // Ligne du côté opposé du bilan, qui équilibre la ligne choisie (« rubrique|ligne », '' pour une autre ligne)
  const [counter, setCounter] = useState(() => (initial?.counter ? lineValue(initial.counter.link) : ''));
  const [counterSection, setCounterSection] = useState('');
  const [counterLabel, setCounterLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const side = dest === 'annuel' ? null : dest;
  // Listes des catégories d'un sens : grandes catégories (sauf pour les dépenses annuelles), puis catégories
  const groupsOf = (kind: GroupKind) =>
    side
      ? categoryGroups()
          .filter((g) => !g.virtual && g.kind === kind)
          .sort((a, b) => a.label.localeCompare(b.label, 'fr'))
      : [];
  const categoriesOf = (kind: GroupKind) => CATEGORIES.filter((c) => groupKindOf(c) === kind && !c.annual && c.id !== SELF_DEBT_ID).sort(byLabel);
  // Lignes d'un côté du bilan : celles du modèle, et celles déjà reliées
  const optionsOf = (of: 'actif' | 'passif') => {
    const secs = LINKABLE_SECTIONS.filter((s) => s.side === of);
    return {
      sections: secs,
      options: [
        ...secs.flatMap((s) => s.template.map((label) => ({ section: s.id, label, title: s.title }))),
        ...links
          .filter((l) => sideOf(l.section) === of && !secs.some((s) => s.id === l.section && s.template.some((t) => t.toLowerCase() === l.label.trim().toLowerCase())))
          .map((l) => ({ section: l.section, label: l.label, title: sectionTitle(l.section) }))
      ]
    };
  };
  const { sections, options: lineOptions } = side ? optionsOf(side) : { sections: [], options: [] };
  // Côté opposé : celui de la ligne qui équilibre le bilan
  const opposite = side === 'actif' ? 'passif' : 'actif';
  const { sections: counterSections, options: counterOptions } = side ? optionsOf(opposite) : { sections: [], options: [] };
  const parse = (value: string, sec: string, label: string, secs: typeof sections) =>
    value === CUSTOM_LINE
      ? { section: sec || secs[0]?.id || '', label: label.trim() }
      : value
        ? { section: value.split('|')[0], label: value.split('|').slice(1).join('|') }
        : { section: '', label: '' };
  const chosen = parse(line, customSection, customLabel, sections);
  const other = parse(counter, counterSection, counterLabel, counterSections);
  const plans = annualPlans();
  const ready = !!category && (dest === 'annuel' ? !!plan : !!chosen.label && !!chosen.section && !!other.label && !!other.section);

  function pickDest(next: Dest) {
    setDest(next);
    // Sens proposé : entrée pour l'actif, sortie sinon (les dépenses annuelles n'ont que des sorties)
    const nextFlow: GroupKind = next === 'actif' ? 'income' : 'expense';
    setFlow(nextFlow);
    if (kindOfTarget(category) !== nextFlow || (next === 'annuel' && category.startsWith('groupe:'))) setCategory('');
    setLine('');
    setCustomLabel('');
    setCustomSection('');
    setNature('=');
    setLineNature('=');
    setCounter('');
    setCounterLabel('');
    setCounterSection('');
  }

  // Ligne d'équilibrage déjà reliée à cette catégorie : sa nature actuelle est proposée
  function suggestNature(counterValue: string, cat: string) {
    const [section, ...rest] = counterValue.split('|');
    const existing = counterValue ? links.find((l) => l.section === section && l.label.trim().toLowerCase() === rest.join('|').toLowerCase()) : undefined;
    const current = existing && cat ? natureOf(existing, cat) : null;
    if (current) setNature(current);
  }

  function suggestLineNature(lineValueChosen: string, cat: string) {
    const [section, ...rest] = lineValueChosen.split('|');
    const existing = lineValueChosen && lineValueChosen !== CUSTOM_LINE ? links.find((l) => l.section === section && l.label.trim().toLowerCase() === rest.join('|').toLowerCase()) : undefined;
    const current = existing && cat ? natureOf(existing, cat) : null;
    if (current) setLineNature(current);
  }

  function pickLine(next: string) {
    setLine(next);
    suggestLineNature(next, category);
  }

  function pickCategory(next: string) {
    setCategory(next);
    suggestLineNature(line, next);
    suggestNature(counter, next);
  }

  function pickCounter(next: string) {
    setCounter(next);
    suggestNature(next, category);
  }

  async function save() {
    setBusy(true);
    setError(null);
    if (dest === 'annuel') {
      const err = await linkPlannedToCategory(plan, category);
      setBusy(false);
      if (err)
        return setError(
          /category|column/i.test(err.message) ? 'Lance le script supabase/annual_links.sql dans l’éditeur SQL de Supabase pour relier les dépenses annuelles.' : describeDbError(err.message)
        );
      limitsQuery.reload();
      const p = plans.find((x) => x.id === plan);
      return onSaved(`${categoryById(category).label} = « ${p?.label ?? 'dépense annuelle'} » : limite de ${formatEuros(annualLimitOf(category) ?? 0)} par mois.`);
    }
    // La ligne choisie vaut le montant de la catégorie (=) ; la ligne d'équilibrage, de l'autre côté du bilan, suit la nature choisie
    // Rôle de la ligne pour cette catégorie : ligne du connecteur (asCounter false) ou ligne d'équilibrage (true)
    const roles = (existing: BalanceLink | undefined, asCounter: boolean) => {
      const kept = (existing?.counters ?? []).filter((c) => c !== category);
      return asCounter ? [...kept, category] : kept;
    };
    const connect = (target: { section: string; label: string }, how: LinkNature, asCounter: boolean) => {
      const existing = links.find((l) => l.section === target.section && l.label.trim().toLowerCase() === target.label.toLowerCase());
      return saveBalanceLink({
        id: existing?.id,
        section: target.section,
        label: existing?.label ?? target.label,
        ...withNature(existing ?? { targets: [], decreases: [] }, category, how),
        counters: roles(existing, asCounter),
        opening: existing?.opening ?? 0,
        opening_month: existing?.opening_month ?? null
      });
    };
    // Modification : la catégorie quitte d'abord ses anciennes lignes qui ne sont plus choisies (une ligne vide est retirée)
    const same = (l: BalanceLink, t: { section: string; label: string }) => l.section === t.section && l.label.trim().toLowerCase() === t.label.toLowerCase();
    const previous = initial ? [initial.line, ...(initial.counter ? [initial.counter.link] : [])] : [];
    let err: { message: string } | null = null;
    for (const l of previous.filter((p) => !same(p, chosen) && !same(p, other))) {
      const targets = l.targets.filter((t) => plainTarget(t) !== initial!.category);
      const decreases = l.decreases.filter((t) => t !== initial!.category);
      const counters = l.counters.filter((t) => t !== initial!.category);
      err = targets.length + decreases.length === 0 && !l.opening ? await removeBalanceLink(l.id) : await saveBalanceLink({ ...l, targets, decreases, counters });
      if (err) break;
    }
    // Catégorie changée : elle est aussi retirée des lignes gardées (la nouvelle y est ajoutée juste après)
    const strip = (l: BalanceLink | undefined) =>
      l && initial && initial.category !== category
        ? {
            ...l,
            targets: l.targets.filter((t) => plainTarget(t) !== initial.category),
            decreases: l.decreases.filter((t) => t !== initial.category),
            counters: l.counters.filter((t) => t !== initial.category)
          }
        : l;
    const connectKept = (target: { section: string; label: string }, how: LinkNature, asCounter: boolean) => {
      const existing = strip(links.find((l) => same(l, target)));
      return saveBalanceLink({
        id: existing?.id,
        section: target.section,
        label: existing?.label ?? target.label,
        ...withNature(existing ?? { targets: [], decreases: [] }, category, how),
        counters: roles(existing, asCounter),
        opening: existing?.opening ?? 0,
        opening_month: existing?.opening_month ?? null
      });
    };
    const link = initial ? connectKept : connect;
    err = err ?? (await link(chosen, lineNature, false)) ?? (await link(other, nature, true)) ?? (await refreshBalanceLinks());
    setBusy(false);
    if (err) return setError(describeDbError(err.message));
    const sign = NATURES.find((n) => n.id === nature)!.sign;
    const lineSign = LINE_NATURES.find((n) => n.id === lineNature)!.sign;
    onSaved(`« ${chosen.label} » ${lineSign} ${targetLabel(category)}, « ${other.label} » ${sign} « ${chosen.label} » : le bilan est à jour et équilibré.`);
  }

  // Liste déroulante des catégories du sens choisi dans la première liste
  const categorySelect = (kind: GroupKind) => {
    const groups = groupsOf(kind);
    return (
      <select
        value={kindOfTarget(category) === kind ? category : ''}
        onChange={(e) => pickCategory(e.target.value)}
        aria-label={kind === 'income' ? "Catégorie d'entrée" : 'Catégorie de sortie'}
        className="fin-select w-full py-2 pl-2 text-[12px]"
      >
        <option value="">Choisir…</option>
        {groups.length > 0 && (
          <optgroup label="Grandes catégories">
            {groups.map((g) => (
              <option key={g.id} value={groupTarget(g.id)}>
                {g.label}
              </option>
            ))}
          </optgroup>
        )}
        <optgroup label="Catégories">
          {categoriesOf(kind).map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </optgroup>
      </select>
    );
  };

  // Liste des lignes d'un côté du bilan, rangées par rubrique, avec « Autre ligne… »
  const lineSelect = (value: string, onChange: (v: string) => void, secs: typeof sections, options: typeof lineOptions, prefix: string, label: string) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} className="fin-select w-full py-2 pl-2 text-[12px]">
      <option value="" disabled>
        {label}
      </option>
      {secs.map((s) => (
        <optgroup key={s.id} label={`${prefix}${s.title}`}>
          {options
            .filter((o) => o.section === s.id)
            .map((o) => (
              <option key={`${o.section}|${o.label}`} value={`${o.section}|${o.label}`}>
                {o.label}
              </option>
            ))}
        </optgroup>
      ))}
      <option value={CUSTOM_LINE}>Autre ligne…</option>
    </select>
  );

  // Autre ligne : sa rubrique et son nom
  const customLine = (secs: typeof sections, section: string, setSection: (v: string) => void, label: string, setLabel: (v: string) => void) => (
    <div className="mt-2 grid grid-cols-2 gap-3">
      {secs.length > 1 ? (
        <select value={section || secs[0].id} onChange={(e) => setSection(e.target.value)} className="fin-select w-full py-2 pl-2 text-[12px]" aria-label="Rubrique">
          {secs.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
      ) : (
        <span className="self-center text-[11px]" style={{ color: FIN.slate }}>
          {secs[0]?.title}
        </span>
      )}
      <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Nom de la ligne" className={inputClass} style={{ borderColor: FIN.line }} />
    </div>
  );

  const sideName = (of: 'actif' | 'passif') => (of === 'actif' ? "de l'actif" : 'du passif');
  return (
    <>
      <ErrorNote message={error} />
      {/* 1. TYPE DE CONNECTEUR, et la ligne (ou la dépense annuelle) qu'il relie */}
      <Field label="Choisir le type de connecteur">
        <div className="flex flex-wrap gap-1.5">
          <Choice on={dest === 'actif'} onClick={() => pickDest('actif')}>
            Actif
          </Choice>
          <Choice on={dest === 'passif'} onClick={() => pickDest('passif')}>
            Passif
          </Choice>
          <Choice on={dest === 'annuel'} onClick={() => pickDest('annuel')}>
            Dépenses annuelles
          </Choice>
        </div>
        <div className="mt-2">
          {side ? (
            <>
              {lineSelect(line, pickLine, sections, lineOptions, '', `Ligne ${sideName(side)}`)}
              {line === CUSTOM_LINE && customLine(sections, customSection, setCustomSection, customLabel, setCustomLabel)}
            </>
          ) : (
            <select value={plan} onChange={(e) => setPlan(e.target.value)} aria-label="Dépense annuelle" className="fin-select w-full py-2 pl-2 text-[12px]">
              <option value="">{plans.length ? 'Choisir une dépense annuelle…' : 'Aucune dépense annuelle'}</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} ({formatEuros(p.amount)})
                </option>
              ))}
            </select>
          )}
        </div>
      </Field>

      {/* TYPE DE LIAISON entre la ligne et la catégorie : +=, −= ou == */}
      {side && (
        <Field label="Choisir le type de liaison">
          <div className="flex gap-1.5">
            {LINE_NATURES.map((n) => (
              <Choice key={n.id} on={lineNature === n.id} onClick={() => setLineNature(n.id)}>
                <span className="text-[13px] leading-none">{n.sign}</span>
              </Choice>
            ))}
          </div>
          <p className="mt-1 text-[10px] leading-relaxed" style={{ color: FIN.slate }}>
            {LINE_NATURES.find((n) => n.id === lineNature)!.text(`« ${chosen.label || `La ligne ${sideName(side)}`} »`, category ? `« ${targetLabel(category)} »` : 'la catégorie')}
          </p>
        </Field>
      )}

      {/* 2. CATÉGORIE : le sens, puis les catégories de ce sens */}
      <Field label="Choisir une catégorie">
        {/* Première liste : le sens (entrée ou sortie) ; deuxième liste : les catégories de ce sens */}
        <div className="grid grid-cols-2 gap-3">
          <select
            value={dest === 'annuel' ? 'expense' : flow}
            onChange={(e) => {
              setFlow(e.target.value as GroupKind);
              setCategory('');
            }}
            disabled={dest === 'annuel'}
            aria-label="Entrée ou sortie"
            className="fin-select w-full py-2 pl-2 text-[12px] disabled:opacity-60"
          >
            <option value="income">Entrée</option>
            <option value="expense">Sortie</option>
          </select>
          {categorySelect(dest === 'annuel' ? 'expense' : flow)}
        </div>
        <p className="mt-1 text-[10px] leading-relaxed" style={{ color: FIN.slate }}>
          {dest === 'annuel'
            ? 'La limite mensuelle de la catégorie (une sortie) vaut la somme de ses dépenses annuelles divisée par douze.'
            : 'Entrée ou sortie, puis la catégorie de ce sens.'}
        </p>
      </Field>

      {/* 3. ÉQUILIBRAGE DU BILAN : la ligne choisie, la nature, puis la ligne de l'autre côté du bilan */}
      {side && (
        <Field label="Équilibrage du bilan">
          {/* Nouvelle ligne (de l'autre côté du bilan), type de liaison, puis l'ancienne ligne (celle du connecteur) */}
          <span className="mb-0.5 block text-[10px]" style={{ color: FIN.slate }}>
            Nouvelle ligne
          </span>
          {lineSelect(counter, pickCounter, counterSections, counterOptions, `${opposite === 'actif' ? 'Actif' : 'Passif'} · `, `Ligne ${sideName(opposite)}`)}
          {counter === CUSTOM_LINE && customLine(counterSections, counterSection, setCounterSection, counterLabel, setCounterLabel)}
          <span className="mb-0.5 mt-2 block text-[10px]" style={{ color: FIN.slate }}>
            Type de liaison
          </span>
          <div className="flex gap-1.5">
            {NATURES.map((n) => (
              <Choice key={n.id} on={nature === n.id} onClick={() => setNature(n.id)}>
                <span className="text-[13px] leading-none">{n.sign}</span>
              </Choice>
            ))}
          </div>
          <span className="mb-0.5 mt-2 block text-[10px]" style={{ color: FIN.slate }}>
            Ancienne ligne
          </span>
          <div className="rounded-sm px-3 py-2" style={{ backgroundColor: FIN.mist }}>
            <span className="block text-[8px] uppercase tracking-[0.15em]" style={{ color: FIN.slate }}>
              Ligne {sideName(side)} du connecteur
            </span>
            <span className="block text-[12px] font-bold" style={{ color: FIN.navy }}>
              {chosen.label || '—'}
            </span>
          </div>
          <p className="mt-1 text-[10px] leading-relaxed" style={{ color: FIN.slate }}>
            {NATURES.find((n) => n.id === nature)!.text(`« ${chosen.label || 'la ligne choisie'} »`, `« ${other.label || `La ligne ${sideName(opposite)}`} »`)} Le bilan reste
            équilibré.
          </p>
        </Field>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        <FinButton onClick={save} disabled={busy || !ready}>
          {busy ? 'Calcul…' : initial ? 'Enregistrer' : 'Créer la connexion'}
        </FinButton>
        <FinButton outline onClick={onCancel}>
          Annuler
        </FinButton>
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-3">
      <span className="mb-1 block text-[9px] uppercase tracking-[0.2em]" style={{ color: FIN.slate }}>
        {label}
      </span>
      {children}
    </div>
  );
}

export function BalanceLinksPanel({ ready, onError, onChanged }: { ready: boolean; onError: (message: string) => void; onChanged: (message: string) => void }) {
  const [confirm, confirmDialog] = useFinConfirm();
  // Popin ouverte : création, modification d'une connexion (même formulaire), ou des proches (formulaire complet)
  const [editing, setEditing] = useState<Connection | 'nouveau' | null>(null);
  const query = useCached('finances:lignes-reliees', async () => {
    const { links, error } = await fetchBalanceLinks();
    return orThrow(links, error);
  });
  const links = query.data ?? [];

  const saved = (message: string) => {
    setEditing(null);
    query.reload();
    onChanged(message);
  };

  // Boutons d'une carte : modifier (formulaire complet) et délier
  const actions = (name: string, onEdit: (() => void) | null, onRemove: () => void) => (
    <span className="flex shrink-0 items-center gap-1">
      {[
        ...(onEdit ? [{ label: `Modifier ${name}`, color: FIN.slate, icon: <Pencil size={14} />, onClick: onEdit }] : []),
        { label: `Délier ${name}`, color: FIN.rose, icon: <Trash2 size={14} />, onClick: onRemove }
      ].map((b) => (
        <button
          key={b.label}
          type="button"
          onClick={b.onClick}
          aria-label={b.label}
          title={b.label}
          className="flex h-8 w-8 items-center justify-center rounded-full border bg-white"
          style={{ borderColor: FIN.line, color: b.color }}
        >
          {b.icon}
        </button>
      ))}
    </span>
  );

  // Case d'une ligne du bilan dans une rangée
  const lineBox = (link: BalanceLink) => ({ tag: `${sideOf(link.section) === 'actif' ? 'Ligne de l’actif' : 'Ligne du passif'} · ${sectionTitle(link.section)}`, label: link.label });

  // Connexions créées ensemble : une catégorie reliée à une ligne (la première enregistrée), et les lignes de l'autre côté
  // du bilan qui l'équilibrent (même catégorie). Une catégorie seule sur une ligne, sans « == » ni ligne d'équilibrage,
  // s'affiche à part, ligne par ligne.
  const pairs: { category: string; line: BalanceLink; counters: { link: BalanceLink; nature: LinkNature }[] }[] = [];
  const shown = new Set<string>(); // « id de liaison|catégorie » déjà affichés dans une connexion
  // Ligne du connecteur d'une catégorie : celle enregistrée comme telle (les autres sont ses lignes d'équilibrage) ;
  // pour les connexions enregistrées sans ce rôle, la ligne du côté proposé par défaut (entrée → actif, sortie → passif)
  const categoriesLinked = [...new Set(links.flatMap((l) => [...l.targets.map(plainTarget), ...l.decreases]))];
  for (const category of categoriesLinked) {
    for (;;) {
      const candidates = links.filter((l) => natureOf(l, category) !== null && !shown.has(`${l.id}|${category}`));
      if (!candidates.length) break;
      const known = candidates.some((l) => l.counters.includes(category));
      const defaultSide = kindOfTarget(category) === 'income' ? 'actif' : 'passif';
      const line =
        (known ? candidates.find((l) => !l.counters.includes(category)) : candidates.find((l) => sideOf(l.section) === defaultSide)) ?? candidates[0];
      const counters = candidates
        .filter((m) => m.id !== line.id && sideOf(m.section) !== sideOf(line.section))
        .map((m) => ({ link: m, nature: natureOf(m, category)! }));
      shown.add(`${line.id}|${category}`);
      // Sans ligne d'équilibrage ni « == », la ligne s'affiche à part (leftovers)
      if (!counters.length && natureOf(line, category) !== '=') {
        shown.delete(`${line.id}|${category}`);
        break;
      }
      pairs.push({ category, line, counters });
      for (const c of counters) shown.add(`${c.link.id}|${category}`);
    }
  }
  const leftovers = links
    .map((link) => ({
      link,
      categories: [...link.targets.map(plainTarget), ...link.decreases].filter((c) => !shown.has(`${link.id}|${c}`))
    }))
    .filter((l) => l.categories.length > 0);

  // Délie une catégorie de ces lignes (une ligne sans plus rien de relié est retirée), puis recalcule le bilan
  async function unlink(category: string, lines: BalanceLink[]) {
    const name = categoryInfo(category).label;
    if (
      !(await confirm('Délier', `Ne plus relier « ${name} » à ${lines.map((l) => `« ${l.label} »`).join(' et ')} ? Les montants inscrits au bilan sont recalculés.`, {
        confirm: 'Délier',
        cancel: 'Annuler'
      }))
    )
      return;
    for (const l of lines) {
      const targets = l.targets.filter((t) => plainTarget(t) !== category);
      const decreases = l.decreases.filter((t) => t !== category);
      const counters = l.counters.filter((t) => t !== category);
      const err = targets.length + decreases.length === 0 && !l.opening ? await removeBalanceLink(l.id) : await saveBalanceLink({ ...l, targets, decreases, counters });
      if (err) return onError(describeDbError(err.message));
    }
    const err = await refreshBalanceLinks();
    if (err) return onError(describeDbError(err.message));
    query.reload();
    onChanged(`« ${name} » n'est plus reliée à ${lines.map((l) => `« ${l.label} »`).join(' ni à ')}.`);
  }

  return (
    <Panel
      collapsible
      title="Créer des connecteurs"
      subtitle="Crée des connexions entre les catégories, le bilan et les dépenses annuelles."
    >
      {confirmDialog}
      {query.error && <ErrorNote message={describeDbError(query.error)} />}
      {/* Ajout, en haut de la carte */}
      <button
        type="button"
        onClick={() => setEditing('nouveau')}
        className="mb-3 flex items-center gap-1 rounded-full border px-4 py-2 text-[10px] uppercase tracking-[0.15em]"
        style={{ borderColor: FIN.gold, color: FIN.gold }}
      >
        <Plus size={13} /> Créer une connexion
      </button>
      {ready && links.length === 0 && annualPlans().every((p) => !p.category) && (
        <p className="text-[11px] italic" style={{ color: FIN.slate }}>
          Aucune connexion pour l&apos;instant.
        </p>
      )}
      {ready && (
        <ul className="space-y-3 text-[12px]">
          {/* Une carte par connexion : catégorie = ligne, puis le rééquilibrage de l'autre côté du bilan */}
          {pairs.map(({ category, line, counters }) => (
            <ConnectionCard
              key={`${line.id}|${category}`}
              actions={actions(categoryInfo(category).label, () => setEditing({ category, line, counter: counters[0] }), () => unlink(category, [line, ...counters.map((c) => c.link)]))}
            >
              {/* Ligne du connecteur et sa catégorie, avec le type de liaison choisi (+=, −= ou ==) */}
              <ConnectionRow from={lineBox(line)} nature={natureOf(line, category) ?? '='} symbol={BALANCE_SYMBOL[natureOf(line, category) ?? '=']} to={categoryInfo(category)} />
              {counters.map(({ link, nature }) => (
                // Ligne choisie pour rééquilibrer += / −= / == le connecteur choisi
                <ConnectionRow
                  key={link.id}
                  tag="Rééquilibrage du bilan"
                  from={lineBox(link)}
                  nature={nature}
                  symbol={BALANCE_SYMBOL[nature]}
                  to={lineBox(line)}
                  sentence={balanceSentence(nature, link.label, line.label)}
                />
              ))}
            </ConnectionCard>
          ))}
          {/* Catégories reliées seules à une ligne (sans rééquilibrage) */}
          {leftovers.flatMap(({ link, categories }) =>
            categories.map((c) => (
              <ConnectionCard
                key={`${link.id}|${c}`}
                actions={actions(categoryInfo(c).label, () => setEditing({ category: c, line: link }), () => unlink(c, [link]))}
              >
                <ConnectionRow from={lineBox(link)} nature="=" to={categoryInfo(c)} />
              </ConnectionCard>
            ))
          )}
        </ul>
      )}
      {editing && (
        <FinModal title={editing === 'nouveau' ? 'Créer une connexion' : 'Modifier la liaison'} onClose={() => setEditing(null)}>
          <ConnectForm links={links} initial={editing === 'nouveau' ? undefined : editing} onSaved={saved} onCancel={() => setEditing(null)} />
        </FinModal>
      )}
      {ready && <AnnualLinks onError={onError} onChanged={onChanged} />}
    </Panel>
  );
}

// DÉPENSES ANNUELLES RELIÉES À UNE CATÉGORIE : la limite mensuelle de la catégorie devient la somme de ses dépenses
// annuelles divisée par douze (lib/transactions, linkPlannedToCategory). Une dépense reliée sort de « Dépenses annuelles ».
function AnnualLinks({ onError, onChanged }: { onError: (message: string) => void; onChanged: (message: string) => void }) {
  const limitsQuery = useCategoryLimits();
  const [, refresh] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const plans = annualPlans();

  async function link(plan: PlannedExpense, category: string | null) {
    setBusy(plan.id);
    const err = await linkPlannedToCategory(plan.id, category);
    setBusy(null);
    if (err) return onError(/category|column/i.test(err.message) ? 'Lance le script supabase/annual_links.sql dans l’éditeur SQL de Supabase pour relier les dépenses annuelles.' : describeDbError(err.message));
    refresh((n) => n + 1);
    limitsQuery.reload();
    const target = category ?? plan.category;
    const limit = target ? annualLimitOf(target) : null;
    onChanged(
      category
        ? `« ${plan.label} » est reliée à ${categoryById(category).label} : limite de ${formatEuros(limit ?? 0)} par mois.`
        : `« ${plan.label} » n'est plus reliée à une catégorie${target ? ` (${categoryById(target).label} : ${limit ? `${formatEuros(limit)} par mois` : 'plus de limite'})` : ''}.`
    );
  }

  const linked = [...new Set(plans.map((p) => p.category).filter((c): c is string => !!c))];
  if (!linked.length) return null;
  return (
    <ul className="mt-3 space-y-3 text-[12px]">
      {linked.map((c) => {
        const category = categoryById(c).label;
        return (
          <ConnectionCard key={c} tag="Dépenses annuelles" title={category} note={`Limite : ${formatEuros(annualLimitOf(c) ?? 0)} par mois`}>
            {plans
              .filter((p) => p.category === c)
              .map((p) => (
                <ConnectionRow
                  key={p.id}
                  from={{ tag: 'Dépense annuelle', label: `${p.label} · ${formatEuros(p.amount)} par an` }}
                  nature="="
                  to={{ tag: 'Catégorie (sortie)', label: category }}
                  sentence={`La limite mensuelle de « ${category} » compte « ${p.label} » pour ${formatEuros(p.amount / 12)} par mois (son montant ÷ 12).`}
                  onRemove={busy === p.id ? undefined : () => link(p, null)}
                />
              ))}
          </ConnectionCard>
        );
      })}
    </ul>
  );
}

// Carte d'une connexion : ses rangées, et ses boutons (modifier, délier) à droite ; un en-tête seulement s'il est donné
function ConnectionCard({ tag, title, note, actions, children }: { tag?: string; title?: string; note?: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="rounded-sm border px-3 py-2" style={{ borderColor: FIN.line, backgroundColor: '#fff' }}>
      {(tag || title) && (
        <div className="mb-2 flex items-start justify-between gap-2">
          <span className="min-w-0">
            {tag && (
              <span className="block text-[9px] uppercase tracking-[0.2em]" style={{ color: FIN.gold }}>
                {tag}
              </span>
            )}
            {title && <b className="block break-words">{title}</b>}
            {note && (
              <span className="block text-[10px]" style={{ color: FIN.slate }}>
                {note}
              </span>
            )}
          </span>
          {actions}
        </div>
      )}
      <div className="flex items-start gap-2">
        <ul className="min-w-0 flex-1 space-y-2">{children}</ul>
        {!(tag || title) && actions}
      </div>
    </li>
  );
}

// Une connexion : à gauche la ligne (du bilan, ou la dépense annuelle), au milieu le type de liaison, à droite la catégorie
// (ou, pour un rééquilibrage, la ligne qu'elle suit) ; dessous, la phrase qui dit exactement ce qui se passe
function ConnectionRow({
  tag,
  from,
  nature,
  to,
  sentence,
  symbol,
  onRemove
}: {
  tag?: string;
  from: { tag: string; label: string };
  nature: LinkNature;
  symbol?: string; // signe affiché à la place de la nature (rééquilibrage : +=, −=, ==)
  to: { tag: string; label: string };
  sentence?: string;
  onRemove?: () => void;
}) {
  const box = (side: { tag: string; label: string }) => (
    <span className="block min-w-0 rounded-sm px-2 py-1" style={{ backgroundColor: FIN.mist }}>
      <span className="block text-[8px] uppercase leading-tight tracking-[0.15em]" style={{ color: FIN.slate }}>
        {side.tag}
      </span>
      <span className="block break-words text-[11px] font-bold leading-snug">{side.label}</span>
    </span>
  );
  return (
    <li className="border-t pt-2 first:border-t-0 first:pt-0" style={{ borderColor: FIN.line }}>
      {tag && (
        <span className="mb-1 block text-[9px] uppercase tracking-[0.2em]" style={{ color: FIN.gold }}>
          {tag}
        </span>
      )}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1.5">
        {box(from)}
        <span
          className="flex h-7 min-w-7 items-center justify-center whitespace-nowrap rounded-full px-1.5 text-[13px] font-bold"
          style={{ backgroundColor: FIN.accent, color: FIN.paper }}
          aria-label={nature === '=' ? 'égal' : nature === '+' ? 'augmente' : 'diminue'}
        >
          {symbol ?? (nature === '-' ? '−' : nature)}
        </span>
        {box(to)}
      </div>
      {(sentence || onRemove) && (
        <p className="mt-1 flex items-start justify-between gap-2 text-[10px] leading-relaxed" style={{ color: FIN.slate }}>
          <span>{sentence}</span>
          {onRemove && (
            <button type="button" onClick={onRemove} className="shrink-0 underline" style={{ color: FIN.rose }}>
              Délier
            </button>
          )}
        </p>
      )}
    </li>
  );
}

// Signe d'un rééquilibrage : la ligne choisie prend la même valeur (==), ou ajoute (+=) / retire (−=) ce qui bouge sur le connecteur
const BALANCE_SYMBOL: Record<LinkNature, string> = { '=': '==', '+': '+=', '-': '−=' };

// Catégorie (ou grande catégorie) d'une connexion, avec son sens
function categoryInfo(target: string) {
  if (target.startsWith('groupe:')) {
    const group = categoryGroups().find((g) => groupTarget(g.id) === target);
    return { tag: `Grande catégorie (${group?.kind === 'income' ? 'entrée' : 'sortie'})`, label: group?.label ?? 'Grande catégorie supprimée' };
  }
  const category = categoryById(target);
  return { tag: `Catégorie (${groupKindOf(category) === 'income' ? 'entrée' : 'sortie'})`, label: category.label };
}

// Phrase du rééquilibrage : comment la ligne de l'autre côté du bilan suit la ligne choisie, pour que l'actif et le passif restent égaux
function balanceSentence(nature: LinkNature, counter: string, line: string) {
  if (nature === '=') return `Chaque mois, « ${counter} » prend la même valeur que « ${line} » : l'actif et le passif restent égaux.`;
  if (nature === '+')
    return `Chaque mois, ce qui s'ajoute à « ${line} » s'ajoute aussi à « ${counter} » : les deux côtés du bilan bougent du même montant et restent égaux.`;
  return `Chaque mois, ce qui s'ajoute à « ${line} » est retiré de « ${counter} » (un remboursement) : le bilan reste équilibré.`;
}

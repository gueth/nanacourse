'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { ChevronLeft, Pencil, Trash2 } from 'lucide-react';
import { BudgetForm } from '@/components/settings/BudgetSettings';
import IncomePlanEditor from '@/components/profile/IncomePlanEditor';
import CycleEditor from '@/components/profile/CycleEditor';
import { cyclePhase, DEFAULT_CYCLE, PHASES, useCycle } from '@/lib/cycle';
import ProfileTextsEditor, { type ProfileSection } from '@/components/profile/ProfileTextsEditor';
import { getDefaultProfileTexts, getProfileTexts, lines, paragraphs, subscribeProfileTexts, syncProfileTexts } from '@/lib/profileTexts';
import { DEFAULT_PLAN, deleteBudget, describeBudgetError, newBudget, partAmount, periodLabel, type BudgetState } from '@/lib/budget';
import { useIncomePlan, useShoppingBudgets } from '@/lib/coursesQueries';
import { ChallengeForm, useChallengeActions } from '@/components/challenges/ChallengeDialogs';
import {
  activeChallenge,
  challengeEnd,
  describeChallengeError,
  durationLabel,
  ownedCoupons,
  pointsSummary,
  shortDate,
  spendCoupon,
  useChallenges,
  useRewards
} from '@/lib/challenges';
import { Doily, EditablePhoto, EditButton, Envelope, mono, NoteSection, paperGrain, PaperClip, PaperModal, PF, Ribbon, script, serif, Stamp, useProfileConfirm } from '@/components/profile/ProfileParts';

// Informations d'exemple, pour voir la page une fois remplie (à remplacer par les vraies).
// Les textes modifiables (à propos, nom, position, objectifs, défis, carte) viennent de lib/profileTexts ;
// la répartition du revenu et les budgets sont les vrais (lib/budget).
const DEMO = {
  fullName: 'Ana Moreau',
  year: '2026',
  role: 'Cheffe des courses & des comptes'
};

const euros = (n: number) => `${n.toFixed(2).replace('.', ',')} €`;

// Page Profil, façon portfolio : enveloppe de titre, carte « À propos », puis un carnet ouvert
// (ticket de caisse, photo d'identité et timbre à gauche ; position, répartition, budgets, objectifs et défis à droite).
// Chaque rubrique a son crayon (ou son « + ») qui ouvre la fenêtre correspondante ; chaque budget a son crayon et sa corbeille.
export default function ProfilePage() {
  // Textes affichés : ceux par défaut au premier rendu, puis ceux enregistrés dans le navigateur
  const txt = useSyncExternalStore(subscribeProfileTexts, getProfileTexts, getDefaultProfileTexts);
  useEffect(() => {
    syncProfileTexts();
  }, []);
  // Rubrique de texte dont la fenêtre de modification est ouverte
  const [editingSection, setEditingSection] = useState<ProfileSection | null>(null);
  // Fenêtre ouverte pour la répartition du revenu ou l'ajout d'un budget
  const [budgetPopup, setBudgetPopup] = useState<'repartition' | 'nouveau' | null>(null);
  // Budget en cours de modification
  const [editingBudget, setEditingBudget] = useState<BudgetState | null>(null);
  const [budgetError, setBudgetError] = useState('');
  const [confirm, confirmDialog] = useProfileConfirm();
  // Défi de la semaine : formulaire d'un nouveau défi, et question « réussi ou échoué ? » sur le précédent
  const challengesQuery = useChallenges();
  const rewardsQuery = useRewards();
  const currentChallenge = activeChallenge(challengesQuery.data);
  const points = pointsSummary(challengesQuery.data, rewardsQuery.data?.claims);
  const [challengeFormOpen, setChallengeFormOpen] = useState(false);
  const challengeActions = useChallengeActions('profile', () => challengesQuery.reload());
  // Coupons gagnés sur l'accueil, pas encore utilisés (regroupés quand il y en a plusieurs identiques)
  const coupons = ownedCoupons(rewardsQuery.data?.claims);
  const [couponError, setCouponError] = useState('');

  // UTILISATION D'UN COUPON, après confirmation : il disparaît (le plus ancien du groupe)
  async function redeemCoupon(label: string, id: string) {
    if (!(await confirm('Utiliser le coupon', `Utiliser maintenant le coupon « ${label} » ? Il disparaîtra de ton profil.`, 'Utiliser'))) return;
    setCouponError('');
    const err = await spendCoupon(id);
    if (err) return setCouponError(describeChallengeError(err));
    rewardsQuery.reload();
  }
  const budgetsQuery = useShoppingBudgets();
  const planQuery = useIncomePlan();
  const plan = planQuery.data ?? DEFAULT_PLAN;
  // Cycle menstruel (colore la page de titre selon la phase du jour)
  const cycleQuery = useCycle();
  const [cycleOpen, setCycleOpen] = useState(false);
  const phase = cyclePhase(cycleQuery.data, new Date());
  const budgets = budgetsQuery.data ?? [];

  // SUPPRESSION D'UN BUDGET, après confirmation : ses dépenses ne comptent plus, ses listes passent sur le premier budget
  async function removeBudget(b: BudgetState) {
    const ok = await confirm(
      'Supprimer le budget',
      `Supprimer le budget « ${b.settings.name} » ? Ses dépenses ne compteront plus, et les listes qui en dépendent passeront sur le premier budget.`
    );
    if (!ok) return;
    setBudgetError('');
    const err = await deleteBudget(b.settings.id!);
    if (err) return setBudgetError(describeBudgetError(err));
    budgetsQuery.reload();
  }

  return (
    <div className="min-h-dvh overflow-x-hidden pb-16" style={{ backgroundColor: PF.bg, color: PF.ink }}>
      <div className="relative mx-auto max-w-md px-4 pt-3">
        <div className="flex items-center justify-between text-[9px] uppercase tracking-[0.2em] text-white">
          <Link href="/accueil" className="-ml-2 flex items-center gap-1 px-2 py-2 opacity-90">
            <ChevronLeft size={14} /> Accueil
          </Link>
          <span className="opacity-80">Courses / Finances</span>
        </div>

        {/* ENVELOPPE DE TITRE */}
        <div className="mt-1 -rotate-1">
          <Envelope name={txt.name} year={DEMO.year} handle={txt.handle} email={txt.email} />
        </div>

        {/* CARTE « À PROPOS » sur un napperon, avec un ruban qui dépasse à gauche */}
        <div className="relative mt-8">
          <Doily size={340} className="absolute -right-24 -top-6" />
          <Ribbon className="absolute -left-10 top-10" />
          <div className="relative mr-[35%] rotate-[0.6deg] px-4 pb-4 pt-5 text-center shadow-[0_8px_18px_rgba(20,30,60,0.3)]" style={paperGrain}>
            {/* Écriture estompée en fond, comme une page réutilisée */}
            <p className="pointer-events-none absolute left-3 top-2 text-[13px] opacity-15" style={script}>
              Liste de courses · Budget
            </p>
            <h2 className="text-[46px] leading-none" style={{ ...script, color: PF.blue, textShadow: '1px 1px 0 #fff, 2px 2px 0 rgba(53,99,168,0.25)' }}>
              À propos
              <EditButton label="À propos" onClick={() => setEditingSection('about')} className="ml-1" />
            </h2>
            <div className="mt-2 space-y-2 text-[10px] leading-snug" style={serif}>
              {paragraphs(txt.about).map((p, i) => (
                <p key={i} className="whitespace-pre-line">
                  {p}
                </p>
              ))}
            </div>
            <p className="mt-2 text-right text-[9px] tracking-[0.2em]" style={{ ...serif, color: PF.blue }}>
              ( {txt.name.toUpperCase()} )
              <EditButton label="Nana" onClick={() => setEditingSection('name')} className="ml-1" />
            </p>
          </div>
          {/* Photo en pied, retenue par un trombone */}
          <div className="absolute -top-3 right-0 w-[34%] rotate-2 bg-white p-1.5 pb-5 shadow-[0_8px_18px_rgba(20,30,60,0.35)]">
            <PaperClip className="absolute -top-3 right-5 rotate-12" />
            <div className="aspect-[2/3] overflow-hidden">
              <EditablePhoto kind="standing" photo="photoStanding" url={txt.photoStanding} label="la photo en pied" confirm={confirm} />
            </div>
          </div>
        </div>

        {/* CARNET OUVERT : deux pages côte à côte */}
        <div className="relative mt-10">
          <Doily size={260} className="absolute -bottom-16 -left-24" />
          <div className="relative grid grid-cols-2 shadow-[0_10px_24px_rgba(20,30,60,0.35)]">
            {/* Pliure du carnet */}
            <div className="pointer-events-none absolute inset-y-0 left-1/2 z-10 w-6 -translate-x-1/2" style={{ background: 'linear-gradient(90deg, transparent, rgba(0,0,0,0.12) 50%, transparent)' }} />

            {/* PAGE DE GAUCHE : ticket, photo d'identité, timbre */}
            <div className="relative min-h-[520px] overflow-visible" style={paperGrain}>
              {/* Ticket de caisse */}
              <div className="absolute left-2 top-4 w-[88%] -rotate-1 bg-white px-2.5 pb-4 pt-3 text-[7px] leading-[1.45] shadow-[0_3px_8px_rgba(0,0,0,0.15)]" style={mono}>
                <p className="text-[22px] font-bold leading-none tracking-wider">{txt.name.toUpperCase()}</p>
                <p className="mb-1.5">({txt.handle})</p>
                <p>NOM&nbsp;&nbsp;&nbsp;{DEMO.fullName.toUpperCase()} ({txt.name.toUpperCase()})</p>
                <p>RÔLE&nbsp;&nbsp;{DEMO.role.toUpperCase()}</p>
                <p className="my-1.5 tracking-[0.1em]">--------------------------</p>
                <p className="mb-0.5">RÉPARTITION :</p>
                {plan.parts.map((part) => (
                  <p key={part.id} className="flex justify-between gap-1">
                    <span className="truncate">{part.label.toUpperCase()}</span>
                    <span>{part.pct} %</span>
                  </p>
                ))}
                <p className="my-1.5 tracking-[0.1em]">--------------------------</p>
                <p className="mb-0.5">BUDGETS (RESTE) :</p>
                {budgets.length === 0 && <p>AUCUN</p>}
                {budgets.map((b) => (
                  <p key={b.settings.id} className="flex justify-between gap-1">
                    <span className="truncate">{b.settings.name.toUpperCase()}</span>
                    <span>{euros(b.remaining)}</span>
                  </p>
                ))}
                <p className="mt-2 text-center">MERCI D&apos;UTILISER NOTRE APPLICATION</p>
              </div>

              {/* Photo d'identité */}
              <div className="absolute right-[-5%] top-2 z-20 w-[50%] rotate-2 bg-white p-1 pb-3 shadow-[0_4px_10px_rgba(20,30,60,0.3)]">
                <PaperClip className="absolute -top-3 left-3 -rotate-6" />
                <div className="aspect-[4/5] overflow-hidden">
                  <EditablePhoto kind="portrait" photo="photoPortrait" url={txt.photoPortrait} label="la photo d’identité" confirm={confirm} />
                </div>
              </div>

              {/* Timbre : carte d'identité */}
              <Stamp className="absolute -left-2 bottom-5 z-20 w-[104%] -rotate-2">
                <p className="text-center text-[6px] uppercase tracking-[0.2em]" style={{ ...serif, color: PF.blue }}>
                  Je m&apos;appelle
                  <EditButton label="Je m'appelle" onClick={() => setEditingSection('identity')} className="ml-1" />
                </p>
                <p className="text-center text-[30px] leading-none" style={{ ...script, color: PF.blue }}>
                  {txt.name}
                </p>
                <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 text-[7.5px] leading-[1.6]" style={{ ...serif, color: PF.ink }}>
                  {[
                    ['Naissance', txt.birth],
                    ['Téléphone', txt.phone],
                    ['Email', txt.email],
                    ['Instagram', txt.handle],
                    ['Adresse', txt.positionAddress]
                  ].map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt style={{ color: PF.blue }}>{k} :</dt>
                      <dd className="truncate border-b border-dotted text-right" style={{ borderColor: PF.pale }}>
                        {v}
                      </dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-1 text-center text-[6px] italic" style={serif}>
                  {txt.quote}
                </p>
              </Stamp>
            </div>

            {/* PAGE DE DROITE : les informations, rubrique par rubrique */}
            <div className="relative px-3 pb-6 pt-2" style={paperGrain}>
              {/* Ovale bleu pâle derrière le milieu de la page */}
              <div className="pointer-events-none absolute inset-x-2 top-[38%] h-24 rounded-[50%]" style={{ backgroundColor: PF.pale, opacity: 0.35 }} />
              <div className="relative">
                <NoteSection title="Ma position" n={1} onEdit={() => setEditingSection('position')}>
                  <p>{txt.positionAddress}</p>
                  <p className="text-[8.5px] opacity-75">{txt.positionNote}</p>
                </NoteSection>
                <NoteSection title="Répartition" n={2} onEdit={() => setBudgetPopup('repartition')}>
                  <p className="text-[7px] uppercase tracking-[0.2em] opacity-70">Revenu · {plan.income ? euros(plan.income) : 'à renseigner'}</p>
                  {plan.parts.map((part) => (
                    <p key={part.id}>
                      {part.label} : {part.pct} %{plan.income > 0 && ` · ${euros(partAmount(plan, part.id))}`}
                    </p>
                  ))}
                </NoteSection>
                <NoteSection title="Budgets" n={3} onAdd={() => setBudgetPopup('nouveau')} addLabel="Ajouter un budget">
                  {budgetsQuery.error && <p className="text-[8.5px] text-brick">Budgets indisponibles</p>}
                  {!budgetsQuery.error && budgets.length === 0 && <p className="opacity-75">{budgetsQuery.data ? 'Aucun budget pour l’instant' : 'Chargement…'}</p>}
                  {budgetError && <p className="text-[8.5px] text-brick">{budgetError}</p>}
                  {budgets.map((b) => (
                    <div key={b.settings.id} className="mt-1">
                      <p>
                        {b.settings.name} : reste {euros(b.remaining)}
                        <span className="block text-[8.5px] opacity-75">
                          sur {euros(Number(b.settings.amount))} tous les {periodLabel(b.settings)}
                        </span>
                      </p>
                      <span className="flex justify-center gap-1">
                        <button type="button" onClick={() => setEditingBudget(b)} aria-label={`Modifier le budget ${b.settings.name}`} className="p-1" style={{ color: PF.blue }}>
                          <Pencil size={11} />
                        </button>
                        <button type="button" onClick={() => removeBudget(b)} aria-label={`Supprimer le budget ${b.settings.name}`} className="p-1 text-brick">
                          <Trash2 size={11} />
                        </button>
                      </span>
                    </div>
                  ))}
                </NoteSection>
                <NoteSection title="Objectifs" n={4} onEdit={() => setEditingSection('goals')}>
                  <p className="text-[7px] uppercase tracking-[0.2em] opacity-70">{txt.goalsLabel}</p>
                  {lines(txt.goals).map((g, i) => (
                    <p key={i}>{g}</p>
                  ))}
                </NoteSection>
                <NoteSection title="Défis" n={5} onAdd={() => setChallengeFormOpen(true)} addLabel="Nouveau défi">
                  <p className="text-[7px] uppercase tracking-[0.2em] opacity-70">{points.available} points à dépenser</p>
                  {challengesQuery.error && <p className="text-[8.5px] text-brick">{describeChallengeError({ message: challengesQuery.error })}</p>}
                  {challengeActions.error && <p className="text-[8.5px] text-brick">{challengeActions.error}</p>}
                  {!challengesQuery.error && !currentChallenge && <p className="opacity-75">{challengesQuery.data ? 'Aucun défi en cours' : 'Chargement…'}</p>}
                  {currentChallenge && (
                    <div className="mt-1">
                      <p>
                        {currentChallenge.title}
                        <span className="block text-[8.5px] opacity-75">
                          {currentChallenge.points} pts · {durationLabel(currentChallenge.duration_days)} · jusqu&apos;au {shortDate(challengeEnd(currentChallenge))}
                        </span>
                      </p>
                      <button
                        type="button"
                        onClick={() => challengeActions.remove(currentChallenge)}
                        aria-label={`Retirer le défi ${currentChallenge.title}`}
                        className="p-1 text-brick"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  )}
                </NoteSection>
                <NoteSection title="Mes coupons" n={6}>
                  <p className="text-[7px] uppercase tracking-[0.2em] opacity-70">Gagnés avec tes points</p>
                  {couponError && <p className="text-[8.5px] text-brick">{couponError}</p>}
                  {rewardsQuery.data && coupons.length === 0 && <p className="opacity-75">Aucun coupon : arrache-en un sur l&apos;accueil</p>}
                  {coupons.map(({ label, items }) => (
                    <div key={label} className="mt-1">
                      <p>
                        {label}
                        {items.length > 1 && <b> ×{items.length}</b>}
                      </p>
                      <button
                        type="button"
                        onClick={() => redeemCoupon(label, items[0].id)}
                        className="mt-0.5 rounded-full border px-2 py-0.5 text-[7px] uppercase tracking-[0.18em]"
                        style={{ borderColor: PF.blue, color: PF.blue }}
                      >
                        Utiliser
                      </button>
                    </div>
                  ))}
                </NoteSection>
                <NoteSection title="Mon cycle" n={7} onEdit={() => cycleQuery.data && setCycleOpen(true)}>
                  {cycleQuery.error && <p className="text-[8.5px] text-brick">{cycleQuery.error}</p>}
                  {!cycleQuery.error && !cycleQuery.data && <p className="opacity-75">Chargement…</p>}
                  {cycleQuery.data && !phase && <p className="opacity-75">À renseigner</p>}
                  {phase && (
                    <>
                      <p style={{ color: PHASES[phase.phase].colors.accent }}>
                        {PHASES[phase.phase].label} · jour {phase.day}
                      </p>
                      <p className="text-[8.5px] opacity-75">
                        cycle de {cycleQuery.data!.cycle_length} jours{cycleQuery.data!.averaged_over > 0 ? ' (moyenne)' : ''} · règles dans {phase.nextPeriodIn} j
                      </p>
                    </>
                  )}
                </NoteSection>
                <p className="mt-4 text-center text-[8px]" style={serif}>
                  2
                </p>
              </div>
            </div>
          </div>
        </div>

              </div>

      {editingSection && (
        <ProfileTextsEditor key={editingSection} section={editingSection} texts={txt} onClose={() => setEditingSection(null)} />
      )}

      {budgetPopup === 'repartition' &&
        (planQuery.data === undefined ? (
          <PaperModal title="Répartition" onClose={() => setBudgetPopup(null)}>
            <p className="text-sm">{planQuery.error ?? 'Chargement…'}</p>
          </PaperModal>
        ) : (
          <IncomePlanEditor
            plan={plan}
            budgets={budgets}
            confirm={confirm}
            onClose={() => setBudgetPopup(null)}
            onSaved={() => {
              planQuery.reload();
              // Les plafonds en pourcentage et la partie des budgets changent avec la répartition
              budgetsQuery.reload();
              setBudgetPopup(null);
            }}
          />
        ))}

      {editingBudget && (
        <PaperModal title={`Modifier « ${editingBudget.settings.name} »`} onClose={() => setEditingBudget(null)}>
          <BudgetForm
            initial={editingBudget.settings}
            plan={plan}
            onCancel={() => setEditingBudget(null)}
            onSaved={() => {
              budgetsQuery.reload();
              setEditingBudget(null);
            }}
          />
        </PaperModal>
      )}

      {cycleOpen && (
        <CycleEditor
          cycle={cycleQuery.data ?? DEFAULT_CYCLE}
          onChanged={() => cycleQuery.reload()}
          onClose={() => setCycleOpen(false)}
          onSaved={() => {
            cycleQuery.reload();
            setCycleOpen(false);
          }}
        />
      )}

      {/* Confirmation avant suppression, au-dessus de tout le reste */}
      {confirmDialog}

      {/* Nouveau défi, puis (au-dessus) la question sur le défi précédent */}
      {challengeFormOpen && (
        <ChallengeForm variant="profile" onSubmit={(values) => challengeActions.start(values, currentChallenge)} onClose={() => setChallengeFormOpen(false)} />
      )}
      {challengeActions.dialog}

      {budgetPopup === 'nouveau' && (
        <PaperModal title="Nouveau budget" onClose={() => setBudgetPopup(null)}>
          <BudgetForm
            initial={newBudget()}
            plan={plan}
            onCancel={() => setBudgetPopup(null)}
            onSaved={() => {
              budgetsQuery.reload();
              setBudgetPopup(null);
            }}
          />
        </PaperModal>
      )}
    </div>
  );
}

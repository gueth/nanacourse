'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { ChevronLeft, Pencil, Trash2 } from 'lucide-react';
import { BudgetForm } from '@/components/settings/BudgetSettings';
import CycleEditor from '@/components/profile/CycleEditor';
import { cyclePhase, DEFAULT_CYCLE, PHASES, useCycle } from '@/lib/cycle';
import ProfileTextsEditor, { type ProfileSection } from '@/components/profile/ProfileTextsEditor';
import { getDefaultProfileTexts, getProfileTexts, lines, paragraphs, subscribeProfileTexts, syncProfileTexts } from '@/lib/profileTexts';
import { deleteBudget, describeBudgetError, newBudget, periodLabel, type BudgetState } from '@/lib/budget';
import { useShoppingBudgets } from '@/lib/coursesQueries';
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
import { CardSpotlight } from '@/components/profile/CardSpotlight';
import { Doily, EditablePhoto, EditButton, Envelope, mono, NoteSection, paperGrain, PaperClip, PaperModal, PF, Ribbon, script, serif, Stamp, useProfileConfirm } from '@/components/profile/ProfileParts';

// Informations d'exemple, pour voir la page une fois remplie (à remplacer par les vraies).
// Les textes modifiables (à propos, nom, position, objectifs, défis, carte) viennent de lib/profileTexts ;
// les budgets sont les vrais (lib/budget). La répartition du revenu est dans les Finances (Gestion et Budget).
const DEMO = {
  fullName: 'Ana Moreau',
  year: '2026',
  role: 'Cheffe des courses & des comptes'
};

const euros = (n: number) => `${n.toFixed(2).replace('.', ',')} €`;

// Page Profil, façon portfolio : tout en haut, l'enveloppe de titre en longue barre horizontale ; dessous, à droite, un carnet plié en deux comme un menu, la photo en pied épinglée tout en haut de sa couverture ;
// à côté, la carte « À propos » et la carte de visite (timbre). Il s'ouvre en poussant ces cartes vers la gauche, et se referme
// À droite, chaque rubrique n'a que son titre, une petite explication et son crayon, qui ouvre une fenêtre avec le détail à modifier.
export default function ProfilePage() {
  // Textes affichés : ceux par défaut au premier rendu, puis ceux enregistrés dans le navigateur
  const txt = useSyncExternalStore(subscribeProfileTexts, getProfileTexts, getDefaultProfileTexts);
  useEffect(() => {
    syncProfileTexts();
  }, []);
  // Rubrique de texte dont la fenêtre de modification est ouverte
  const [editingSection, setEditingSection] = useState<ProfileSection | null>(null);
  // Fenêtre ouverte pour l'ajout d'un budget
  const [budgetPopup, setBudgetPopup] = useState<'nouveau' | null>(null);
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
  // Cycle menstruel (colore la page de titre selon la phase du jour)
  const cycleQuery = useCycle();
  const [cycleOpen, setCycleOpen] = useState(false);
  const phase = cyclePhase(cycleQuery.data, new Date());
  // Fenêtre de détail ouverte depuis la page de droite : budgets, défis ou coupons
  const [panel, setPanel] = useState<'budgets' | 'defis' | 'coupons' | null>(null);
  // Carnet plié en deux comme un menu : fermé (on voit sa couverture) ou ouvert à plat
  const [notebookOpen, setNotebookOpen] = useState(false);
  // Carte de gauche mise au premier plan, avec sa place de départ sur l'écran
  const [spotlight, setSpotlight] = useState<{ id: 'about' | 'visite'; rect: DOMRect } | null>(null);
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

  // CARTES DE GAUCHE : leurs crayons de modification sont à gauche, la partie droite passant sous le carnet.
  // Dans la carte au premier plan, un crayon la remet d'abord en place, puis ouvre la modification.
  const edit = (section: ProfileSection) => () => {
    setSpotlight(null);
    setEditingSection(section);
  };
  const aboutCard = (
    <div className="relative rotate-[0.8deg] px-3 pb-3 pt-4 text-center shadow-[0_8px_18px_rgba(20,30,60,0.3)]" style={paperGrain}>
      <EditButton label="À propos" onClick={edit('about')} className="absolute -left-2 -top-2 z-10" />
      <h2 className="text-[34px] leading-none" style={{ ...script, color: PF.blue, textShadow: '1px 1px 0 #fff, 2px 2px 0 rgba(53,99,168,0.25)' }}>
        À propos
      </h2>
      <div className="mt-1.5 space-y-1.5 text-[8.5px] leading-snug" style={serif}>
        {paragraphs(txt.about).map((p, i) => (
          <p key={i} className="whitespace-pre-line">
            {p}
          </p>
        ))}
      </div>
      <p className="mt-1.5 text-right text-[8px] tracking-[0.2em]" style={{ ...serif, color: PF.blue }}>
        ( {txt.name.toUpperCase()} )
      </p>
    </div>
  );
  const visitCard = (
    <Stamp className="relative -rotate-2">
      <EditButton label="Carte de visite" onClick={edit('identity')} className="absolute -left-1 -top-1 z-10" />
      <p className="text-center text-[7px] uppercase tracking-[0.2em]" style={{ ...serif, color: PF.blue }}>
        Carte de visite
      </p>
      <p className="text-center text-[30px] leading-none" style={{ ...script, color: PF.blue }}>
        {txt.name}
      </p>
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 text-[8px] leading-[1.6]" style={{ ...serif, color: PF.ink }}>
        {[
          ['Téléphone', txt.phone],
          ['Email', txt.email],
          ['Site web', txt.website],
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
      <p className="mt-1 text-center text-[7px] italic" style={serif}>
        {txt.quote}
      </p>
    </Stamp>
  );
  // Carte touchée : on note sa place sur l'écran, d'où elle part pour venir au premier plan (sauf toucher sur un crayon)
  function spotlightCard(id: 'about' | 'visite', e: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>) {
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    setSpotlight({ id, rect: e.currentTarget.getBoundingClientRect() });
  }

  return (
    <div className="relative isolate min-h-dvh overflow-x-hidden pb-4" style={{ backgroundColor: PF.bg, color: PF.ink }}>
      {/* DÉCORS DU FOND : quelques napperons et un ruban posés une fois pour toutes, qui ne bougent pas quand le carnet s'ouvre.
          Posés sur toute la page, jusqu'en bas de l'écran ; coupés à ses bords (overflow-hidden), ils n'allongent pas la page */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden>
        <Doily size={300} className="absolute -right-32 top-6" />
        <Doily size={200} className="absolute -left-24 top-[300px] opacity-80" />
        <Doily size={220} className="absolute -right-24 top-[640px] opacity-80" />
        <Ribbon className="absolute -left-8 top-[90px]" />
        {/* Grand napperon rond en bas à gauche, dont on voit le quart qui dépasse du coin */}
        <Doily size={280} className="absolute -bottom-24 -left-24" />
      </div>
      <div className="relative isolate mx-auto max-w-md px-4 pt-3">
        <div className="flex items-center text-[9px] uppercase tracking-[0.2em] text-white">
          <Link href="/cartes" className="-ml-2 flex items-center gap-1 px-2 py-2 opacity-90">
            <ChevronLeft size={14} /> Retour
          </Link>
        </div>

        {/* ENVELOPPE DE TITRE : longue barre horizontale en haut de la page */}
        <div className="mt-2">
          <Envelope year={DEMO.year} handle={txt.handle} email={txt.email} />
        </div>

        {/* CARNET, plié en deux comme un menu, en haut à droite de la page : fermé, on ne voit que sa couverture (le dos de la
            page de gauche, rabattue sur celle de droite), avec « À propos » et la carte de visite à côté, sur la moitié gauche.
            Un toucher l'ouvre : la page de gauche se déplie sur la pliure du milieu et pousse ces cartes vers la gauche */}
        <div className="relative mt-8 grid">
          {/* À côté du carnet fermé : la carte « À propos » et la carte de visite en timbre, poussées hors de la page à l'ouverture */}
          <div
            className="relative z-0 col-start-1 row-start-1 w-[64%] space-y-5 self-start pt-2 transition-[transform,opacity] duration-700 ease-[cubic-bezier(0.45,0.05,0.25,1)] motion-reduce:transition-none"
            // Carnet ouvert : ces cartes, sorties de l'écran, ne prennent plus de hauteur (pas de vide sous le carnet)
            style={{ transform: notebookOpen ? 'translateX(calc(-100% - 2rem))' : undefined, opacity: notebookOpen ? 0 : 1, height: notebookOpen ? 0 : undefined }}
            inert={notebookOpen}
          >
            {/* Toucher une carte la fait venir au premier plan (ses crayons, à gauche, restent accessibles sous le carnet) */}
            {(['about', 'visite'] as const).map((id) => (
              <div
                key={id}
                role="button"
                tabIndex={0}
                aria-label={id === 'about' ? 'Agrandir la carte « À propos »' : 'Agrandir la carte de visite'}
                onClick={(e) => spotlightCard(id, e)}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && spotlightCard(id, e)}
                className="relative cursor-zoom-in outline-none"
                style={{ visibility: spotlight?.id === id ? 'hidden' : undefined }}
              >
                {id === 'about' ? aboutCard : visitCard}
              </div>
            ))}
          </div>
          <div
            className="pointer-events-none relative z-10 col-start-1 row-start-1 grid grid-cols-2 self-start [&>*]:pointer-events-auto"
            style={{ perspective: 1800 }}
          >
            {/* Pliure du carnet */}
            <div
              className="pointer-events-none absolute inset-y-0 left-1/2 z-30 w-6 -translate-x-1/2 transition-opacity duration-500"
              style={{ background: 'linear-gradient(90deg, transparent, rgba(0,0,0,0.12) 50%, transparent)', opacity: notebookOpen ? 1 : 0 }}
            />

            {/* PAGE DE GAUCHE, qui se rabat : recto = ticket et photo d'identité, verso = couverture du carnet */}
            <div
              className="relative z-20 transition-transform duration-700 ease-[cubic-bezier(0.45,0.05,0.25,1)] [transform-style:preserve-3d] motion-reduce:transition-none"
              style={{ transformOrigin: 'right center', transform: notebookOpen ? 'rotateY(0deg)' : 'rotateY(180deg)' }}
            >
            {/* Recto : le ticket, avec la photo d'identité épinglée dessus */}
            <div
              className="relative flex h-full min-h-[520px] flex-col overflow-visible pb-5 shadow-[0_10px_24px_rgba(20,30,60,0.35)] [backface-visibility:hidden]"
              style={paperGrain}
              inert={!notebookOpen}
            >
              <div className="relative mt-4">
              {/* Ticket de caisse : récapitulatif de tout ce qui est enregistré dans le profil */}
              <div className="relative ml-2 w-[88%] -rotate-1 bg-white px-2.5 pb-4 pt-3 text-[7px] leading-[1.45] shadow-[0_3px_8px_rgba(0,0,0,0.15)]" style={mono}>
                <p className="text-[22px] font-bold leading-none tracking-wider">{txt.name.toUpperCase()}</p>
                <p className="mb-1.5">({txt.handle})</p>
                <p>NOM&nbsp;&nbsp;&nbsp;{DEMO.fullName.toUpperCase()} ({txt.name.toUpperCase()})</p>
                <p>RÔLE&nbsp;&nbsp;{DEMO.role.toUpperCase()}</p>
                <p className="my-1.5 tracking-[0.1em]">--------------------------</p>
                <p className="mb-0.5">POSITION :</p>
                <p className="break-words">{txt.positionAddress.toUpperCase()}</p>
                <p className="my-1.5 tracking-[0.1em]">--------------------------</p>
                <p className="mb-0.5">BUDGETS (RESTE) :</p>
                {budgets.length === 0 && <p>AUCUN</p>}
                {budgets.map((b) => (
                  <p key={b.settings.id} className="flex justify-between gap-1">
                    <span className="truncate">{b.settings.name.toUpperCase()}</span>
                    <span>{euros(b.remaining)}</span>
                  </p>
                ))}
                <p className="my-1.5 tracking-[0.1em]">--------------------------</p>
                <p className="mb-0.5">OBJECTIFS :</p>
                {lines(txt.goals).length === 0 && <p>AUCUN</p>}
                {lines(txt.goals).map((g, i) => (
                  <p key={i} className="break-words">
                    · {g.toUpperCase()}
                  </p>
                ))}
                <p className="my-1.5 tracking-[0.1em]">--------------------------</p>
                <p className="mb-0.5">DÉFI EN COURS :</p>
                {currentChallenge ? (
                  <>
                    <p className="break-words">{currentChallenge.title.toUpperCase()}</p>
                    <p className="flex justify-between gap-1">
                      <span>{currentChallenge.points} PTS</span>
                      <span>JUSQU&apos;AU {shortDate(challengeEnd(currentChallenge)).toUpperCase()}</span>
                    </p>
                  </>
                ) : (
                  <p>{challengesQuery.data ? 'AUCUN' : '…'}</p>
                )}
                <p className="flex justify-between gap-1">
                  <span>POINTS À DÉPENSER</span>
                  <span>{points.available}</span>
                </p>
                <p className="my-1.5 tracking-[0.1em]">--------------------------</p>
                <p className="mb-0.5">COUPONS :</p>
                {rewardsQuery.data && coupons.length === 0 && <p>AUCUN</p>}
                {coupons.map(({ label, items }) => (
                  <p key={label} className="flex justify-between gap-1">
                    <span className="truncate">{label.toUpperCase()}</span>
                    <span>×{items.length}</span>
                  </p>
                ))}
                <p className="my-1.5 tracking-[0.1em]">--------------------------</p>
                <p className="mb-0.5">CYCLE :</p>
                {phase ? (
                  <>
                    <p className="flex justify-between gap-1">
                      <span className="truncate">{PHASES[phase.phase].label.toUpperCase()}</span>
                      <span>JOUR {phase.day}</span>
                    </p>
                    <p className="flex justify-between gap-1">
                      <span>RÈGLES DANS</span>
                      <span>{phase.nextPeriodIn} J</span>
                    </p>
                  </>
                ) : (
                  <p>{cycleQuery.data ? 'À RENSEIGNER' : '…'}</p>
                )}
                <p className="my-1.5 tracking-[0.1em]">--------------------------</p>
                <p className="mt-2 text-center">MERCI D&apos;UTILISER NOTRE APPLICATION</p>
              </div>

              {/* Photo d'identité, épinglée en haut à droite du ticket */}
              <div className="absolute right-[-5%] top-[-14px] z-20 w-[50%] rotate-2 bg-white p-1 pb-3 shadow-[0_4px_10px_rgba(20,30,60,0.3)]">
                <PaperClip className="absolute -top-3 left-3 -rotate-6" />
                <div className="aspect-[4/5] overflow-hidden">
                  <EditablePhoto kind="portrait" photo="photoPortrait" url={txt.photoPortrait} label="la photo d’identité" confirm={confirm} />
                </div>
              </div>
              </div>
            </div>

            {/* Verso : la couverture du carnet fermé, avec la photo en pied épinglée dessus ; la toucher l'ouvre */}
            <div
              className="absolute inset-0 shadow-[0_10px_24px_rgba(20,30,60,0.35)] [backface-visibility:hidden]"
              style={{ ...paperGrain, transform: 'rotateY(180deg)' }}
              inert={notebookOpen}
            >
            <button
              type="button"
              onClick={() => setNotebookOpen(true)}
              aria-label="Ouvrir le carnet"
              className="absolute inset-0 flex flex-col items-center justify-center p-3 text-center"
            >
              <span className="absolute inset-2 border-2 border-double" style={{ borderColor: PF.blue }} aria-hidden />
              <span className="text-[8px] uppercase tracking-[0.3em]" style={{ ...serif, color: PF.blue }}>
                {DEMO.year}
              </span>
              <span className="mt-1 text-[40px] leading-none" style={{ ...script, color: PF.blue }}>
                Carnet
              </span>
              <span className="mt-1 text-[9px] italic" style={serif}>
                de {txt.name}
              </span>
              <span className="mt-6 text-[8px] uppercase tracking-[0.25em] opacity-70" style={serif}>
                toucher pour ouvrir
              </span>
            </button>
            {/* Photo en pied, épinglée tout en haut du carnet : bien droite, centrée, son bord du haut sur celui du carnet,
                et le trombone qui passe par-dessus le bord. Cachée carnet ouvert (sinon Safari la laisse voir à travers la page) */}
            <div
              className={`absolute inset-x-[18%] top-0 bg-white p-1.5 pb-5 shadow-[0_8px_18px_rgba(20,30,60,0.35)] [backface-visibility:hidden] transition-[visibility] duration-0 ${notebookOpen ? 'invisible delay-500' : 'visible'}`}
            >
              <PaperClip className="absolute -top-4 left-1/2 -translate-x-1/2" />
              <div className="aspect-[2/3] overflow-hidden">
                <EditablePhoto kind="standing" photo="photoStanding" url={txt.photoStanding} label="la photo en pied" confirm={confirm} />
              </div>
            </div>
            </div>
            </div>

            {/* PAGE DE DROITE : les informations, rubrique par rubrique (cachée sous la couverture quand le carnet est fermé) */}
            <div className="relative px-3 pb-6 pt-2 shadow-[0_10px_24px_rgba(20,30,60,0.35)]" style={paperGrain} inert={!notebookOpen}>
              {/* Ovale bleu pâle derrière le milieu de la page */}
              <div className="pointer-events-none absolute inset-x-2 top-[38%] h-24 rounded-[50%]" style={{ backgroundColor: PF.pale, opacity: 0.35 }} />
              <div className="relative">
                {/* Seulement les titres, une petite explication et le crayon : le détail s'ouvre dans une fenêtre */}
                <NoteSection title="Ma position" n={1} onEdit={() => setEditingSection('position')}>
                  <p className="opacity-75">Ton point de départ, pour te conseiller le magasin le plus proche.</p>
                </NoteSection>
                <NoteSection title="Budgets" n={2} onEdit={() => setPanel('budgets')}>
                  <p className="opacity-75">Tes enveloppes de courses et ce qu&apos;il reste dans chacune.</p>
                </NoteSection>
                <NoteSection title="Objectifs" n={3} onEdit={() => setEditingSection('goals')}>
                  <p className="opacity-75">Ce que tu mets de côté, et pour quoi.</p>
                </NoteSection>
                <NoteSection title="Défis" n={4} onEdit={() => setPanel('defis')}>
                  <p className="opacity-75">Le défi de la semaine, qui te rapporte des points.</p>
                </NoteSection>
                <NoteSection title="Mes coupons" n={5} onEdit={() => setPanel('coupons')}>
                  <p className="opacity-75">Les récompenses gagnées avec tes points, à utiliser quand tu veux.</p>
                </NoteSection>
                <NoteSection title="Mon cycle" n={6} onEdit={() => cycleQuery.data && setCycleOpen(true)}>
                  <p className="opacity-75">Les dates de ton cycle, qui colorent les cartes du jour.</p>
                  {cycleQuery.error && <p className="text-[8.5px] text-brick">{cycleQuery.error}</p>}
                </NoteSection>
                {/* Fermer le carnet, en bas de la page de droite */}
                <p className="mt-5 text-center">
                  <button
                    type="button"
                    onClick={() => setNotebookOpen(false)}
                    className="border px-4 py-1.5 text-[9px] uppercase tracking-[0.25em]"
                    style={{ ...serif, borderColor: PF.blue, color: PF.blue }}
                  >
                    Fermer
                  </button>
                </p>
                <p className="mt-3 text-center text-[8px]" style={serif}>
                  2
                </p>
              </div>
            </div>
          </div>

        </div>
      </div>

      {spotlight && (
        <CardSpotlight
          rect={spotlight.rect}
          label={spotlight.id === 'about' ? 'À propos' : 'Carte de visite'}
          onClose={() => setSpotlight(null)}
        >
          {spotlight.id === 'about' ? aboutCard : visitCard}
        </CardSpotlight>
      )}

      {editingSection && (
        <ProfileTextsEditor key={editingSection} section={editingSection} texts={txt} onClose={() => setEditingSection(null)} />
      )}

      {/* BUDGETS : la liste, chaque budget avec son crayon et sa corbeille, et l'ajout d'un nouveau */}
      {panel === 'budgets' && (
        <PaperModal
          title="Budgets"
          onClose={() => setPanel(null)}
          footer={<PanelButton onClick={() => setBudgetPopup('nouveau')}>Ajouter un budget</PanelButton>}
        >
          <div className="space-y-3 text-sm" style={serif}>
            {budgetsQuery.error && <p className="text-brick">Budgets indisponibles</p>}
            {!budgetsQuery.error && budgets.length === 0 && <p className="opacity-75">{budgetsQuery.data ? 'Aucun budget pour l’instant' : 'Chargement…'}</p>}
            {budgetError && <p className="text-brick">{budgetError}</p>}
            {budgets.map((b) => (
              <div key={b.settings.id} className="flex items-center gap-2 border-b border-dotted pb-2" style={{ borderColor: PF.pale }}>
                <p className="min-w-0 flex-1">
                  {b.settings.name} : reste {euros(b.remaining)}
                  <span className="block text-xs opacity-75">
                    sur {euros(Number(b.settings.amount))} tous les {periodLabel(b.settings)}
                  </span>
                </p>
                <button type="button" onClick={() => setEditingBudget(b)} aria-label={`Modifier le budget ${b.settings.name}`} className="p-2" style={{ color: PF.blue }}>
                  <Pencil size={16} />
                </button>
                <button type="button" onClick={() => removeBudget(b)} aria-label={`Supprimer le budget ${b.settings.name}`} className="p-2 text-brick">
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        </PaperModal>
      )}

      {/* DÉFIS : les points, le défi en cours (qu'on peut retirer) et le lancement d'un nouveau défi */}
      {panel === 'defis' && (
        <PaperModal title="Défis" onClose={() => setPanel(null)} footer={<PanelButton onClick={() => setChallengeFormOpen(true)}>Nouveau défi</PanelButton>}>
          <div className="space-y-3 text-sm" style={serif}>
            <p className="text-xs uppercase tracking-[0.2em] opacity-70">{points.available} points à dépenser</p>
            {challengesQuery.error && <p className="text-brick">{describeChallengeError({ message: challengesQuery.error })}</p>}
            {challengeActions.error && <p className="text-brick">{challengeActions.error}</p>}
            {!challengesQuery.error && !currentChallenge && <p className="opacity-75">{challengesQuery.data ? 'Aucun défi en cours' : 'Chargement…'}</p>}
            {currentChallenge && (
              <div className="flex items-center gap-2">
                <p className="min-w-0 flex-1">
                  {currentChallenge.title}
                  <span className="block text-xs opacity-75">
                    {currentChallenge.points} pts · {durationLabel(currentChallenge.duration_days)} · jusqu&apos;au {shortDate(challengeEnd(currentChallenge))}
                  </span>
                </p>
                <button type="button" onClick={() => challengeActions.remove(currentChallenge)} aria-label={`Retirer le défi ${currentChallenge.title}`} className="p-2 text-brick">
                  <Trash2 size={16} />
                </button>
              </div>
            )}
          </div>
        </PaperModal>
      )}

      {/* COUPONS : ceux gagnés et pas encore utilisés, avec le bouton pour en utiliser un */}
      {panel === 'coupons' && (
        <PaperModal title="Mes coupons" onClose={() => setPanel(null)}>
          <div className="space-y-3 text-sm" style={serif}>
            <p className="text-xs uppercase tracking-[0.2em] opacity-70">Gagnés avec tes points</p>
            {couponError && <p className="text-brick">{couponError}</p>}
            {!rewardsQuery.data && <p className="opacity-75">{rewardsQuery.error ?? 'Chargement…'}</p>}
            {rewardsQuery.data && coupons.length === 0 && <p className="opacity-75">Aucun coupon : arrache-en un sur la page des courses</p>}
            {coupons.map(({ label, items }) => (
              <div key={label} className="flex items-center gap-2 border-b border-dotted pb-2" style={{ borderColor: PF.pale }}>
                <p className="min-w-0 flex-1">
                  {label}
                  {items.length > 1 && <b> ×{items.length}</b>}
                </p>
                <PanelButton onClick={() => redeemCoupon(label, items[0].id)}>Utiliser</PanelButton>
              </div>
            ))}
          </div>
        </PaperModal>
      )}

      {editingBudget && (
        <PaperModal title={`Modifier « ${editingBudget.settings.name} »`} onClose={() => setEditingBudget(null)}>
          <BudgetForm
            initial={editingBudget.settings}
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

// Bouton arrondi des fenêtres du profil (ajouter un budget, nouveau défi, utiliser un coupon)
function PanelButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border px-4 py-1.5 text-xs uppercase tracking-[0.18em]"
      style={{ borderColor: PF.blue, color: PF.blue }}
    >
      {children}
    </button>
  );
}

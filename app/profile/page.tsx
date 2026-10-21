'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronLeft } from 'lucide-react';
import LocationSettings from '@/components/profile/LocationSettings';
import BudgetSettings from '@/components/settings/BudgetSettings';
import { BluePhoto, Doily, Envelope, mono, NoteSection, paperGrain, PaperClip, PF, Ribbon, script, serif, Stamp } from '@/components/profile/ProfileParts';

// Informations d'exemple, pour voir la page une fois remplie (à remplacer par les vraies)
const DEMO = {
  name: 'Nana',
  fullName: 'Ana Moreau',
  year: '2026',
  handle: '@nana.courses',
  email: 'nana.courses@exemple.fr',
  phone: '06 12 34 56 78',
  birth: '12.03.1999',
  address: '12 rue des Lilas, 69003 Lyon',
  role: 'Cheffe des courses & des comptes',
  tastes: ['Cuisine de saison', 'Batch cooking du dimanche', 'Desserts maison', 'Marchés de producteurs'],
  stores: [
    ['Lidl', '0,8 km'],
    ['Carrefour Market', '1,2 km'],
    ['Marché Croix-Rousse', '2,5 km'],
    ['Biocoop', '3,1 km']
  ],
  budget: { amount: '80 €', period: 'par semaine', margin: '10 %', spent: '52,40 €', left: '27,60 €' }
};

// Page Profil, façon portfolio : enveloppe de titre, carte « À propos », puis un carnet ouvert
// (ticket de caisse, photo d'identité et timbre à gauche ; position, budget, magasins, goûts, objectifs et défis à droite).
// Les vrais réglages (position de départ et budget) restent modifiables en bas de page.
export default function ProfilePage() {
  const [editing, setEditing] = useState(false);

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
          <Envelope name={DEMO.name} year={DEMO.year} handle={DEMO.handle} email={DEMO.email} />
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
            </h2>
            <div className="mt-2 space-y-2 text-[10px] leading-snug" style={serif}>
              <p>
                Bonjour, je m&apos;appelle Ana mais tout le monde m&apos;appelle <b style={{ color: PF.blue }}>{DEMO.name}</b>. Je vis à Lyon et je
                tiens ici mes courses, mon budget et mes défis de la semaine.
              </p>
              <p>
                J&apos;aime cuisiner de saison, comparer les prix d&apos;un magasin à l&apos;autre et mettre un peu de côté chaque mois. Mon objectif :
                tenir mes courses sous 80 € par semaine et partir au Japon l&apos;an prochain.
              </p>
              <p>Merci de passer sur mon profil, bonne visite !</p>
            </div>
            <p className="mt-2 text-right text-[9px] tracking-[0.2em]" style={{ ...serif, color: PF.blue }}>
              ( {DEMO.name.toUpperCase()} )
            </p>
          </div>
          {/* Photo en pied, retenue par un trombone */}
          <div className="absolute -top-3 right-0 w-[34%] rotate-2 bg-white p-1.5 pb-5 shadow-[0_8px_18px_rgba(20,30,60,0.35)]">
            <PaperClip className="absolute -top-3 right-5 rotate-12" />
            <div className="aspect-[2/3] overflow-hidden">
              <BluePhoto kind="standing" />
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
                <p className="text-[22px] font-bold leading-none tracking-wider">{DEMO.name.toUpperCase()}</p>
                <p className="mb-1.5">({DEMO.handle})</p>
                <p>NOM&nbsp;&nbsp;&nbsp;{DEMO.fullName.toUpperCase()} ({DEMO.name.toUpperCase()})</p>
                <p>RÔLE&nbsp;&nbsp;{DEMO.role.toUpperCase()}</p>
                <p className="my-1.5 tracking-[0.1em]">--------------------------</p>
                {DEMO.tastes.map((t) => (
                  <p key={t}>{t.toUpperCase()}</p>
                ))}
                <p className="my-1.5 tracking-[0.1em]">--------------------------</p>
                <p className="mb-0.5">MAGASINS :</p>
                {DEMO.stores.map(([s, d]) => (
                  <p key={s} className="flex justify-between gap-1">
                    <span className="truncate">{s.toUpperCase()}</span>
                    <span>{d}</span>
                  </p>
                ))}
                <p className="my-1.5 tracking-[0.1em]">--------------------------</p>
                <p className="flex justify-between">
                  <span>BUDGET / SEMAINE</span>
                  <b>{DEMO.budget.amount}</b>
                </p>
                <p className="flex justify-between">
                  <span>DÉPENSÉ</span>
                  <span>{DEMO.budget.spent}</span>
                </p>
                <p className="flex justify-between">
                  <span>RESTE</span>
                  <span>{DEMO.budget.left}</span>
                </p>
                <p className="mt-2 text-center">MERCI DE VOTRE VISITE</p>
                <p className="text-center">{DEMO.name.toUpperCase()} {DEMO.year}</p>
              </div>

              {/* Photo d'identité */}
              <div className="absolute right-[-5%] top-2 z-20 w-[50%] rotate-2 bg-white p-1 pb-3 shadow-[0_4px_10px_rgba(20,30,60,0.3)]">
                <PaperClip className="absolute -top-3 left-3 -rotate-6" />
                <div className="aspect-[4/5] overflow-hidden">
                  <BluePhoto kind="portrait" />
                </div>
              </div>

              {/* Timbre : carte d'identité */}
              <Stamp className="absolute -left-2 bottom-5 z-20 w-[104%] -rotate-2">
                <p className="text-center text-[6px] uppercase tracking-[0.2em]" style={{ ...serif, color: PF.blue }}>
                  Je m&apos;appelle
                </p>
                <p className="text-center text-[30px] leading-none" style={{ ...script, color: PF.blue }}>
                  {DEMO.name}
                </p>
                <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 text-[7.5px] leading-[1.6]" style={{ ...serif, color: PF.ink }}>
                  {[
                    ['Naissance', DEMO.birth],
                    ['Téléphone', DEMO.phone],
                    ['Email', DEMO.email],
                    ['Instagram', DEMO.handle],
                    ['Adresse', DEMO.address]
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
                  Une bonne liste, c&apos;est déjà la moitié des courses
                </p>
              </Stamp>
            </div>

            {/* PAGE DE DROITE : les informations, rubrique par rubrique */}
            <div className="relative px-3 pb-6 pt-2" style={paperGrain}>
              {/* Ovale bleu pâle derrière le milieu de la page */}
              <div className="pointer-events-none absolute inset-x-2 top-[38%] h-24 rounded-[50%]" style={{ backgroundColor: PF.pale, opacity: 0.35 }} />
              <div className="relative">
                <NoteSection title="Ma position" n={1}>
                  <p>{DEMO.address}</p>
                  <p className="text-[8.5px] opacity-75">Point de départ, pour conseiller le magasin le plus proche</p>
                </NoteSection>
                <NoteSection title="Budget" n={2}>
                  <p className="text-[7px] uppercase tracking-[0.2em] opacity-70">Courses · {DEMO.budget.period}</p>
                  <p>
                    {DEMO.budget.amount}, marge de {DEMO.budget.margin}
                  </p>
                  <p>
                    {DEMO.budget.spent} dépensés, reste {DEMO.budget.left}
                  </p>
                </NoteSection>
                <NoteSection title="Magasins" n={3}>
                  {DEMO.stores.map(([s]) => (
                    <p key={s}>{s}</p>
                  ))}
                </NoteSection>
                <NoteSection title="Goûts" n={4}>
                  {DEMO.tastes.map((t) => (
                    <p key={t}>{t}</p>
                  ))}
                </NoteSection>
                <NoteSection title="Objectifs" n={5}>
                  <p className="text-[7px] uppercase tracking-[0.2em] opacity-70">Épargne · 2026</p>
                  <p>Voyage au Japon : 1 200 € sur 3 000 €</p>
                  <p>Fonds d&apos;urgence : 3 mois de dépenses</p>
                </NoteSection>
                <NoteSection title="Défis" n={6}>
                  <p className="text-[7px] uppercase tracking-[0.2em] opacity-70">Cette semaine</p>
                  <p>Zéro gaspillage au frigo</p>
                  <p>Trois repas végétariens</p>
                </NoteSection>
                <p className="mt-4 text-center text-[8px]" style={serif}>
                  2
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* VRAIS RÉGLAGES : position de départ et budget, repliés */}
        <div className="relative mt-14 px-4 py-3 shadow-[0_6px_14px_rgba(20,30,60,0.25)]" style={paperGrain}>
          <button type="button" onClick={() => setEditing(!editing)} aria-expanded={editing} className="flex w-full items-center justify-between">
            <span className="text-[30px] leading-none" style={{ ...script, color: PF.blue }}>
              Modifier mes informations
            </span>
            <ChevronDown size={18} className={`transition-transform ${editing ? 'rotate-180' : ''}`} style={{ color: PF.blue }} />
          </button>
          {editing && (
            <div className="mt-3">
              <h2 className="title-hand mb-2 text-2xl">Ma position</h2>
              <LocationSettings />
              <h2 className="title-hand mb-2 mt-8 text-2xl">Budget</h2>
              <BudgetSettings />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

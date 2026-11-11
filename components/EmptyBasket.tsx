'use client';

import { useState } from 'react';
import { ListPlus, Power, ReceiptText } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import Modal, { type ModalVariant } from '@/components/Modal';
import NewListComposer from '@/components/NewListComposer';

// Listes non actives proposées à l'activation
type InactiveList = { id: string; name: string; items: { count: number }[] };

// ACTIVATION : une seule liste active à la fois, donc on désactive d'abord les autres.
// La date d'activation est gardée : elle s'affiche sous le code-barres du ticket.
async function activateList(id: string) {
  const { error: offError } = await supabase.from('shopping_lists').update({ is_active: false }).eq('is_active', true);
  if (offError) return offError.message;
  const { error } = await supabase.from('shopping_lists').update({ is_active: true, activated_at: new Date().toISOString() }).eq('id', id);
  return error ? error.message : null;
}

// Panier de courses dessiné (anse, rebord, corps ajouré de fentes arrondies), à la couleur du texte
function Basket({ className }: { className?: string }) {
  // Fentes du corps : trois rangées (deux hautes, une courte en bas), resserrées vers le fond comme le panier
  const rows = [
    { y: 82, h: 30, left: 30, right: 170 },
    { y: 118, h: 26, left: 36, right: 164 },
    { y: 150, h: 10, left: 42, right: 158 }
  ];
  const slots = rows.flatMap((r, ri) => {
    const count = 11;
    const step = (r.right - r.left) / count;
    return Array.from({ length: count }, (_, i) => (
      <rect key={`${ri}-${i}`} x={r.left + i * step + step / 2 - 3.5} y={r.y} width={7} height={r.h} rx={3.5} fill="black" />
    ));
  });
  return (
    <svg viewBox="0 0 200 175" className={className} aria-hidden>
      <defs>
        <mask id="basket-holes">
          <rect width="200" height="175" fill="white" />
          {slots}
        </mask>
      </defs>
      {/* Anse : deux montants penchés réunis par la poignée */}
      <path d="M62 66 L80 12 H120 L138 66" fill="none" stroke="currentColor" strokeWidth="9" strokeLinejoin="round" strokeLinecap="round" />
      <g mask="url(#basket-holes)" fill="currentColor">
        {/* Rebord */}
        <rect x="12" y="62" width="176" height="14" rx="5" />
        {/* Corps, plus étroit au fond */}
        <path d="M22 74 H178 L164 164 Q162 170 156 170 H44 Q38 170 36 164 Z" />
      </g>
    </svg>
  );
}

// Accueil, page des courses, sans liste active : le panier vide à gauche, et à droite
// les boutons pour scanner un reçu, créer une nouvelle liste ou activer une liste existante.
export default function EmptyBasket({
  onScan,
  onChanged,
  variant
}: {
  onScan: () => void;
  // Une liste vient d'être activée : on recharge le ticket
  onChanged: () => void;
  variant: ModalVariant;
}) {
  const [creating, setCreating] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [lists, setLists] = useState<InactiveList[] | null>(null);
  const [error, setError] = useState('');

  async function openChooser() {
    setError('');
    setLists(null);
    setChoosing(true);
    const { data, error } = await supabase
      .from('shopping_lists')
      .select('id, name, items:shopping_list_items(count)')
      .eq('is_active', false)
      .order('created_at', { ascending: false });
    if (error) setError(error.message);
    setLists((data as unknown as InactiveList[]) ?? []);
  }

  async function activate(id: string) {
    setError('');
    const message = await activateList(id);
    if (message) return setError(message);
    setChoosing(false);
    setCreating(false);
    onChanged();
  }

  // Boutons en pilule : le premier (créer) plein vert olive, les deux autres beiges
  const button = 'inline-flex w-full items-center gap-2 whitespace-nowrap rounded-full px-4 py-2.5 text-[14px] font-medium transition-transform active:scale-[0.97]';
  return (
    <div className="rounded-[28px] bg-white p-3 shadow-[0_18px_40px_-24px_rgba(46,58,36,0.45)]">
      <div className="flex items-stretch gap-3">
        {/* Le panier, sur une tuile vert matcha */}
        <div className="flex w-[42%] shrink-0 flex-col justify-between rounded-[22px] bg-gradient-to-br from-[#c9d6a8] to-[#8fa868] p-3 text-[#2e3a24]">
          <p className="text-[12px] italic leading-tight opacity-80">Aucune liste</p>
          <Basket className="mt-1 w-full" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-2">
          <p className="mb-1 text-[20px] font-bold leading-tight tracking-tight">Le panier est vide</p>
          <button type="button" onClick={() => setCreating(true)} className={`${button} bg-[#3a4a2b] text-[#f6f3e8]`}>
            <ListPlus size={17} /> Nouvelle liste
          </button>
          <button type="button" onClick={openChooser} className={`${button} bg-[#ebe3d5]`}>
            <Power size={17} /> Activer une liste
          </button>
          <button type="button" onClick={onScan} className={`${button} bg-[#ebe3d5]`}>
            <ReceiptText size={17} /> Scanner un reçu
          </button>
        </div>
      </div>
      {error && !choosing && <p className="mt-3 text-center text-sm text-brick">{error}</p>}

      {/* Nouvelle liste : aussitôt créée, elle devient la liste active */}
      {creating && <NewListComposer onClose={() => setCreating(false)} onCreated={activate} variant={variant} />}

      {/* Choix de la liste à activer parmi celles qui ne le sont pas */}
      {choosing && (
        <Modal title="Activer une liste" onClose={() => setChoosing(false)} variant={variant}>
          {lists === null ? (
            <p>Chargement...</p>
          ) : lists.length === 0 ? (
            <p className="opacity-70">Aucune liste enregistrée : crées-en une nouvelle.</p>
          ) : (
            <ul className="space-y-2">
              {lists.map((l) => (
                <li key={l.id}>
                  <button
                    type="button"
                    onClick={() => activate(l.id)}
                    className="flex w-full items-center justify-between gap-3 rounded-[18px] bg-white px-4 py-3 text-left shadow-[0_8px_20px_-14px_rgba(46,58,36,0.5)] active:scale-[0.98]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{l.name}</span>
                      <span className="block text-[12px] opacity-60">
                        {l.items[0]?.count ?? 0} article{(l.items[0]?.count ?? 0) > 1 ? 's' : ''}
                      </span>
                    </span>
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#ebe3d5]" aria-hidden>
                      <Power size={15} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {error && <p className="mt-3 text-sm text-brick">{error}</p>}
        </Modal>
      )}
    </div>
  );
}

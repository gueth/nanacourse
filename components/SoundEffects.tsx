'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { playSfx, type Sfx } from '@/lib/sfx';

// BRUITAGES AUTOMATIQUES DE TOUTE L'APPLICATION (monté une seule fois dans la mise en page générale) :
//  - toucher un bouton ou un lien : petit « pop » ;
//  - cocher une case, basculer un interrupteur : « tic » de verre ;
//  - choisir une option : note claire ;
//  - changer de page : souffle léger.
// Un élément peut choisir son bruitage avec data-sfx="success" (ou "off" pour rester muet, lui et ce qu'il contient).
// Les popins jouent elles-mêmes leur son d'ouverture et de fermeture (components/Modal.tsx).

const NAMES = new Set<Sfx>(['tap', 'open', 'close', 'toggle', 'select', 'success', 'error', 'page']);

function soundFor(el: Element): Sfx | null {
  const tagged = el.closest('[data-sfx]');
  if (tagged) {
    const name = tagged.getAttribute('data-sfx') as Sfx;
    return NAMES.has(name) ? name : null;
  }
  const input = el.closest('input');
  if (input) {
    if (input.disabled) return null;
    return input.type === 'checkbox' || input.type === 'radio' ? 'toggle' : null;
  }
  if (el.closest('[role="switch"], [role="checkbox"], [role="radio"], [role="tab"]')) return 'toggle';
  if (el.closest('[role="option"]')) return 'select';
  const control = el.closest('button, a[href], [role="button"], summary, label');
  if (!control || control.matches(':disabled, [aria-disabled="true"]')) return null;
  // Un <label> qui enveloppe une case la fera sonner elle-même (évite le double son)
  if (control.tagName === 'LABEL') return null;
  return 'tap';
}

export function SoundEffects() {
  const pathname = usePathname();
  const first = useRef(true);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!(e.target instanceof Element)) return;
      const sound = soundFor(e.target);
      if (sound) playSfx(sound);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  // Changement de page (pas à l'ouverture de l'application)
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    playSfx('page');
  }, [pathname]);

  return null;
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';

// SUR TÉLÉPHONE, LES LISTES DÉROULANTES S'OUVRENT DANS UN MENU AU STYLE DE L'APPLICATION.
// Le menu natif d'Android / iOS ignore tout le CSS (fond, police, couleurs). Sur écran tactile, on l'empêche
// de s'ouvrir et on affiche à la place un panneau en bas de l'écran, construit à partir des options du <select>
// (groupes compris), aux couleurs et à la police de la liste touchée. Le choix est renvoyé au <select>
// comme un vrai changement : les onChange de React fonctionnent sans rien modifier ailleurs.
// Monté une seule fois (dans la mise en page générale), il s'applique à toutes les listes de l'application.
// Un <select data-native> garde le menu du téléphone.

type Option = { value: string; label: string; disabled: boolean };
type Group = { label: string | null; options: Option[] };
type Picker = {
  select: HTMLSelectElement;
  title: string;
  groups: Group[];
  value: string;
  theme: { color: string; background: string; line: string; font: string };
};

// Libellé de la liste : aria-label, <label> associé, ou étiquette de champ juste avant
function titleOf(select: HTMLSelectElement) {
  const aria = select.getAttribute('aria-label');
  if (aria?.trim()) return aria.trim();
  // <label> associé, sans le texte des options quand la liste est à l'intérieur du label
  const label = select.labels?.[0];
  if (label) {
    const copy = label.cloneNode(true) as HTMLElement;
    copy.querySelectorAll('select').forEach((s) => s.remove());
    const text = copy.textContent?.replace(/\s+/g, ' ').trim();
    if (text) return text;
  }
  const before = select.previousElementSibling;
  if (before?.classList.contains('field-label') && before.textContent?.trim()) return before.textContent.trim();
  return 'Choisir';
}

// Options du <select>, rangées par groupe (<optgroup>), les options hors groupe dans des groupes sans titre
function groupsOf(select: HTMLSelectElement): Group[] {
  const groups: Group[] = [];
  const toOption = (o: HTMLOptionElement): Option => ({ value: o.value, label: o.label || o.text, disabled: o.disabled });
  for (const child of Array.from(select.children)) {
    if (child instanceof HTMLOptGroupElement) {
      groups.push({ label: child.label, options: Array.from(child.children).filter((c): c is HTMLOptionElement => c instanceof HTMLOptionElement && !c.hidden).map(toOption) });
    } else if (child instanceof HTMLOptionElement && !child.hidden) {
      const last = groups[groups.length - 1];
      if (last && last.label === null) last.options.push(toOption(child));
      else groups.push({ label: null, options: [toOption(child)] });
    }
  }
  return groups;
}

// Couleurs et police de la liste touchée (thème de la page : gazette bleue, cuisine, Paramètres, Finances, Profil...)
function themeOf(select: HTMLSelectElement) {
  const cs = getComputedStyle(select);
  const v = (name: string) => cs.getPropertyValue(name).trim();
  const background = select.classList.contains('fin-select') ? '#f8f7f4' : select.classList.contains('pf-select') ? '#f6f5f1' : v('--color-card') || '#fffaf3';
  const line = select.classList.contains('fin-select') ? '#c9d2df' : select.classList.contains('pf-select') ? '#c5d3ea' : v('--color-line') || 'rgba(0,0,0,0.15)';
  return { color: cs.color, background, line, font: cs.fontFamily };
}

// Change la valeur du <select> comme le ferait l'utilisateur, pour que React reçoive l'événement
function choose(select: HTMLSelectElement, value: string) {
  if (select.value === value) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  if (setter) setter.call(select, value);
  else select.value = value;
  select.dispatchEvent(new Event('input', { bubbles: true }));
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

export function MobileSelectPicker() {
  const [picker, setPicker] = useState<Picker | null>(null);
  const openRef = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    openRef.current = false;
    setPicker(null);
  }, []);

  useEffect(() => {
    const touchScreen = window.matchMedia('(pointer: coarse)');
    // Liste concernée par l'événement (null = on laisse faire le navigateur)
    const target = (e: Event) => {
      if (!touchScreen.matches) return null;
      const el = e.target instanceof Element ? e.target.closest('select') : null;
      if (!el || el.disabled || el.multiple || el.hasAttribute('data-native') || el.size > 1) return null;
      return el;
    };
    const open = (select: HTMLSelectElement) => {
      if (openRef.current) return;
      openRef.current = true;
      select.blur();
      setPicker({ select, title: titleOf(select), groups: groupsOf(select), value: select.value, theme: themeOf(select) });
    };

    // Un simple toucher (pas un glissement pour faire défiler la page) ouvre le panneau à la place du menu natif
    let start: { x: number; y: number } | null = null;
    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0];
      start = target(e) && t ? { x: t.clientX, y: t.clientY } : null;
    };
    const onTouchEnd = (e: TouchEvent) => {
      const select = target(e);
      const t = e.changedTouches[0];
      if (!select || !start || !t) return;
      const moved = Math.hypot(t.clientX - start.x, t.clientY - start.y) > 10;
      start = null;
      if (moved) return;
      e.preventDefault(); // empêche le menu natif (et le zoom d'iOS sur le champ)
      open(select);
    };
    // Souris sur écran tactile, ou navigateur qui ouvre le menu au clic
    const onMouseDown = (e: MouseEvent) => {
      const select = target(e);
      if (!select) return;
      e.preventDefault();
      open(select);
    };
    // Filet de sécurité : la liste a pris le focus malgré tout (ex : depuis le clavier du téléphone)
    const onFocusIn = (e: FocusEvent) => {
      const select = target(e);
      if (select) open(select);
    };

    document.addEventListener('touchstart', onTouchStart, { passive: true, capture: true });
    document.addEventListener('touchend', onTouchEnd, { passive: false, capture: true });
    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('focusin', onFocusIn, true);
    return () => {
      document.removeEventListener('touchstart', onTouchStart, true);
      document.removeEventListener('touchend', onTouchEnd, true);
      document.removeEventListener('mousedown', onMouseDown, true);
      document.removeEventListener('focusin', onFocusIn, true);
    };
  }, []);

  // Échap ferme ; à l'ouverture, l'option choisie est amenée dans la partie visible
  useEffect(() => {
    if (!picker) return;
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'center' });
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [picker, close]);

  if (!picker) return null;
  const { theme } = picker;
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40" onClick={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={picker.title}
        className="mobile-picker flex max-h-[70dvh] w-full max-w-md flex-col rounded-t-2xl pb-[env(safe-area-inset-bottom)] shadow-2xl"
        style={{ backgroundColor: theme.background, color: theme.color, fontFamily: theme.font }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3" style={{ borderColor: theme.line }}>
          <p className="min-w-0 truncate text-[17px] font-semibold">{picker.title}</p>
          <button type="button" onClick={close} aria-label="Fermer" className="-mr-2 p-2">
            <X size={20} />
          </button>
        </div>
        <div ref={listRef} role="listbox" aria-label={picker.title} className="overflow-y-auto overscroll-contain py-1">
          {picker.groups.map((g, gi) => (
            <div key={gi} role="group" aria-label={g.label ?? undefined}>
              {g.label && <p className="px-4 pb-1 pt-3 text-[11px] font-bold uppercase tracking-[0.14em] opacity-60">{g.label}</p>}
              {g.options.map((o, oi) => {
                const selected = o.value === picker.value;
                return (
                  <button
                    key={`${oi}-${o.value}`}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    disabled={o.disabled}
                    onClick={() => {
                      choose(picker.select, o.value);
                      close();
                    }}
                    className="flex min-h-12 w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-[16px] disabled:opacity-40"
                    style={selected ? { backgroundColor: theme.line } : undefined}
                  >
                    <span className="min-w-0">{o.label || '—'}</span>
                    {selected && <Check size={18} className="shrink-0" />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

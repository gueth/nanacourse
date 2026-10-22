'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Mail } from 'lucide-react';
import { countUnread, runReminders } from '@/lib/messages';

// Lettre de l'accueil, fixée en bas à droite de l'écran (elle reste visible au défilement) :
// à l'ouverture, nana envoie les rappels dus, puis la pastille affiche le nombre de messages non lus.
// À placer hors de ScaledStage : un parent transformé ferait défiler l'élément "fixed" avec la page.
// Rappels de la session en cours (lancés à la première visite de l'accueil)
let remindersRun: ReturnType<typeof runReminders> | null = null;

export function MessagesButton() {
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // Les rappels ne sont évalués qu'une fois par ouverture de l'appli (plusieurs requêtes et écritures) ;
    // les visites suivantes de l'accueil se contentent de recompter les non lus
    remindersRun ??= runReminders();
    remindersRun
      .then(() => countUnread())
      .then(({ count }) => {
        if (!cancelled) setUnread(count);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Link
      href="/messages"
      aria-label={unread > 0 ? `Messages, ${unread} non lu${unread > 1 ? 's' : ''}` : 'Messages'}
      className="fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full border-2 bg-[#f8f7f4] text-[#4a566b] shadow-[0_2px_4px_rgba(0,0,0,0.18),0_8px_16px_rgba(27,42,74,0.25)] transition-transform active:scale-95"
      style={{ borderColor: '#4a566b' }}
    >
      <Mail size={26} strokeWidth={1.8} />
      {unread > 0 && (
        <span className="absolute -right-1 -top-1 flex h-[20px] min-w-[20px] items-center justify-center rounded-full bg-[#a2525a] px-1 text-[10px] font-bold leading-none text-white ring-2 ring-[#f8f7f4]">
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </Link>
  );
}

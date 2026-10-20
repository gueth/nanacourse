'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, Send } from 'lucide-react';
import { fetchMessages, markAllRead, type Message } from '@/lib/messages';

const NAVY = '#2b3a55';
const SLATE = '#4a566b';
const MIST = '#e8edf4';
const ROSE = '#a2525a';

// Délai entre l'apparition de deux messages non lus, pendant lequel nana "écrit"
const TYPING_MS = 900;

function sameDay(a: Date, b: Date) {
  return a.toDateString() === b.toDateString();
}

// Séparateur de date : "Aujourd'hui", "Hier", ou "lundi 19 octobre"
function dayLabel(d: Date) {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (sameDay(d, today)) return "Aujourd'hui";
  if (sameDay(d, yesterday)) return 'Hier';
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

function timeLabel(d: Date) {
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

// Avatar de nana : initiale calligraphiée dans un rond
function Avatar({ size }: { size: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full text-white"
      style={{ width: size, height: size, backgroundColor: SLATE, fontFamily: 'var(--font-script), cursive', fontSize: size * 0.55 }}
      aria-hidden
    >
      n
    </span>
  );
}

// Les trois points qui rebondissent pendant que nana écrit
function TypingBubble() {
  return (
    <div className="msg-in flex items-end gap-2">
      <Avatar size={28} />
      <div className="flex gap-1 rounded-2xl rounded-bl-md bg-white px-4 py-3 shadow-sm" aria-label="nana écrit…">
        {[0, 1, 2].map((i) => (
          <span key={i} className="typing-dot block h-2 w-2 rounded-full" style={{ backgroundColor: SLATE, animationDelay: `${i * 0.15}s` }} />
        ))}
      </div>
    </div>
  );
}

// Messagerie : la conversation avec nana. Les messages déjà lus sont affichés d'emblée ;
// les non lus apparaissent un par un, comme s'ils arrivaient, sous un séparateur "non lus".
export default function MessagesPage() {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[] | null>(null);
  // Identifiants des messages non lus à l'ouverture de la page (figés, même une fois marqués lus)
  const [unreadIds, setUnreadIds] = useState<Set<string>>(new Set());
  // Nombre de messages non lus déjà apparus
  const [revealed, setRevealed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Ignoré si l'effet est relancé (mode strict) : sinon le premier chargement marquerait
    // tout comme lu avant que le second ne repère les non lus
    let cancelled = false;
    fetchMessages().then(({ messages, error }) => {
      if (cancelled) return;
      if (error) {
        setError(error.message);
        setMessages([]);
        return;
      }
      setUnreadIds(new Set(messages.filter((m) => !m.read_at).map((m) => m.id)));
      setMessages(messages);
      markAllRead();
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const unreadCount = unreadIds.size;
  const typing = messages !== null && revealed < unreadCount;

  // Fait apparaître les non lus l'un après l'autre
  useEffect(() => {
    if (!typing) return;
    const timer = setTimeout(() => setRevealed((n) => n + 1), TYPING_MS);
    return () => clearTimeout(timer);
  }, [typing, revealed]);

  // Reste calé en bas de la conversation à chaque nouveau message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: revealed === 0 ? 'auto' : 'smooth', block: 'end' });
  }, [messages, revealed]);

  const read = messages?.filter((m) => !unreadIds.has(m.id)) ?? [];
  const unread = messages?.filter((m) => unreadIds.has(m.id)) ?? [];
  const shown = [...read, ...unread.slice(0, revealed)];

  return (
    <div className="messages-screen flex h-dvh flex-col" style={{ backgroundColor: MIST, color: NAVY }}>
      {/* EN-TÊTE : retour et nom de nana (sans l'avatar, dont l'initiale se lisait "n nana" à côté du nom) */}
      <header className="flex items-center gap-3 px-3 py-3 text-white shadow-md" style={{ backgroundColor: SLATE }}>
        <button type="button" onClick={() => router.back()} aria-label="Retour" className="-ml-1 p-1">
          <ChevronLeft size={26} />
        </button>
        <div className="leading-tight">
          <p className="text-[28px] leading-none" style={{ fontFamily: 'var(--font-script), cursive' }}>
            nana
          </p>
          <p className="text-[11px] opacity-80">{typing ? 'écrit…' : 'en ligne'}</p>
        </div>
      </header>

      {/* CONVERSATION */}
      <div className="flex-1 overflow-y-auto px-3 py-4">
        {messages === null && <p className="mt-10 text-center text-sm opacity-60">Chargement…</p>}
        {error && (
          <p className="mx-auto mt-10 max-w-[280px] text-center text-sm" style={{ color: ROSE }}>
            Impossible de charger les messages ({error}). La table « messages » existe-t-elle dans Supabase ?
          </p>
        )}
        {messages !== null && !error && messages.length === 0 && (
          <p className="mt-10 text-center text-sm opacity-60">Pas encore de message de nana.</p>
        )}

        <div className="flex flex-col gap-2">
          {shown.map((m, i) => {
            const date = new Date(m.created_at);
            const prev = shown[i - 1];
            const newDay = !prev || !sameDay(new Date(prev.created_at), date);
            const firstUnread = unreadIds.has(m.id) && (!prev || !unreadIds.has(prev.id));
            // Avatar seulement sous le dernier message d'une suite
            const next = shown[i + 1];
            const lastOfGroup = !next || !sameDay(new Date(next.created_at), date) || (unreadIds.has(next.id) && !unreadIds.has(m.id));

            return (
              <div key={m.id} className="flex flex-col gap-2">
                {newDay && (
                  <p className="my-2 self-center rounded-full bg-white/70 px-3 py-1 text-[11px] first-letter:uppercase opacity-80">
                    {dayLabel(date)}
                  </p>
                )}
                {firstUnread && (
                  <div className="my-2 flex items-center gap-2 text-[11px] uppercase tracking-[0.2em]" style={{ color: ROSE }}>
                    <span className="h-px flex-1" style={{ backgroundColor: ROSE }} />
                    {unreadCount} {unreadCount > 1 ? 'messages non lus' : 'message non lu'}
                    <span className="h-px flex-1" style={{ backgroundColor: ROSE }} />
                  </div>
                )}
                <div className={`flex items-end gap-2 ${unreadIds.has(m.id) ? 'msg-in' : ''}`}>
                  {lastOfGroup ? <Avatar size={28} /> : <span className="w-7 shrink-0" />}
                  <div
                    className={`max-w-[78%] rounded-2xl bg-white px-3.5 py-2 shadow-sm ${lastOfGroup ? 'rounded-bl-md' : ''}`}
                  >
                    <p className="whitespace-pre-wrap text-[14px] leading-snug">{m.body}</p>
                    <p className="mt-1 text-right text-[10px] opacity-50">{timeLabel(date)}</p>
                  </div>
                </div>
              </div>
            );
          })}
          {typing && <TypingBubble />}
        </div>
        <div ref={bottomRef} />
      </div>

      {/* BARRE DE SAISIE : décorative pour l'instant, nana ne lit pas encore les réponses */}
      <footer className="flex items-center gap-2 border-t bg-white px-3 py-2" style={{ borderColor: '#c9d2df' }}>
        <input
          disabled
          placeholder="Bientôt, tu pourras répondre à nana…"
          className="flex-1 rounded-full px-4 py-2 text-[13px] placeholder:opacity-60"
          style={{ backgroundColor: MIST }}
        />
        <span className="flex h-9 w-9 items-center justify-center rounded-full text-white opacity-40" style={{ backgroundColor: SLATE }}>
          <Send size={16} />
        </span>
      </footer>
    </div>
  );
}

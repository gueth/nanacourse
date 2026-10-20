import { supabase } from '@/lib/supabase';
import { fetchLines, monthKey } from '@/lib/finance';

// Messagerie de nana : des messages de rappel, envoyés à l'ouverture de l'appli quand une
// règle (plus bas) est remplie, puis lus dans la page /messages comme une conversation.
//
// Table à créer dans Supabase (éditeur SQL) :
//
//   create table messages (
//     id uuid primary key default gen_random_uuid(),
//     sender text not null default 'nana',
//     body text not null,
//     rule_key text unique,          -- identifiant du rappel, pour ne jamais l'envoyer deux fois
//     created_at timestamptz not null default now(),
//     read_at timestamptz            -- null tant que le message n'a pas été lu
//   );
//   create index messages_created_at on messages (created_at);

export type Message = {
  id: string;
  sender: string;
  body: string;
  rule_key: string | null;
  created_at: string;
  read_at: string | null;
};

// Semaine ISO (AAAA-Wss) : un rappel hebdomadaire porte la semaine dans sa clé
function isoWeekKey(d: Date) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

type Reminder = { key: string; body: string };

// Règles de rappel : chacune renvoie le message à envoyer, ou null si rien à dire.
// La clé décide de la fréquence : fixe = une seule fois, avec la semaine = au plus une fois par semaine.
const RULES: ((now: Date) => Promise<Reminder | null>)[] = [
  // Premier message, une seule fois
  async () => ({
    key: 'bienvenue',
    body: "Coucou, c'est nana ! Je t'enverrai ici des petits rappels pour que tu n'oublies rien 🌸"
  }),

  // Bilan de compte du mois pas encore rempli (aucun montant saisi) : un rappel par semaine
  async (now) => {
    const { lines, error } = await fetchLines(monthKey(now));
    if (error) return null;
    const filled = lines.some((l) => l.statement === 'bilan' && l.amount !== 0);
    if (filled) return null;
    return {
      key: `bilan-${monthKey(now)}-${isoWeekKey(now)}`,
      body: "Salut, j'espère que tu vas bien ! C'était juste pour te rappeler que je n'ai pas encore reçu ton bilan de compte de ce mois-ci 🙂"
    };
  }
];

// Évalue les règles et enregistre les nouveaux rappels (ceux déjà envoyés sont ignorés grâce à rule_key)
export async function runReminders() {
  const now = new Date();
  const reminders = (await Promise.all(RULES.map((rule) => rule(now).catch(() => null)))).filter(
    (r): r is Reminder => r !== null
  );
  // Un par un, dans l'ordre des règles : chaque message a ainsi sa propre heure d'envoi
  // et ils s'affichent dans cet ordre dans la conversation
  for (const r of reminders) {
    const { error } = await supabase
      .from('messages')
      .upsert({ rule_key: r.key, body: r.body }, { onConflict: 'rule_key', ignoreDuplicates: true });
    if (error) return { error };
  }
  return { error: null };
}

export async function countUnread() {
  const { count, error } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .is('read_at', null);
  return { count: count ?? 0, error };
}

export async function fetchMessages() {
  const { data, error } = await supabase.from('messages').select('*').order('created_at');
  return { messages: (data as Message[]) ?? [], error };
}

export async function markAllRead() {
  const { error } = await supabase.from('messages').update({ read_at: new Date().toISOString() }).is('read_at', null);
  return { error };
}

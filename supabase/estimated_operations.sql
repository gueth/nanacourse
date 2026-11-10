-- Opérations estimées d'un livret (Livret A, LEP...) pour un mois dont le relevé n'est pas encore arrivé.
-- Tant qu'on n'y touche pas, l'appli les déduit des virements vus sur les autres comptes ; dès qu'on les modifie,
-- la version modifiée est gardée ici (toutes les opérations du compte pour ce mois) et sert au solde estimé.
-- Un relevé importé ensuite pour ce compte et ce mois fait foi : ces lignes ne servent plus.
-- À lancer une fois dans l'éditeur SQL de Supabase ; le script peut être relancé sans risque.
create table if not exists estimated_operations (
  id uuid primary key default gen_random_uuid(),
  account text not null,
  month text not null, -- AAAA-MM
  date date not null,
  label text not null,
  amount numeric not null, -- positif : entrée sur le livret
  created_at timestamptz not null default now()
);
create index if not exists estimated_operations_account_month on estimated_operations (account, month);

-- Accès depuis l'appli (clé publique, rôle "anon"), comme les autres tables
alter table estimated_operations enable row level security;
drop policy if exists "acces appli" on estimated_operations;
create policy "acces appli" on estimated_operations for all to anon, authenticated using (true) with check (true);

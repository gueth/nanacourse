-- Cycle menstruel (Profil > Mon cycle) : colore la page de titre selon la phase du jour.
-- À lancer dans l'éditeur SQL de Supabase ; le script peut être relancé sans risque.

-- Sur la ligne de profil : durée de départ du cycle (utilisée tant qu'aucune moyenne n'est possible)
-- et durée des règles, en jours
alter table profile add column if not exists cycle_start date; -- ancienne saisie unique, reprise ci-dessous
alter table profile add column if not exists cycle_length smallint not null default 28;
alter table profile add column if not exists period_length smallint not null default 5;

alter table profile drop constraint if exists profile_cycle_length_check;
alter table profile add constraint profile_cycle_length_check check (cycle_length between 21 and 40);
alter table profile drop constraint if exists profile_period_length_check;
alter table profile add constraint profile_period_length_check check (period_length between 2 and 10);

-- Historique des débuts de règles : la durée moyenne du cycle est calculée à partir des écarts entre ces dates
create table if not exists cycle_periods (
  id uuid primary key default gen_random_uuid(),
  start_date date not null unique,
  created_at timestamptz not null default now()
);

-- La date déjà saisie dans le profil devient la première de l'historique
insert into cycle_periods (start_date)
select cycle_start from profile where cycle_start is not null
on conflict (start_date) do nothing;

-- Accès depuis l'appli (clé publique, rôle "anon"), comme les autres tables
alter table profile enable row level security;
drop policy if exists "acces appli" on profile;
create policy "acces appli" on profile for all to anon, authenticated using (true) with check (true);

alter table cycle_periods enable row level security;
drop policy if exists "acces appli" on cycle_periods;
create policy "acces appli" on cycle_periods for all to anon, authenticated using (true) with check (true);

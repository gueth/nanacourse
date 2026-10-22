-- Plusieurs budgets de courses (Profil > Budget), chacun avec sa période, et les listes de courses
-- et les reçus scannés rattachés à l'un d'eux. À lancer une fois dans l'éditeur SQL de Supabase ;
-- le script peut être relancé sans risque.

-- Un budget : nom, montant par période, marge si des prix manquent, période (jours, semaines ou mois)
alter table budget_settings add column if not exists name text not null default 'Courses';
alter table budget_settings add column if not exists created_at timestamptz not null default now();
-- Moment où le budget a été recommencé avant la fin de sa période (validation d'une liste qui dépassait
-- le reste) : les dépenses d'avant ne comptent plus dans la nouvelle période
alter table budget_settings add column if not exists restarted_at timestamptz;
-- Unité de période : 'day', 'week' ou 'month' (une ancienne contrainte limitée à 'day' / 'week' est retirée)
alter table budget_settings drop constraint if exists budget_settings_period_unit_check;

-- Rattachement des dépenses (courses validées, reçus) et des listes de courses à un budget,
-- avec le même type que l'identifiant des budgets
do $$
declare id_type text;
begin
  select format_type(atttypid, atttypmod) into id_type
  from pg_attribute where attrelid = 'budget_settings'::regclass and attname = 'id';
  execute format('alter table expenses add column if not exists budget_id %s references budget_settings(id) on delete set null', id_type);
  execute format('alter table shopping_lists add column if not exists budget_id %s references budget_settings(id) on delete set null', id_type);
end $$;

-- Les dépenses et les listes existantes vont dans le premier budget (celui qui existait jusqu'ici)
update expenses set budget_id = (select id from budget_settings order by created_at limit 1) where budget_id is null;
update shopping_lists set budget_id = (select id from budget_settings order by created_at limit 1) where budget_id is null;

-- Répartition du revenu (méthode 40/40/20) : le revenu du mois et le pourcentage de chaque partie
-- (charges, investissement personnel, épargne), modulables. Une seule ligne (id = 1).
create table if not exists income_plan (
  id int primary key default 1 check (id = 1),
  income numeric not null default 0,
  charges_pct numeric not null default 40,
  plaisirs_pct numeric not null default 40,
  epargne_pct numeric not null default 20,
  updated_at timestamptz not null default now()
);

-- Partie du revenu dans laquelle entre chaque budget, et plafond en euros ou en pourcentage de cette partie
alter table budget_settings add column if not exists part text not null default 'charges';
alter table budget_settings add column if not exists amount_mode text not null default 'euros';
alter table budget_settings add column if not exists percent numeric;

-- Accès depuis l'appli (clé publique, rôle "anon"), comme les autres tables
do $$
declare t text;
begin
  foreach t in array array['budget_settings', 'expenses', 'income_plan']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "acces appli" on %I', t);
    execute format('create policy "acces appli" on %I for all to anon, authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- Tables du coach financier (page Finances). À exécuter une fois dans l'éditeur SQL de Supabase.
-- Si la sécurité au niveau des lignes (RLS) est activée sur tes autres tables, ajoute les mêmes règles à celles-ci.

-- Opérations importées depuis les relevés bancaires (CSV / OFX)
create table if not exists bank_transactions (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  label text not null,
  amount numeric not null,              -- négatif pour une dépense
  category text not null,
  account text not null default 'Compte courant',
  import_key text not null unique,      -- empêche d'importer deux fois la même opération
  created_at timestamptz not null default now()
);
create index if not exists bank_transactions_date on bank_transactions (date);

-- Corrections de catégorie mémorisées : "ce commerçant va toujours dans cette catégorie"
create table if not exists category_rules (
  pattern text primary key,
  category text not null
);

-- Limite de dépenses mensuelle par catégorie
create table if not exists budgets (
  category text primary key,
  monthly_limit numeric not null
);

-- Dépenses annuelles à anticiper (assurance, impôts, vacances...)
create table if not exists planned_expenses (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  amount numeric not null,
  due_month int not null check (due_month between 1 and 12),
  created_at timestamptz not null default now()
);

-- Objectifs d'épargne
create table if not exists finance_goals (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  target numeric not null,
  saved numeric not null default 0,
  monthly numeric not null default 0,
  annual_rate numeric not null default 0,
  created_at timestamptz not null default now()
);

-- Crédits et dettes en cours
create table if not exists debts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  principal numeric not null,
  annual_rate numeric not null default 0,
  monthly numeric not null,
  created_at timestamptz not null default now()
);

-- Placements : ce que tu as versé, ce que ça vaut aujourd'hui, les frais et le niveau de risque
create table if not exists investments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null default 'autre',   -- livret, fonds_euros, av_uc, pea, per, scpi, crypto, autre
  invested numeric not null default 0,  -- total des versements (moins les retraits)
  value numeric not null default 0,     -- valeur actuelle
  fees numeric not null default 0,      -- frais annuels (0.008 = 0,8 %)
  expected_rate numeric not null default 0, -- rendement annuel espéré avant frais
  risk int not null default 1 check (risk between 1 and 7), -- échelle de risque européenne (SRI)
  opened_on date,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- Catégories créées par l'utilisateur pour classer ses opérations (en plus des catégories de base)
create table if not exists custom_categories (
  id text primary key,                  -- perso_xxxx
  label text not null,
  kind text not null default 'variable', -- 'variable' (dépense) ou 'income' (entrée)
  section text not null,                -- rubrique du compte de résultat (logement, vie_courante, revenus...)
  created_at timestamptz not null default now()
);

-- Catégories de base que l'utilisateur a supprimées (elles ne sont plus proposées ni utilisées par le classement automatique)
create table if not exists removed_categories (
  id text primary key
);

-- Lignes du bilan et du compte de résultat calculées par l'import des relevés : recalculées aux imports suivants
-- (un montant saisi à la main garde auto = false et n'est jamais modifié par l'import)
alter table finance_lines add column if not exists auto boolean not null default false;

-- Accès depuis l'appli (à garder en fin de fichier, après la création de toutes les tables).
-- Supabase active la sécurité au niveau des lignes (RLS) sur les nouvelles tables :
-- sans règle, toute écriture est refusée ("new row violates row-level security policy").
-- L'appli n'a pas de connexion utilisateur et utilise la clé publique (rôle "anon") : on l'autorise donc
-- à lire et écrire ces tables, comme les autres tables de l'appli. Ce script peut être relancé sans risque.
do $$
declare t text;
begin
  foreach t in array array['bank_transactions', 'category_rules', 'budgets', 'planned_expenses', 'finance_goals', 'debts', 'investments',
                           'custom_categories', 'removed_categories']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "acces appli" on %I', t);
    execute format('create policy "acces appli" on %I for all to anon, authenticated using (true) with check (true)', t);
  end loop;
end $$;

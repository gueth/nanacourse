-- Couleurs des Finances (Paramètres > Finances, voir lib/healthSettings.ts) : les règles qui donnent à un mois sa
-- couleur (rouge, orange, jaune, bleu, vert), et la répartition du revenu propre à chaque couleur.
-- Une seule ligne (id = 1). Sans cette table, l'appli garde les règles et la répartition par défaut.
-- rules : { hemorragieIncome, maladieSavings, maladieOverdraft, olympiqueRate, inflation }
-- repartitions : { "<état>": { "<id de partie>": <pourcentage> } } ; un état absent suit la répartition par défaut.
-- savings : règle de l'épargne, { "exclure": ["aides", …] } : catégories d'entrée écartées de l'épargne
--   (épargne = entrées − ces entrées − charges ; voir lib/savingsRule.ts).
-- À lancer une fois dans l'éditeur SQL de Supabase ; le script peut être relancé sans risque.
create table if not exists finance_health (
  id int primary key default 1,
  rules jsonb not null default '{}'::jsonb,
  repartitions jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Table déjà créée : ajout de la règle de l'épargne
alter table finance_health add column if not exists savings jsonb not null default '{"exclure": ["aides"]}'::jsonb;

alter table finance_health enable row level security;
drop policy if exists "acces appli" on finance_health;
create policy "acces appli" on finance_health for all to anon, authenticated using (true) with check (true);

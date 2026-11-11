-- Répartition du revenu propre à chaque mois passé (Finances > Budget et Finances > Gestion, voir lib/repartition.ts).
-- La répartition par défaut reste dans income_plan ; un mois sans ligne ici la suit.
-- parts : liste JSON de { id, label, hint, pct, targets, savings }.
create table if not exists month_plans (
  month text primary key, -- AAAA-MM
  parts jsonb not null,
  updated_at timestamptz not null default now()
);

alter table month_plans enable row level security;
drop policy if exists "acces appli" on month_plans;
create policy "acces appli" on month_plans for all to anon, authenticated using (true) with check (true);

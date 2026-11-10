-- Défis et bons d'achat. À lancer une fois dans l'éditeur SQL de Supabase ; le script peut être relancé sans risque.
--  - challenges : les défis (un seul « en cours » à la fois, choisi dans Profil > Défis), puis réussis ou échoués
--    (historique dans Paramètres > Défis, d'où on peut les rejouer) ;
--  - rewards : les bons d'achat proposés sur l'accueil (page 2), avec leur coût en points ;
--  - reward_claims : les coupons gagnés. Points disponibles = points des défis réussis − coût des coupons gagnés.
--    Un coupon reste dans Profil > Mes coupons jusqu'à ce qu'on l'utilise (used_at), puis disparaît.
--    Le stock de coupons à gagner est tiré au sort chaque lundi ; slot = sa place dans le stock, gagnable une seule fois.

create table if not exists challenges (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  duration_days int not null default 7 check (duration_days >= 1),
  points int not null default 10 check (points >= 0),
  status text not null default 'active' check (status in ('active', 'success', 'failed')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now()
);
-- Un seul défi en cours à la fois
create unique index if not exists challenges_one_active on challenges (status) where status = 'active';

create table if not exists rewards (
  id uuid primary key default gen_random_uuid(),
  label text not null unique,
  cost int not null check (cost >= 0),
  position int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists reward_claims (
  id uuid primary key default gen_random_uuid(),
  reward_id uuid references rewards(id) on delete set null,
  label text not null, -- gardé même si le bon est retiré de la liste
  cost int not null check (cost >= 0),
  claimed_at timestamptz not null default now()
);
-- Place du coupon dans le stock de la semaine (« AAAA-MM-JJ:n », le lundi), et date d'utilisation
alter table reward_claims add column if not exists slot text;
alter table reward_claims add column if not exists used_at timestamptz;
create unique index if not exists reward_claims_slot on reward_claims (slot) where slot is not null;

-- Bons d'achat de départ (les coûts se changent ici ou dans l'éditeur de table de Supabase)
insert into rewards (label, cost, position) values
  ('Voir un film à la télé', 10, 1),
  ('Regarder 2 épisodes d''une série', 10, 2),
  ('Gagner 5 €', 25, 3),
  ('Commander une pizza', 40, 4),
  ('Manger un burger', 40, 5),
  ('Manger un tacos', 40, 6),
  ('Aller au cinéma', 60, 7),
  ('Gagner 10 €', 50, 8),
  ('Aller à la fête foraine', 80, 9),
  ('Aller au restaurant', 90, 10),
  ('Gagner 20 €', 100, 11)
on conflict (label) do nothing;

-- Accès depuis l'appli (clé publique, rôle "anon"), comme les autres tables
do $$
declare t text;
begin
  foreach t in array array['challenges', 'rewards', 'reward_claims']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "acces appli" on %I', t);
    execute format('create policy "acces appli" on %I for all to anon, authenticated using (true) with check (true)', t);
  end loop;
end $$;

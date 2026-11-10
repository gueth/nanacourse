-- Défis en parallèle, règles réglables et coupons à prix tirés au sort.
-- À lancer dans l'éditeur SQL de Supabase APRÈS supabase/challenges.sql ; le script peut être relancé sans risque.
--
--  - Un défi choisi ou créé apparaît seulement dans Paramètres > Défis, « en cours » : aucun coupon n'est créé pour lui.
--    À la fin de son temps, s'il est réussi, ses points s'ajoutent ; ils servent à prendre les coupons de l'accueil.
--    Les coupons gagnés vont dans Profil > Mes coupons, jusqu'à leur utilisation.
--  - challenge_settings (une seule ligne, réglée dans Paramètres > Défis) :
--      cooldown_days    jours à attendre après la création d'un défi avant d'en créer un autre (3 par défaut) ;
--      max_active       défis en même temps au plus (5) : au-delà, un nouveau défi commence à la fin d'un autre ;
--      abandon_ratio    part du temps à passer avant de pouvoir abandonner (supprimer) un défi commencé (0,5 = la moitié) ;
--      stock_every_days les coupons à gagner de l'accueil changent tous les N jours (3) ;
--      stock_size       nombre de coupons proposés à chaque fois (6).
--  - rewards : les coupons créés dans les paramètres (intitulé + difficulté sur 5). Pas de prix fixe :
--    chaque coupon proposé sur l'accueil reçoit un prix au hasard dans la tranche de sa difficulté
--    (1 : 5-44, 2 : 44-83, 3 : 83-122, 4 : 122-161, 5 : 161-200), donc un même coupon peut coûter un peu plus ou moins.
--  - reward_stock : les coupons proposés sur l'accueil pour la période en cours, tirés parmi les coupons actifs
--    (doublons possibles). Fonction current_reward_stock() : renvoie le stock en cours et le crée s'il n'existe pas encore.
--  - claim_coupon(id) : prend un coupon du stock si les points suffisent (points des défis réussis − coupons déjà pris).
--  Les règles sont vérifiées dans la base (déclencheurs) : l'appli reçoit un message d'erreur lisible si l'une est enfreinte.

-- --- Réglages ---
create table if not exists challenge_settings (
  id boolean primary key default true check (id), -- une seule ligne
  cooldown_days int not null default 3 check (cooldown_days >= 0),
  max_active int not null default 5 check (max_active >= 1),
  abandon_ratio numeric not null default 0.5 check (abandon_ratio between 0 and 1),
  stock_every_days int not null default 3 check (stock_every_days >= 1),
  stock_size int not null default 6 check (stock_size between 1 and 30),
  updated_at timestamptz not null default now()
);
insert into challenge_settings (id) values (true) on conflict (id) do nothing;

-- --- Défis : plusieurs en même temps ---
drop index if exists challenges_one_active;
create index if not exists challenges_active_dates on challenges (started_at) where status = 'active';

-- Fin prévue d'un défi
create or replace function challenge_end(p_start timestamptz, p_days int) returns timestamptz
language sql stable as $$
  select p_start + p_days * interval '1 day'
$$;

-- Nombre maximum de défis en cours en même temps entre p_start et p_end (défis en cours ou à venir)
create or replace function challenge_peak(p_start timestamptz, p_end timestamptz) returns int
language sql stable as $$
  select coalesce(max(n), 0)::int
  from (
    select (
      select count(*) from challenges c
      where c.status = 'active' and c.started_at <= pts.t and challenge_end(c.started_at, c.duration_days) > pts.t
    ) as n
    from (
      select p_start as t
      union
      select c.started_at from challenges c
      where c.status = 'active' and c.started_at > p_start and c.started_at < p_end
    ) pts
  ) x
$$;

-- Premier moment (maintenant ou à la fin d'un défi) où un défi de p_days jours peut commencer sans dépasser max_active
create or replace function challenge_free_start(p_days int) returns timestamptz
language plpgsql stable as $$
declare
  s challenge_settings;
  t timestamptz;
begin
  select * into s from challenge_settings where id;
  for t in
    select now()
    union
    select challenge_end(c.started_at, c.duration_days) from challenges c
    where c.status = 'active' and challenge_end(c.started_at, c.duration_days) > now()
    order by 1
  loop
    if challenge_peak(t, challenge_end(t, p_days)) < s.max_active then
      return t;
    end if;
  end loop;
  return null;
end $$;

-- Date lisible dans les messages (heure de Paris)
create or replace function fr_date(p timestamptz) returns text
language sql stable as $$
  select to_char(p at time zone 'Europe/Paris', 'DD/MM "à" HH24"h"MI')
$$;

-- Règles des défis
create or replace function challenges_rules() returns trigger
language plpgsql as $$
declare
  s challenge_settings;
  last_created timestamptz;
  free_at timestamptz;
  abandon_at timestamptz;
begin
  select * into s from challenge_settings where id;

  if tg_op = 'INSERT' then
    new.status := 'active';
    new.ended_at := null;
    new.created_at := now();
    if new.started_at is null or new.started_at < now() then
      new.started_at := now();
    end if;

    -- Délai entre deux créations de défi
    select max(created_at) into last_created from challenges;
    if last_created is not null and now() < last_created + s.cooldown_days * interval '1 day' then
      raise exception 'Tu pourras créer un nouveau défi le %.', fr_date(last_created + s.cooldown_days * interval '1 day');
    end if;

    -- Nombre de défis en même temps
    if challenge_peak(new.started_at, challenge_end(new.started_at, new.duration_days)) >= s.max_active then
      free_at := challenge_free_start(new.duration_days);
      raise exception 'Déjà % défis en même temps : celui-ci peut commencer le %, à la fin d''un autre défi.', s.max_active, fr_date(free_at);
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.started_at is distinct from old.started_at or new.duration_days <> old.duration_days or new.points <> old.points then
      raise exception 'Un défi ne se modifie plus une fois créé : seul son intitulé peut changer.';
    end if;
    if old.status <> 'active' and new.status <> old.status then
      raise exception 'Ce défi est déjà terminé.';
    end if;
    -- Réussi ou échoué : seulement à la fin de son temps
    if old.status = 'active' and new.status <> 'active' then
      if now() < challenge_end(old.started_at, old.duration_days) then
        raise exception 'Ce défi se termine le % : tu pourras dire alors s''il est réussi.', fr_date(challenge_end(old.started_at, old.duration_days));
      end if;
      new.ended_at := now();
    end if;
    return new;
  end if;

  -- DELETE : abandonner un défi commencé seulement après la part de temps réglée (un défi pas encore commencé se retire)
  if old.status = 'active' and old.started_at <= now() then
    abandon_at := old.started_at + old.duration_days * s.abandon_ratio * interval '1 day';
    if now() < abandon_at then
      raise exception 'Ce défi ne peut être abandonné qu''à partir du %.', fr_date(abandon_at);
    end if;
  end if;
  return old;
end $$;

drop trigger if exists challenges_rules on challenges;
create trigger challenges_rules before insert or update or delete on challenges
for each row execute function challenges_rules();

-- --- Coupons : intitulé et difficulté sur 5 ---
alter table rewards add column if not exists difficulty int;
-- Anciens bons : difficulté déduite de leur ancien prix fixe
update rewards set difficulty = least(5, greatest(1, ceil(coalesce(cost, 5) / 40.0)::int)) where difficulty is null;
alter table rewards alter column difficulty set default 1;
alter table rewards alter column difficulty set not null;
alter table rewards drop constraint if exists rewards_difficulty_check;
alter table rewards add constraint rewards_difficulty_check check (difficulty between 1 and 5);
-- Le prix n'est plus fixe : il est tiré au sort à chaque mise en stock
alter table rewards alter column cost drop not null;
-- Coupon retiré des tirages sans être supprimé
alter table rewards add column if not exists active boolean not null default true;

-- Prix au hasard dans la tranche de la difficulté (de 5 à 200 en tout)
create or replace function coupon_price(p_difficulty int) returns int
language sql volatile as $$
  select (5 + (p_difficulty - 1) * 39 + floor(random() * 40))::int
$$;

-- --- Stock de l'accueil ---
create table if not exists reward_stock (
  id uuid primary key default gen_random_uuid(),
  period_start date not null, -- premier jour de la période (elle dure stock_every_days jours)
  slot int not null,
  reward_id uuid references rewards(id) on delete set null,
  label text not null,
  difficulty int not null check (difficulty between 1 and 5),
  cost int not null check (cost between 5 and 200),
  created_at timestamptz not null default now(),
  unique (period_start, slot)
);

alter table reward_claims add column if not exists stock_id uuid references reward_stock(id) on delete set null;
alter table reward_claims add column if not exists difficulty int;
create unique index if not exists reward_claims_stock on reward_claims (stock_id) where stock_id is not null;

-- Stock en cours (créé au premier appel de la période) : les périodes partent d'un lundi fixe, tous les stock_every_days jours
create or replace function current_reward_stock() returns setof reward_stock
language plpgsql as $$
declare
  s challenge_settings;
  today date := (now() at time zone 'Europe/Paris')::date;
  anchor date := date '2026-01-05';
  p date;
begin
  select * into s from challenge_settings where id;
  p := anchor + ((today - anchor) / s.stock_every_days) * s.stock_every_days;

  perform pg_advisory_xact_lock(hashtext('reward_stock'));
  if not exists (select 1 from reward_stock where period_start = p) then
    insert into reward_stock (period_start, slot, reward_id, label, difficulty, cost)
    select p, g.n - 1, r.id, r.label, r.difficulty, coupon_price(r.difficulty)
    from generate_series(1, s.stock_size) g(n)
    -- « g.n is not null » : un tirage par place (sinon Postgres ne tirerait qu'une fois)
    cross join lateral (select * from rewards where active and g.n is not null order by random() limit 1) r;
  end if;

  return query select * from reward_stock where period_start = p order by cost, slot;
end $$;

-- Prendre un coupon du stock en cours avec ses points
create or replace function claim_coupon(p_stock_id uuid) returns reward_claims
language plpgsql as $$
declare
  st reward_stock;
  available int;
  claim reward_claims;
begin
  perform pg_advisory_xact_lock(hashtext('coupons'));
  select * into st from reward_stock where id = p_stock_id;
  if not found then
    raise exception 'Ce coupon n''existe plus.';
  end if;
  if st.period_start <> (select max(period_start) from reward_stock) then
    raise exception 'Ce coupon n''est plus proposé.';
  end if;
  if exists (select 1 from reward_claims where stock_id = p_stock_id) then
    raise exception 'Ce coupon a déjà été pris.';
  end if;

  available := (select coalesce(sum(points), 0) from challenges where status = 'success')
             - (select coalesce(sum(cost), 0) from reward_claims);
  if available < st.cost then
    raise exception 'Il te manque % points pour ce coupon.', st.cost - available;
  end if;

  insert into reward_claims (reward_id, label, cost, difficulty, stock_id)
  values (st.reward_id, st.label, st.cost, st.difficulty, st.id)
  returning * into claim;
  return claim;
end $$;

-- Accès depuis l'appli (clé publique, rôle "anon"), comme les autres tables
do $$
declare t text;
begin
  foreach t in array array['challenge_settings', 'reward_stock']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "acces appli" on %I', t);
    execute format('create policy "acces appli" on %I for all to anon, authenticated using (true) with check (true)', t);
  end loop;
end $$;

grant execute on function challenge_free_start(int), current_reward_stock(), claim_coupon(uuid) to anon, authenticated;

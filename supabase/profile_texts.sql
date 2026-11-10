-- Textes de la page Profil (à propos, nom, position, objectifs, défis, carte d'identité), modifiables
-- depuis les crayons de chaque rubrique. À lancer une fois dans l'éditeur SQL de Supabase ;
-- le script peut être relancé sans risque.
-- La répartition du revenu et les budgets utilisent les tables de supabase/shopping_budgets.sql.

-- Tous les textes dans une seule colonne JSON de la ligne de profil
alter table profile add column if not exists texts jsonb;

-- Accès depuis l'appli (clé publique, rôle "anon"), comme les autres tables
alter table profile enable row level security;
drop policy if exists "acces appli" on profile;
create policy "acces appli" on profile for all to anon, authenticated using (true) with check (true);

-- Photos du profil (photo en pied et photo d'identité) : stockage public "profile-photos".
-- Leurs adresses sont gardées dans la colonne "texts" ci-dessus.
insert into storage.buckets (id, name, public)
values ('profile-photos', 'profile-photos', true)
on conflict (id) do update set public = true;

drop policy if exists "photos profil lecture" on storage.objects;
create policy "photos profil lecture" on storage.objects for select to anon, authenticated using (bucket_id = 'profile-photos');
drop policy if exists "photos profil ajout" on storage.objects;
create policy "photos profil ajout" on storage.objects for insert to anon, authenticated with check (bucket_id = 'profile-photos');

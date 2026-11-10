-- Stockage des photos de l'appli. À lancer une fois dans l'éditeur SQL de Supabase ;
-- le script peut être relancé sans risque.
--   "ingredient-photos" : photos des ingrédients (adresse dans ingredients.photo_url)
--   "profile-photos"    : photo en pied et photo d'identité du profil (adresses dans profile.texts)

-- Colonne de l'adresse de la photo d'un ingrédient
alter table ingredients add column if not exists photo_url text;

-- Stockages publics : images seulement, 10 Mo au plus par fichier
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('ingredient-photos', 'ingredient-photos', true, 10485760,
   array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif']),
  ('profile-photos', 'profile-photos', true, 10485760,
   array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Accès depuis l'appli (clé publique, rôle "anon"), comme les autres tables :
-- lire, ajouter, remplacer et supprimer les photos de ces deux stockages
drop policy if exists "photos profil lecture" on storage.objects;
drop policy if exists "photos profil ajout" on storage.objects;
drop policy if exists "photos lecture" on storage.objects;
drop policy if exists "photos ajout" on storage.objects;
drop policy if exists "photos modification" on storage.objects;
drop policy if exists "photos suppression" on storage.objects;

create policy "photos lecture" on storage.objects for select to anon, authenticated
  using (bucket_id in ('ingredient-photos', 'profile-photos'));
create policy "photos ajout" on storage.objects for insert to anon, authenticated
  with check (bucket_id in ('ingredient-photos', 'profile-photos'));
create policy "photos modification" on storage.objects for update to anon, authenticated
  using (bucket_id in ('ingredient-photos', 'profile-photos'))
  with check (bucket_id in ('ingredient-photos', 'profile-photos'));
create policy "photos suppression" on storage.objects for delete to anon, authenticated
  using (bucket_id in ('ingredient-photos', 'profile-photos'));

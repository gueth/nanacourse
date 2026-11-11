-- Bannières d'ingrédients : regroupent les variantes d'un même produit (« Œufs » : 12 oeufs, 20 oeufs, 6 œufs plein air...).
-- Ce sont les bannières qui s'affichent dans la popin de création d'une liste ; on y choisit ensuite la variante.
-- La bannière porte la photo et la catégorie : ses ingrédients prennent sa catégorie.
-- On rattache un ingrédient à sa bannière dans Paramètres > Ingrédients.
-- À lancer dans l'éditeur SQL de Supabase ; le script peut être relancé sans risque.

create table if not exists ingredient_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  photo_url text, -- photo de la bannière (affichée à la place de celles de ses variantes)
  created_at timestamptz not null default now()
);
-- Catégorie de la bannière, reprise par tous ses ingrédients
alter table ingredient_groups add column if not exists category_id uuid references categories (id) on delete set null;

-- Bannière de chaque ingrédient (aucune = l'ingrédient s'affiche seul). Supprimer une bannière détache ses ingrédients.
alter table ingredients add column if not exists group_id uuid references ingredient_groups (id) on delete set null;
create index if not exists ingredients_group_id_idx on ingredients (group_id);

-- Accès depuis l'appli (clé publique, rôle "anon"), comme les autres tables
alter table ingredient_groups enable row level security;
drop policy if exists "acces appli" on ingredient_groups;
create policy "acces appli" on ingredient_groups for all to anon, authenticated using (true) with check (true);

-- Bannières de départ, d'après les ingrédients existants (un ingrédient déjà rattaché n'est pas déplacé)
insert into ingredient_groups (name) values
  ('Œufs'), ('Ail'), ('Avocat'), ('Baguette'), ('Banane plantain'), ('Viande hachée'), ('Carotte'), ('Orange'),
  ('Tomate'), ('Sauce tomate'), ('Pomme de terre'), ('Lait'), ('Masque visage'), ('Mangue'), ('Oignon'), ('Pâtes'),
  ('Pain'), ('Poireau'), ('Poivron'), ('Poulet'), ('Porc'), ('Yaourt')
on conflict (name) do nothing;

with seed (group_name, ingredient_id) as (
  values
    ('Œufs', '676c44fd-fcab-4b01-9e55-dfcd68f85212'), -- 12 oeuf
    ('Œufs', 'edb988b6-5d28-4310-baa1-66756d30ca3b'), -- 20 oeuf
    ('Œufs', '2d1b011c-a40a-4aa9-aec4-3b74126cfa8d'), -- 6 œufs plein air
    ('Œufs', '2f670a13-dc1e-42dd-b5bf-5d767f8587d8'), -- Alvéole 12 parole d'éleveur
    ('Ail', '724313e7-7c71-42fd-9af4-db8612102d57'),
    ('Ail', 'cebdfd39-114c-4b4b-8954-51f46ed19e31'),
    ('Avocat', 'cec44dab-c773-4c0c-b574-d88f70b9c4d9'),
    ('Avocat', '42021f19-d96c-4420-8fea-60000c421d8a'),
    ('Avocat', '01ac81ac-6855-4d55-b7d2-255f1fe50643'),
    ('Baguette', '4478b9de-78b5-4d33-a4f8-af0a6642b530'),
    ('Baguette', '7d09bb7a-b068-457d-96de-17fdda8a691a'),
    ('Banane plantain', 'd3485bfa-8cec-47ed-805d-26d083b729ce'),
    ('Banane plantain', '22ce3a7b-661c-4ac8-8302-1d38ffe11962'),
    ('Viande hachée', '780311ea-0999-4435-8334-19540df8bfb7'),
    ('Viande hachée', '21ea2fe4-2a74-40fe-b9f9-797e0ff1273f'),
    ('Viande hachée', '2840d764-62c6-46f3-a974-aea5c3ee746e'),
    ('Carotte', 'c50c6cde-ea08-4e7a-8ca3-302ea7d69d7e'),
    ('Carotte', '104754ed-f62d-447a-9233-4156180166b7'),
    ('Orange', 'e4ffe5bd-76ed-4d94-a61b-aa846ac502d5'),
    ('Orange', '87d9bdc2-9824-444e-bf28-472a7c01e7e6'),
    ('Orange', 'e9114a8b-f8a3-432b-ba98-c00f57d56283'),
    ('Tomate', 'd3476557-5f0d-428b-a3f8-4a1926405414'),
    ('Tomate', 'b63d51a3-bfe9-49ac-9f60-7baba525e0de'),
    ('Tomate', '510788f3-94e9-4fcf-a6c9-58f8a66e3d5f'),
    ('Tomate', '4130dd6a-7921-47ab-9061-2eaf3a4ffa66'),
    ('Tomate', 'a62a6ba8-596b-4132-980a-d3f4983cfaa1'),
    ('Tomate', '2d62fb11-05ef-4e2b-b414-9105e5b1ed13'),
    ('Sauce tomate', '0adcc958-7e5b-4b11-b138-c674e40e6066'),
    ('Sauce tomate', '7d797079-ba41-477a-a087-147504a3d01f'),
    ('Pomme de terre', '016be30f-a50e-4176-90b3-235659998fa2'),
    ('Pomme de terre', '7dc9da55-45c9-4f6c-9cb3-aada23c96f4a'),
    ('Lait', 'a0fbfaa2-cda3-47df-a8fb-1e65ad16f5bf'),
    ('Lait', '056eb54d-a64e-4d38-8984-b79dedeea20a'),
    ('Lait', 'b68bf4ed-d535-40b6-881d-9f3555ae827d'),
    ('Masque visage', '4943f478-83d5-470e-b145-56c6d90ee79b'),
    ('Masque visage', '182bbe11-29ad-4a3b-a43e-39a4c282a0d6'),
    ('Mangue', '4e9ec4a0-a184-44cd-8941-9782a06998dc'),
    ('Mangue', 'c984b01c-f702-425a-ba17-54db40dc3760'),
    ('Oignon', 'c63ea4ef-6786-4475-8cb2-8180ec348ddc'),
    ('Oignon', 'd99efb42-fadf-446c-9b67-7df88c387c79'),
    ('Oignon', 'd494f80d-6cca-47a5-ac2c-5161323e13f7'),
    ('Pâtes', '165000f9-cba9-465d-9758-846ff4a06ff5'),
    ('Pâtes', '90f15b9d-9ce0-46ac-a760-6cb6612dbeb6'),
    ('Pâtes', '9e0ca58e-2b69-434d-870b-6f10603c6732'),
    ('Pâtes', '0a818733-13f8-4fdf-b8f7-f36b1c0b3a11'),
    ('Pâtes', '2c8fa6fd-4e63-4c69-9797-655b9d601f4a'),
    ('Pâtes', 'b7608a28-f262-44a6-92c8-7e6948e74736'),
    ('Pain', '3203d7fa-9b77-4496-a8e6-8808f1373ed9'), -- Pain burger
    ('Pain', 'a28d014d-b641-4e95-a4f9-8ff26f0ba039'), -- Petit pain
    ('Pain', '4cd203cd-da78-423f-9dfa-3ba9c5c9e09b'), -- Tranche de pain nature
    ('Poireau', '8e47e38d-ef45-4e66-9b1e-beca5972ba2a'),
    ('Poireau', '91e75e12-5b32-4900-9b39-83229b73a7ff'),
    ('Poireau', '8b8d18a9-ffff-4f72-8533-db230f9216f7'),
    ('Poivron', '6dc6849b-6f41-4655-8af3-ec06747e9cc7'),
    ('Poivron', '9c79de3b-3426-430f-aba3-6954410d2dfa'),
    ('Poivron', '61c78fc0-3bd4-4489-981d-bf84bad64162'),
    ('Poulet', 'f630cc49-bf86-45fe-a29f-15e12cf56a15'),
    ('Poulet', 'ecee39f1-4ab7-4202-bae2-29b8e7de9a75'),
    ('Porc', '650fd05b-543c-4fe1-93b0-637052aab168'),
    ('Porc', '48761ede-8938-4105-965c-bcd4071b8c45'),
    ('Yaourt', '8d39934b-d389-444a-8295-bb6665f00831'),
    ('Yaourt', '8b648845-4c4c-474b-a57a-874989bc9d3f'),
    ('Yaourt', '26050c2f-ab3e-4a0b-94a6-4ebb5aee9c11')
)
update ingredients i
set group_id = g.id
from seed s
join ingredient_groups g on g.name = s.group_name
where i.id = s.ingredient_id::uuid
  and i.group_id is null;

-- Catégorie de chaque bannière qui n'en a pas encore : la plus fréquente parmi ses ingrédients
update ingredient_groups g
set category_id = (
  select i.category_id from ingredients i
  where i.group_id = g.id and i.category_id is not null
  group by i.category_id
  order by count(*) desc
  limit 1
)
where g.category_id is null;

-- Les ingrédients d'une bannière prennent sa catégorie
update ingredients i
set category_id = g.category_id
from ingredient_groups g
where i.group_id = g.id and g.category_id is not null and i.category_id is distinct from g.category_id;

-- Photo de chaque bannière qui n'en a pas encore : celle de sa première variante qui en a une
update ingredient_groups g
set photo_url = (select i.photo_url from ingredients i where i.group_id = g.id and i.photo_url is not null order by i.name limit 1)
where g.photo_url is null;

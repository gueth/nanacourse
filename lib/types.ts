export type Category = {
  id: string;
  name: string;
  budget_limit: number | null;
};

// Enseigne (ex : Carrefour) : un libellé et une couleur, partagés par tous ses magasins
export type Chain = {
  id: string;
  name: string;
  color: string | null;
};

// Supermarché : une enseigne (facultative), un nom de magasin et une adresse.
// "chain" est l'enseigne jointe à la lecture (voir STORE_SELECT dans lib/stores.ts).
export type Store = {
  id: string;
  name: string;
  chain_id: string | null;
  chain: Chain | null;
  address: string | null;
  // Position du magasin, calculée une fois à partir de son adresse (voir lib/geo.ts)
  latitude?: number | null;
  longitude?: number | null;
};

export type Ingredient = {
  id: string;
  name: string;
  note: string | null;
  photo_url: string | null;
  category_id: string | null;
  type: string | null;
  // Bannière qui regroupe les variantes d'un même produit (voir lib/ingredientGroups.ts) ; aucune = ingrédient seul
  group_id?: string | null;
};

// Bannière d'ingrédients (« Œufs », « Lait »...) : affichée à la place de ses variantes dans la création d'une liste.
// Elle porte la photo et la catégorie ; ses ingrédients prennent sa catégorie.
export type IngredientGroup = {
  id: string;
  name: string;
  photo_url: string | null;
  category_id: string | null;
  category: Category | null; // catégorie jointe à la lecture
};

export type IngredientPrice = {
  id: string;
  ingredient_id: string;
  store_id: string;
  price: number;
  available: boolean;
};

export type IngredientWithRelations = Ingredient & {
  category: Category | null;
  prices: (IngredientPrice & { store: Store })[];
};

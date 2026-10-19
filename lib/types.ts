export type Category = {
  id: string;
  name: string;
  budget_limit: number | null;
};

export type Store = {
  id: string;
  name: string;
  chain: string | null; // enseigne (ex : Carrefour), pour distinguer plusieurs magasins d'une même chaîne
  address: string | null;
  color: string | null;
  // Position du magasin, calculée une fois à partir de son adresse (voir lib/geo.ts)
  latitude?: number | null;
  longitude?: number | null;
};

export type Brand = {
  id: string;
  name: string;
  rating: number | null;
};

export type Ingredient = {
  id: string;
  name: string;
  note: string | null;
  photo_url: string | null;
  category_id: string | null;
  brand_id: string | null;
  type: string | null;
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
  brand: Brand | null;
  prices: (IngredientPrice & { store: Store })[];
};

export type InventoryRow = {
  id: string;
  ingredient_id: string;
  quantity: number;
  low_stock: boolean;
};

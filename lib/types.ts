export type Category = {
  id: string;
  name: string;
  budget_limit: number | null;
};

export type Store = {
  id: string;
  name: string;
  address: string | null;
  color: string | null;
};

export type Ingredient = {
  id: string;
  name: string;
  note: string | null;
  photo_url: string | null;
  category_id: string | null;
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

export type InventoryRow = {
  id: string;
  ingredient_id: string;
  quantity: number;
  low_stock: boolean;
};

// Nom affiché d'un supermarché : "Enseigne — nom du magasin" si l'enseigne est renseignée.
// Exemple : { chain: 'Carrefour', name: 'Bastille' } -> "Carrefour — Bastille"
export function storeLabel(store: { name: string; chain?: string | null }) {
  return store.chain ? `${store.chain} — ${store.name}` : store.name;
}

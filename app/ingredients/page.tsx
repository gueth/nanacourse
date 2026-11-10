import { redirect } from 'next/navigation';

// Les ingrédients (et leurs photos) se gèrent dans Paramètres (onglet Ingrédients) : les anciens liens y mènent
export default function IngredientsPage() {
  redirect('/settings?tab=ingredients');
}

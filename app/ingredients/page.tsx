import { redirect } from 'next/navigation';

// Les ingrédients (et leurs photos) se gèrent depuis le menu de la page des courses : les anciens liens y mènent
export default function IngredientsPage() {
  redirect('/course?gerer=ingredients');
}

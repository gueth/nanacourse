import { redirect } from 'next/navigation';

// La liste de courses (et son optimisation par magasin) s'imprime en ticket de caisse sur l'accueil : les anciens liens y mènent
export default function ShoppingListPage() {
  redirect('/accueil#ticket');
}

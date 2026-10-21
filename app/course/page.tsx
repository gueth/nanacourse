import { redirect } from 'next/navigation';

// L'ancienne page Courses n'existe plus : la liste de courses active s'imprime en ticket de caisse
// sur l'accueil (adresse /accueil#ticket). Les anciens liens y mènent.
export default function CoursePage() {
  redirect('/accueil#ticket');
}

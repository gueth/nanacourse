import { redirect } from 'next/navigation';

// La partie Finances s'ouvre sur le bilan (l'ancienne page Santé a été retirée)
export default function FinancesHome() {
  redirect('/banque/comptes');
}

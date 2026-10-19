'use client';

import LocationSettings from '@/components/profile/LocationSettings';
import BudgetSettings from '@/components/settings/BudgetSettings';

// Page Profil : ta position de départ (pour conseiller un magasin proche) et ton budget
export default function ProfilePage() {
  return (
    <div>
      <h1 className="title-hand text-3xl sm:text-4xl mb-4">Profil</h1>

      <h2 className="title-hand text-2xl sm:text-3xl mb-2">Ma position</h2>
      <LocationSettings />

      <h2 className="title-hand text-2xl sm:text-3xl mt-8 mb-2">Budget</h2>
      <BudgetSettings />
    </div>
  );
}

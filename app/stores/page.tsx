import { redirect } from 'next/navigation';

// Les supermarchés se gèrent dans Paramètres (onglet Supermarchés) : les anciens liens y mènent
export default function StoresPage() {
  redirect('/settings?tab=stores');
}

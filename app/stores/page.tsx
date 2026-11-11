import { redirect } from 'next/navigation';

// Les supermarchés se gèrent depuis le menu de la page des courses : les anciens liens y mènent
export default function StoresPage() {
  redirect('/course?gerer=supermarches');
}

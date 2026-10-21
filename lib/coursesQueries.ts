'use client';

import { must, useCached } from '@/lib/cache';
import { STORE_SELECT } from '@/lib/stores';
import { supabase } from '@/lib/supabase';
import type { Store } from '@/lib/types';

// Données de la partie Courses gardées en mémoire (lib/cache), partagées entre les pages qui en ont besoin :
// chargées une fois, affichées tout de suite aux visites suivantes, puis rafraîchies en arrière-plan.

// Supermarchés, par ordre alphabétique (liste de courses, magasins, paramètres...)
export function useStores() {
  return useCached('courses:magasins', async () => must<Store[]>(await supabase.from('stores').select(STORE_SELECT).order('name')));
}

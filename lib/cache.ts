'use client';

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';

// Mémoire des données chargées depuis Supabase, partagée par toutes les pages tant que l'appli reste ouverte.
// Une page qui revient affiche tout de suite ses dernières données, puis les recharge en arrière-plan :
// plus de « Chargement… » à chaque visite. Chaque donnée est rangée sous une clé (ex : 'courses:listes').
//
// Usage :
//   const { data, error, setData, reload } = useCached('magasins', async () => must(await supabase.from('stores').select('*')));
//   data : undefined tant que rien n'a encore été chargé ; setData : modifie la donnée (et la mémoire) sans recharger.

type State = { data?: unknown; error: string | null };
type Entry = {
  state: State;
  listeners: Set<() => void>;
  pending?: Promise<void>;
  seq: number; // numéro du dernier chargement lancé : seul le plus récent est gardé
  version: number; // augmente à chaque modification locale (setData)
  at: number; // moment de la dernière écriture, pour retrouver la donnée la plus récente d'une famille de clés
};

const EMPTY: State = { error: null };
const store = new Map<string, Entry>();

function entry(key: string) {
  let e = store.get(key);
  if (!e) {
    e = { state: EMPTY, listeners: new Set(), seq: 0, version: 0, at: 0 };
    store.set(key, e);
  }
  return e;
}

function write(e: Entry, state: State) {
  e.state = state;
  e.at = Date.now();
  e.listeners.forEach((l) => l());
}

const errorMessage = (err: unknown) =>
  err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : String(err);

// Résultat d'une requête Supabase ({ data, error }) : renvoie data, ou lève l'erreur (affichée par la page)
export function must<T>({ data, error }: { data: T | null; error: unknown }): T {
  if (error) throw error;
  return data as T;
}

// Même chose pour les fonctions de l'appli qui renvoient { valeur, error } : renvoie la valeur, ou lève l'erreur
export function orThrow<T>(value: T, error: unknown): T {
  if (error) throw error;
  return value;
}

// Lance le chargement d'une clé (un seul à la fois, sauf si "force" : utile juste après une modification)
function load(key: string, fetcher: () => Promise<unknown>, force = false) {
  const e = entry(key);
  if (e.pending && !force) return e.pending;
  const seq = ++e.seq;
  const version = e.version;
  const pending = fetcher()
    .then(
      (data) => {
        // Un chargement plus récent a été lancé, ou la donnée a été modifiée entre-temps sur l'appareil :
        // ce résultat est déjà dépassé, on le laisse de côté
        if (seq !== e.seq || version !== e.version) return;
        write(e, { data, error: null });
      },
      (err) => {
        console.error(err);
        if (seq === e.seq) write(e, { ...e.state, error: errorMessage(err) });
      }
    )
    .finally(() => {
      if (e.pending === pending) e.pending = undefined;
    });
  e.pending = pending;
  return pending;
}

// Modifie une donnée en mémoire (sans recharger) ; sans effet si elle n'a pas encore été chargée
export function setCached<T>(key: string, update: (prev: T) => T) {
  const e = store.get(key);
  if (!e || e.state.data === undefined) return;
  e.version++;
  write(e, { data: update(e.state.data as T), error: e.state.error });
}

// Modifie toutes les données dont la clé commence par "prefix" (ex : toutes les fenêtres d'opérations déjà chargées)
export function setCachedAll<T>(prefix: string, update: (prev: T) => T) {
  for (const key of store.keys()) if (key.startsWith(prefix)) setCached(key, update);
}

// Donnée la plus récemment chargée parmi les clés qui commencent par "prefix" (ex : le mois affiché juste avant)
export function latestCached<T>(prefix: string): T | undefined {
  let best: Entry | undefined;
  for (const [key, e] of store) if (key.startsWith(prefix) && e.state.data !== undefined && (!best || e.at > best.at)) best = e;
  return best?.state.data as T | undefined;
}

// Donnée d'une clé (null : rien à charger pour l'instant), rechargée en arrière-plan à chaque affichage de la page
export function useCached<T>(key: string | null, fetcher: () => Promise<T>) {
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!key) return () => {};
      const e = entry(key);
      e.listeners.add(onChange);
      return () => e.listeners.delete(onChange);
    },
    [key]
  );
  const state = useSyncExternalStore(
    subscribe,
    () => (key ? entry(key).state : EMPTY),
    () => EMPTY
  );

  useEffect(() => {
    if (key) load(key, () => fetcherRef.current());
  }, [key]);

  const setData = useCallback((update: (prev: T) => T) => key && setCached(key, update), [key]);
  const reload = useCallback(() => (key ? load(key, () => fetcherRef.current(), true) : Promise.resolve()), [key]);

  return { data: state.data as T | undefined, error: state.error, setData, reload };
}

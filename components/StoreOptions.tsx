import type { Store } from '@/lib/types';

// Options d'un <select> de magasins, regroupées par enseigne (<optgroup>).
// Les magasins sans enseigne sont listés à la fin, sous « Autres ».
export default function StoreOptions({ stores }: { stores: Store[] }) {
  const byChain = new Map<string, Store[]>();
  const others: Store[] = [];
  for (const s of stores) {
    const chain = s.chain?.trim();
    if (!chain) others.push(s);
    else byChain.set(chain, [...(byChain.get(chain) ?? []), s]);
  }
  const chains = Array.from(byChain.keys()).sort((a, b) => a.localeCompare(b));

  return (
    <>
      {chains.map((chain) => (
        <optgroup key={chain} label={chain}>
          {byChain.get(chain)!.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </optgroup>
      ))}
      {others.length > 0 &&
        (chains.length > 0 ? (
          <optgroup label="Autres">
            {others.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </optgroup>
        ) : (
          others.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))
        ))}
    </>
  );
}

import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';

// Nombre maximum de photos pour un même reçu (un long ticket peut être pris en plusieurs fois)
const MAX_PHOTOS = 4;

// Format de la réponse attendue de Claude : le magasin et les produits achetés sur le reçu
const ReceiptSchema = z.object({
  store_id: z
    .string()
    .nullable()
    .describe('Identifiant du supermarché connu correspondant (liste fournie), ou null si aucun ne correspond'),
  store_chain: z
    .string()
    .nullable()
    .describe('Enseigne du magasin, ex : « Carrefour », « Leclerc », « Lidl », ou null si illisible'),
  store_name: z
    .string()
    .nullable()
    .describe('Nom du magasin SANS l’enseigne : format et/ou ville ou quartier, ex : « Market Le Puy », « Bastille », ou null'),
  store_address: z
    .string()
    .nullable()
    .describe('Adresse postale imprimée sur le reçu (rue, code postal, ville), ou null si absente'),
  items: z.array(
    z.object({
      ingredient_id: z
        .string()
        .nullable()
        .describe("Identifiant de l'ingrédient connu correspondant (liste fournie), ou null si aucun ne correspond"),
      name: z
        .string()
        .describe('Nom court et lisible du produit en français, sans la marque, ex : « Lait demi-écrémé », « Oeufs »'),
      brand_id: z.string().nullable().describe('Identifiant de la marque connue (liste fournie), ou null'),
      brand_name: z.string().nullable().describe('Marque lue sur le reçu (ex : « Président »), ou null si absente'),
      category_id: z.string().nullable().describe('Identifiant de la catégorie connue la plus adaptée (liste fournie), ou null'),
      type: z
        .string()
        .nullable()
        .describe('Unité : pièce, kg, g, litre, paquet, conserve, bouteille (celle de l’ingrédient connu si trouvé)'),
      quantity: z.number().describe("Quantité achetée, dans l'unité de « type » (ex : 2 pour 2 paquets, 0.532 pour 532 g en kg)"),
      unit_price: z.number().nullable().describe('Prix pour une unité de « type », en euros, remises comprises, ou null'),
      confidence: z.enum(['haute', 'moyenne', 'basse']).describe('Confiance dans la lecture de la ligne')
    })
  )
});

export type ReceiptScanResult = z.infer<typeof ReceiptSchema>;
export type ReceiptItem = ReceiptScanResult['items'][number];

const client = new Anthropic();

const INSTRUCTIONS = `Ces photos montrent un reçu (ticket de caisse) de supermarché, éventuellement en plusieurs morceaux.
Extrais les produits achetés pour mettre à jour un stock et des prix.

- Les abréviations des tickets sont fréquentes (« LT DEMI ECR PRES 1L » = lait demi-écrémé Président 1 L) :
  donne un nom court et lisible, sans la marque, et mets la marque à part.
- Pour chaque produit, cherche s'il correspond à un ingrédient connu (même produit, même si le nom diffère un peu).
  Mets alors son identifiant et son unité. Sinon, ingredient_id = null, propose une unité et la catégorie connue la plus adaptée.
- Si la marque correspond à une marque connue, mets son identifiant ; sinon brand_id = null et garde brand_name.
- Quantité : nombre d'articles (« 2 x 1,25 » = 2), ou poids en kg pour la pesée (« 0,532 kg x 2,99 €/kg » = 0.532).
  Si un même produit apparaît sur plusieurs lignes, fais une seule ligne avec la quantité totale.
- Prix unitaire : prix d'une unité. Si une remise s'applique au produit juste au-dessus, déduis-la de son prix.
- Ignore ce qui n'est pas un produit : total, sous-total, TVA, moyens de paiement, fidélité, sacs, consignes, remises globales.
- Si le reçu est pris en plusieurs photos qui se chevauchent, ne compte pas deux fois les mêmes lignes.
- Lis l'en-tête du ticket : enseigne, nom du magasin (sans l'enseigne) et adresse. Cherche ce magasin
  dans les supermarchés connus (même enseigne et même ville ou adresse).
- Mets une confiance « basse » quand la ligne est difficile à lire ou à interpréter.`;

export async function POST(request: Request) {
  const formData = await request.formData();
  const photos = formData.getAll('photos').filter((f): f is File => f instanceof File);

  if (photos.length === 0) {
    return Response.json({ error: 'Aucune photo reçue.' }, { status: 400 });
  }
  if (photos.length > MAX_PHOTOS) {
    return Response.json({ error: `${MAX_PHOTOS} photos au maximum.` }, { status: 400 });
  }

  // Données connues, pour que Claude rattache les lignes aux bons ingrédients, marques, catégories et magasin
  const [ings, brands, cats, stores] = await Promise.all([
    supabase.from('ingredients').select('id, name, type').order('name'),
    supabase.from('brands').select('id, name').order('name'),
    supabase.from('categories').select('id, name').order('name'),
    supabase.from('stores').select('id, name, chain, address').order('name')
  ]);
  const dbError = ings.error ?? brands.error ?? cats.error ?? stores.error;
  if (dbError) {
    console.error(dbError);
    return Response.json({ error: 'Impossible de lire les données connues.' }, { status: 500 });
  }

  const list = (rows: string[]) => rows.join('\n') || '(aucun)';
  const context = [
    'Ingrédients connus (identifiant | nom | unité) :',
    list((ings.data ?? []).map((i) => `${i.id} | ${i.name} | ${i.type ?? '—'}`)),
    '',
    'Marques connues (identifiant | nom) :',
    list((brands.data ?? []).map((b) => `${b.id} | ${b.name}`)),
    '',
    'Catégories connues (identifiant | nom) :',
    list((cats.data ?? []).map((c) => `${c.id} | ${c.name}`)),
    '',
    'Supermarchés connus (identifiant | enseigne | nom | adresse) :',
    list((stores.data ?? []).map((s) => `${s.id} | ${s.chain ?? '—'} | ${s.name} | ${s.address ?? '—'}`))
  ].join('\n');

  const images = await Promise.all(
    photos.map(async (file) => ({
      type: 'image' as const,
      source: {
        type: 'base64' as const,
        media_type: (file.type || 'image/jpeg') as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
        data: Buffer.from(await file.arrayBuffer()).toString('base64')
      }
    }))
  );

  try {
    const response = await client.beta.messages.parse({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      // Si la demande est refusée par un filtre de sécurité, elle est relancée sur le modèle de secours recommandé
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: {
        effort: 'medium',
        format: betaZodOutputFormat(ReceiptSchema)
      },
      messages: [
        {
          role: 'user',
          content: [...images, { type: 'text', text: `${INSTRUCTIONS}\n\n${context}` }]
        }
      ]
    });

    if (response.stop_reason === 'refusal' || !response.parsed_output) {
      return Response.json({ error: "Impossible d'analyser ce reçu." }, { status: 422 });
    }

    // Sécurité : on ignore un identifiant qui ne fait pas partie des données connues
    const known = (rows: { id: string }[] | null) => new Set((rows ?? []).map((r) => r.id));
    const [ingIds, brandIds, catIds, storeIds] = [known(ings.data), known(brands.data), known(cats.data), known(stores.data)];
    const keep = (id: string | null, ids: Set<string>) => (id && ids.has(id) ? id : null);

    const result: ReceiptScanResult = {
      store_id: keep(response.parsed_output.store_id, storeIds),
      store_chain: response.parsed_output.store_chain,
      store_name: response.parsed_output.store_name,
      store_address: response.parsed_output.store_address,
      items: response.parsed_output.items
        .filter((it) => it.quantity > 0)
        .map((it) => ({
          ...it,
          ingredient_id: keep(it.ingredient_id, ingIds),
          brand_id: keep(it.brand_id, brandIds),
          category_id: keep(it.category_id, catIds)
        }))
    };
    return Response.json(result);
  } catch (error) {
    console.error(error);
    // Clé API absente, invalide ou révoquée (ANTHROPIC_API_KEY dans .env.local)
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
      return Response.json({ error: 'Clé API Anthropic refusée : vérifie ANTHROPIC_API_KEY dans .env.local.' }, { status: 502 });
    }
    if (error instanceof Anthropic.RateLimitError) {
      return Response.json({ error: 'Trop de demandes : réessaie dans un instant.' }, { status: 429 });
    }
    if (error instanceof Anthropic.BadRequestError) {
      return Response.json({ error: 'Photos refusées : essaie avec des photos JPEG ou PNG plus petites.' }, { status: 400 });
    }
    return Response.json({ error: "Échec de l'analyse du reçu." }, { status: 500 });
  }
}

import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';

// Nombre maximum de photos analysées en une fois (frigo, placards...)
const MAX_PHOTOS = 6;

// Format de la réponse attendue de Claude : la liste des produits vus sur les photos
const PantrySchema = z.object({
  items: z.array(
    z.object({
      ingredient_id: z
        .string()
        .nullable()
        .describe("Identifiant de l'ingrédient connu correspondant (liste fournie), ou null si aucun ne correspond"),
      name: z.string().describe('Nom court du produit en français, ex : « Lait demi-écrémé », « Oeufs »'),
      quantity: z
        .number()
        .describe("Quantité visible, dans l'unité de « type » (ex : 6 pour 6 oeufs, 1.5 pour 1,5 kg)"),
      type: z
        .string()
        .nullable()
        .describe('Unité : pièce, kg, g, litre, paquet, conserve, bouteille (celle de l’ingrédient connu si trouvé)'),
      confidence: z.enum(['haute', 'moyenne', 'basse']).describe('Confiance dans l’identification et la quantité')
    })
  )
});

export type PantryItem = z.infer<typeof PantrySchema>['items'][number];

const client = new Anthropic();

const INSTRUCTIONS = `Ces photos montrent l'intérieur d'un frigo et/ou de placards de cuisine.
Fais l'inventaire des produits alimentaires visibles, pour mettre à jour un stock.

- Pour chaque produit, cherche s'il correspond à un ingrédient connu (liste ci-dessous) : même produit,
  même si le nom diffère un peu (« oeufs » = « 12 oeuf »). Mets alors son identifiant et son unité.
  Sinon, ingredient_id = null et propose une unité adaptée.
- Compte les unités visibles (bouteilles, pots, paquets, pièces). Pour le vrac (fruits, légumes, viande),
  estime le poids en kg. Un emballage entamé compte pour 1 dans son unité.
- Si un même produit apparaît sur plusieurs photos sous des angles différents, ne le compte qu'une fois.
- N'invente rien de caché : liste seulement ce qu'on voit. Ignore les produits non alimentaires.
- Mets une confiance « basse » quand le produit ou la quantité sont difficiles à lire.

Ingrédients connus (identifiant | nom | unité) :`;

export async function POST(request: Request) {
  const formData = await request.formData();
  const photos = formData.getAll('photos').filter((f): f is File => f instanceof File);

  if (photos.length === 0) {
    return Response.json({ error: 'Aucune photo reçue.' }, { status: 400 });
  }
  if (photos.length > MAX_PHOTOS) {
    return Response.json({ error: `${MAX_PHOTOS} photos au maximum.` }, { status: 400 });
  }

  // Ingrédients connus, pour que Claude rattache les produits vus aux bons ingrédients
  const { data: known, error: dbError } = await supabase.from('ingredients').select('id, name, type').order('name');
  if (dbError) {
    console.error(dbError);
    return Response.json({ error: 'Impossible de lire la liste des ingrédients.' }, { status: 500 });
  }
  const knownIds = new Set((known ?? []).map((i) => i.id));
  const knownList = (known ?? []).map((i) => `${i.id} | ${i.name} | ${i.type ?? '—'}`).join('\n') || '(aucun)';

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
        format: betaZodOutputFormat(PantrySchema)
      },
      messages: [
        {
          role: 'user',
          content: [...images, { type: 'text', text: `${INSTRUCTIONS}\n${knownList}` }]
        }
      ]
    });

    if (response.stop_reason === 'refusal' || !response.parsed_output) {
      return Response.json({ error: "Impossible d'analyser ces photos." }, { status: 422 });
    }

    // Sécurité : on ignore un identifiant qui ne fait pas partie des ingrédients connus
    const items = response.parsed_output.items
      .filter((it) => it.quantity > 0)
      .map((it) => ({ ...it, ingredient_id: it.ingredient_id && knownIds.has(it.ingredient_id) ? it.ingredient_id : null }));

    return Response.json({ items });
  } catch (error) {
    console.error(error);
    if (error instanceof Anthropic.RateLimitError) {
      return Response.json({ error: 'Trop de demandes : réessaie dans un instant.' }, { status: 429 });
    }
    if (error instanceof Anthropic.BadRequestError) {
      return Response.json({ error: 'Photos refusées : essaie avec des photos JPEG ou PNG plus petites.' }, { status: 400 });
    }
    return Response.json({ error: "Échec de l'analyse des photos." }, { status: 500 });
  }
}

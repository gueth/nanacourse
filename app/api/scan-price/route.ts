import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

const ScanResultSchema = z.object({
  name: z.string().describe("Nom du produit tel qu'il apparaît sur l'étiquette, sans la marque si possible"),
  price: z.number().nullable().describe("Prix affiché en euros (nombre décimal), ou null si aucun prix n'est visible"),
});

const client = new Anthropic();

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get('photo');

  if (!(file instanceof File)) {
    return Response.json({ error: 'Aucune photo reçue.' }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer()).toString('base64');
  const mediaType = file.type || 'image/jpeg';

  try {
    const response = await client.messages.parse({
      model: 'claude-opus-5',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif', data: bytes },
            },
            {
              type: 'text',
              text: "Cette photo montre une étiquette de prix en magasin. Extrait le nom du produit et son prix.",
            },
          ],
        },
      ],
      output_config: {
        format: zodOutputFormat(ScanResultSchema),
      },
    });

    if (!response.parsed_output) {
      return Response.json({ error: "Impossible de lire l'étiquette sur cette photo." }, { status: 422 });
    }

    return Response.json(response.parsed_output);
  } catch (error) {
    console.error(error);
    return Response.json({ error: "Échec de l'analyse de la photo." }, { status: 500 });
  }
}

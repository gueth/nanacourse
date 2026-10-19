// Lecture du texte d'une photo, gratuitement et directement dans le navigateur, avec Tesseract.js.
// Au premier usage, le navigateur télécharge le moteur et le dictionnaire français (quelques Mo),
// puis les garde en cache.

// Une ligne de texte lue, avec la hauteur de ses caractères (en pixels) :
// sur une étiquette, le prix principal est écrit plus gros que le reste.
export type OcrLine = { text: string; height: number; confidence: number };

// Côté le plus long de l'image lue : plus grand qu'à l'envoi vers une IA, car Tesseract
// lit mieux les petits caractères (tickets de caisse) quand l'image est grande.
const OCR_MAX_SIDE = 2400;

// Prépare la photo : redimensionnée, en niveaux de gris et plus contrastée (lecture plus fiable)
async function prepare(image: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(image);
  const scale = Math.min(1, OCR_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d')!;
  // Filtre ignoré sans erreur par les navigateurs qui ne le gèrent pas
  ctx.filter = 'grayscale(1) contrast(1.4)';
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas;
}

// Lit une ou plusieurs photos et renvoie toutes leurs lignes, dans l'ordre.
// onProgress reçoit un nombre entre 0 et 1.
export async function readLines(images: Blob[], onProgress?: (p: number) => void): Promise<OcrLine[]> {
  // Import à la demande : la bibliothèque n'est chargée que quand on scanne
  const { createWorker, PSM } = await import('tesseract.js');
  let done = 0;
  const worker = await createWorker('fra', undefined, {
    logger: (m) => {
      if (m.status === 'recognizing text') onProgress?.((done + m.progress) / images.length);
    }
  });
  try {
    // Garde les espaces entre colonnes (nom ... prix) et lit la page comme un seul bloc de texte
    await worker.setParameters({ preserve_interword_spaces: '1', tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
    const lines: OcrLine[] = [];
    for (const image of images) {
      const { data } = await worker.recognize(await prepare(image), {}, { blocks: true });
      for (const block of data.blocks ?? []) {
        for (const paragraph of block.paragraphs) {
          for (const line of paragraph.lines) {
            const text = line.text.replace(/\s+$/, '');
            if (text.trim()) lines.push({ text, height: line.bbox.y1 - line.bbox.y0, confidence: line.confidence });
          }
        }
      }
      done += 1;
    }
    onProgress?.(1);
    return lines;
  } finally {
    await worker.terminate();
  }
}

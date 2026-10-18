// Côté le plus long de l'image envoyée : au-delà, Claude réduit l'image de toute façon
const MAX_SIDE = 1568;

// Réduit la photo et la convertit en JPEG, pour rester sous la limite de taille de l'API
// et éviter les formats non acceptés (ex : HEIC). Renvoie null si le navigateur ne sait pas lire l'image.
export async function toJpeg(file: File): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  } catch (err) {
    console.error(err);
    return null;
  }
}

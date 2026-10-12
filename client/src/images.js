import { t } from './i18n/translate.js';
// Client-side image handling: crop/shrink profile pictures and compress big receipt photos before upload.

export const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const RECEIPT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
export const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;
export const RECEIPTS_PER_PAYMENT = 5;

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return t('{round} KB', { round: Math.round(n / 1024) });
  return t('{toFixed} MB', { toFixed: (n / 1024 / 1024).toFixed(1) });
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(t('That file could not be read as a picture.')));
    };
    img.src = url;
  });
}

const toBlob = (canvas, type, quality) =>
  new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(t('Could not process the picture.')))), type, quality));

/** Centre-crop to a square and scale to `size` px, as a JPEG (also strips camera metadata such as GPS). */
export async function squareAvatar(file, size = 256) {
  if (!AVATAR_TYPES.includes(file.type)) throw new Error(t('Choose a JPEG, PNG or WebP picture.'));
  if (file.size > 15 * 1024 * 1024) throw new Error(t('That picture is too large. Choose one under 15 MB.'));
  const img = await loadImage(file);
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  if (!side) throw new Error(t('That file could not be read as a picture.'));
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; // transparent PNGs get a white background in JPEG
  ctx.fillRect(0, 0, size, size);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
  return toBlob(canvas, 'image/jpeg', 0.86);
}

/**
 * Validate a receipt file; photos over ~1.5 MB are shrunk (max 2200 px) so uploads stay quick.
 * Returns the File/Blob to upload together with the file name to show.
 */
export async function prepareReceipt(file) {
  if (!RECEIPT_TYPES.includes(file.type)) throw new Error(t('“{name}” is not a JPEG, PNG, WebP or PDF file.', { name: file.name }));
  let out = file;
  if (file.type.startsWith('image/') && file.size > 1.5 * 1024 * 1024) {
    try {
      const img = await loadImage(file);
      const scale = Math.min(1, 2200 / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      const smaller = await toBlob(canvas, 'image/jpeg', 0.85);
      if (smaller.size < file.size) out = new File([smaller], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
    } catch {
      /* keep the original if it cannot be re-encoded */
    }
  }
  if (out.size > RECEIPT_MAX_BYTES) throw new Error(t('“{name}” is larger than {formatBytes}.', { name: file.name, formatBytes: formatBytes(RECEIPT_MAX_BYTES) }));
  return out;
}

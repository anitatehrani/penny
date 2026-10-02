/** File-type detection from the actual bytes (never trust the Content-Type or file extension the client sends). */
export function detectType(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  return null;
}

export const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const RECEIPT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
export const AVATAR_MAX_BYTES = 512 * 1024;
export const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;
export const RECEIPTS_PER_PAYMENT = 5;

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };

/** A safe display name for an uploaded file: no paths, no control characters, bounded length, right extension. */
export function cleanFilename(raw, mime) {
  let name = '';
  try {
    name = decodeURIComponent(String(raw ?? ''));
  } catch {
    name = String(raw ?? '');
  }
  name = name
    .split(/[\\/]/)
    .pop()
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '');
  const ext = EXT[mime];
  if (!name) name = 'receipt';
  if (name.length > 120) name = name.slice(0, 120);
  if (ext && !new RegExp(`\\.${ext}$`, 'i').test(name) && !(ext === 'jpg' && /\.jpe?g$/i.test(name))) name = `${name.replace(/\.[A-Za-z0-9]{1,5}$/, '')}.${ext}`;
  return name;
}

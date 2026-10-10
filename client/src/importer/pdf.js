// Reading the words of a PDF, with their positions, in the browser (docs/DESIGN.md section 41). The PDF reader (pdf.js) is loaded only when a PDF
// is chosen. Scripting, scripts in forms and eval are off, nothing is fetched from the network, and the file is not sent anywhere.

import { ImportError } from './errors.js';

export const MAX_PDF_BYTES = 15 * 1024 * 1024;
export const MAX_PDF_PAGES = 60;

/** Load the PDF reader in the browser (a separate file the first time, so people who never import a PDF never download it). */
export async function loadPdfjs() {
  const [lib, worker] = await Promise.all([import('pdfjs-dist/legacy/build/pdf.min.mjs'), import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')]);
  lib.GlobalWorkerOptions.workerSrc = worker.default;
  return lib;
}

/**
 * The positioned words of every page: [{ width, height, items: [{ str, x, y, w, h }] }], y counted from the top.
 * `pdfjs` is the library (loadPdfjs() in the browser, the plain Node build in tests). A wrong or missing password throws an ImportError
 * with code 'password'.
 */
export async function readPdfWords(bytes, { pdfjs, password } = {}) {
  if (!pdfjs) throw new Error('readPdfWords needs the PDF library');
  if (bytes.byteLength > MAX_PDF_BYTES) throw new ImportError('toobig', 'That PDF is larger than 15 MB. Download the CSV or Excel version from your bank instead.');
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes), // a copy: the reader takes ownership of what it is given
    password,
    isEvalSupported: false,
    enableXfa: false,
    disableFontFace: true,
    useSystemFonts: false,
    useWorkerFetch: false,
    isOffscreenCanvasSupported: false,
    stopAtErrors: false,
    verbosity: 0,
  });
  let doc;
  try {
    doc = await task.promise;
  } catch (e) {
    if (e?.name === 'PasswordException') {
      throw new ImportError('password', e.code === 2 ? 'That password is not right.' : 'This PDF is protected with a password.', { wrong: e.code === 2 });
    }
    if (e?.name === 'InvalidPDFException' || e?.name === 'FormatError') throw new ImportError('unreadable', 'That file does not look like a PDF Penny can open.');
    throw new ImportError('unreadable', 'Penny could not open that PDF.');
  }
  try {
    if (doc.numPages > MAX_PDF_PAGES) throw new ImportError('toobig', `That PDF has ${doc.numPages} pages. Penny reads up to ${MAX_PDF_PAGES}: pick a shorter period.`);
    const pages = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const vp = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items = [];
      for (const it of content.items) {
        if (typeof it.str !== 'string' || !it.str.trim()) continue;
        const t = pdfjs.Util.transform(vp.transform, it.transform);
        const size = Math.hypot(t[2], t[3]) || Math.abs(it.height) || 8;
        if (Math.abs(t[1]) > 0.2 * size || Math.abs(t[2]) > 1.2 * size) continue; // sideways text is not a table cell
        items.push({ str: it.str, x: t[4], y: t[5], w: it.width * (vp.scale || 1), h: size });
      }
      pages.push({ width: vp.width, height: vp.height, items });
      page.cleanup();
    }
    return pages;
  } finally {
    doc.destroy();
  }
}

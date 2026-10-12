// Generated and illustrated avatars: small SVGs built from a seed. The same seed always gives the same picture.
// They are produced as SVG text so they can be shown on screen and also turned into the PNG that is uploaded as the profile picture.

/** Tiny seeded random number generator (mulberry32). */
export function rng(seed) {
  let h = 1779033703 ^ String(seed).length;
  for (const ch of String(seed)) {
    h = Math.imul(h ^ ch.charCodeAt(0), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let tt = Math.imul(a ^ (a >>> 15), 1 | a);
    tt = (tt + Math.imul(tt ^ (tt >>> 7), 61 | tt)) ^ tt;
    return ((tt ^ (tt >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, list) => list[Math.floor(r() * list.length)];

const PALETTES = [
  ['#1f3a5f', '#e8b04b', '#f4efe6', '#c8553d'],
  ['#264653', '#2a9d8f', '#e9c46a', '#f4a261'],
  ['#3d348b', '#7678ed', '#f7b801', '#f18701'],
  ['#2b2d42', '#8d99ae', '#edf2f4', '#ef233c'],
  ['#335c67', '#fff3b0', '#e09f3e', '#9e2a2b'],
  ['#0b3954', '#087e8b', '#bfd7ea', '#ff5a5f'],
  ['#5f0f40', '#9a031e', '#fb8b24', '#e36414'],
  ['#1b4332', '#52b788', '#d8f3dc', '#ffb703'],
];

/** Abstract: a background and three overlapping geometric shapes. */
export function generatedSvg(seed, size = 64) {
  const r = rng(`gen:${seed}`);
  const [bg, a, b, c] = pick(r, PALETTES);
  const cols = [a, b, c];
  const shapes = [];
  for (let i = 0; i < 3; i++) {
    const col = cols[(i + Math.floor(r() * 3)) % 3];
    const kind = Math.floor(r() * 4);
    const x = 8 + r() * 48;
    const y = 8 + r() * 48;
    const s = 16 + r() * 30;
    if (kind === 0) shapes.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(s / 2).toFixed(1)}" fill="${col}" opacity="0.92"/>`);
    else if (kind === 1) shapes.push(`<rect x="${(x - s / 2).toFixed(1)}" y="${(y - s / 2).toFixed(1)}" width="${s.toFixed(1)}" height="${s.toFixed(1)}" rx="${(r() * 8).toFixed(1)}" fill="${col}" transform="rotate(${Math.round(r() * 90)} ${x.toFixed(1)} ${y.toFixed(1)})" opacity="0.92"/>`);
    else if (kind === 2) shapes.push(`<path d="M${(x - s / 2).toFixed(1)} ${(y + s / 2).toFixed(1)} A${s.toFixed(1)} ${s.toFixed(1)} 0 0 1 ${(x + s / 2).toFixed(1)} ${(y + s / 2).toFixed(1)} Z" fill="${col}" opacity="0.92"/>`);
    else shapes.push(`<path d="M${x.toFixed(1)} ${(y - s / 2).toFixed(1)} L${(x + s / 2).toFixed(1)} ${(y + s / 2).toFixed(1)} L${(x - s / 2).toFixed(1)} ${(y + s / 2).toFixed(1)} Z" fill="${col}" opacity="0.92"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}" role="img" aria-hidden="true"><rect width="64" height="64" fill="${bg}"/>${shapes.join('')}</svg>`;
}

const SKIN = ['#f6d5bd', '#eab98f', '#d29a6a', '#a8714a', '#7a4a2f', '#563421'];
const HAIR = ['#1c1410', '#3b2a20', '#6b4423', '#a56b3a', '#d9a441', '#8b8b8b', '#b0452a'];
const SHIRT = ['#2a6fc4', '#2f8a45', '#c2335a', '#a35f00', '#5f4bb6', '#363a41', '#0e7490'];
const BG = ['#e3ecfa', '#e2f3e6', '#fbe6ec', '#fbefd9', '#eeeafa', '#e6e7ea', '#d9f0f4'];

function hairBack(style, col) {
  if (style === 'long') return `<path d="M17 36c0-14 6-22 15-22s15 8 15 22v14H40V38H24v12H17z" fill="${col}"/>`;
  if (style === 'bun') return `<circle cx="32" cy="9" r="6.5" fill="${col}"/>`;
  if (style === 'curly') return [14, 22, 32, 42, 50].map((x, i) => `<circle cx="${x}" cy="${i % 2 ? 17 : 19}" r="7.5" fill="${col}"/>`).join('');
  return '';
}
function hairFront(style, col) {
  if (style === 'short') return `<path d="M20 26c0-9 5-14 12-14s12 5 12 14c-4-4-8-6-12-6s-8 2-12 6z" fill="${col}"/>`;
  if (style === 'side') return `<path d="M20 28c0-10 5-15 12-15 7 0 12 5 12 14-6-1-14-3-18-8-1 4-3 7-6 9z" fill="${col}"/>`;
  if (style === 'buzz') return `<path d="M21 25c1-8 5-11 11-11s10 3 11 11c-4-3-7-4-11-4s-7 1-11 4z" fill="${col}" opacity="0.85"/>`;
  if (style === 'long') return `<path d="M20 28c0-9 5-14 12-14s12 5 12 14c-5-3-9-6-12-8-3 3-7 6-12 8z" fill="${col}"/>`;
  if (style === 'bun') return `<path d="M20 27c0-9 5-13 12-13s12 4 12 13c-4-3-8-5-12-5s-8 2-12 5z" fill="${col}"/>`;
  if (style === 'curly') return `<path d="M21 26c2-6 6-8 11-8s9 2 11 8c-4-2-7-3-11-3s-7 1-11 3z" fill="${col}"/>`;
  return '';
}

/** A friendly flat face: head, hair, eyes, mouth, shoulders. Optional glasses. */
export function illustratedSvg(seed, size = 64) {
  const r = rng(`ill:${seed}`);
  const skin = pick(r, SKIN);
  const hair = pick(r, HAIR);
  const shirt = pick(r, SHIRT);
  const bg = pick(r, BG);
  const style = pick(r, ['short', 'side', 'buzz', 'long', 'bun', 'curly']);
  const glasses = r() < 0.3;
  const smile = pick(r, ['M26 40q6 5 12 0', 'M27 40q5 3.5 10 0', 'M26 39.5q6 6.5 12 0']);
  const brow = r() < 0.5;
  const dark = skin === '#563421' || skin === '#7a4a2f';
  const eyeCol = '#1c1410';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}" role="img" aria-hidden="true">
<rect width="64" height="64" fill="${bg}"/>
${hairBack(style, hair)}
<path d="M8 64c0-11 9-17 24-17s24 6 24 17z" fill="${shirt}"/>
<rect x="28" y="42" width="8" height="8" rx="3" fill="${skin}"/>
<ellipse cx="32" cy="32" rx="12" ry="13.5" fill="${skin}"/>
<ellipse cx="20" cy="33" rx="2.2" ry="3" fill="${skin}"/><ellipse cx="44" cy="33" rx="2.2" ry="3" fill="${skin}"/>
${hairFront(style, hair)}
<circle cx="27" cy="33" r="1.7" fill="${eyeCol}"/><circle cx="37" cy="33" r="1.7" fill="${eyeCol}"/>
${brow ? `<path d="M24 29.5q3-2 6 0M34 29.5q3-2 6 0" stroke="${hair}" stroke-width="1.4" fill="none" stroke-linecap="round"/>` : ''}
${glasses ? `<g fill="none" stroke="${dark ? '#f1f1ec' : '#2b2d42'}" stroke-width="1.3"><circle cx="27" cy="33" r="4.4"/><circle cx="37" cy="33" r="4.4"/><path d="M31.4 33h1.2"/></g>` : ''}
<path d="${smile}" stroke="${dark ? '#f1d3c0' : '#7a3b2e'}" stroke-width="1.5" fill="none" stroke-linecap="round"/>
</svg>`;
}

/** Turn SVG text into a PNG file (so it can be uploaded like any other profile picture). */
export function svgToPng(svg, px = 256) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = px;
      canvas.getContext('2d').drawImage(img, 0, 0, px, px);
      URL.revokeObjectURL(url);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not create the picture.'))), 'image/png');
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not create the picture.'));
    };
    img.src = url;
  });
}

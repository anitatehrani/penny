// Finds every sentence the app passes to the translator (t, tn, tRich, N_), by reading the source. Used by the tests that keep the dictionaries complete.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

export const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../src');

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'i18n') yield* walk(p);
    } else if (/\.(jsx?|mjs)$/.test(e.name)) yield p;
  }
}

/** The sentences a node can be: a string, a template without pieces, or a choice between them. null when it is not made of fixed text. */
function literals(node) {
  if (!node) return null;
  if (node.type === 'StringLiteral') return [node.value];
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) return [node.quasis[0].value.cooked];
  if (node.type === 'ConditionalExpression') {
    const a = literals(node.consequent);
    const b = literals(node.alternate);
    return a && b ? [...a, ...b] : null;
  }
  if (node.type === 'LogicalExpression') {
    const l = literals(node.left);
    const r = literals(node.right);
    return l && r ? [...l, ...r] : null;
  }
  return null;
}

/**
 * @returns {{ keys: Map<string, { plural: boolean, one?: string, where: string[] }>, dynamic: string[] }}
 *   keys: every sentence (for tn, the plural form with its singular); dynamic: the calls whose sentence is not fixed text (a label kept in a constant).
 */
export function extractKeys(root = SRC) {
  const keys = new Map();
  const dynamic = [];
  const add = (text, where, extra = {}) => {
    const e = keys.get(text) ?? { plural: false, where: [] };
    e.where.push(where);
    Object.assign(e, extra);
    keys.set(text, e);
  };
  for (const file of walk(root)) {
    const src = fs.readFileSync(file, 'utf8');
    let ast;
    try {
      ast = parser.parse(src, { sourceType: 'module', plugins: ['jsx'] });
    } catch {
      continue;
    }
    const short = path.relative(root, file).replace(/\\/g, '/');
    traverse(ast, {
      CallExpression(p) {
        const c = p.node.callee;
        if (c.type !== 'Identifier') return;
        const where = `${short}:${p.node.loc.start.line}`;
        if (c.name === 't' || c.name === 'tRich' || c.name === 'N_') {
          const lit = literals(p.node.arguments[0]);
          if (lit) lit.forEach((s) => add(s, where));
          else if (c.name !== 'N_') dynamic.push(where);
        } else if (c.name === 'tn') {
          const one = literals(p.node.arguments[1]);
          const other = literals(p.node.arguments[2]);
          if (one && other && one.length === other.length) other.forEach((s, i) => add(s, where, { plural: true, one: one[i] }));
          else dynamic.push(where);
        }
      },
    });
  }
  return { keys, dynamic };
}

/** The {names} in a sentence. */
export const placeholders = (s) => new Set([...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]));

// IRONHAVEN v6 — the entry program for the make.fun gta6-01 kit.
//
// Run it from the repository root with Node 22+:
//   MAKEFUN_OUTPUT_DIR=/tmp/out1 node main.ts
//
// It stages this entry (game/ and screenshots/) into the output directory
// and writes dossier.json there, so the file the scorer rebuilds from the
// same game/ and screenshots/ matches byte for byte. The staging copy is
// deterministic (file bytes and paths only), so two runs into two fresh
// directories produce identical dossier bytes.
//
// The dossier format (makefun/dossier/v1) is implemented here from the
// kit's contract: a "## Game" block (source / vendored / asset counts and
// totals), then "## Sources" — index.html first, then the source scripts in
// the order the page loads them (a module script followed by a depth-first
// walk of its static imports), then every other source file by path, each
// under a heading naming its path, lines and bytes, its text in a fence.
// The text holds at most caps.text_max_bytes UTF-8 bytes; the first source
// that does not fit whole goes in up to its last complete line that fits,
// and a last line names what was left out. Screenshots ride along as
// base64 with their sha256, the first by name the cover.
import { createHash } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DOSSIER_SCHEMA = 'makefun/dossier/v1';
const DOSSIER_MAX_BYTES = 4 * 1024 * 1024;
const DOSSIER_MAX_IMAGES = 8;
const INDEX_HTML_MAX_BYTES = 1024 * 1024;
const GAME_PATH_MAX_BYTES = 1000;
const VENDORED_LISTED = 24;
const SOURCE_EXTENSIONS = ['html', 'js', 'mjs', 'css', 'glsl', 'vert', 'frag', 'wgsl', 'json'];
const SOURCE_NAME = new RegExp(`\\.(${SOURCE_EXTENSIONS.join('|')})$`, 'i');
const GENERATED_NAME = /\.min\.(?:js|mjs|css)$/i;
const MODULE_NAME = /\.(?:js|mjs)$/i;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

class DossierError extends Error {
  limit: string | null;
  constructor(message: string, limit: string | null = null) {
    super(message);
    this.name = 'DossierError';
    this.limit = limit;
  }
}

type GameFileClass = 'source' | 'vendored' | 'asset';
interface GameFile { path: string; bytes: number; cls: GameFileClass; }
interface GameTree { files: GameFile[]; directories: string[]; count: number; totalBytes: number; }
interface GameCaps { game_max_files?: number; game_max_bytes?: number; game_path_max_bytes?: number; }
interface DossierCaps {
  text_max_bytes: number;
  screenshots?: { max: number; max_bytes: number };
  game_max_files?: number;
  game_max_bytes?: number;
  game_path_max_bytes?: number;
}

// ---------------------------------------------------------------- bytes

const utf8 = new TextDecoder('utf-8');
const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const sha256Hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const byteLength = (s: string): number => Buffer.byteLength(s, 'utf8');
const textOf = (bytes: Uint8Array): string => utf8.decode(bytes);

function lineCount(bytes: Uint8Array): number {
  if (bytes.length === 0) return 0;
  let n = 0;
  for (const b of bytes) if (b === 0x0a) n++;
  return bytes[bytes.length - 1] === 0x0a ? n : n + 1;
}

function fenceFor(body: string): string {
  let longest = 0;
  for (const run of body.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  return '`'.repeat(Math.max(3, longest + 1));
}

function languageOf(path: string): string {
  const ext = /\.([A-Za-z0-9]+)$/.exec(path)?.[1]?.toLowerCase() ?? '';
  if (ext === 'mjs' || ext === 'js') return 'js';
  if (ext === 'glsl' || ext === 'vert' || ext === 'frag') return 'glsl';
  if (ext === 'wgsl') return 'wgsl';
  if (ext === 'html') return 'html';
  if (ext === 'css') return 'css';
  if (ext === 'json') return 'json';
  return 'text';
}

// ---------------------------------------------------------------- the game tree

function classifyGamePath(path: string): GameFileClass {
  const segs = path.split('/');
  const base = segs[segs.length - 1] ?? '';
  const dirs = segs.slice(0, -1);
  if (dirs.includes('vendor') || GENERATED_NAME.test(base)) return 'vendored';
  return SOURCE_NAME.test(base) ? 'source' : 'asset';
}

function readGameTree(gameDir: string, caps: GameCaps = {}): GameTree {
  const maxFiles = caps.game_max_files ?? Infinity;
  const maxBytes = caps.game_max_bytes ?? Infinity;
  const maxPath = caps.game_path_max_bytes ?? GAME_PATH_MAX_BYTES;
  let root;
  try {
    root = lstatSync(gameDir);
  } catch {
    throw new DossierError('game/: no such directory: a game is a directory of static files, its index.html at its root');
  }
  if (!root.isDirectory()) throw new DossierError('game/: not a directory (a game is a directory of static files)');
  const files: GameFile[] = [];
  const directories: string[] = [];
  let count = 0;
  let totalBytes = 0;
  const walk = (rel: string): void => {
    let entries;
    try {
      entries = readdirSync(rel === '' ? gameDir : join(gameDir, rel), { withFileTypes: true });
    } catch (err) {
      throw new DossierError(`game/${rel === '' ? '' : `${rel}/`}: cannot be read (${(err as Error).message})`);
    }
    for (const e of entries) {
      const path = rel === '' ? e.name : `${rel}/${e.name}`;
      const pathBytes = byteLength(path);
      if (pathBytes > maxPath) {
        throw new DossierError(`game/${path}: a path of ${pathBytes} bytes, over the ${maxPath} allowed (game_path_max_bytes)`, 'game_path_max_bytes');
      }
      let st;
      try {
        st = lstatSync(join(gameDir, path));
      } catch {
        throw new DossierError(`game/${path}: cannot be read`);
      }
      count++;
      if (count > maxFiles) {
        throw new DossierError(`game/: holds more than the ${maxFiles} files and directories allowed (game_max_files)`, 'game_max_files');
      }
      if (st.isDirectory()) {
        directories.push(path);
        walk(path);
      } else if (st.isFile()) {
        totalBytes += st.size;
        if (totalBytes > maxBytes) {
          throw new DossierError(`game/: its files come to more than the ${maxBytes} bytes allowed (game_max_bytes)`, 'game_max_bytes');
        }
        files.push({ path, bytes: st.size, cls: classifyGamePath(path) });
      } else {
        throw new DossierError(`game/${path}: a symbolic link or special file (game/ holds plain files and directories only)`);
      }
    }
  };
  walk('');
  files.sort((a, b) => byCodeUnit(a.path, b.path));
  directories.sort(byCodeUnit);
  return { files, directories, count, totalBytes };
}

function readIndexHtml(gameDir: string, tree: GameTree): Uint8Array {
  const file = tree.files.find((f) => f.path === 'index.html');
  if (file === undefined) {
    if (tree.directories.includes('index.html')) throw new DossierError('buildDossier: game/index.html: a directory, not the page');
    throw new DossierError('buildDossier: game/index.html: no such file: a game is a directory of static files, its index.html at its root');
  }
  if (file.bytes > INDEX_HTML_MAX_BYTES) throw new DossierError(`buildDossier: game/index.html: ${file.bytes} bytes, over the ${INDEX_HTML_MAX_BYTES} a page may be`);
  try {
    return new Uint8Array(readFileSync(join(gameDir, 'index.html')));
  } catch (err) {
    throw new DossierError(`buildDossier: game/index.html: cannot be read (${(err as Error).message})`);
  }
}

// ---------------------------------------------------------------- the page

interface HtmlScript { src: string | null; type: string; text: string; }
interface HtmlLink { href: string; rel: string; }
interface HtmlResource { tag: string; src: string; }
interface HtmlImportMap { value: unknown; error: string | null; }
interface HtmlFacts { scripts: HtmlScript[]; links: HtmlLink[]; resources: HtmlResource[]; importMaps: HtmlImportMap[]; }

const RESOURCE_TAGS = ['img', 'source', 'video', 'audio', 'iframe'] as const;

function tagEnd(html: string, from: number): number {
  let quote = '';
  for (let i = from; i < html.length; i++) {
    const ch = html[i]!;
    if (quote !== '') {
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '>') return i;
  }
  return -1;
}

function attributesOf(body: string): Map<string, string> {
  const out = new Map<string, string>();
  let i = 0;
  while (i < body.length) {
    while (i < body.length && /[\s/]/.test(body[i]!)) i++;
    if (i >= body.length) break;
    const start = i;
    while (i < body.length && !/[\s=/>]/.test(body[i]!)) i++;
    const name = body.slice(start, i).toLowerCase();
    while (i < body.length && /\s/.test(body[i]!)) i++;
    let value = '';
    if (body[i] === '=') {
      i++;
      while (i < body.length && /\s/.test(body[i]!)) i++;
      const quote = body[i];
      if (quote === '"' || quote === "'") {
        const end = body.indexOf(quote, i + 1);
        value = body.slice(i + 1, end < 0 ? body.length : end);
        i = end < 0 ? body.length : end + 1;
      } else {
        const s = i;
        while (i < body.length && !/[\s>]/.test(body[i]!)) i++;
        value = body.slice(s, i);
      }
    }
    if (name !== '') out.set(name, value);
  }
  return out;
}

function closeIndexOf(html: string, from: number, name: string): number {
  const needle = `</${name}`;
  for (let i = from; i + needle.length <= html.length; i++) {
    if (html[i] !== '<') continue;
    let hit = true;
    for (let j = 1; j < needle.length; j++) {
      if (html[i + j]!.toLowerCase() !== needle[j]) { hit = false; break; }
    }
    if (hit) return i;
  }
  return -1;
}

// A tag scan, not an HTML parser: it reads the attributes the dossier
// cares about (script src/type, link href/rel, resource src, import maps)
// and nothing else. Comments and the document type are skipped.
function htmlFacts(html: string): HtmlFacts {
  const scripts: HtmlScript[] = [];
  const links: HtmlLink[] = [];
  const resources: HtmlResource[] = [];
  const importMaps: HtmlImportMap[] = [];
  let i = 0;
  while (i < html.length) {
    const at = html.indexOf('<', i);
    if (at < 0) break;
    if (html.startsWith('<!--', at)) {
      const end = html.indexOf('-->', at + 4);
      i = end < 0 ? html.length : end + 3;
      continue;
    }
    if (html.startsWith('<!', at)) {
      const end = html.indexOf('>', at + 2);
      i = end < 0 ? html.length : end + 1;
      continue;
    }
    const rest = html.slice(at + 1, at + 8).toLowerCase();
    if (rest.startsWith('script') && !/[A-Za-z0-9]/.test(html[at + 7] ?? '')) {
      const end = tagEnd(html, at + 7);
      if (end < 0) break;
      const attrs = attributesOf(html.slice(at + 7, end));
      const type = (attrs.get('type') ?? '').trim().toLowerCase();
      const src = attrs.get('src') ?? null;
      let body = '';
      if (src === null) {
        const close = closeIndexOf(html, end + 1, 'script');
        body = html.slice(end + 1, close < 0 ? html.length : close);
        i = close < 0 ? html.length : close + 8;
      } else {
        const close = closeIndexOf(html, end + 1, 'script');
        i = close < 0 ? html.length : close + 8;
      }
      if (type === 'importmap') {
        let value: unknown = null;
        let error: string | null = null;
        try {
          value = JSON.parse(body);
        } catch (err) {
          error = (err as Error).message;
        }
        importMaps.push({ value, error });
      } else {
        scripts.push({ src, type, text: src === null ? body : '' });
      }
      continue;
    }
    if (rest.startsWith('link') && !/[A-Za-z0-9]/.test(html[at + 5] ?? '')) {
      const end = tagEnd(html, at + 5);
      if (end < 0) break;
      const attrs = attributesOf(html.slice(at + 5, end));
      const href = attrs.get('href');
      if (href !== undefined) links.push({ href, rel: (attrs.get('rel') ?? '').trim().toLowerCase() });
      i = end + 1;
      continue;
    }
    const tag = RESOURCE_TAGS.find((name) => rest.startsWith(name) && !/[A-Za-z0-9]/.test(html[at + 1 + name.length] ?? ''));
    if (tag !== undefined) {
      const end = tagEnd(html, at + 1 + tag.length);
      if (end < 0) break;
      const attrs = attributesOf(html.slice(at + 1 + tag.length, end));
      const src = attrs.get('src');
      if (src !== undefined) resources.push({ tag, src });
      i = end + 1;
      continue;
    }
    const end = tagEnd(html, at + 1);
    i = end < 0 ? html.length : end + 1;
  }
  return { scripts, links, resources, importMaps };
}

interface ImportMap { imports: Record<string, string | null>; scopes: Record<string, Record<string, string | null>>; }
interface ImportMapRead { map: ImportMap | null; error: string | null; }

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function setOwn<T>(o: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(o, key, { value, enumerable: true, writable: true, configurable: true });
}

function importMapOf(facts: HtmlFacts): ImportMapRead {
  if (facts.importMaps.length === 0) return { map: null, error: null };
  if (facts.importMaps.length > 1) return { map: null, error: `index.html holds ${facts.importMaps.length} import maps: a page holds one at most` };
  const only = facts.importMaps[0]!;
  if (only.error !== null) return { map: null, error: `index.html's import map is not JSON (${only.error})` };
  if (!isObject(only.value)) return { map: null, error: 'index.html\'s import map is not a JSON object' };
  const importsRaw = only.value.imports ?? {};
  if (!isObject(importsRaw)) return { map: null, error: 'index.html\'s import map holds an "imports" that is not an object' };
  const imports: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(importsRaw)) {
    if (value !== null && typeof value !== 'string') return { map: null, error: `index.html's import map maps ${JSON.stringify(key)} to no string` };
    setOwn(imports, key, value);
  }
  const scopes: Record<string, Record<string, string | null>> = {};
  const scopesRaw = only.value.scopes;
  if (scopesRaw !== undefined) {
    if (!isObject(scopesRaw)) return { map: null, error: 'index.html\'s import map holds a "scopes" that is not an object' };
    for (const [scope, entries] of Object.entries(scopesRaw)) {
      if (!isObject(entries)) return { map: null, error: `index.html's import map scope ${JSON.stringify(scope)} is not an object` };
      const inner: Record<string, string | null> = {};
      for (const [key, value] of Object.entries(entries)) {
        if (value !== null && typeof value !== 'string') return { map: null, error: `index.html's import map scope ${JSON.stringify(scope)} maps ${JSON.stringify(key)} to no string` };
        setOwn(inner, key, value);
      }
      setOwn(scopes, scope, inner);
    }
  }
  return { map: { imports, scopes }, error: null };
}

const URI_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

function isRelativeRef(ref: string): boolean {
  return ref.length > 0 && !URI_SCHEME.test(ref) && !ref.startsWith('//') && !ref.startsWith('/');
}

function isRelativeSpecifier(specifier: string): boolean {
  return specifier === '.' || specifier === '..' || specifier.startsWith('./') || specifier.startsWith('../');
}

function resolveGamePath(ref: string, from: string): string | null {
  if (!isRelativeRef(ref)) return null;
  const cut = ref.search(/[?#]/);
  const raw = cut < 0 ? ref : ref.slice(0, cut);
  if (raw === '') return null;
  const parts = from.split('/').slice(0, -1);
  for (const seg of raw.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) return null;
      parts.pop();
      continue;
    }
    parts.push(seg);
  }
  if (parts.length === 0) return null;
  return parts.join('/');
}

interface ImportMapMatch { found: boolean; value: string | null; }

function entryOf(entries: Record<string, string | null>, specifier: string): ImportMapMatch {
  if (Object.hasOwn(entries, specifier)) return { found: true, value: entries[specifier]! };
  let best: string | null = null;
  for (const key of Object.keys(entries)) {
    if (key.endsWith('/') && specifier.startsWith(key) && (best === null || key.length > best.length)) best = key;
  }
  if (best === null) return { found: false, value: null };
  const base = entries[best]!;
  if (base === null) return { found: true, value: null };
  return { found: true, value: `${base}${specifier.slice(best.length)}` };
}

function scopePath(scope: string): string | null {
  const cut = scope.search(/[?#]/);
  const raw = cut < 0 ? scope : scope.slice(0, cut);
  if (raw === '.' || raw === './') return '';
  return resolveGamePath(scope, 'index.html');
}

function importMapMatch(map: ImportMap | null, specifier: string, from: string = 'index.html'): ImportMapMatch {
  if (map === null) return { found: false, value: null };
  let best: { prefix: string; entries: Record<string, string | null> } | null = null;
  for (const [scope, entries] of Object.entries(map.scopes)) {
    const prefix = scopePath(scope);
    if (prefix === null || !from.startsWith(prefix)) continue;
    if (best === null || prefix.length > best.prefix.length) best = { prefix, entries };
  }
  if (best !== null) {
    const scoped = entryOf(best.entries, specifier);
    if (scoped.found) return scoped;
  }
  return entryOf(map.imports, specifier);
}

function resolveSpecifier(specifier: string, from: string, map: ImportMap | null): string | null {
  if (isRelativeSpecifier(specifier)) return resolveGamePath(specifier, from);
  const match = importMapMatch(map, specifier, from);
  if (!match.found || match.value === null || !isRelativeRef(match.value)) return null;
  return resolveGamePath(match.value, 'index.html');
}

// ---------------------------------------------------------------- static imports

const IDENT_START = /[A-Za-z_$]/;
const IDENT = /[A-Za-z0-9_$]/;

// A module's static import and export-from specifiers, in source order, by
// a lexical scan: comments, strings, template literals and regular
// expressions are skipped, so words inside them are never read as imports.
function sourceImports(source: string): string[] {
  const out: string[] = [];
  const n = source.length;
  let i = 0;
  const regexPosition = (prev: string): boolean => prev === '' || '([{,;:=!&|?+-*%^~<>'.includes(prev);
  let prev = '';

  const skipSpace = (): void => {
    for (;;) {
      while (i < n && /\s/.test(source[i]!)) i++;
      if (source.startsWith('//', i)) {
        while (i < n && source[i] !== '\n') i++;
        continue;
      }
      if (source.startsWith('/*', i)) {
        const end = source.indexOf('*/', i + 2);
        i = end < 0 ? n : end + 2;
        continue;
      }
      return;
    }
  };
  const skipString = (quote: string): string | null => {
    i++;
    let s = '';
    while (i < n) {
      const ch = source[i]!;
      if (ch === quote) {
        i++;
        return s;
      }
      if (ch === '\\') {
        const next = source[i + 1];
        if (next === undefined) return null;
        s += next === 'n' ? '\n' : next === 't' ? '\t' : next === 'r' ? '\r' : next;
        i += 2;
        continue;
      }
      if (ch === '\n') return null;
      s += ch;
      i++;
    }
    return null;
  };
  const skipTemplate = (): void => {
    i++;
    while (i < n) {
      const ch = source[i]!;
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === '`') {
        i++;
        return;
      }
      i++;
    }
  };
  const skipRegex = (): void => {
    i++;
    let inClass = false;
    while (i < n) {
      const ch = source[i]!;
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === '[') inClass = true;
      else if (ch === ']') inClass = false;
      else if (ch === '/' && !inClass) {
        i++;
        return;
      } else if (ch === '\n') return;
      i++;
    }
  };
  const readWord = (): string => {
    const start = i;
    while (i < n && IDENT.test(source[i]!)) i++;
    return source.slice(start, i);
  };
  const maybeString = (): string | null => {
    skipSpace();
    const ch = source[i];
    if (ch !== '"' && ch !== "'") return null;
    return skipString(ch);
  };
  const clause = (stopAt: string[]): string | null => {
    for (;;) {
      skipSpace();
      if (i >= n) return null;
      const ch = source[i]!;
      if (stopAt.includes(ch)) return null;
      if (ch === '"' || ch === "'") return skipString(ch);
      if (ch === '{' || ch === '}') {
        i++;
        continue;
      }
      if (ch === ',' || ch === '*') {
        i++;
        continue;
      }
      if (IDENT_START.test(ch)) {
        const word = readWord();
        if (word === 'from') {
          const spec = maybeString();
          return spec;
        }
        if (word === 'as' || word === 'type') continue;
        continue;
      }
      return null;
    }
  };

  while (i < n) {
    skipSpace();
    if (i >= n) break;
    const ch = source[i]!;
    if (ch === '"' || ch === "'") {
      skipString(ch);
      prev = ch;
      continue;
    }
    if (ch === '`') {
      skipTemplate();
      prev = '`';
      continue;
    }
    if (ch === '/') {
      if (regexPosition(prev)) skipRegex();
      else i++;
      prev = '/';
      continue;
    }
    if (IDENT_START.test(ch)) {
      const word = readWord();
      prev = 'a';
      if (word === 'import') {
        skipSpace();
        if (source[i] === '(' || source[i] === '.') continue;
        const spec = clause(['=', ';']);
        if (spec !== null) out.push(spec);
        continue;
      }
      if (word === 'export') {
        skipSpace();
        if (source[i] !== '*' && source[i] !== '{') continue;
        const spec = clause(['=', ';']);
        if (spec !== null) out.push(spec);
        continue;
      }
      continue;
    }
    prev = ch;
    i++;
  }
  return out;
}

interface GameSource { path: string; bytes: Uint8Array; }

const CLASSIC_SCRIPT_TYPES = new Set([
  'application/ecmascript', 'application/javascript', 'application/x-ecmascript',
  'application/x-javascript', 'text/ecmascript', 'text/javascript',
  'text/javascript1.0', 'text/javascript1.1', 'text/javascript1.2',
  'text/javascript1.3', 'text/javascript1.4', 'text/javascript1.5',
  'text/jscript', 'text/livescript', 'text/x-ecmascript', 'text/x-javascript',
]);

function isClassicScript(type: string): boolean {
  return type === '' || CLASSIC_SCRIPT_TYPES.has(type.split(';')[0]!.trim());
}

// The source JS files in the order the page loads them: index.html's
// scripts in document order, a module script followed by a depth-first
// walk of its static imports, each reached module's own imports in source
// order, the first time a path is reached.
function importOrder(sources: readonly GameSource[], facts: HtmlFacts): string[] {
  const byPath = new Map(sources.map((s) => [s.path, s]));
  const map = importMapOf(facts).map;
  const textOfPath = (path: string): string => {
    const file = byPath.get(path);
    return file === undefined ? '' : textOf(file.bytes);
  };
  const order: string[] = [];
  const seen = new Set<string>();
  const visit = (path: string, walk = true): void => {
    if (seen.has(path) || !MODULE_NAME.test(path) || !byPath.has(path)) return;
    seen.add(path);
    order.push(path);
    if (!walk) return;
    for (const specifier of sourceImports(textOfPath(path))) {
      const target = resolveSpecifier(specifier, path, map);
      if (target !== null) visit(target);
    }
  };
  for (const script of facts.scripts) {
    if (script.type !== 'module') {
      if (isClassicScript(script.type) && script.src !== null && isRelativeRef(script.src)) {
        const target = resolveGamePath(script.src, 'index.html');
        if (target !== null) visit(target, false);
      }
      continue;
    }
    if (script.src !== null) {
      const target = isRelativeRef(script.src) ? resolveGamePath(script.src, 'index.html') : resolveSpecifier(script.src, 'index.html', map);
      if (target !== null) visit(target);
    } else {
      for (const specifier of sourceImports(script.text)) {
        const target = resolveSpecifier(specifier, 'index.html', map);
        if (target !== null) visit(target);
      }
    }
  }
  return order;
}

// ---------------------------------------------------------------- canonical JSON

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`canonicalJson: ${value} is not a finite number`);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  if (typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) throw new TypeError('canonicalJson: only plain objects and arrays');
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o).sort(byCodeUnit).map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
  }
  throw new TypeError(`canonicalJson: a ${typeof value} has no JSON form`);
}

// ---------------------------------------------------------------- the dossier

const opensWith = (bytes: Uint8Array, magic: readonly number[], at = 0): boolean =>
  bytes.length >= at + magic.length && magic.every((b, i) => bytes[at + i] === b);

const extensionOf = (path: string): string => {
  const base = path.split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '(none)';
};

function gameBlockLines(tree: GameTree): string[] {
  const source = tree.files.filter((f) => f.cls === 'source');
  const vendored = tree.files.filter((f) => f.cls === 'vendored');
  const assets = tree.files.filter((f) => f.cls === 'asset');
  const sum = (list: readonly GameFile[]): number => list.reduce((n, f) => n + f.bytes, 0);
  const lines = [
    '## Game',
    '',
    `Source files: ${source.length} (${sum(source)} bytes)`,
    `Vendored files: ${vendored.length} (${sum(vendored)} bytes)`,
  ];
  if (vendored.length > 0) {
    const listed = vendored.slice(0, VENDORED_LISTED).map((f) => `game/${f.path} (${f.bytes} bytes)`);
    const more = vendored.length > VENDORED_LISTED ? `, and ${vendored.length - VENDORED_LISTED} more` : '';
    lines.push(`  ${listed.join(', ')}${more}`);
  }
  const byExt = new Map<string, { n: number; bytes: number }>();
  for (const f of assets) {
    const ext = extensionOf(f.path);
    const at = byExt.get(ext) ?? { n: 0, bytes: 0 };
    at.n++;
    at.bytes += f.bytes;
    byExt.set(ext, at);
  }
  const extText = [...byExt]
    .sort((a, b) => byCodeUnit(a[0], b[0]))
    .map(([ext, at]) => `${ext} ${at.n} (${at.bytes} bytes)`)
    .join(', ');
  lines.push(`Assets: ${extText === '' ? 'none' : extText}`);
  lines.push(`Totals: ${tree.count} files and directories (${tree.totalBytes} bytes)`);
  return lines;
}

interface SourceCode {
  norm: Uint8Array;
  text: string;
  fence: string;
  block: string;
  blockBytes: number;
  lines: number;
}

// A source's section cut inside its text: its heading, its first k lines
// in its fence (closed), a line naming how many of its lines are not
// shown, then the cut line. k is the most lines (at least one, fewer than
// all) whose whole fits in `room` UTF-8 bytes; null when not one line fits.
function sourceHead(
  heading: string,
  code: { norm: Uint8Array; text: string; fence: string },
  language: string,
  room: number,
  tail: (hidden: number) => string,
): string | null {
  const total = lineCount(code.norm);
  const lines = code.text.split('\n');
  const open = `${code.fence}${language}\n`;
  const close = `${code.fence}\n\n`;
  const note = (k: number): string => `[${total - k} of this file's ${total} lines not shown.]\n`;
  const fixed = byteLength(heading) + byteLength(open) + byteLength(close);
  let best = 0;
  let shown = 0;
  let raw = 0;
  for (let k = 1; k < total; k++) {
    shown += byteLength(lines[k - 1]!) + 1;
    raw = code.norm.indexOf(0x0a, raw) + 1;
    if (fixed + shown + byteLength(note(k)) + byteLength(tail(code.norm.length - raw)) <= room) best = k;
  }
  if (best === 0) return null;
  let rawEnd = 0;
  for (let k = 0; k < best; k++) rawEnd = code.norm.indexOf(0x0a, rawEnd) + 1;
  const head = lines.slice(0, best).map((l) => `${l}\n`).join('');
  return `${heading}${open}${head}${close}${note(best)}${tail(code.norm.length - rawEnd)}`;
}

function buildDossier(dir: string, caps: DossierCaps): Uint8Array {
  const max = caps.text_max_bytes;
  if (!Number.isSafeInteger(max) || max <= 0) throw new DossierError(`buildDossier: caps.text_max_bytes must be a positive integer, not ${String(max)}`, 'text_max_bytes');
  let maxImages = { n: DOSSIER_MAX_IMAGES, whose: 'a dossier holds' };
  let maxImageBytes = { n: DOSSIER_MAX_BYTES, whose: 'a dossier holds' };
  if (caps.screenshots !== undefined) {
    const s = caps.screenshots as { max?: unknown; max_bytes?: unknown } | null;
    if (typeof s !== 'object' || s === null) throw new DossierError('buildDossier: caps.screenshots must be an object {max, max_bytes}');
    for (const k of ['max', 'max_bytes'] as const) {
      const v = s[k];
      if (typeof v !== 'number' || !Number.isSafeInteger(v) || v <= 0) throw new DossierError(`buildDossier: caps.screenshots.${k} must be a positive integer, not ${String(v)}`, `screenshots.${k}`);
    }
    if ((s.max as number) < maxImages.n) maxImages = { n: s.max as number, whose: 'caps.screenshots.max allows' };
    if ((s.max_bytes as number) < maxImageBytes.n) maxImageBytes = { n: s.max_bytes as number, whose: 'caps.screenshots.max_bytes allows' };
  }
  const gameCaps: GameCaps = {};
  for (const k of ['game_max_files', 'game_max_bytes', 'game_path_max_bytes'] as const) {
    const v = caps[k] as unknown;
    if (v === undefined) continue;
    if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) throw new DossierError(`buildDossier: caps.${k} must be a whole number, not ${String(v)}`, k);
    gameCaps[k] = v;
  }

  const gameDir = join(dir, 'game');
  const tree = readGameTree(gameDir, gameCaps);
  const htmlBytes = readIndexHtml(gameDir, tree);
  const html = htmlFacts(textOf(htmlBytes));

  const sources = tree.files.filter((f) => f.cls === 'source').map((f) => ({ path: f.path, bytes: new Uint8Array(readFileSync(join(gameDir, f.path))) }));
  const byPath = new Map(sources.map((s) => [s.path, s]));
  const ordered = importOrder(sources, html).filter((p) => p !== 'index.html');
  const seen = new Set<string>(['index.html', ...ordered]);
  const rest = sources.map((s) => s.path).filter((p) => !seen.has(p)).sort(byCodeUnit);
  const order = ['index.html', ...ordered, ...rest];

  const codes = new Map<string, SourceCode>();
  const codeOf = (path: string): SourceCode | null => {
    let code = codes.get(path);
    if (code !== undefined) return code;
    const file = byPath.get(path);
    if (file === undefined) return null;
    const t = textOf(file.bytes);
    const fence = fenceFor(t);
    const block = `${fence}${languageOf(path)}\n${t}${t.endsWith('\n') ? '' : '\n'}${fence}\n\n`;
    code = { norm: file.bytes, text: t, fence, block, blockBytes: byteLength(block), lines: lineCount(file.bytes) };
    codes.set(path, code);
    return code;
  };

  const shotNames = (() => {
    const shotsDir = join(dir, 'screenshots');
    let shotDirStat;
    try {
      shotDirStat = lstatSync(shotsDir);
    } catch {
      throw new DossierError('buildDossier: no screenshots/ directory: an entry hands in 3 or 4 renders of its game, the first by name the cover');
    }
    if (!shotDirStat.isDirectory()) throw new DossierError('buildDossier: screenshots is not a directory: an entry hands in 3 or 4 renders of its game, the first by name the cover');
    let names: string[];
    try {
      names = readdirSync(shotsDir, { withFileTypes: true })
        .filter((e) => e.isFile() && !e.name.startsWith('.'))
        .map((e) => e.name)
        .sort(byCodeUnit);
    } catch (err) {
      throw new DossierError(`buildDossier: screenshots/ cannot be read (${(err as Error).message})`);
    }
    return names;
  })();
  if (shotNames.length === 0) throw new DossierError('buildDossier: screenshots/ holds no image: the first is the cover');
  if (shotNames.length > maxImages.n) throw new DossierError(`buildDossier: screenshots/ holds ${shotNames.length} files, over the ${maxImages.n} ${maxImages.whose}`, 'screenshots.max');
  const images = shotNames.map((name) => {
    if (!IMAGE_NAME.test(name)) throw new DossierError(`buildDossier: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters, not starting with . or -`);
    const size = lstatSync(join(dir, 'screenshots', name)).size;
    if (size > maxImageBytes.n) throw new DossierError(`buildDossier: screenshots/${name} is ${size} bytes, over the ${maxImageBytes.n} ${maxImageBytes.whose}`, 'screenshots.max_bytes');
    const bytes = new Uint8Array(readFileSync(join(dir, 'screenshots', name)));
    if (bytes.length > maxImageBytes.n) throw new DossierError(`buildDossier: screenshots/${name} is ${bytes.length} bytes, over the ${maxImageBytes.n} ${maxImageBytes.whose}`, 'screenshots.max_bytes');
    const media_type = opensWith(bytes, PNG_MAGIC) ? 'image/png' : opensWith(bytes, JPEG_MAGIC) ? 'image/jpeg' : null;
    if (media_type === null) throw new DossierError(`buildDossier: screenshots/${name} is neither a PNG nor a JPEG`);
    return { name, media_type, sha256: sha256Hex(bytes), base64: Buffer.from(bytes).toString('base64') };
  });

  const head = [...gameBlockLines(tree), '', '## Sources', '', ''].join('\n');
  const sections = order.map((path) => {
    const code = codeOf(path);
    const lines = code === null ? 0 : code.lines;
    const bytes = code === null ? 0 : code.norm.length;
    const heading = `### game/${path} (${lines} ${lines === 1 ? 'line' : 'lines'}, ${bytes} bytes)\n\n`;
    const shown = lines === 0 ? null : code;
    return { heading, code: shown, size: byteLength(heading) + (shown === null ? 0 : shown.blockBytes), bytes };
  });
  const restBytes = new Array<number>(sections.length + 1).fill(0);
  for (let k = sections.length - 1; k >= 0; k--) restBytes[k] = restBytes[k + 1]! + (k + 1 < sections.length ? sections[k + 1]!.bytes : 0);

  const cutLine = (files: number, bytes: number): string => `[Cut at ${max} bytes: ${files} file${files === 1 ? '' : 's'} and ${bytes} bytes of source left out.]\n`;
  let out = head;
  let used = byteLength(head);
  let kept = 0;
  for (; kept < sections.length; kept++) {
    const section = sections[kept]!;
    const restCount = sections.length - kept - 1;
    const tail = restCount === 0 ? 0 : byteLength(cutLine(restCount, restBytes[kept]!));
    if (used + section.size + tail > max) break;
    out += section.code === null ? section.heading : `${section.heading}${section.code.block}`;
    used += section.size;
  }
  if (kept < sections.length) {
    const first = sections[kept]!;
    const restCount = sections.length - kept - 1;
    const after = restBytes[kept]!;
    const part = first.code === null ? null : sourceHead(first.heading, first.code, languageOf(order[kept]!), max - used, (hidden) => cutLine(restCount, after + hidden));
    out += part ?? cutLine(restCount + 1, after + first.bytes);
  }
  if (byteLength(out) > max) throw new DossierError(`buildDossier: caps.text_max_bytes ${max} cannot hold even the Game block and the cut line`, 'text_max_bytes');

  const doc = { schema: DOSSIER_SCHEMA, cover: 0, text: out.replace(/\n+$/, '\n'), images };
  const bytes = Buffer.from(canonicalJson(doc), 'utf8');
  if (bytes.length > DOSSIER_MAX_BYTES) throw new DossierError(`buildDossier: the dossier is ${bytes.length} bytes, over the ${DOSSIER_MAX_BYTES} one holds`);
  return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length);
}

// ---------------------------------------------------------------- the entry program

const entryDir = dirname(fileURLToPath(import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR || '/output';
mkdirSync(outDir, { recursive: true });

for (const name of ['game', 'screenshots']) {
  const src = join(entryDir, name);
  const dst = join(outDir, name);
  if (existsSync(src) && src !== dst) {
    cpSync(src, dst, { recursive: true, force: true });
  }
}

const dossier = buildDossier(outDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
});
const dossierPath = join(outDir, 'dossier.json');
writeFileSync(dossierPath, dossier);
console.log(`dossier.json written: ${Buffer.from(dossier).length} bytes -> ${dossierPath}`);

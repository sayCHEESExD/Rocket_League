import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { logger } from '../util/logger.js';

const SCOPE = 'careers';

/**
 * A signed-in player's CAREER: running totals across every match they have
 * finished (or left), keyed by their Bloxity account id. This is the
 * server-owned state the profile stats are read from - only the match rules
 * write it (goals, saves, demos... credited by `Match`), never a client.
 */
export const CAREER_KEYS = ['goals', 'assists', 'saves', 'shots', 'demos', 'points', 'matches', 'wins', 'mvps'] as const;
export type CareerKey = (typeof CAREER_KEYS)[number];
export type Career = Record<CareerKey, number>;

const empty = (): Career => Object.fromEntries(CAREER_KEYS.map((k) => [k, 0])) as Career;

/** Only finite, non-negative whole increments of known keys ever reach the store. */
const cleanDelta = (delta: Partial<Career>): Partial<Career> | null => {
  const out: Partial<Career> = {};
  let any = false;
  for (const k of CAREER_KEYS) {
    const v = delta[k];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
      out[k] = Math.floor(v);
      any = true;
    }
  }
  return any ? out : null;
};

const fromDoc = (doc: Record<string, unknown> | null | undefined): Career => {
  const c = empty();
  if (doc) for (const k of CAREER_KEYS) if (typeof doc[k] === 'number' && Number.isFinite(doc[k])) c[k] = doc[k] as number;
  return c;
};

interface Backend {
  get(id: string): Promise<Career | null>;
  /** Add to a career and return the new totals. Atomic per account (several pods may share one store). */
  inc(id: string, delta: Partial<Career>): Promise<Career>;
}

/**
 * PRODUCTION: the managed MongoDB a Bloxity pod is given (`MONGODB_URI`).
 * `$inc` is atomic on the server, so pods never overwrite each other's numbers.
 */
class MongoBackend implements Backend {
  private col: Promise<import('mongodb').Collection<Record<string, unknown>>> | null = null;
  constructor(private readonly uri: string) {}

  private collection(): Promise<import('mongodb').Collection<Record<string, unknown>>> {
    this.col ??= (async () => {
      const { MongoClient } = await import('mongodb');
      const client = new MongoClient(this.uri, { serverSelectionTimeoutMS: 8000 });
      await client.connect();
      const col = client.db().collection<Record<string, unknown>>('careers');
      logger.info(SCOPE, 'career store: MongoDB');
      return col;
    })().catch((error: unknown) => {
      this.col = null; // try again next time
      throw error;
    });
    return this.col;
  }

  async get(id: string): Promise<Career | null> {
    const doc = await (await this.collection()).findOne({ _id: id as never });
    return doc ? fromDoc(doc) : null;
  }

  async inc(id: string, delta: Partial<Career>): Promise<Career> {
    const doc = await (await this.collection()).findOneAndUpdate(
      { _id: id as never },
      { $inc: delta, $set: { updatedAt: new Date() } } as never,
      { upsert: true, returnDocument: 'after' },
    );
    return fromDoc(doc);
  }
}

/** LOCAL DEVELOPMENT: one JSON file (single process), written atomically (temp file + rename). */
class JsonBackend implements Backend {
  private data: Map<string, Career> | null = null;
  private writing: Promise<void> = Promise.resolve();
  constructor(private readonly file: string) {}

  private async load(): Promise<Map<string, Career>> {
    if (this.data) return this.data;
    const map = new Map<string, Career>();
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8')) as Record<string, Record<string, unknown>>;
      for (const [id, doc] of Object.entries(raw)) map.set(id, fromDoc(doc));
    } catch {
      /* no file yet */
    }
    this.data = map;
    logger.info(SCOPE, `career store: ${this.file} (${map.size} careers)`);
    return map;
  }

  async get(id: string): Promise<Career | null> {
    return (await this.load()).get(id) ?? null;
  }

  async inc(id: string, delta: Partial<Career>): Promise<Career> {
    const map = await this.load();
    const c = map.get(id) ?? empty();
    for (const k of CAREER_KEYS) c[k] += delta[k] ?? 0;
    map.set(id, c);
    const body = JSON.stringify(Object.fromEntries(map));
    this.writing = this.writing.then(async () => {
      await mkdir(dirname(this.file), { recursive: true });
      await writeFile(`${this.file}.tmp`, body);
      await rename(`${this.file}.tmp`, this.file);
    });
    await this.writing;
    return { ...c };
  }
}

const backend: Backend = process.env['MONGODB_URI']?.trim()
  ? new MongoBackend(process.env['MONGODB_URI'].trim())
  : new JsonBackend(resolve(process.env['RL_DATA_DIR'] ?? 'data', 'careers.json'));

/** Last known totals per account (what the stat reporter reads). */
const known = new Map<string, Career>();
const inflight = new Set<Promise<unknown>>();
const track = <T>(p: Promise<T>): Promise<T> => {
  inflight.add(p);
  void p.finally(() => inflight.delete(p)).catch(() => undefined);
  return p;
};

export const careers = {
  /** A player signed in: load their totals (for reporting). Never throws. */
  async load(accountId: string): Promise<Career | null> {
    try {
      const c = (await track(backend.get(accountId))) ?? empty();
      known.set(accountId, c);
      return c;
    } catch (error) {
      logger.warn(SCOPE, `could not load career ${accountId}: ${String(error)}`);
      return null;
    }
  },
  /** Credit a finished (or abandoned) match. Never throws; returns the new totals, or null. */
  async add(accountId: string, delta: Partial<Career>): Promise<Career | null> {
    const clean = cleanDelta(delta);
    if (!clean) return known.get(accountId) ?? null;
    try {
      const c = await track(backend.inc(accountId, clean));
      known.set(accountId, c);
      return c;
    } catch (error) {
      logger.warn(SCOPE, `could not save career ${accountId}: ${String(error)}`);
      return null;
    }
  },
  /** The last known totals, or undefined (not loaded yet / never played). */
  current(accountId: string): Career | undefined {
    return known.get(accountId);
  },
  /** Wait for every write in flight (shutdown). */
  async settle(): Promise<void> {
    await Promise.allSettled([...inflight]);
  },
};

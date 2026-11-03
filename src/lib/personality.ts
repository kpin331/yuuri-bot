import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const PERSONALITY_DIR = join(process.cwd(), "personality");
const DEFAULT_SLUG = "mommy";
const MAX_NAME_LENGTH = 40;
const MAX_PERSONALITY_BYTES = 32 * 1024;

export interface PersonalityInfo {
  name: string;
  slug: string;
}

export type PersonalityResult =
  | { ok: true; personality: PersonalityInfo }
  | { ok: false; error: string };

function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

function markdownName(contents: string, fallback: string): string {
  const heading = /^#\s+(.+)\s*$/m.exec(contents)?.[1]?.trim();
  return heading || fallback;
}

async function ensureDirectory(): Promise<void> {
  await mkdir(PERSONALITY_DIR, { recursive: true });
}

async function readActiveSlug(): Promise<string> {
  try {
    const value = (await readFile(join(PERSONALITY_DIR, "active.txt"), "utf8")).trim();
    return /^[\p{L}\p{N}-]+$/u.test(value) ? value : DEFAULT_SLUG;
  } catch {
    return DEFAULT_SLUG;
  }
}

export async function getActivePersonality(): Promise<{ name: string; instructions: string }> {
  await ensureDirectory();
  const slug = await readActiveSlug();
  for (const candidate of [slug, DEFAULT_SLUG]) {
    try {
      const contents = await readFile(join(PERSONALITY_DIR, `${candidate}.md`), "utf8");
      const instructions = contents.replace(/^#\s+.+\r?\n+/, "").trim();
      return { name: markdownName(contents, candidate), instructions };
    } catch {
      // Try the default file if the selected personality is missing.
    }
  }
  return { name: "YuuriBot", instructions: "Gunakan persona yang hangat, ramah, ringkas, akurat, dan membantu." };
}

export async function listPersonalities(): Promise<PersonalityInfo[]> {
  await ensureDirectory();
  const files = (await readdir(PERSONALITY_DIR)).filter((file) => file.toLowerCase().endsWith(".md"));
  const entries = await Promise.all(files.map(async (file) => {
    const slug = file.slice(0, -3);
    try {
      const contents = await readFile(join(PERSONALITY_DIR, file), "utf8");
      return { name: markdownName(contents, slug), slug };
    } catch {
      return null;
    }
  }));
  return entries.filter((entry): entry is PersonalityInfo => entry !== null).sort((a, b) => a.name.localeCompare(b.name));
}

export async function addPersonality(nameInput: string, instructionsInput: string): Promise<PersonalityResult> {
  const name = nameInput.trim();
  const instructions = instructionsInput.trim();
  if (!name || name.length > MAX_NAME_LENGTH) {
    return { ok: false, error: `Nama persona harus 1-${MAX_NAME_LENGTH} karakter.` };
  }
  if (!instructions) return { ok: false, error: "Instruksi persona tidak boleh kosong." };
  if (Buffer.byteLength(instructions, "utf8") > MAX_PERSONALITY_BYTES - Buffer.byteLength(name, "utf8") - 8) {
    return { ok: false, error: "File persona maksimal 32 KB." };
  }

  const slug = slugify(name);
  if (!slug) return { ok: false, error: "Nama persona harus memiliki huruf atau angka." };
  await ensureDirectory();
  const path = join(PERSONALITY_DIR, `${slug}.md`);
  try {
    const existing = await readFile(path, "utf8");
    const existingName = markdownName(existing, slug);
    if (existingName.toLocaleLowerCase() !== name.toLocaleLowerCase()) {
      return { ok: false, error: `Nama persona bentrok dengan “${existingName}”. Pilih nama lain.` };
    }
  } catch {
    // A new file is being added.
  }

  await writeFile(path, `# ${name}\n\n${instructions}\n`, "utf8");
  return { ok: true, personality: { name, slug } };
}

export async function switchPersonality(nameInput: string): Promise<PersonalityResult> {
  const name = nameInput.trim();
  if (!name || name.length > MAX_NAME_LENGTH) {
    return { ok: false, error: `Nama persona harus 1-${MAX_NAME_LENGTH} karakter.` };
  }
  const slug = slugify(name);
  if (!slug) return { ok: false, error: "Nama persona harus memiliki huruf atau angka Latin." };
  await ensureDirectory();
  try {
    const contents = await readFile(join(PERSONALITY_DIR, `${slug}.md`), "utf8");
    const personality = { name: markdownName(contents, slug), slug };
    await writeFile(join(PERSONALITY_DIR, "active.txt"), `${slug}\n`, "utf8");
    return { ok: true, personality };
  } catch {
    return { ok: false, error: `Persona “${name}” tidak ditemukan.` };
  }
}

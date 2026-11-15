export const CLASSES = {
  warrior: { hp: 120, mana: 24, attack: 19, armor: 6, skill: "Hantaman: damage ganda dan ganggu niat musuh" },
  mage: { hp: 85, mana: 48, attack: 17, armor: 2, skill: "Bola api: damage ganda ke semua musuh" },
  rogue: { hp: 95, mana: 30, attack: 21, armor: 3, skill: "Tusuk: damage tiga kali, abaikan perisai" },
  ranger: { hp: 100, mana: 36, attack: 20, armor: 3, skill: "Panah pengikat: damage ganda dan ganggu niat musuh" },
  cleric: { hp: 110, mana: 42, attack: 16, armor: 4, skill: "Cahaya: pulihkan 30 HP dan serang musuh" },
} as const;
export type Role = keyof typeof CLASSES;
export type Difficulty = "easy" | "normal" | "hard";
export interface Enemy { kind: number; hp: number; maxHp: number; turn: number; summoned?: boolean }
export interface Adventure { difficulty: Difficulty; stage: number; hp: number; mana: number; potions: number; gold: number; xp: number; materials: number; enemies: Enemy[] }
export interface Character { role: Role; xp: number; gold: number; materials: number; weapon: number; armor: number; wins: number; questClaimed: boolean; storedPotions?: number; adventure: Adventure | null }
const MONSTERS = [
  { name: "Slime", hp: 38, attack: 13 },
  { name: "Serigala", hp: 46, attack: 15 },
  { name: "Goblin Penjaga", hp: 60, attack: 14 },
  { name: "Dukun Goblin", hp: 42, attack: 12 },
  { name: "Kepala Goblin", hp: 125, attack: 22 },
];
const GROUPS = [[0], [1], [2, 3], [4]];
const SCALE = { easy: 0.75, normal: 1, hard: 1.3 };
export function level(c: Character): number { return Math.min(30, 1 + Math.floor(c.xp / 100)); }
function stats(c: Character) {
  const base = CLASSES[c.role];
  return { hp: base.hp + (level(c) - 1) * 8, mana: base.mana, attack: base.attack + (level(c) - 1) * 2 + c.weapon * 3, armor: base.armor + c.armor * 2 };
}
export function createCharacter(role: Role): Character {
  return { role, xp: 0, gold: 0, materials: 0, weapon: 0, armor: 0, wins: 0, questClaimed: false, storedPotions: 0, adventure: null };
}
function enemies(stage: number, difficulty: Difficulty): Enemy[] {
  const group = difficulty === "hard" && stage === 1 ? [1, 0] : difficulty === "easy" && stage === 2 ? [2] : GROUPS[stage]!;
  return group.map(kind => {
    const hp = Math.round(MONSTERS[kind]!.hp * SCALE[difficulty]);
    return { kind, hp, maxHp: hp, turn: 0 };
  });
}
function intent(e: Enemy): string {
  if (e.kind === 0) return e.turn % 2 ? "semburan korosif (abaikan armor)" : "serangan biasa";
  if (e.kind === 1) return e.turn % 2 ? "terkaman berat" : "mengintai (tanpa damage)";
  if (e.kind === 2) return e.turn % 2 ? "serangan balasan" : "berlindung dengan perisai";
  if (e.kind === 3) return e.turn % 2 ? "kutukan (abaikan armor)" : "menyembuhkan sekutu";
  return ["serangan biasa", "hantaman berat", "memanggil goblin"][e.turn % 3]!;
}
function help(prefix: string): string {
  return [`${prefix}rpg mulai [easy|normal|hard] — default Normal`, `${prefix}rpg serang [nomor] | skill [nomor]`, `${prefix}rpg bertahan | potion | kabur`, `${prefix}rpg tas | upgrade senjata | upgrade armor | quest`, "Skill: 8 mana. Bertahan: damage berkurang 65%, pulih 4 mana.", "Kalah/kabur: simpan separuh loot perjalanan. Perlengkapan lama aman."].join("\n");
}
export function renderRpg(c: Character, prefix: string): string {
  const a = c.adventure;
  const title = `${c.role.toUpperCase()} · Level ${level(c)} · XP ${c.xp}\nGold ${c.gold} · Material ${c.materials} · Senjata +${c.weapon} · Armor +${c.armor}\nCadangan potion ${c.storedPotions ?? 0} · ${prefix}rpg toko (saldo kasino)`;
  if (!a) return `${title}\nKota · Quest: kalahkan Kepala Goblin (${c.wins > 0 ? "selesai" : "belum selesai"}).\n${CLASSES[c.role].skill}\n${help(prefix)}`;
  return `${title}\nHutan Goblin · ${a.difficulty} · Encounter ${a.stage + 1}/4\nHP ${a.hp}/${stats(c).hp} · Mana ${a.mana}/${stats(c).mana} · Potion ${a.potions}\nLoot sementara: ${a.gold} gold, ${a.xp} XP, ${a.materials} material\n${a.enemies.map((e, i) => `${i + 1}. ${MONSTERS[e.kind]!.name} · HP ${e.hp}/${e.maxHp}\nNiat: ${intent(e)}`).join("\n")}\n${CLASSES[c.role].skill}\n${help(prefix)}`;
}
function settle(c: Character, won: boolean): string {
  const a = c.adventure!;
  const fraction = won ? 1 : 0.5;
  const gold = Math.floor(a.gold * fraction), xp = Math.floor(a.xp * fraction), materials = Math.floor(a.materials * fraction);
  c.gold += gold; c.xp += xp; c.materials += materials;
  if (won) c.wins++;
  c.adventure = null;
  return `${won ? "Petualangan selesai!" : "Kembali ke kota; separuh loot perjalanan hilang."} Dibawa pulang: ${gold} gold, ${xp} XP, ${materials} material.`;
}
export function actRpg(c: Character, input: string): string {
  const [action, arg, ...extra] = input.trim().toLowerCase().split(/\s+/);
  if (extra.length) return "Argumen terlalu banyak.";
  if (!action || action === "tas") return "";
  if (action === "buat") return "Karakter sudah dibuat. Class tidak dapat diganti.";
  if (action === "mulai") {
    if (c.adventure) return "Selesaikan petualangan aktif atau gunakan kabur.";
    if (arg && !["easy", "normal", "hard"].includes(arg)) return "Difficulty: easy, normal, atau hard.";
    const difficulty = (arg || "normal") as Difficulty, s = stats(c);
    c.adventure = { difficulty, stage: 0, hp: s.hp, mana: s.mana, potions: 3, gold: 0, xp: 0, materials: 0, enemies: enemies(0, difficulty) };
    return "Berangkat ke Hutan Goblin. HP/mana penuh; bekal 3 potion. Difficulty terkunci.";
  }
  if (action === "upgrade") {
    if (c.adventure) return "Upgrade hanya tersedia di kota.";
    if (arg !== "senjata" && arg !== "armor") return "Pilih upgrade senjata atau upgrade armor.";
    const key = arg === "senjata" ? "weapon" : "armor";
    const cost = (c[key] + 1) * 40, materialCost = (c[key] + 1) * 2;
    if (c[key] >= 10) return "Upgrade sudah maksimum (+10).";
    if (c.gold < cost || c.materials < materialCost) return `Butuh ${cost} gold dan ${materialCost} material. Senjata: +3 serangan; armor: +2 pertahanan per upgrade.`;
    c.gold -= cost; c.materials -= materialCost; c[key]++;
    return `${arg} naik ke +${c[key]}.`;
  }
  if (action === "quest") {
    if (arg) return "Gunakan quest tanpa argumen.";
    if (c.adventure) return "Klaim quest di kota.";
    if (!c.wins) return "Quest: kalahkan Kepala Goblin. Hadiah sekali: 100 gold dan 5 material.";
    if (c.questClaimed) return "Hadiah quest sudah diklaim.";
    c.questClaimed = true; c.gold += 100; c.materials += 5;
    return "Quest selesai: +100 gold dan +5 material.";
  }
  const a = c.adventure;
  if (!a) return "Mulai petualangan dahulu. Gunakan command yang tercantum di bawah.";
  if (!["serang", "skill", "bertahan", "potion", "kabur"].includes(action!)) return "Aksi tidak dikenal. Pilih aksi dari daftar di bawah.";
  if (!["serang", "skill"].includes(action!) && arg) return "Aksi ini tidak memakai argumen.";
  if (action === "kabur") return settle(c, false);
  const targetIndex = arg === undefined ? 0 : /^[1-9]\d*$/.test(arg) ? Number(arg) - 1 : -1;
  const target = a.enemies[targetIndex];
  if ((action === "serang" || action === "skill") && !target) return "Nomor target tidak valid.";
  if (action === "skill" && a.mana < 8) return "Mana tidak cukup; butuh 8. Bertahan memulihkan 4 mana.";
  if (action === "potion" && (a.potions + (c.storedPotions ?? 0) === 0 || a.hp >= stats(c).hp)) return "Potion habis atau HP masih penuh.";
  const s = stats(c), log: string[] = [], interrupted = new Set<Enemy>();
  if (action === "potion") {
    if (a.potions > 0) a.potions--;
    else c.storedPotions = (c.storedPotions ?? 0) - 1;
    a.hp = Math.min(s.hp, a.hp + 45); log.push("Potion memulihkan sampai 45 HP.");
  }
  if (action === "bertahan") { a.mana = Math.min(s.mana, a.mana + 4); log.push("Bertahan dan pulih 4 mana."); }
  if (action === "serang" || action === "skill") {
    const skill = action === "skill";
    if (skill) a.mana -= 8;
    if (skill && c.role === "cleric") a.hp = Math.min(s.hp, a.hp + 30);
    const targets = skill && c.role === "mage" ? a.enemies : [target!];
    for (const e of targets) {
      let damage = s.attack * (skill ? c.role === "rogue" ? 3 : c.role === "cleric" ? 1 : 2 : 1);
      if (e.kind === 2 && e.turn % 2 === 0 && !(skill && ["mage", "rogue"].includes(c.role))) damage = Math.ceil(damage / 2);
      e.hp -= damage; log.push(`${MONSTERS[e.kind]!.name} menerima ${damage} damage.`);
      if (skill && ["warrior", "ranger"].includes(c.role)) interrupted.add(e);
    }
  }
  for (const e of a.enemies.filter(e => e.hp <= 0)) {
    if (e.summoned) continue;
    const multiplier = SCALE[a.difficulty];
    a.gold += Math.round((e.kind === 4 ? 70 : 20) * multiplier);
    a.xp += Math.round((e.kind === 4 ? 45 : 15) * multiplier);
    a.materials += e.kind === 4 ? 3 : 1;
    log.push(`${MONSTERS[e.kind]!.name} dikalahkan.`);
  }
  a.enemies = a.enemies.filter(e => e.hp > 0);
  if (!a.enemies.length) {
    if (a.stage === 3) return [...log, settle(c, true)].join("\n");
    a.stage++; a.enemies = enemies(a.stage, a.difficulty);
    return [...log, "Lanjut ke encounter berikutnya."].join("\n");
  }
  for (const e of [...a.enemies]) {
    const turn = e.turn++;
    if (interrupted.has(e)) { log.push(`${MONSTERS[e.kind]!.name}: aksi terganggu.`); continue; }
    if (e.kind === 1 && turn % 2 === 0 || e.kind === 2 && turn % 2 === 0) continue;
    if (e.kind === 3 && turn % 2 === 0) {
      const ally = a.enemies.reduce((low, candidate) => candidate.hp / candidate.maxHp < low.hp / low.maxHp ? candidate : low);
      ally.hp = Math.min(ally.maxHp, ally.hp + 15); log.push("Dukun menyembuhkan sekutu hingga 15 HP."); continue;
    }
    if (e.kind === 4 && turn % 3 === 2) {
      if (a.enemies.length < 3) {
        const hp = Math.round(MONSTERS[2]!.hp * SCALE[a.difficulty]);
        a.enemies.push({ kind: 2, hp, maxHp: hp, turn: 0, summoned: true });
      }
      log.push("Kepala Goblin memanggil penjaga."); continue;
    }
    const heavy = e.kind === 1 && turn % 2 === 1 || e.kind === 4 && turn % 3 === 1;
    const piercing = (e.kind === 0 || e.kind === 3) && turn % 2 === 1;
    const damage = Math.max(1, Math.round((MONSTERS[e.kind]!.attack * SCALE[a.difficulty] * (heavy ? 2 : 1) - (piercing ? 0 : s.armor)) * (action === "bertahan" ? 0.35 : 1)));
    a.hp = Math.max(0, a.hp - damage); log.push(`${MONSTERS[e.kind]!.name}: ${damage} damage.`);
    if (a.hp === 0) return [...log, "Kamu kalah.", settle(c, false)].join("\n");
  }
  return log.join("\n");
}

import type { Character } from "./rpg.js";

export const POTION_PRICE = 2_500;
export const MAX_STORED_POTIONS = 10;
const money = (value: number): string => `Rp${value.toLocaleString("id-ID")}`;

export function renderRpgShop(c: Character, prefix: string, balance: number): string {
  return [
    `Toko RPG · Saldo kasino ${money(balance)}`,
    `Potion: ${money(POTION_PRICE)} / botol. Cadangan ${c.storedPotions ?? 0}/${MAX_STORED_POTIONS}.`,
    c.weapon >= 10 ? "Senjata sudah maksimum (+10)." : `Senjata +${c.weapon + 1}: ${money((c.weapon + 1) * 10_000)} + ${(c.weapon + 1) * 2} material.`,
    c.armor >= 10 ? "Armor sudah maksimum (+10)." : `Armor +${c.armor + 1}: ${money((c.armor + 1) * 10_000)} + ${(c.armor + 1) * 2} material.`,
    `${prefix}rpg beli potion | ${prefix}rpg beli senjata | ${prefix}rpg beli armor`,
    "Pembelian langsung memakai saldo kasino, hanya di kota. Satu barang per command.",
    `Upgrade memakai gold RPG: ${prefix}rpg upgrade senjata atau ${prefix}rpg upgrade armor.`,
    "Hadiah tetap gold RPG. Tidak bisa dijual atau ditukar menjadi saldo kasino.",
  ].join("\n");
}

export function prepareRpgPurchase(c: Character, item: string): { ok: false; message: string } | { ok: true; cost: number; character: Character; message: string } {
  if (c.adventure) return { ok: false, message: "Belanja hanya tersedia di kota. Selesaikan petualangan dahulu." };
  if (!["potion", "senjata", "armor"].includes(item)) return { ok: false, message: "Pilih beli potion, beli senjata, atau beli armor. Satu barang per command." };
  const next = structuredClone(c);
  if (item === "potion") {
    if ((c.storedPotions ?? 0) >= MAX_STORED_POTIONS) return { ok: false, message: "Cadangan potion penuh (10 botol)." };
    next.storedPotions = (c.storedPotions ?? 0) + 1;
    return { ok: true, cost: POTION_PRICE, character: next, message: `Potion dibeli seharga ${money(POTION_PRICE)}. Dipakai setelah bekal gratis habis; sisa cadangan tetap tersimpan saat pulang.` };
  }
  const key = item === "senjata" ? "weapon" : "armor";
  const target = c[key] + 1, materialCost = target * 2, cost = target * 10_000;
  if (target > 10) return { ok: false, message: "Upgrade sudah maksimum (+10)." };
  if (c.materials < materialCost) return { ok: false, message: `Butuh ${materialCost} material untuk upgrade ${item} +${target}.` };
  next[key] = target;
  next.materials -= materialCost;
  return { ok: true, cost, character: next, message: `${item} naik ke +${target}. Biaya ${money(cost)} dan ${materialCost} material.` };
}

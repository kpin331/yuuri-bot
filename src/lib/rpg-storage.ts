import { getDb } from "./db.js";
import { getWallet, isBalanceFrozen } from "./casino-storage.js";
import { prepareRpgPurchase, renderRpgShop } from "./rpg-shop.js";
import { actRpg, CLASSES, createCharacter, renderRpg, type Character, type Role } from "./rpg.js";

export function handleRpg(platform: string, userId: string, input: string, prefix: string, messageId: string): string {
  const db = getDb();
  if (!db) return "Penyimpanan RPG sedang tidak tersedia.";
  db.exec("BEGIN IMMEDIATE");
  try {
    const previous = db.prepare("SELECT response FROM rpg_receipts WHERE platform = ? AND user_id = ? AND message_id = ? UNION ALL SELECT response FROM rpg_purchases WHERE platform = ? AND user_id = ? AND message_id = ? LIMIT 1").get(platform, userId, messageId, platform, userId, messageId) as { response: string } | undefined;
    if (previous) { db.exec("COMMIT"); return previous.response; }
    const row = db.prepare("SELECT state FROM rpg_characters WHERE platform = ? AND user_id = ?").get(platform, userId) as { state: string } | undefined;
    let character: Character | null = row ? JSON.parse(row.state) : null;
    let response: string;
    let purchased = false;
    if (!character) {
      const parts = input.trim().toLowerCase().split(/\s+/);
      if (parts.length === 2 && parts[0] === "buat" && Object.hasOwn(CLASSES, parts[1]!)) {
        character = createCharacter(parts[1] as Role);
        response = `Karakter dibuat.\n${renderRpg(character, prefix)}`;
      } else {
        response = `Pilih class sekali saat membuat karakter:\n${Object.entries(CLASSES).map(([role, s]) => `${role}: HP ${s.hp}, mana ${s.mana}. ${s.skill}.`).join("\n")}\nKirim ${prefix}rpg buat <class>\nContoh: ${prefix}rpg buat warrior\nGold dan level RPG terpisah dari saldo serta level chat.`;
      }
    } else {
      const [action, ...args] = input.trim().toLowerCase().split(/\s+/);
      let outcome: string;
      if (action === "toko") {
        outcome = args.length ? "Gunakan toko tanpa argumen." : renderRpgShop(character, prefix, getWallet(userId)?.balance ?? 0);
      } else if (action === "beli") {
        const purchase = prepareRpgPurchase(character, args.join(" "));
        if (!purchase.ok) outcome = purchase.message;
        else if (isBalanceFrozen(userId)) outcome = "Saldo kasino dibekukan. Lunasi pinjaman terlebih dahulu.";
        else {
          const wallet = getWallet(userId);
          if (!wallet || wallet.balance < purchase.cost) outcome = `⚠️ Saldo kasino tidak cukup. Butuh Rp${purchase.cost.toLocaleString("id-ID")}.`;
          else {
            const debit = db.prepare("UPDATE casino_wallets SET balance = balance - ?, updated_at = ? WHERE user_id = ? AND balance >= ? AND balance_frozen = 0").run(purchase.cost, Date.now(), userId, purchase.cost);
            if (Number(debit.changes) !== 1) throw new Error("Saldo berubah saat pembelian RPG.");
            character = purchase.character;
            purchased = true;
            outcome = `${purchase.message}\nSisa saldo kasino: Rp${(wallet.balance - purchase.cost).toLocaleString("id-ID")}.`;
          }
        }
      } else outcome = actRpg(character, input);
      response = [outcome, renderRpg(character, prefix)].filter(Boolean).join("\n\n");
    }
    if (character) db.prepare("INSERT INTO rpg_characters (platform, user_id, state) VALUES (?, ?, ?) ON CONFLICT(platform, user_id) DO UPDATE SET state = excluded.state").run(platform, userId, JSON.stringify(character));
    if (purchased) db.prepare("INSERT INTO rpg_purchases (platform, user_id, message_id, response) VALUES (?, ?, ?, ?)").run(platform, userId, messageId, response);
    db.prepare("INSERT INTO rpg_receipts (platform, user_id, message_id, response) VALUES (?, ?, ?, ?)").run(platform, userId, messageId, response);
    db.prepare("DELETE FROM rpg_receipts WHERE platform = ? AND user_id = ? AND rowid NOT IN (SELECT rowid FROM rpg_receipts WHERE platform = ? AND user_id = ? ORDER BY rowid DESC LIMIT 100)").run(platform, userId, platform, userId);
    db.exec("COMMIT");
    return response;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

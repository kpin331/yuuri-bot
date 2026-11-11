export function greetingForTime(now: number = Date.now()): string {
  const hour = Number(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta", hour: "2-digit", hourCycle: "h23",
  }).format(new Date(now)));
  if (hour >= 4 && hour < 11) return "pagi";
  if (hour >= 11 && hour < 15) return "siang";
  if (hour >= 15 && hour < 18) return "sore";
  return "malam";
}

export function startMessage(name: string, commandCount: number, level: number): string {
  return `Selamat ${greetingForTime()}, ${name}.\nJumlah command tersedia: ${commandCount}\nLevel kamu: ${level}\n\nKetik help untuk menampilkan semua command.`;
}

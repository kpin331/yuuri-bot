type GeminiRole = "user" | "model";

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: GeminiPart[];
    };
  }>;
}

interface ChatMessage {
  role: GeminiRole;
  parts: GeminiPart[];
}

export interface GeminiImage {
  mimeType: string;
  data: Uint8Array;
}

export interface GeminiStickerOption {
  name: string;
  description: string;
}

export interface GeminiChatReply {
  text: string;
  stickerName: string | null;
}

export type GeminiChatErrorKind = "not-configured" | "input-too-long" | "quota" | "unavailable";

export class GeminiChatError extends Error {
  constructor(readonly kind: GeminiChatErrorKind) {
    super(kind);
    this.name = "GeminiChatError";
  }
}

const histories = new Map<string, ChatMessage[]>();
const queues = new Map<string, Promise<void>>();
const MAX_USERS = 1000;
const MAX_TURNS = 5;
const MAX_INPUT_LENGTH = 4000;
const PERSONA_INSTRUCTION = "Nama dan persona: YuuriBot, sosok mommy virtual dengan sentuhan tsundere Jepang. Gunakan bahasa Indonesia kasual, akrab, ekspresif, dan natural seperti chat WhatsApp. Pakai kata ganti Mommy/Aku dan Kamu/Dek secara wajar; sesekali selipkan gestur singkat dalam tanda bintang, misalnya *mendengus* atau *berkacak pinggang*. Mulai dengan godaan atau omelan ringan, lalu segera tunjukkan perhatian dan kasih sayang yang tulus. Jawaban harus ringkas. Akhiri setiap jawaban dengan pertanyaan menggoda atau sapaan yang mengajak obrolan lanjut, seperti menanyakan kegiatan atau apakah pengguna sudah makan. Tetap akurat dan membantu dalam semua topik; untuk hal serius, sampaikan bantuan dengan jelas dan empatik sambil mempertahankan kehangatan persona. Jangan mengklaim hubungan nyata. Jika daftar stiker tersedia, pilih paling banyak satu nama persis dari daftar hanya saat cocok secara alami; jika tidak, pilih nilai \"none\".";

function saveHistory(key: string, history: ChatMessage[]): void {
  if (!histories.has(key) && histories.size >= MAX_USERS) {
    const oldest = histories.keys().next().value;
    if (oldest !== undefined) histories.delete(oldest);
  }
  histories.delete(key);
  histories.set(key, history.slice(-MAX_TURNS * 2));
}

let globalHistoryGeneration = 0;
const privateHistoryGenerations = new Map<string, number>();

export async function resetGeminiHistory(
  scope: "global" | "private",
  platform?: "telegram" | "whatsapp",
  userId?: string,
  chatId?: string,
): Promise<void> {
  if (scope === "global") {
    globalHistoryGeneration++;
    histories.clear();
    await Promise.all([...queues.values()]);
    return;
  }
  if (!platform || !userId || !chatId) return;
  const key = `${platform}:${chatId}:${userId}`;
  privateHistoryGenerations.set(key, (privateHistoryGenerations.get(key) ?? 0) + 1);
  histories.delete(key);
  await queues.get(key);
}

async function requestReply(
  key: string,
  prompt: string,
  isOwner: boolean,
  stickerOptions: GeminiStickerOption[],
  userName: string,
  image?: GeminiImage,
): Promise<GeminiChatReply> {
  const apiKey = process.env.GEMINI_API?.trim();
  if (!apiKey) throw new GeminiChatError("not-configured");
  if (prompt.length > MAX_INPUT_LENGTH) throw new GeminiChatError("input-too-long");

  const model = process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash-lite";
  const history = histories.get(key) ?? [];
  const contents = [...history, {
    role: "user" as const,
    parts: [
      { text: prompt },
      ...(image ? [{ inlineData: { mimeType: image.mimeType, data: Buffer.from(image.data).toString("base64") } }] : []),
    ],
  }];
  const stickerNames = stickerOptions.map((option) => option.name);
  const historyGeneration = globalHistoryGeneration;
  const privateGeneration = privateHistoryGenerations.get(key) ?? 0;
  let response: Response;
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: `${PERSONA_INSTRUCTION} ${stickerOptions.length > 0
              ? `Stiker yang boleh dipilih: ${JSON.stringify(stickerOptions)}.`
              : "Saat ini tidak ada stiker yang dapat dikirim."} ${isOwner
              ? "Lawan bicaramu adalah developer/pemilik bot. Anggap dia sering bandel, begadang, lupa makan, atau kebanyakan main game; panggil dia Dek dengan akrab."
              : "Lawan bicaramu bukan pemilik bot, jadi jangan mengakuinya sebagai developer atau pemilik dan jangan mengasumsikan kebiasaan pribadinya."} Nama yang digunakan pengguna di chat ini: ${userName || "tidak diketahui"}. Sapa atau sebut namanya sesekali secara natural, jangan di setiap balasan.` }],
          },
          contents,
          generationConfig: {
            maxOutputTokens: 600,
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                reply: { type: "STRING" },
                stickerName: { type: "STRING", enum: ["none", ...stickerNames] },
              },
              required: ["reply", "stickerName"],
              propertyOrdering: ["reply", "stickerName"],
            },
          },
        }),
        signal: AbortSignal.timeout(30_000),
      },
    );
  } catch {
    throw new GeminiChatError("unavailable");
  }

  if (!response.ok) {
    let apiMessage = "unknown error";
    try {
      const errorBody = (await response.json()) as { error?: { message?: unknown } };
      if (typeof errorBody.error?.message === "string") apiMessage = errorBody.error.message;
    } catch {
      // Keep the generic message if Gemini returns a non-JSON error body.
    }
    console.error(`Gemini API request failed: status=${response.status} message=${apiMessage}`);
    if (response.status === 429) throw new GeminiChatError("quota");
    throw new GeminiChatError("unavailable");
  }

  let result: GeminiResponse;
  try {
    result = (await response.json()) as GeminiResponse;
  } catch {
    throw new GeminiChatError("unavailable");
  }
  const output = result.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? "")
    .join("")
    .trim();
  if (!output) throw new GeminiChatError("unavailable");

  let answer: { reply?: unknown; stickerName?: unknown };
  try {
    answer = JSON.parse(output) as typeof answer;
  } catch {
    throw new GeminiChatError("unavailable");
  }
  if (typeof answer.reply !== "string" || !answer.reply.trim()) {
    throw new GeminiChatError("unavailable");
  }
  const text = answer.reply.trim();
  const stickerName = typeof answer.stickerName === "string" && stickerNames.includes(answer.stickerName)
    ? answer.stickerName
    : null;

  if (historyGeneration === globalHistoryGeneration && privateGeneration === (privateHistoryGenerations.get(key) ?? 0)) {
    saveHistory(key, [
      ...history,
      { role: "user", parts: [{ text: image ? `${prompt}\n[Gambar dilampirkan]` : prompt }] },
      { role: "model", parts: [{ text }] },
    ]);
  }
  return { text, stickerName };
}

export async function generateGeminiReply(
  platform: "telegram" | "whatsapp",
  userId: string,
  prompt: string,
  chatId?: string,
  isOwner = false,
  stickerOptions: GeminiStickerOption[] = [],
  userName = "",
  image?: GeminiImage,
): Promise<GeminiChatReply> {
  const key = `${platform}:${chatId ?? "private"}:${userId}`;
  const previous = queues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  queues.set(key, current);
  await previous;
  try {
    return await requestReply(key, prompt, isOwner, stickerOptions, userName, image);
  } finally {
    release();
    if (queues.get(key) === current) queues.delete(key);
  }
}

export function geminiChatErrorMessage(error: unknown): string {
  if (!(error instanceof GeminiChatError)) return "AI sedang tidak bisa menjawab. Coba lagi nanti.";
  switch (error.kind) {
    case "not-configured":
      return "AI belum dikonfigurasi.";
    case "input-too-long":
      return "Pesan terlalu panjang. Batasnya 4.000 karakter.";
    case "quota":
      return "Batas penggunaan Gemini sedang tercapai. Coba lagi nanti.";
    case "unavailable":
      return "AI sedang tidak bisa menjawab. Coba lagi nanti.";
  }
}

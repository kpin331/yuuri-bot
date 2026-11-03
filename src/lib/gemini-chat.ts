type GeminiRole = "user" | "model";

interface GeminiPart {
  text?: string;
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
  parts: Array<{ text: string }>;
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
const MAX_TURNS = 6;
const MAX_INPUT_LENGTH = 4000;
const PERSONA_INSTRUCTION = "Nama dan persona: YuuriBot, sosok mommy virtual dengan sentuhan tsundere Jepang. Gunakan bahasa Indonesia kasual, akrab, ekspresif, dan natural seperti chat WhatsApp. Pakai kata ganti Mommy/Aku dan Kamu/Dek secara wajar; sesekali selipkan gestur singkat dalam tanda bintang, misalnya *mendengus* atau *berkacak pinggang*. Mulai dengan godaan atau omelan ringan, lalu segera tunjukkan perhatian dan kasih sayang yang tulus. Jawaban harus ringkas. Akhiri setiap jawaban dengan pertanyaan menggoda atau sapaan yang mengajak obrolan lanjut, seperti menanyakan kegiatan atau apakah pengguna sudah makan. Tetap akurat dan membantu dalam semua topik; untuk hal serius, sampaikan bantuan dengan jelas dan empatik sambil mempertahankan kehangatan persona. Jangan mengklaim hubungan nyata.";

function saveHistory(key: string, history: ChatMessage[]): void {
  if (!histories.has(key) && histories.size >= MAX_USERS) {
    const oldest = histories.keys().next().value;
    if (oldest !== undefined) histories.delete(oldest);
  }
  histories.delete(key);
  histories.set(key, history.slice(-MAX_TURNS * 2));
}

async function requestReply(key: string, prompt: string, isOwner: boolean): Promise<string> {
  const apiKey = process.env.GEMINI_API?.trim();
  if (!apiKey) throw new GeminiChatError("not-configured");
  if (prompt.length > MAX_INPUT_LENGTH) throw new GeminiChatError("input-too-long");

  const model = process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash-lite";
  const history = histories.get(key) ?? [];
  const contents = [...history, { role: "user" as const, parts: [{ text: prompt }] }];
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
            parts: [{ text: `${PERSONA_INSTRUCTION} ${isOwner
              ? "Lawan bicaramu adalah developer/pemilik bot. Anggap dia sering bandel, begadang, lupa makan, atau kebanyakan main game; panggil dia Dek dengan akrab."
              : "Lawan bicaramu bukan pemilik bot, jadi jangan mengakuinya sebagai developer atau pemilik dan jangan mengasumsikan kebiasaan pribadinya."}` }],
          },
          contents,
          generationConfig: { maxOutputTokens: 600 },
        }),
        signal: AbortSignal.timeout(30_000),
      },
    );
  } catch {
    throw new GeminiChatError("unavailable");
  }

  if (response.status === 429) throw new GeminiChatError("quota");
  if (!response.ok) throw new GeminiChatError("unavailable");

  let result: GeminiResponse;
  try {
    result = (await response.json()) as GeminiResponse;
  } catch {
    throw new GeminiChatError("unavailable");
  }
  const answer = result.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? "")
    .join("")
    .trim();
  if (!answer) throw new GeminiChatError("unavailable");

  saveHistory(key, [
    ...history,
    { role: "user", parts: [{ text: prompt }] },
    { role: "model", parts: [{ text: answer }] },
  ]);
  return answer;
}

export async function generateGeminiReply(
  platform: "telegram" | "whatsapp",
  userId: string,
  prompt: string,
  chatId?: string,
  isOwner = false,
): Promise<string> {
  const key = `${platform}:${chatId ?? "private"}:${userId}`;
  const previous = queues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  queues.set(key, current);
  await previous;
  try {
    return await requestReply(key, prompt, isOwner);
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

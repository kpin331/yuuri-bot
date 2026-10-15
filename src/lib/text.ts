// The shared caption/menu builders in src/lib produce Telegram HTML. WhatsApp
// uses its own lightweight markup, so this converts the HTML we already build
// into WhatsApp formatting instead of duplicating every caption.
export function htmlToWhatsApp(input: string): string {
  return (
    input
      // Line breaks.
      .replace(/<br\s*\/?>/gi, "\n")
      // Bold: <b>..</b> / <strong>..</strong> -> *..*
      .replace(/<(b|strong)>([\s\S]*?)<\/\1>/gi, "*$2*")
      // Italic: <i>..</i> / <em>..</em> -> _.._
      .replace(/<(i|em)>([\s\S]*?)<\/\1>/gi, "_$2_")
      // Monospace: <code>..</code> -> ```..```
      .replace(/<code>([\s\S]*?)<\/code>/gi, "```$1```")
      // Links: <a href="URL">text</a> -> text (URL)
      .replace(/<a\s+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "$2 ($1)")
      // Strip any remaining tags.
      .replace(/<[^>]+>/g, "")
      // Unescape the entities last, so unescaped "<" never looks like a tag.
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
  );
}

// Escapes WhatsApp's own control characters so user text is shown literally.
export function escapeWhatsApp(input: string): string {
  return input.replace(/([*_~`])/g, "$1\u200b");
}

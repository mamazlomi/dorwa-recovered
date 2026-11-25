// Plain text out of a resume (PDF or DOCX) so the AI can read it. Best effort:
// a scanned PDF has no text layer and returns "" - the person types a summary instead.

const clean = (s: string) => s.replace(/\u0000/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

async function pdfText(buf: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(buf);
  const { text } = await extractText(pdf, { mergePages: true });
  return clean(Array.isArray(text) ? text.join("\n") : String(text ?? ""));
}

const ENT: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&apos;": "'" };

async function docxText(buf: Uint8Array): Promise<string> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file("word/document.xml")?.async("string");
  if (!xml) return "";
  return clean(xml
    .replace(/<w:tab\/>/g, " ")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<w:br[^>]*\/>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(amp|lt|gt|quot|apos);/g, (m) => ENT[m] ?? m)
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))));
}

export type ResumeKind = "pdf" | "docx";

/** Detects the real file type from its first bytes (never trusts the name alone). */
export function resumeKind(buf: Uint8Array): ResumeKind | null {
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return "pdf"; // %PDF
  if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) return "docx"; // PK zip
  return null;
}

export async function resumeText(buf: Uint8Array, kind: ResumeKind): Promise<string> {
  try {
    const t = kind === "pdf" ? await pdfText(buf) : await docxText(buf);
    return t.slice(0, 12000);
  } catch (e) {
    console.warn(`[resume] could not read ${kind}: ${String(e)}`);
    return "";
  }
}

// Cloudflare Workers AI, used only for suggestions a person reviews before
// saving (translations of titles/descriptions). Detachable: without the
// environment variables every caller simply gets `null`.
// Cost is capped by Cloudflare's daily free allocation on the free plan.

const ACCOUNT = process.env.CF_ACCOUNT_ID;
const TOKEN = process.env.CF_AI_TOKEN;
const TRANSLATE_MODEL = process.env.CF_AI_TRANSLATE_MODEL || "@cf/meta/m2m100-1.2b";
// tried in order; the larger model handles Persian/Arabic noticeably better
const CHAT_MODELS = (process.env.CF_AI_CHAT_MODEL || "@cf/meta/llama-3.3-70b-instruct-fp8-fast,@cf/meta/llama-3.1-8b-instruct")
  .split(",").map((m) => m.trim()).filter(Boolean);

export const aiEnabled = () => Boolean(ACCOUNT && TOKEN);

async function run(model: string, body: unknown): Promise<Record<string, unknown> | null> {
  if (!aiEnabled()) return null;
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/${model}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => null)) as
    { success?: boolean; result?: Record<string, unknown>; errors?: { message?: string }[] } | null;
  if (!res.ok || !json?.success) {
    console.warn(`[ai] ${model} failed: ${res.status} ${json?.errors?.map((e) => e.message).join("; ") ?? ""}`);
    return null;
  }
  return json.result ?? null;
}

const NAMES: Record<string, string> = { en: "English", ar: "Arabic", fa: "Persian" };

// Fixed shop vocabulary: exact, free and never "creative". Checked first.
const GLOSSARY: Record<string, { en: string; ar: string }> = {
  "مکمل": { en: "Supplements", ar: "المكملات الغذائية" },
  "مکمل ها": { en: "Supplements", ar: "المكملات الغذائية" },
  "مکمل غذایی": { en: "Dietary supplements", ar: "المكملات الغذائية" },
  "آرایشی و بهداشتی": { en: "Beauty & personal care", ar: "التجميل والعناية الشخصية" },
  "تجهیزات و ملزومات": { en: "Medical equipment & supplies", ar: "المعدات واللوازم الطبية" },
  "تجهیزات پزشکی": { en: "Medical equipment", ar: "المعدات الطبية" },
  "دارو": { en: "Medicines", ar: "الأدوية" },
  "داروها": { en: "Medicines", ar: "الأدوية" },
  "داروهای بدون نسخه": { en: "Over-the-counter medicines", ar: "أدوية بدون وصفة طبية" },
  "مادر و کودک": { en: "Mother & baby", ar: "الأم والطفل" },
  "بهداشت دهان": { en: "Oral care", ar: "العناية بالفم" },
  "بهداشت دهان و دندان": { en: "Oral & dental care", ar: "العناية بالفم والأسنان" },
  "تخفیف دارها": { en: "On sale", ar: "العروض" },
  "ویتامین ها": { en: "Vitamins", ar: "الفيتامينات" },
  "ورزشی": { en: "Sports nutrition", ar: "التغذية الرياضية" },
};
const norm = (s: string) =>
  s.replace(/[يى]/g, "ی").replace(/ك/g, "ک").replace(/[‌\s]+/g, " ").trim();

/**
 * Translates short shop text: glossary first, then chat models that are told
 * the context (an online pharmacy) — word-for-word models turn «مکمل» into the
 * mathematical "integration" in Arabic — and the translation model last.
 */
export async function translate(text: string, target: "en" | "ar", source = "fa"): Promise<string | null> {
  const clean = text.trim().slice(0, 600);
  if (!clean) return "";
  const known = source === "fa" ? GLOSSARY[norm(clean)] : undefined;
  if (known) return known[target];
  const tidy = (s: string) => {
    const out = s.trim().replace(/^["«“]|["»”]$/g, "").split("\n")[0].trim();
    return target === "en" && out ? out[0].toUpperCase() + out.slice(1) : out;
  };
  const hints = Object.entries(GLOSSARY).slice(0, 8).map(([fa, t]) => `${fa} = ${t[target]}`).join("; ");
  for (const model of CHAT_MODELS) {
    try {
      const r = await run(model, {
        messages: [
          { role: "system", content: `You translate labels and short descriptions for an online pharmacy and health-products shop (medicines, dietary supplements, cosmetics, medical equipment) from ${NAMES[source]} into ${NAMES[target]}. Use the usual retail wording of that domain. Reference terms: ${hints}. Reply with the translation only, no quotes, no notes.` },
          { role: "user", content: clean },
        ],
        max_tokens: 200,
      });
      const out = typeof r?.response === "string" ? tidy(r.response) : "";
      if (out) return out;
    } catch (e) {
      console.warn(`[ai] ${model} error: ${String(e)}`);
    }
  }
  try {
    const r = await run(TRANSLATE_MODEL, { text: clean, source_lang: source, target_lang: target });
    const out = typeof r?.translated_text === "string" ? tidy(r.translated_text) : "";
    return out || null;
  } catch {
    return null;
  }
}

/** Free text from a short prompt (Persian-capable models first); null when AI is off or fails. */
export async function write(system: string, user: string, maxTokens = 600): Promise<string | null> {
  for (const model of CHAT_MODELS) {
    try {
      const r = await run(model, { messages: [{ role: "system", content: system }, { role: "user", content: user }], max_tokens: maxTokens });
      const out = typeof r?.response === "string" ? r.response.trim() : "";
      if (out) return out;
    } catch (e) {
      console.warn(`[ai] ${model} error: ${String(e)}`);
    }
  }
  return null;
}

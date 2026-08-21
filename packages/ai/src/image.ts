/**
 * Image generation via OpenRouter (OpenAI-compatible images API).
 * Falls back to a deterministic SVG data-URL mock when keys/credits missing.
 */

export type GenerateImageInput = {
  prompt: string;
  model?: string;
  size?: "1024x1024" | "1792x1024" | "1024x1792";
};

export type GenerateImageResult = {
  provider: "openrouter" | "mock";
  model: string;
  imageUrl: string | null;
  imageB64: string | null;
  revisedPrompt?: string;
};

function mockSvgDataUrl(prompt: string): string {
  const safe = prompt
    .slice(0, 80)
    .replace(/[<>&"]/g, "")
    .replace(/\s+/g, " ");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="#1c1917"/><stop offset="100%" stop-color="#b45309"/>
  </linearGradient></defs>
  <rect width="1024" height="1024" fill="url(#g)"/>
  <text x="64" y="480" fill="#fafaf9" font-family="Georgia,serif" font-size="36">hrmny creative</text>
  <text x="64" y="540" fill="#fde68a" font-family="ui-sans-serif,system-ui" font-size="22">${safe}</text>
</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

export async function generateImage(
  input: GenerateImageInput,
): Promise<GenerateImageResult> {
  const model =
    input.model?.trim() ||
    process.env.LLM_IMAGE_MODEL?.trim() ||
    "google/gemini-2.5-flash-image-preview";
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key || process.env.LLM_PROVIDER === "mock") {
    return {
      provider: "mock",
      model: "mock-svg",
      imageUrl: mockSvgDataUrl(input.prompt),
      imageB64: null,
      revisedPrompt: input.prompt,
    };
  }

  try {
    // Prefer chat+modalities path used by OpenRouter image models.
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
        ...(process.env.NEXT_PUBLIC_APP_URL
          ? { "http-referer": process.env.NEXT_PUBLIC_APP_URL }
          : {}),
        "x-title": "hrmny OS creative",
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: `Generate an image: ${input.prompt}`,
          },
        ],
        modalities: ["image", "text"],
      }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) {
      // Fallback: OpenAI-style images endpoint
      const imgRes = await fetch(
        "https://openrouter.ai/api/v1/images/generations",
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${key}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model,
            prompt: input.prompt,
            size: input.size ?? "1024x1024",
          }),
          signal: AbortSignal.timeout(90_000),
        },
      );
      if (!imgRes.ok) {
        return {
          provider: "mock",
          model: "mock-svg",
          imageUrl: mockSvgDataUrl(input.prompt),
          imageB64: null,
        };
      }
      const imgJson = (await imgRes.json()) as {
        data?: Array<{ url?: string; b64_json?: string }>;
      };
      const first = imgJson.data?.[0];
      return {
        provider: "openrouter",
        model,
        imageUrl: first?.url ?? null,
        imageB64: first?.b64_json ?? null,
      };
    }

    const json = (await res.json()) as {
      choices?: Array<{
        message?: {
          content?: string | Array<{ type?: string; image_url?: { url?: string } }>;
          images?: Array<{ image_url?: { url?: string } }>;
        };
      }>;
    };
    const message = json.choices?.[0]?.message;
    const fromImages = message?.images?.[0]?.image_url?.url;
    let fromContent: string | null = null;
    if (Array.isArray(message?.content)) {
      for (const part of message.content) {
        if (part?.image_url?.url) {
          fromContent = part.image_url.url;
          break;
        }
      }
    }
    const url = fromImages ?? fromContent;
    if (url) {
      return {
        provider: "openrouter",
        model,
        imageUrl: url,
        imageB64: null,
      };
    }
  } catch {
    /* fall through */
  }

  return {
    provider: "mock",
    model: "mock-svg",
    imageUrl: mockSvgDataUrl(input.prompt),
    imageB64: null,
  };
}

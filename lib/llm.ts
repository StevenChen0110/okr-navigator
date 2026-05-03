import Anthropic from "@anthropic-ai/sdk";
import type { AIProvider } from "./types";

export type { AIProvider };

const OPENAI_COMPAT_BASE: Partial<Record<AIProvider, string>> = {
  openai: "https://api.openai.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
  grok: "https://api.x.ai/v1",
};

export const PROVIDER_LABEL: Record<AIProvider, string> = {
  anthropic: "Claude",
  openai: "ChatGPT",
  gemini: "Gemini",
  grok: "Grok",
};

export const PROVIDER_MODELS: Record<AIProvider, { id: string; label: string }[]> = {
  anthropic: [
    { id: "claude-haiku-4-5-20251001", label: "Haiku（快速）" },
    { id: "claude-sonnet-4-6", label: "Sonnet（均衡）" },
    { id: "claude-opus-4-7", label: "Opus（深度）" },
  ],
  openai: [
    { id: "gpt-4o-mini", label: "GPT-4o mini（快速）" },
    { id: "gpt-4o", label: "GPT-4o（均衡）" },
    { id: "o4-mini", label: "o4-mini（推理）" },
  ],
  gemini: [
    { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash（快速）" },
    { id: "gemini-2.5-flash-preview-04-17", label: "Gemini 2.5 Flash（均衡）" },
    { id: "gemini-2.5-pro-preview-03-25", label: "Gemini 2.5 Pro（深度）" },
  ],
  grok: [
    { id: "grok-3-mini", label: "Grok-3 mini（快速）" },
    { id: "grok-3", label: "Grok-3（均衡）" },
  ],
};

export const DEFAULT_MODEL: Record<AIProvider, string> = {
  anthropic: "claude-haiku-4-5-20251001",
  openai: "gpt-4o-mini",
  gemini: "gemini-2.0-flash",
  grok: "grok-3-mini",
};

export async function complete(
  provider: AIProvider,
  apiKey: string,
  model: string,
  system: string,
  user: string,
  maxTokens = 2048,
): Promise<string> {
  if (provider === "anthropic") {
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    });
    return (message.content[0] as { type: string; text: string }).text.trim();
  }

  const baseUrl = OPENAI_COMPAT_BASE[provider];
  if (!baseUrl) throw new Error(`Unknown provider: ${provider}`);

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`${provider} API error: ${err}`);
  }

  const data = await res.json() as { choices: { message: { content: string } }[] };
  return data.choices[0].message.content.trim();
}

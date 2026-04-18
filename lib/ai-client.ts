import { getSettings } from "./storage";

export async function callAI<T>(action: string, payload: Record<string, unknown>): Promise<T> {
  const settings = getSettings();
  const res = await fetch("/api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action,
      model: settings.claudeModel,
      language: settings.language,
      ...payload,
    }),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText);
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

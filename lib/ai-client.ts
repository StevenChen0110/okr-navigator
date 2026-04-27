import { getSettings, getEvaluationProfile } from "./storage";
import { buildEvaluationPrompt } from "./evaluation-prompt";

export async function callAI<T>(action: string, payload: Record<string, unknown>): Promise<T> {
  const settings = getSettings();

  const extraPayload: Record<string, unknown> =
    action === "analyzeIdea"
      ? { evaluationContext: buildEvaluationPrompt(getEvaluationProfile()) }
      : {};

  const res = await fetch("/api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action,
      model: settings.claudeModel,
      language: settings.language,
      ...extraPayload,
      ...payload,
    }),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText);
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

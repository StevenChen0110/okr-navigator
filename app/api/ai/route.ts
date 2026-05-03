import { NextRequest, NextResponse } from "next/server";
import type { AIProvider } from "@/lib/types";
import {
  analyzeIdea,
  clarifyIdea,
  classifyKR,
  refineObjective,
  suggestKeyResults,
  getQuarterRecommendation,
  analyzeConfidenceDrop,
  convertAllToSMART,
  refineKRTitle,
} from "@/lib/claude";

const ENV_KEYS: Record<string, string | undefined> = {
  anthropic: process.env.CLAUDE_API_KEY,
  openai: process.env.OPENAI_API_KEY,
  gemini: process.env.GEMINI_API_KEY,
  grok: process.env.GROK_API_KEY,
};

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { action, model, language, provider: providerRaw, apiKey: apiKeyFromBody, ...payload } = body as {
    action: string;
    model: string;
    language: "zh-TW" | "en";
    provider?: string;
    apiKey?: string;
    [key: string]: unknown;
  };

  const provider = (providerRaw ?? "anthropic") as AIProvider;
  const apiKey = (apiKeyFromBody as string | undefined) || ENV_KEYS[provider];
  if (!apiKey) {
    return NextResponse.json({ error: `API key not configured for provider: ${provider}` }, { status: 500 });
  }

  try {
    switch (action) {
      case "analyzeIdea": {
        const result = await analyzeIdea(
          apiKey, model, language,
          payload.ideaTitle as string,
          payload.ideaNotes as string,
          payload.objectives as Parameters<typeof analyzeIdea>[5],
          payload.evaluationContext as string | undefined,
          payload.groups as Parameters<typeof analyzeIdea>[7],
          provider,
        );
        return NextResponse.json(result);
      }
      case "classifyKR": {
        const result = await classifyKR(
          apiKey, model, language,
          payload.krTitle as string,
          payload.objectiveTitle as string,
          provider,
        );
        return NextResponse.json(result);
      }
      case "refineObjective": {
        const result = await refineObjective(apiKey, model, language, payload.rawInput as string, provider);
        return NextResponse.json(result);
      }
      case "suggestKeyResults": {
        const result = await suggestKeyResults(
          apiKey, model, language,
          payload.objectiveTitle as string,
          payload.objectiveDescription as string | undefined,
          payload.existingKRs as string[] | undefined,
          provider,
        );
        return NextResponse.json(result);
      }
      case "getQuarterRecommendation": {
        const result = await getQuarterRecommendation(
          apiKey, model, language,
          payload.objectiveTitle as string,
          payload.okrType as "committed" | "aspirational",
          payload.krScores as Array<{ title: string; score: number }>,
          provider,
        );
        return NextResponse.json(result);
      }
      case "analyzeConfidenceDrop": {
        const result = await analyzeConfidenceDrop(
          apiKey, model, language,
          payload.krTitle as string,
          payload.objectiveTitle as string,
          payload.confidence as Parameters<typeof analyzeConfidenceDrop>[5],
          provider,
        );
        return NextResponse.json(result);
      }
      case "convertAllToSMART": {
        const result = await convertAllToSMART(
          apiKey, model, language,
          payload.krs as string[],
          payload.objectiveTitle as string,
          payload.timeframe as string,
          provider,
        );
        return NextResponse.json(result);
      }
      case "refineKRTitle": {
        const result = await refineKRTitle(
          apiKey, model, language,
          payload.objectiveTitle as string,
          payload.currentTitle as string,
          payload.userInstruction as string,
          provider,
        );
        return NextResponse.json(result);
      }
      case "clarifyIdea": {
        const result = await clarifyIdea(
          apiKey, model, language,
          payload.ideaTitle as string,
          payload.objectives as Parameters<typeof clarifyIdea>[4],
          provider,
        );
        return NextResponse.json(result);
      }
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    console.error("[/api/ai]", action, err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

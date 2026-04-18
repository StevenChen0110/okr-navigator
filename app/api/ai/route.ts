import { NextRequest, NextResponse } from "next/server";
import {
  analyzeIdea,
  classifyKR,
  refineObjective,
  suggestKeyResults,
  generateSnapshot,
  getQuarterRecommendation,
  analyzeConfidenceDrop,
  convertAllToSMART,
  refineKRTitle,
} from "@/lib/claude";

export async function POST(req: NextRequest) {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "CLAUDE_API_KEY not configured" }, { status: 500 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { action, model, language, ...payload } = body as {
    action: string;
    model: string;
    language: "zh-TW" | "en";
    [key: string]: unknown;
  };

  try {
    switch (action) {
      case "analyzeIdea": {
        const result = await analyzeIdea(
          apiKey, model, language,
          payload.ideaTitle as string,
          payload.ideaWhy as string,
          payload.ideaOutcome as string,
          payload.ideaNotes as string,
          payload.objectives as Parameters<typeof analyzeIdea>[7],
          payload.backgroundContext as string | undefined,
        );
        return NextResponse.json(result);
      }
      case "classifyKR": {
        const result = await classifyKR(
          apiKey, model, language,
          payload.krTitle as string,
          payload.objectiveTitle as string,
        );
        return NextResponse.json(result);
      }
      case "refineObjective": {
        const result = await refineObjective(apiKey, model, language, payload.rawInput as string);
        return NextResponse.json(result);
      }
      case "suggestKeyResults": {
        const result = await suggestKeyResults(
          apiKey, model, language,
          payload.objectiveTitle as string,
          payload.objectiveDescription as string | undefined,
          payload.existingKRs as string[] | undefined,
          payload.backgroundContext as string | undefined,
        );
        return NextResponse.json(result);
      }
      case "generateSnapshot": {
        const result = await generateSnapshot(
          apiKey, model, language,
          payload.objectiveTitle as string,
          payload.motivation as string,
          payload.okrType as "committed" | "aspirational",
          payload.timeframe as string,
          payload.krs as string[],
        );
        return NextResponse.json(result);
      }
      case "getQuarterRecommendation": {
        const result = await getQuarterRecommendation(
          apiKey, model, language,
          payload.objectiveTitle as string,
          payload.okrType as "committed" | "aspirational",
          payload.krScores as Array<{ title: string; score: number }>,
        );
        return NextResponse.json(result);
      }
      case "analyzeConfidenceDrop": {
        const result = await analyzeConfidenceDrop(
          apiKey, model, language,
          payload.krTitle as string,
          payload.objectiveTitle as string,
          payload.confidence as Parameters<typeof analyzeConfidenceDrop>[5],
        );
        return NextResponse.json(result);
      }
      case "convertAllToSMART": {
        const result = await convertAllToSMART(
          apiKey, model, language,
          payload.krs as string[],
          payload.objectiveTitle as string,
          payload.timeframe as string,
        );
        return NextResponse.json(result);
      }
      case "refineKRTitle": {
        const result = await refineKRTitle(
          apiKey, model, language,
          payload.objectiveTitle as string,
          payload.currentTitle as string,
          payload.userInstruction as string,
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

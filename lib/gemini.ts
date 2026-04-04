import { GoogleGenerativeAI } from "@google/generative-ai";
import { Objective, IdeaAnalysis } from "./types";

const SYSTEM_PROMPT = `You are an OKR decision navigator. Given a user's Objectives and Key Results (OKRs) and a new Idea they are considering, you must analyze how much this Idea helps achieve each Objective.

Output ONLY valid JSON matching this exact schema:
{
  "objectiveScores": [
    {
      "objectiveId": "string",
      "objectiveTitle": "string",
      "overallScore": number (0-10, how much this idea helps achieve this Objective),
      "keyResultScores": [
        {
          "keyResultId": "string",
          "keyResultTitle": "string",
          "score": number (0-10),
          "reasoning": "string (1-2 sentences)"
        }
      ],
      "reasoning": "string (2-3 sentences explaining the O-level score)"
    }
  ],
  "finalScore": number (0-10, weighted average priority across all objectives),
  "risks": ["string", ...] (list of risks or negative side effects, empty array if none),
  "executionSuggestions": ["string", ...] (2-3 concrete action steps to execute this idea)
}

Scoring guide:
- 0-2: No meaningful contribution or actively harmful
- 3-4: Slight indirect contribution
- 5-6: Moderate contribution
- 7-8: Strong contribution
- 9-10: This idea is central to achieving the objective

The finalScore should reflect overall priority considering all objectives together. Weigh objectives equally unless context suggests otherwise. Output ONLY the JSON object, no markdown fences.`;

export async function analyzeIdea(
  apiKey: string,
  model: string,
  ideaTitle: string,
  ideaDescription: string,
  objectives: Objective[]
): Promise<IdeaAnalysis> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const genModel = genAI.getGenerativeModel({ model });

  const okrContext = objectives
    .map(
      (o) =>
        `Objective ID: ${o.id}\nObjective: ${o.title}${o.description ? `\nDescription: ${o.description}` : ""}\nKey Results:\n${o.keyResults
          .map((kr) => `  - KR ID: ${kr.id}\n    KR: ${kr.title}${kr.description ? `\n    Description: ${kr.description}` : ""}`)
          .join("\n")}`
    )
    .join("\n\n");

  const userPrompt = `USER'S OKRs:\n${okrContext}\n\nIDEA TO ANALYZE:\nTitle: ${ideaTitle}\nDescription: ${ideaDescription}`;

  const result = await genModel.generateContent(SYSTEM_PROMPT + "\n\n" + userPrompt);

  const text = result.response.text().trim();
  const parsed = JSON.parse(text) as Omit<IdeaAnalysis, "analyzedAt">;

  return {
    ...parsed,
    analyzedAt: new Date().toISOString(),
  };
}

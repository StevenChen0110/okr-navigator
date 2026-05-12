import type { IdeaAnalysis, Objective, EvaluationProfile, ObjGroup } from "./types";

export function computeWeightedScore(
  idea: { analysis: IdeaAnalysis | null },
  objectives: Objective[],
  profile: EvaluationProfile,
  groups: ObjGroup[],
): number {
  if (!idea.analysis) return 0;
  const w = profile.priorityWeights;
  const gw = profile.groupPriorityWeights;
  const groupMap = new Map(groups.map((g) => [g.id, g]));
  let sumScores = 0;
  let sumWeights = 0;
  for (const os of idea.analysis.objectiveScores) {
    const obj = objectives.find((o) => o.id === os.objectiveId);
    if (!obj) continue;
    const objPriority = obj.meta?.priority ?? 2;
    const objWeight = profile.considerPriority ? (w[objPriority] ?? 1) : 1;
    let groupWeight = 1;
    if (profile.considerGroupPriority && obj.meta?.groupId) {
      const g = groupMap.get(obj.meta.groupId);
      if (g) groupWeight = gw[g.priority] ?? 1;
    }
    const weight = objWeight * groupWeight;
    sumScores += os.overallScore * weight;
    sumWeights += weight;
  }
  return sumWeights > 0 ? sumScores / sumWeights : (idea.analysis.finalScore ?? 0);
}

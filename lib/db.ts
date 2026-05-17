import { supabase } from "./supabase";
import { Objective, Idea, TaskStatus, IdeaStatus, WeeklyLog, LogItem, AlignmentReport, Role } from "./types";

async function uid(): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  return user.id;
}

// ── Objectives ────────────────────────────────────────────────────────────────

export async function fetchObjectives(): Promise<Objective[]> {
  const { data, error } = await supabase
    .from("objectives")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => {
    // status is stored inside meta._status to avoid a schema migration
    const rawMeta = { ...(r.meta ?? {}) };
    const status = (rawMeta._status as Objective["status"]) ?? "active";
    delete rawMeta._status;
    return {
      id: r.id,
      title: r.title,
      description: r.description ?? "",
      keyResults: r.key_results,
      createdAt: r.created_at,
      status,
      meta: Object.keys(rawMeta).length ? rawMeta : undefined,
    };
  });
}

export async function saveObjective(objective: Objective): Promise<void> {
  const userId = await uid();
  const meta = {
    ...(objective.meta ?? {}),
    ...(objective.status && objective.status !== "active" ? { _status: objective.status } : {}),
  };
  const { error } = await supabase.from("objectives").upsert({
    id: objective.id,
    user_id: userId,
    title: objective.title,
    description: objective.description ?? "",
    key_results: objective.keyResults,
    created_at: objective.createdAt,
    meta: Object.keys(meta).length ? meta : null,
  });
  if (error) throw error;
}

export async function removeObjective(id: string): Promise<void> {
  const { error } = await supabase.from("objectives").delete().eq("id", id);
  if (error) throw error;
}

// ── Ideas ─────────────────────────────────────────────────────────────────────

export async function fetchIdeas(): Promise<Idea[]> {
  const { data, error } = await supabase
    .from("ideas")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    analysis: r.analysis,
    createdAt: r.created_at,
    completed: r.completed ?? false,
    completedAt: r.completed_at ?? undefined,
    linkedKRs: r.linked_krs ?? [],
    taskStatus: (r.task_status as TaskStatus) ?? undefined,
    ideaStatus: (r.idea_status as IdeaStatus) ?? "active",
    todos: r.todos ?? [],
    quickAnalysis: r.quick_analysis ?? false,
    needsReanalysis: r.needs_reanalysis ?? false,
  }));
}

export async function saveIdea(idea: Idea): Promise<void> {
  const userId = await uid();
  const { error } = await supabase.from("ideas").upsert({
    id: idea.id,
    user_id: userId,
    title: idea.title,
    description: idea.description,
    analysis: idea.analysis,
    created_at: idea.createdAt,
    completed: idea.completed ?? false,
    completed_at: idea.completedAt ?? null,
    linked_krs: idea.linkedKRs ?? [],
    task_status: idea.taskStatus ?? null,
    idea_status: idea.ideaStatus ?? "active",
    todos: idea.todos ?? [],
    quick_analysis: idea.quickAnalysis ?? false,
    needs_reanalysis: idea.needsReanalysis ?? false,
  });
  if (error) throw error;
}

export async function updateIdeaTaskStatus(id: string, taskStatus: TaskStatus | null): Promise<void> {
  const { error } = await supabase.from("ideas").update({
    task_status: taskStatus,
  }).eq("id", id);
  if (error) throw error;
}

export async function updateIdeaCompletion(id: string, completed: boolean): Promise<void> {
  const { error } = await supabase.from("ideas").update({
    completed,
    completed_at: completed ? new Date().toISOString() : null,
  }).eq("id", id);
  if (error) throw error;
}

export async function updateIdeaStatus(id: string, ideaStatus: IdeaStatus): Promise<void> {
  const { error } = await supabase.from("ideas").update({ idea_status: ideaStatus }).eq("id", id);
  if (error) throw error;
}

export async function removeIdea(id: string): Promise<void> {
  const { error } = await supabase.from("ideas").delete().eq("id", id);
  if (error) throw error;
}

export async function markAllIdeasForReanalysis(): Promise<void> {
  const { error } = await supabase
    .from("ideas")
    .update({ needs_reanalysis: true })
    .eq("idea_status", "active");
  if (error) throw error;
}

// ── Weekly Logs ───────────────────────────────────────────────────────────────

export async function fetchWeeklyLog(weekStart: string): Promise<WeeklyLog | null> {
  const { data, error } = await supabase
    .from("weekly_logs")
    .select("*")
    .eq("week_start", weekStart)
    .maybeSingle();
  if (error) { console.warn("weekly_logs not ready:", error.message); return null; }
  if (!data) return null;
  return { id: data.id, weekStart: data.week_start, rawInput: data.raw_input, createdAt: data.created_at };
}

export async function saveWeeklyLog(log: WeeklyLog): Promise<void> {
  const userId = await uid();
  const { error } = await supabase.from("weekly_logs").upsert({
    id: log.id,
    user_id: userId,
    week_start: log.weekStart,
    raw_input: log.rawInput,
    created_at: log.createdAt,
  });
  if (error) throw error;
}

// ── Log Items ─────────────────────────────────────────────────────────────────

export async function fetchLogItems(logId: string): Promise<LogItem[]> {
  const { data, error } = await supabase
    .from("log_items")
    .select("*")
    .eq("log_id", logId)
    .order("created_at", { ascending: true });
  if (error) { console.warn("log_items not ready:", error.message); return []; }
  return (data ?? []).map((r) => ({
    id: r.id,
    logId: r.log_id,
    content: r.content,
    krId: r.kr_id ?? null,
    krTitle: r.kr_title ?? null,
    isPlanned: r.is_planned ?? false,
    createdAt: r.created_at,
  }));
}

export async function saveLogItems(items: LogItem[]): Promise<void> {
  if (!items.length) return;
  const userId = await uid();
  const { error } = await supabase.from("log_items").upsert(
    items.map((i) => ({
      id: i.id,
      log_id: i.logId,
      user_id: userId,
      content: i.content,
      kr_id: i.krId ?? null,
      kr_title: i.krTitle ?? null,
      is_planned: i.isPlanned,
      created_at: i.createdAt,
    }))
  );
  if (error) throw error;
}

// ── Alignment Reports ─────────────────────────────────────────────────────────

export async function fetchReport(weekStart: string): Promise<AlignmentReport | null> {
  const { data, error } = await supabase
    .from("alignment_reports")
    .select("*")
    .eq("week_start", weekStart)
    .maybeSingle();
  if (error) { console.warn("alignment_reports not ready:", error.message); return null; }
  if (!data) return null;
  return {
    id: data.id,
    weekStart: data.week_start,
    alignmentScore: data.alignment_score,
    aiInsight: data.ai_insight,
    suggestions: data.suggestions ?? [],
    logId: data.log_id,
    createdAt: data.created_at,
  };
}

export async function fetchReports(): Promise<AlignmentReport[]> {
  const { data, error } = await supabase
    .from("alignment_reports")
    .select("*")
    .order("week_start", { ascending: false });
  if (error) { console.warn("alignment_reports not ready:", error.message); return []; }
  return (data ?? []).map((r) => ({
    id: r.id,
    weekStart: r.week_start,
    alignmentScore: r.alignment_score,
    aiInsight: r.ai_insight,
    suggestions: r.suggestions ?? [],
    logId: r.log_id,
    createdAt: r.created_at,
  }));
}

export async function saveReport(report: AlignmentReport): Promise<void> {
  const userId = await uid();
  const { error } = await supabase.from("alignment_reports").upsert({
    id: report.id,
    user_id: userId,
    week_start: report.weekStart,
    alignment_score: report.alignmentScore,
    ai_insight: report.aiInsight,
    suggestions: report.suggestions,
    log_id: report.logId,
    created_at: report.createdAt,
  });
  if (error) throw error;
}

// ── Roles ─────────────────────────────────────────────────────────────────────

export async function fetchRoles(): Promise<Role[]> {
  const { data, error } = await supabase
    .from("roles")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    emoji: r.emoji ?? "🎯",
    layer: (r.layer ?? 0) as 0 | 1 | 2 | 3,
    inferred: r.inferred ?? false,
    userConfirmed: r.user_confirmed ?? true,
    weight: r.weight ?? 1.0,
    color: r.color ?? undefined,
    description: r.description ?? undefined,
    createdAt: r.created_at,
  }));
}

export async function saveRole(role: Role): Promise<void> {
  const userId = await uid();
  const { error } = await supabase.from("roles").upsert({
    id: role.id,
    user_id: userId,
    name: role.name,
    emoji: role.emoji,
    layer: role.layer,
    inferred: role.inferred,
    user_confirmed: role.userConfirmed,
    weight: role.weight,
    color: role.color ?? null,
    description: role.description ?? null,
    created_at: role.createdAt,
  });
  if (error) throw error;
}

export async function deleteRole(id: string): Promise<void> {
  const { error } = await supabase.from("roles").delete().eq("id", id);
  if (error) throw error;
}

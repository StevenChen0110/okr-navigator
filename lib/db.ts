import { supabase } from "./supabase";
import { Objective, Idea, TaskStatus, IdeaStatus, Habit, HabitLog } from "./types";
import { v4 as uuid } from "uuid";

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

// ── Habits ────────────────────────────────────────────────────────────────────

export async function fetchHabits(): Promise<Habit[]> {
  const { data, error } = await supabase
    .from("habits")
    .select("*")
    .is("archived_at", null)
    .order("created_at", { ascending: true });
  if (error) {
    console.warn("habits table not ready:", error.message);
    return [];
  }
  return (data ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    cue: r.cue ?? undefined,
    frequency: r.frequency ?? "daily",
    streakCount: r.streak_count ?? 0,
    lastDoneAt: r.last_done_at ?? undefined,
    createdAt: r.created_at,
    archivedAt: r.archived_at ?? undefined,
  }));
}

export async function saveHabit(habit: Habit): Promise<void> {
  const userId = await uid();
  const { error } = await supabase.from("habits").upsert({
    id: habit.id,
    user_id: userId,
    name: habit.name,
    cue: habit.cue ?? null,
    frequency: habit.frequency,
    streak_count: habit.streakCount,
    last_done_at: habit.lastDoneAt ?? null,
    created_at: habit.createdAt,
    archived_at: habit.archivedAt ?? null,
  });
  if (error) throw error;
}

export async function removeHabit(id: string): Promise<void> {
  const { error } = await supabase.from("habits").update({ archived_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

export async function fetchTodayHabitLogs(): Promise<HabitLog[]> {
  const today = new Date().toISOString().split("T")[0];
  const { data, error } = await supabase
    .from("habit_logs")
    .select("*")
    .eq("logged_at", today);
  if (error) {
    console.warn("habit_logs table not ready:", error.message);
    return [];
  }
  return (data ?? []).map((r) => ({
    id: r.id,
    habitId: r.habit_id,
    loggedAt: r.logged_at,
    skipped: r.skipped ?? false,
  }));
}

export async function logHabitDone(habitId: string, habit: Habit): Promise<Habit> {
  const userId = await uid();
  const today = new Date().toISOString().split("T")[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];

  const logId = uuid();
  const { error: logError } = await supabase.from("habit_logs").upsert({
    id: logId,
    habit_id: habitId,
    user_id: userId,
    logged_at: today,
    skipped: false,
  });
  if (logError) throw logError;

  const newStreak = habit.lastDoneAt === yesterday ? habit.streakCount + 1 : 1;
  const updatedHabit: Habit = { ...habit, streakCount: newStreak, lastDoneAt: today };
  await saveHabit(updatedHabit);
  return updatedHabit;
}

export async function undoHabitLog(habitId: string, habit: Habit): Promise<Habit> {
  const today = new Date().toISOString().split("T")[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];

  await supabase.from("habit_logs").delete().eq("habit_id", habitId).eq("logged_at", today);

  const newStreak = Math.max(0, habit.streakCount - 1);
  const updatedHabit: Habit = {
    ...habit,
    streakCount: newStreak,
    lastDoneAt: newStreak > 0 ? yesterday : undefined,
  };
  await saveHabit(updatedHabit);
  return updatedHabit;
}

import { supabase } from "./supabase";
import { Objective, Idea, TaskStatus } from "./types";

async function uid(): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  return user.id;
}

// Objectives

export async function fetchObjectives(): Promise<Objective[]> {
  const { data, error } = await supabase
    .from("objectives")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description ?? "",
    keyResults: r.key_results,
    createdAt: r.created_at,
    meta: r.meta ?? undefined,
  }));
}

export async function saveObjective(objective: Objective): Promise<void> {
  const userId = await uid();
  const { error } = await supabase.from("objectives").upsert({
    id: objective.id,
    user_id: userId,
    title: objective.title,
    description: objective.description ?? "",
    key_results: objective.keyResults,
    created_at: objective.createdAt,
    meta: objective.meta ?? null,
  });
  if (error) throw error;
}

export async function removeObjective(id: string): Promise<void> {
  const { error } = await supabase.from("objectives").delete().eq("id", id);
  if (error) throw error;
}

// Ideas

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

export async function removeIdea(id: string): Promise<void> {
  const { error } = await supabase.from("ideas").delete().eq("id", id);
  if (error) throw error;
}


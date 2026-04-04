import { supabase } from "./supabase";
import { Objective, Idea } from "./types";

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
  });
  if (error) throw error;
}

export async function removeIdea(id: string): Promise<void> {
  const { error } = await supabase.from("ideas").delete().eq("id", id);
  if (error) throw error;
}

"use client";

import { useState, useEffect } from "react";
import { v4 as uuid } from "uuid";
import { Objective, KeyResult } from "@/lib/types";
import { getObjectives, saveObjectives } from "@/lib/storage";

export default function OKRPage() {
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    setObjectives(getObjectives());
  }, []);

  function persist(next: Objective[]) {
    setObjectives(next);
    saveObjectives(next);
  }

  function addObjective() {
    const newO: Objective = {
      id: uuid(),
      title: "",
      description: "",
      keyResults: [],
      createdAt: new Date().toISOString(),
    };
    const next = [...objectives, newO];
    persist(next);
    setEditingId(newO.id);
  }

  function updateObjective(id: string, patch: Partial<Objective>) {
    persist(objectives.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  }

  function deleteObjective(id: string) {
    if (!confirm("確定要刪除這個目標嗎？")) return;
    persist(objectives.filter((o) => o.id !== id));
    if (editingId === id) setEditingId(null);
  }

  function addKR(objectiveId: string) {
    const kr: KeyResult = { id: uuid(), title: "", description: "" };
    updateObjective(objectiveId, {
      keyResults: [
        ...(objectives.find((o) => o.id === objectiveId)?.keyResults ?? []),
        kr,
      ],
    });
  }

  function updateKR(objectiveId: string, krId: string, patch: Partial<KeyResult>) {
    const o = objectives.find((o) => o.id === objectiveId);
    if (!o) return;
    updateObjective(objectiveId, {
      keyResults: o.keyResults.map((kr) =>
        kr.id === krId ? { ...kr, ...patch } : kr
      ),
    });
  }

  function deleteKR(objectiveId: string, krId: string) {
    const o = objectives.find((o) => o.id === objectiveId);
    if (!o) return;
    updateObjective(objectiveId, {
      keyResults: o.keyResults.filter((kr) => kr.id !== krId),
    });
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 md:px-6 md:py-10">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-xl font-semibold">OKR 目標管理</h1>
          <p className="text-sm text-gray-500 mt-0.5">定義你的長期目標與量化指標</p>
        </div>
        <button
          onClick={addObjective}
          className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors"
        >
          + 新增目標
        </button>
      </div>

      {objectives.length === 0 && (
        <div className="text-center py-20 text-gray-400">
          <div className="text-4xl mb-3">◎</div>
          <p className="text-sm">還沒有目標，點擊「新增目標」開始</p>
        </div>
      )}

      <div className="space-y-4">
        {objectives.map((o, oi) => (
          <div key={o.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {/* Objective Header */}
            <div className="p-5">
              <div className="flex items-start gap-3">
                <span className="mt-1 text-xs font-bold text-indigo-400 bg-indigo-50 rounded px-1.5 py-0.5 shrink-0">
                  O{oi + 1}
                </span>
                <div className="flex-1 space-y-2">
                  <input
                    value={o.title}
                    onChange={(e) => updateObjective(o.id, { title: e.target.value })}
                    placeholder="目標名稱（例：成為全端開發者）"
                    className="w-full font-medium text-sm bg-transparent border-b border-transparent focus:border-indigo-300 focus:outline-none pb-0.5 placeholder:text-gray-300"
                  />
                  <input
                    value={o.description ?? ""}
                    onChange={(e) => updateObjective(o.id, { description: e.target.value })}
                    placeholder="目標描述（選填）"
                    className="w-full text-xs text-gray-500 bg-transparent border-b border-transparent focus:border-indigo-300 focus:outline-none pb-0.5 placeholder:text-gray-300"
                  />
                </div>
                <button
                  onClick={() => deleteObjective(o.id)}
                  className="text-gray-300 hover:text-red-400 transition-colors text-lg leading-none mt-0.5"
                >
                  ×
                </button>
              </div>
            </div>

            {/* Key Results */}
            <div className="border-t border-gray-100 px-5 pb-4">
              <div className="space-y-2 pt-3">
                {o.keyResults.map((kr, kri) => (
                  <div key={kr.id} className="flex items-start gap-2">
                    <span className="mt-2 text-xs text-gray-400 shrink-0">KR{kri + 1}</span>
                    <div className="flex-1 space-y-1">
                      <input
                        value={kr.title}
                        onChange={(e) => updateKR(o.id, kr.id, { title: e.target.value })}
                        placeholder="量化指標（例：完成 3 個全端專案）"
                        className="w-full text-sm bg-gray-50 rounded-lg px-3 py-1.5 border border-transparent focus:border-indigo-300 focus:outline-none placeholder:text-gray-300"
                      />
                      <input
                        value={kr.description ?? ""}
                        onChange={(e) => updateKR(o.id, kr.id, { description: e.target.value })}
                        placeholder="補充說明（選填）"
                        className="w-full text-xs text-gray-400 bg-transparent px-3 focus:outline-none placeholder:text-gray-300"
                      />
                    </div>
                    <button
                      onClick={() => deleteKR(o.id, kr.id)}
                      className="mt-2 text-gray-300 hover:text-red-400 transition-colors"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              <button
                onClick={() => addKR(o.id)}
                className="mt-3 text-xs text-indigo-500 hover:text-indigo-700 font-medium"
              >
                + 新增 Key Result
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

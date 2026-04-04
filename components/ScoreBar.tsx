"use client";

interface Props {
  score: number; // 0-10
  label?: string;
  showValue?: boolean;
}

export default function ScoreBar({ score, label, showValue = true }: Props) {
  const pct = (score / 10) * 100;
  const color =
    score >= 7 ? "bg-indigo-500" : score >= 4 ? "bg-amber-400" : "bg-red-400";

  return (
    <div className="space-y-1">
      {label && (
        <div className="flex justify-between items-center">
          <span className="text-xs text-gray-600 truncate max-w-[180px]">{label}</span>
          {showValue && (
            <span className="text-xs font-semibold text-gray-700 ml-2">{score.toFixed(1)}</span>
          )}
        </div>
      )}
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

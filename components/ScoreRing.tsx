"use client";

interface Props {
  score: number;
  scale?: "0-10" | "0-100";
  size?: number;
  label?: string;
}

export default function ScoreRing({ score, scale = "0-10", size = 64, label }: Props) {
  const pct = scale === "0-100" ? score / 100 : score / 10;
  const r = (size - 10) / 2;
  const circ = 2 * Math.PI * r;
  const dash = pct * circ;

  const threshold = scale === "0-100"
    ? { high: 70, mid: 40 }
    : { high: 7, mid: 4 };
  const color = score >= threshold.high ? "#6366f1" : score >= threshold.mid ? "#f59e0b" : "#ef4444";

  const displayText = scale === "0-100" ? `${Math.round(score)}%` : score.toFixed(1);

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e5e7eb" strokeWidth={6} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={color} strokeWidth={6}
          strokeDasharray={`${dash} ${circ - dash}`} strokeLinecap="round"
        />
      </svg>
      <div className="flex flex-col items-center" style={{ marginTop: -(size / 2 + 16) }}>
        <span className="font-bold text-lg leading-none" style={{ color }}>{displayText}</span>
      </div>
      {label && <span className="text-xs text-gray-500 text-center leading-tight">{label}</span>}
    </div>
  );
}

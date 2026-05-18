"use client";

import type { IdeaValidationReport } from "@/lib/types";

function scoreColor(score: number): string {
  if (score >= 7) return "#22c55e"; // green-500
  if (score >= 4) return "#f59e0b"; // amber-400
  return "#ef4444"; // red-400
}

function scoreLabel(score: number, zh: boolean): string {
  if (score >= 7) return zh ? "強" : "Strong";
  if (score >= 4) return zh ? "中" : "Fair";
  return zh ? "弱" : "Weak";
}

function scoreBg(score: number): string {
  if (score >= 7) return "bg-green-50 border-green-200 text-green-700";
  if (score >= 4) return "bg-amber-50 border-amber-200 text-amber-700";
  return "bg-red-50 border-red-200 text-red-500";
}

interface Props {
  report: IdeaValidationReport;
  zh?: boolean;
}

export default function IkigaiViz({ report, zh = true }: Props) {
  const { ikigai } = report;
  const dims = [
    { key: "passion",    label: zh ? "熱情" : "Passion",    dim: ikigai.passion,    cx: 75,  cy: 75  },
    { key: "impact",     label: zh ? "影響力" : "Impact",   dim: ikigai.impact,     cx: 125, cy: 75  },
    { key: "expertise",  label: zh ? "能力" : "Expertise",  dim: ikigai.expertise,  cx: 75,  cy: 125 },
    { key: "viability",  label: zh ? "可行性" : "Viability", dim: ikigai.viability, cx: 125, cy: 125 },
  ];

  const overall = ikigai.overallScore;

  return (
    <div className="space-y-4">
      {/* SVG 4 overlapping circles */}
      <div className="flex justify-center">
        <svg viewBox="0 0 200 200" className="w-48 h-48">
          {/* Glow defs */}
          <defs>
            {dims.map((d) => (
              <radialGradient key={d.key} id={`grad-${d.key}`} cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor={scoreColor(d.dim.score)} stopOpacity="0.5" />
                <stop offset="100%" stopColor={scoreColor(d.dim.score)} stopOpacity="0.08" />
              </radialGradient>
            ))}
          </defs>

          {/* 4 overlapping circles */}
          {dims.map((d) => (
            <circle
              key={d.key}
              cx={d.cx}
              cy={d.cy}
              r="55"
              fill={`url(#grad-${d.key})`}
              stroke={scoreColor(d.dim.score)}
              strokeWidth="1.5"
              strokeOpacity="0.4"
            />
          ))}

          {/* Center badge */}
          <circle cx="100" cy="100" r="22" fill="white" stroke="#e5e7eb" strokeWidth="1" />
          <text
            x="100" y="96"
            textAnchor="middle"
            fontSize="11"
            fontWeight="700"
            fill={scoreColor(overall)}
          >
            {overall.toFixed(1)}
          </text>
          <text x="100" y="108" textAnchor="middle" fontSize="7" fill="#9ca3af">
            {zh ? "目的感" : "Purpose"}
          </text>

          {/* Score labels inside each circle */}
          {dims.map((d) => (
            <text
              key={d.key}
              x={d.cx}
              y={d.cy + 4}
              textAnchor="middle"
              fontSize="12"
              fontWeight="700"
              fill={scoreColor(d.dim.score)}
            >
              {d.dim.score}
            </text>
          ))}

          {/* Corner labels */}
          <text x="28" y="22" textAnchor="middle" fontSize="7.5" fill="#6b7280">{dims[0].label}</text>
          <text x="172" y="22" textAnchor="middle" fontSize="7.5" fill="#6b7280">{dims[1].label}</text>
          <text x="28" y="188" textAnchor="middle" fontSize="7.5" fill="#6b7280">{dims[2].label}</text>
          <text x="172" y="188" textAnchor="middle" fontSize="7.5" fill="#6b7280">{dims[3].label}</text>
        </svg>
      </div>

      {/* Dimension cards */}
      <div className="grid grid-cols-2 gap-2">
        {dims.map((d) => (
          <div key={d.key} className={`rounded-xl border px-3 py-2.5 ${scoreBg(d.dim.score)}`}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold">{d.label}</span>
              <span className="text-xs font-bold font-mono">
                {d.dim.score}/10
                <span className="ml-1 font-normal opacity-70">
                  {scoreLabel(d.dim.score, zh)}
                </span>
              </span>
            </div>
            <p className="text-xs opacity-80 leading-snug">{d.dim.reasoning}</p>
          </div>
        ))}
      </div>

      {/* Verdict */}
      <div className="rounded-xl bg-gray-50 border border-gray-100 px-4 py-3">
        <p className="text-xs text-gray-500 font-medium mb-1">
          {zh ? "AI 綜合判斷" : "Overall Verdict"}
        </p>
        <p className="text-sm text-gray-700 leading-relaxed">{ikigai.verdict}</p>
      </div>

      {/* Market Research */}
      {report.marketResearch && (
        <div className="rounded-xl border border-blue-100 bg-blue-50/40 px-4 py-3 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-blue-700 uppercase tracking-widest">
              {zh ? "市場資料" : "Market Data"}
            </p>
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
              report.marketResearch.fromWebSearch
                ? "bg-blue-100 text-blue-600"
                : "bg-gray-100 text-gray-500"
            }`}>
              {report.marketResearch.fromWebSearch
                ? (zh ? "來自網路資料" : "From web search")
                : (zh ? "AI 知識庫" : "AI knowledge")}
            </span>
          </div>

          {report.marketResearch.marketSize && (
            <div>
              <p className="text-[11px] font-semibold text-blue-600 mb-0.5">{zh ? "市場規模" : "Market Size"}</p>
              <p className="text-xs text-gray-700 leading-snug">{report.marketResearch.marketSize}</p>
            </div>
          )}
          {report.marketResearch.painPoints && (
            <div>
              <p className="text-[11px] font-semibold text-blue-600 mb-0.5">{zh ? "已知痛點" : "Pain Points"}</p>
              <p className="text-xs text-gray-700 leading-snug">{report.marketResearch.painPoints}</p>
            </div>
          )}
          {report.marketResearch.existingSolutions && (
            <div>
              <p className="text-[11px] font-semibold text-blue-600 mb-0.5">{zh ? "現有解法" : "Existing Solutions"}</p>
              <p className="text-xs text-gray-700 leading-snug">{report.marketResearch.existingSolutions}</p>
            </div>
          )}

          {report.marketResearch.sources.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-blue-600 mb-1">{zh ? "資料來源" : "Sources"}</p>
              <ul className="space-y-0.5">
                {report.marketResearch.sources.slice(0, 4).map((s, i) => (
                  <li key={i}>
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] text-blue-500 hover:underline truncate block"
                    >
                      {s.title}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

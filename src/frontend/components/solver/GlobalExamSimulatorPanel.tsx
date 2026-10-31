import { LifeBuoy } from "lucide-react";
import {
  GlobalExamModality,
  GlobalExamScenarioResult,
} from "@/wolfram-solver/engine/subFormulaSolver";

export interface GlobalExamSimulatorPanelProps {
  showGlobalSim: boolean;
  isApproved: boolean;
  examModality: GlobalExamModality;
  setExamModality: (m: GlobalExamModality) => void;
  activeScenario: GlobalExamScenarioResult;
  simulatedExamScore: string;
  setSimulatedExamScore: (score: string) => void;
  projectedPostGlobalGrade: number | null;
  passingGrade: number;
}

export function GlobalExamSimulatorPanel({
  showGlobalSim,
  isApproved,
  examModality,
  setExamModality,
  activeScenario,
  simulatedExamScore,
  setSimulatedExamScore,
  projectedPostGlobalGrade,
  passingGrade,
}: GlobalExamSimulatorPanelProps) {
  if (!showGlobalSim || isApproved) {
    return null;
  }

  const modalities: Array<{ id: GlobalExamModality; shortLabel: string }> = [
    { id: "mat_70_30", shortLabel: "MAT (70% NP + 30% Global)" },
    { id: "fis_60_40", shortLabel: "FIS (60% PS + 40% Global)" },
    { id: "replace_worst", shortLabel: "Reemplaza Peor Certamen" },
  ];

  return (
    <div className="rounded-xl border border-amber-500/30 bg-zinc-950/90 p-3.5 sm:p-4 space-y-3 animate-in fade-in-50 duration-150">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-bold text-amber-300">
          <LifeBuoy className="h-4 w-4 text-amber-400" />
          <span>Simulador de Certamen Global / Examen Recuperativo USM</span>
        </div>

        {/* Selector de modalidad reglamentaria USM */}
        <div className="flex flex-wrap gap-1.5">
          {modalities.map((mod) => (
            <button
              key={mod.id}
              type="button"
              onClick={() => setExamModality(mod.id)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors ${
                examModality === mod.id
                  ? "bg-amber-500/20 border-amber-500/60 text-amber-300 font-bold"
                  : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {mod.shortLabel}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-center pt-1">
        <div className="md:col-span-2 space-y-1 text-xs">
          <div className="text-zinc-300 font-medium">
            {activeScenario.formulaDescription}
          </div>
          <div className="text-[11px] text-zinc-400">
            Nota presentación considerada:{" "}
            <strong className="font-mono text-zinc-200">
              {activeScenario.presentationGrade.toFixed(1)}
            </strong>{" "}
            • {activeScenario.eligibilityNote}
          </div>
          <div className="pt-1 text-xs">
            {activeScenario.requiredExamScore !== null &&
            activeScenario.isReachable ? (
              <span>
                Nota mínima necesaria en el Global / Recuperativo para aprobar:{" "}
                <strong className="font-mono text-sm text-amber-400">
                  {activeScenario.requiredExamScore.toFixed(1)}
                </strong>
              </span>
            ) : (
              <span className="text-rose-400 font-medium">
                Con la nota de presentación actual se requeriría{" "}
                {activeScenario.requiredExamScore?.toFixed(1) ?? ">100"}{" "}
                (&gt; 100). Sube las evaluaciones pendientes primero.
              </span>
            )}
          </div>
        </div>

        {/* Input interactivo para probar nota en el Global */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/90 p-2.5 flex items-center justify-between gap-2">
          <div className="space-y-0.5">
            <label className="text-[10px] font-bold uppercase text-zinc-400 block">
              Simular Nota Global
            </label>
            <input
              type="number"
              min={0}
              max={100}
              placeholder={
                activeScenario.requiredExamScore !== null
                  ? String(Math.round(activeScenario.requiredExamScore))
                  : "60"
              }
              value={simulatedExamScore}
              onChange={(e) => setSimulatedExamScore(e.target.value)}
              className="w-20 h-7 px-2 text-center font-mono text-xs font-bold rounded bg-zinc-950 border border-zinc-700 text-amber-300 focus:border-amber-500 outline-none"
            />
          </div>

          <div className="text-right">
            <span className="text-[10px] uppercase text-zinc-400 block">
              NF Post-Global
            </span>
            <span
              className={`font-mono text-sm font-black ${
                projectedPostGlobalGrade === null
                  ? "text-zinc-500"
                  : projectedPostGlobalGrade >= passingGrade
                  ? "text-emerald-400"
                  : "text-rose-400"
              }`}
            >
              {projectedPostGlobalGrade !== null
                ? projectedPostGlobalGrade.toFixed(1)
                : "—"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

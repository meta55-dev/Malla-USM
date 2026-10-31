import * as React from "react";
import {
  SubFormulaCourseSolveResult,
  SubFormulaEvaluation,
  Course,
  AreaInfo,
  CourseFinalFormula,
} from "@/shared/types/academic";
import {
  computeGlobalExamScenarios,
  GlobalExamModality,
} from "@/wolfram-solver/engine/subFormulaSolver";
import {
  buildFormulaExpression,
  getOfficialSigaFormula,
  inferCourseFormulaConfig,
} from "@/wolfram-solver/templates/formulaPresets";
import { sigaService } from "@/curricula/services/sigaService";
import { FormulaEditorModal } from "./FormulaEditorModal";
import { GlobalExamSimulatorPanel } from "./GlobalExamSimulatorPanel";
import { Card, CardHeader, CardContent } from "@/frontend/components/ui/card";
import { Badge } from "@/frontend/components/ui/badge";
import { Button } from "@/frontend/components/ui/button";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/frontend/components/ui/alert-dialog";
import {
  Trash2,
  Award,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  TrendingUp,
  SlidersHorizontal,
  FileText,
  Sparkles,
  LifeBuoy,
  RotateCcw,
  PlusCircle,
} from "lucide-react";

interface CourseSolverCardProps {
  sigla: string;
  formula: CourseFinalFormula;
  courseInfo: Course | null;
  areaInfo: AreaInfo | null;
  solveResult: SubFormulaCourseSolveResult;
  sede?: string;
  onUnenroll: (sigla: string) => void;
  onScoreChange: (
    sigla: string,
    blockId: string,
    evalId: string,
    score: number | null
  ) => void;
  onUpdateFormula?: (sigla: string, newFormula: CourseFinalFormula) => void;
  onQuickApprove?: (sigla: string, grade: number) => void;
}

/**
 * Identifies which evaluations were discarded under the drop_worst rule.
 */
function getDroppedEvalIds(
  evaluations: SubFormulaEvaluation[],
  droppedScores?: number[]
): Set<string> {
  const set = new Set<string>();
  if (!droppedScores || droppedScores.length === 0) return set;

  const remainingDrops = [...droppedScores];
  const sorted = evaluations
    .filter((e) => e.score !== null && e.score !== undefined && !isNaN(e.score))
    .sort((a, b) => Number(a.score) - Number(b.score));

  for (const ev of sorted) {
    const idx = remainingDrops.findIndex(
      (d) => Math.abs(d - Number(ev.score)) < 0.001
    );
    if (idx !== -1) {
      set.add(ev.id);
      remainingDrops.splice(idx, 1);
    }
  }
  return set;
}

function getDefaultModalityForSigla(sigla: string): GlobalExamModality {
  const upper = sigla.toUpperCase();
  if (upper.startsWith("MAT")) return "mat_70_30";
  if (upper.startsWith("FIS")) return "fis_60_40";
  return "replace_worst";
}

export function CourseSolverCard({
  sigla,
  formula,
  courseInfo,
  areaInfo,
  solveResult,
  sede = "Casa Central Valparaíso",
  onUnenroll,
  onScoreChange,
  onUpdateFormula,
  onQuickApprove,
}: CourseSolverCardProps) {
  const [editorOpen, setEditorOpen] = React.useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = React.useState(false);
  const [showGlobalSim, setShowGlobalSim] = React.useState(false);
  const [examModality, setExamModality] = React.useState<GlobalExamModality>(() =>
    getDefaultModalityForSigla(sigla)
  );
  const [simulatedExamScore, setSimulatedExamScore] = React.useState<string>("");

  const hasActiveBonuses = React.useMemo(() => {
    const mult = formula.finalGradeMultiplier ?? 1;
    const gBonus = formula.finalGradeBonusPoints ?? 0;
    const bBonus = (formula.subFormulas || []).some(
      (b) => (b.bonusPoints ?? 0) !== 0 || (b.evalBonusPoints ?? 0) !== 0
    );
    return Math.abs(mult - 1) > 0.001 || Math.abs(gBonus) > 0.001 || bBonus;
  }, [formula]);

  const [showBonusPanel, setShowBonusPanel] = React.useState<boolean>(hasActiveBonuses);

  React.useEffect(() => {
    if (hasActiveBonuses) {
      setShowBonusPanel(true);
    }
  }, [hasActiveBonuses]);

  const [resolvedPdfUrl, setResolvedPdfUrl] = React.useState<string | null>(
    formula.syllabusPdfUrl || courseInfo?.programa_pdf || null
  );

  React.useEffect(() => {
    const direct = formula.syllabusPdfUrl || courseInfo?.programa_pdf || null;
    if (direct) {
      setResolvedPdfUrl(direct);
      return;
    }
    let mounted = true;
    sigaService.getSyllabusPdfUrl(sigla, sede).then((url) => {
      if (mounted && url) setResolvedPdfUrl(url);
    });
    return () => {
      mounted = false;
    };
  }, [sigla, sede, formula.syllabusPdfUrl, courseInfo?.programa_pdf]);

  const blocks = formula.subFormulas || [];

  const hasOfficialCatalogFormula = React.useMemo(
    () => !!getOfficialSigaFormula(sigla),
    [sigla]
  );

  const handleQuickRestoreOfficial = () => {
    if (!onUpdateFormula) return;
    const inferred = inferCourseFormulaConfig(sigla, courseInfo);
    const mergedBlocks = inferred.subFormulas.map((newB) => {
      const oldB = blocks.find(
        (b) => b.code.toUpperCase() === newB.code.toUpperCase() || b.id === newB.id
      );
      if (!oldB) return newB;
      return {
        ...newB,
        bonusPoints: oldB.bonusPoints,
        evalBonusPoints: oldB.evalBonusPoints,
        evaluations: newB.evaluations.map((ev, i) => ({
          ...ev,
          score:
            oldB.evaluations[i]?.score !== undefined
              ? oldB.evaluations[i].score
              : null,
        })),
      };
    });
    onUpdateFormula(sigla, {
      ...inferred,
      finalGradeMultiplier: formula.finalGradeMultiplier,
      finalGradeBonusPoints: formula.finalGradeBonusPoints,
      subFormulas: mergedBlocks,
    });
  };

  const handleUpdateBlockBonus = (
    blockId: string,
    field: "bonusPoints" | "evalBonusPoints",
    val: number
  ) => {
    if (!onUpdateFormula) return;
    const updatedBlocks = blocks.map((b) =>
      b.id === blockId ? { ...b, [field]: val } : b
    );
    onUpdateFormula(sigla, {
      ...formula,
      expression: buildFormulaExpression(
        updatedBlocks,
        formula.piecewiseAlpha,
        formula.finalGradeMultiplier,
        formula.finalGradeBonusPoints
      ),
      subFormulas: updatedBlocks,
    });
  };

  const handleUpdateGlobalModifiers = (
    nextMultiplier: number,
    nextBonusPoints: number
  ) => {
    if (!onUpdateFormula) return;
    onUpdateFormula(sigla, {
      ...formula,
      finalGradeMultiplier: nextMultiplier,
      finalGradeBonusPoints: nextBonusPoints,
      expression: buildFormulaExpression(
        blocks,
        formula.piecewiseAlpha,
        nextMultiplier,
        nextBonusPoints
      ),
    });
  };

  // Calculate total unknowns (Z) and guaranteed points with 0 in remaining (X)
  const totalUnknowns = blocks.reduce(
    (acc, b) =>
      acc +
      b.evaluations.filter(
        (e) => e.score === null || e.score === undefined || isNaN(e.score)
      ).length,
    0
  );

  const normalizedWeights = React.useMemo(() => {
    const sum = blocks.reduce(
      (acc, b) => acc + (b.weightInFinal > 0 ? b.weightInFinal : 0),
      0
    );
    if (sum <= 0) return blocks.map(() => 1 / blocks.length);
    return blocks.map((b) => (b.weightInFinal > 0 ? b.weightInFinal / sum : 0));
  }, [blocks]);

  const accumulatedPointsWithZero = React.useMemo(() => {
    if (solveResult.minPossibleGrade !== undefined) {
      return solveResult.minPossibleGrade;
    }
    return solveResult.blocks.reduce(
      (acc, b, idx) =>
        acc + normalizedWeights[idx] * (b.projectedAverageWithZero ?? 0),
      0
    );
  }, [solveResult.minPossibleGrade, solveResult.blocks, normalizedWeights]);

  const X = accumulatedPointsWithZero;
  const Y = solveResult.requiredUniformGrade;
  const Z = totalUnknowns;

  const isApproved =
    solveResult.status === "APPROVED" ||
    (X >= formula.passingGrade &&
      solveResult.blocks.every(
        (b) => b.minGradeRequired === null || (b.requiredForBlockMin ?? 0) <= 0
      ));

  const isFailed = solveResult.status === "FAILED" && Z === 0;

  const isCriticalMin =
    solveResult.bindingCondition === "BLOCK_MIN" &&
    Y !== null &&
    Y <= 80 &&
    !isApproved &&
    !isFailed;

  const isInDanger =
    (solveResult.status === "IN_DANGER" ||
      solveResult.status === "REQUIRES_PERFECT" ||
      (Y !== null && Y > 80)) &&
    !isApproved &&
    !isFailed;

  const isOnTrack = !isApproved && !isFailed && !isInDanger && !isCriticalMin;

  const globalScenarios = React.useMemo(
    () => computeGlobalExamScenarios(formula, solveResult),
    [formula, solveResult]
  );

  const activeScenario = globalScenarios[examModality];
  const parsedSimScore =
    simulatedExamScore.trim() !== "" && !isNaN(Number(simulatedExamScore))
      ? Math.min(100, Math.max(0, Number(simulatedExamScore)))
      : null;

  const projectedPostGlobalGrade =
    parsedSimScore !== null
      ? activeScenario.projectFinalGrade(parsedSimScore)
      : null;

  // Build the stylized monospace formula string
  const formulaEquation = React.useMemo(() => {
    const expr = buildFormulaExpression(
      blocks,
      formula.piecewiseAlpha,
      formula.finalGradeMultiplier,
      formula.finalGradeBonusPoints
    );
    return `NF = ${expr} (Meta: ≥ ${formula.passingGrade})`;
  }, [
    blocks,
    formula.piecewiseAlpha,
    formula.finalGradeMultiplier,
    formula.finalGradeBonusPoints,
    formula.passingGrade,
  ]);

  const conditionString = React.useMemo(() => {
    const mins = blocks.filter((b) => b.minGradeRequired !== null);
    if (mins.length === 0) return null;
    const conds = mins
      .map((b) => `${b.code} ≥ ${b.minGradeRequired}`)
      .join(" ∧ ");
    return `Condición: ${conds} (sino NF = min)`;
  }, [blocks]);

  return (
    <Card className="bg-zinc-900 border-zinc-800 text-zinc-100 shadow-lg rounded-xl overflow-hidden transition-all hover:border-zinc-700/80">
      {/* 1. Header */}
      <CardHeader className="p-4 sm:p-5 border-b border-zinc-800/80 bg-zinc-900/90 flex flex-row items-center justify-between gap-3 space-y-0">
        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="flex items-center gap-2">
            <span
              className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: areaInfo?.color || "#0B72D4" }}
              title={areaInfo?.nombre || "Área"}
            />
            <span className="font-mono font-black text-base sm:text-lg tracking-tight text-zinc-100">
              {sigla}
            </span>
          </div>

          <h3 className="font-semibold text-sm sm:text-base text-zinc-200">
            {courseInfo?.nombre || sigla}
          </h3>

          {courseInfo && (
            <Badge
              variant="outline"
              className="border-zinc-800 bg-zinc-950/60 text-zinc-400 text-[11px] font-normal"
            >
              Sem. {courseInfo.semestre} • {courseInfo.creditos_usm} USM /{" "}
              {courseInfo.creditos_sct} SCT
            </Badge>
          )}

          {formula.sourceLabel && (
            <Badge
              variant="outline"
              className={`text-[10px] font-medium gap-1 ${
                formula.source === "siga_pdf"
                  ? "border-emerald-500/40 bg-emerald-950/30 text-emerald-300"
                  : formula.source === "custom"
                  ? "border-blue-500/40 bg-blue-950/30 text-blue-300"
                  : "border-amber-500/40 bg-amber-950/30 text-amber-300"
              }`}
              title="Nivel de certeza / origen de los requisitos de evaluación cargados para esta asignatura"
            >
              <Sparkles className="h-2.5 w-2.5 text-amber-400" />
              <span>{formula.sourceLabel}</span>
            </Badge>
          )}

          {formula.source !== "siga_pdf" &&
            hasOfficialCatalogFormula &&
            onUpdateFormula && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleQuickRestoreOfficial}
                className="h-6 px-2 text-[10px] font-semibold text-emerald-300 border-emerald-500/40 bg-emerald-950/30 hover:bg-emerald-950/60 gap-1"
                title="Restaurar la fórmula oficial extraída del Programa PDF de SIGA conservando tus notas"
              >
                <RotateCcw className="h-2.5 w-2.5 text-emerald-400" />
                <span>Usar Fórmula Oficial SIGA</span>
              </Button>
            )}

          {isApproved && (
            <Badge className="bg-emerald-950/80 text-emerald-300 border border-emerald-700/60 text-xs gap-1 font-bold">
              <CheckCircle2 className="h-3 w-3 text-emerald-400" />
              Aprobado ({solveResult.currentFinalGrade.toFixed(1)})
            </Badge>
          )}
        </div>

        {/* Header Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          {resolvedPdfUrl && (
            <a
              href={resolvedPdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-xs font-medium text-zinc-300 hover:text-amber-300 bg-zinc-950/70 hover:bg-zinc-800 border border-zinc-800 transition-colors"
              title="Abrir Programa Oficial de Asignatura en PDF (SIGA USM)"
            >
              <FileText className="h-3.5 w-3.5 text-amber-400" />
              <span className="hidden lg:inline">Programa PDF</span>
            </a>
          )}

          {onUpdateFormula && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setEditorOpen(true)}
              className="h-8 px-2.5 text-xs font-semibold text-amber-300 border-amber-500/30 bg-amber-950/20 hover:bg-amber-950/40 hover:text-amber-200 gap-1.5"
              title="Configurar porcentajes, evaluaciones, descarte de peores notas o plantillas USM"
            >
              <SlidersHorizontal className="h-3.5 w-3.5 text-amber-400" />
              <span className="hidden sm:inline">Configurar Fórmula</span>
            </Button>
          )}

          {onQuickApprove && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                onQuickApprove(
                  sigla,
                  Math.round(solveResult.currentFinalGrade || 55)
                )
              }
              className="h-8 px-2.5 text-xs font-medium text-emerald-400 hover:text-emerald-300 hover:bg-emerald-950/30 gap-1.5"
              title="Aprobar ramo y transferir nota final a tu malla curricular"
            >
              <Award className="h-4 w-4" />
              <span className="hidden sm:inline">Aprobar Ramo</span>
            </Button>
          )}

          <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-zinc-400 hover:text-rose-400 hover:bg-rose-950/30 rounded-lg transition-colors"
                title="Desinscribir ramo del semestre"
                aria-label="Desinscribir asignatura"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  ¿Eliminar {courseInfo?.nombre ? `${sigla} - ${courseInfo.nombre}` : sigla} de tus ramos inscritos?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  Se perderán las notas parciales y ajustes de fórmula guardados para este semestre.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>
                  Cancelar
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    setDeleteConfirmOpen(false);
                    onUnenroll(sigla);
                  }}
                  className="bg-rose-600 hover:bg-rose-700 text-white gap-2 font-medium"
                >
                  <Trash2 className="h-4 w-4" />
                  <span>Sí, eliminar ramo</span>
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardHeader>

      <CardContent className="p-4 sm:p-5 space-y-4">
        {/* 2. Sub-formulas Section */}
        <div className="space-y-1.5">
          <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 flex items-center justify-between">
            <span>Cálculos Complementarios (Sub-fórmulas)</span>
            <span className="font-mono text-zinc-500 font-normal">
              {blocks.length} {blocks.length === 1 ? "bloque" : "bloques"}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {blocks.map((block) => {
              const bResult = solveResult.blocks.find(
                (b) => b.blockId === block.id
              );
              const avg = bResult?.currentAverage;
              const effWeight = bResult?.weightInFinal ?? block.weightInFinal;
              const effBonus = bResult?.effectiveBonusPoints ?? 0;
              const minReq = block.minGradeRequired;
              const hasMin = minReq !== null;
              const meetsMin = bResult?.meetsMinGrade ?? false;

              let typeDesc = "Promedio simple";
              if (block.type === "drop_worst") {
                const dropN = block.dropWorstCount || 1;
                typeDesc = `${block.evaluations.length} eval., descarta ${dropN} ${
                  dropN === 1 ? "peor" : "peores"
                }`;
              } else if (block.type === "simple_average") {
                typeDesc = `${block.evaluations.length} ${block.name}`;
              } else if (block.type === "weighted") {
                const weightsStr = block.evaluations
                  .map((e) => `${e.weight}%`)
                  .join(" / ");
                typeDesc = `Ponderado (${weightsStr})`;
              }

              return (
                <div
                  key={block.id}
                  className="rounded-lg border border-zinc-800/90 bg-zinc-950/50 p-2.5 flex flex-col justify-between gap-1.5 text-xs shadow-xs"
                >
                  <div className="flex items-center justify-between gap-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono font-bold text-amber-400 dark:text-amber-300">
                        {block.code}
                      </span>
                      {effBonus > 0 && (
                        <span
                          className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-emerald-950/80 text-emerald-300 border border-emerald-700/60"
                          title={`Incluye +${effBonus.toFixed(1)} pts extra por actividades en este bloque`}
                        >
                          +{effBonus.toFixed(1)} pts
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] font-semibold text-zinc-400">
                      {Math.round(effWeight * (effWeight <= 1 ? 100 : 1))}%
                    </span>
                  </div>

                  <div
                    className="text-[11px] text-zinc-400 line-clamp-1"
                    title={block.name}
                  >
                    {typeDesc}
                  </div>

                  <div className="flex items-center justify-between pt-1 border-t border-zinc-800/50 text-[11px]">
                    <span className="text-zinc-400">
                      Promedio:{" "}
                      <strong className="text-zinc-100 font-mono">
                        {avg !== null && avg !== undefined
                          ? avg.toFixed(1)
                          : "—"}
                      </strong>
                    </span>

                    {hasMin ? (
                      (() => {
                        const reqMin = bResult?.requiredForBlockMin;
                        const isReachable =
                          reqMin !== null &&
                          reqMin !== undefined &&
                          reqMin <= 100;
                        return (
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${
                              meetsMin
                                ? "bg-emerald-950/70 text-emerald-400 border-emerald-800/60"
                                : isReachable
                                ? "bg-amber-950/70 text-amber-400 border-amber-800/60"
                                : "bg-rose-950/70 text-rose-400 border-rose-800/60"
                            }`}
                            title={
                              meetsMin
                                ? "Cumple el requisito mínimo de bloque"
                                : reqMin !== null && reqMin !== undefined
                                ? `Requiere promediar ${reqMin.toFixed(
                                    1
                                  )} en lo restante`
                                : "No cumple mínimo"
                            }
                          >
                            Mín: ≥ {minReq}
                          </span>
                        );
                      })()
                    ) : (
                      <span className="text-[10px] text-zinc-500">
                        Sin mín.
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 3. Final Formula & Official Requirements Line */}
        <div className="rounded-lg bg-zinc-950/80 border border-zinc-800/80 px-3 py-2.5 space-y-1.5 text-xs">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5 font-mono">
            <div className="flex flex-wrap items-center gap-2 text-zinc-200 font-medium tracking-tight">
              <span className="text-amber-400 font-bold">{formulaEquation}</span>

              {formula.piecewiseAlpha && (
                <span
                  className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/40"
                  title="Ponderación dinámica por tramos según promedio de Certámenes (PC)"
                >
                  α(PC) = {(solveResult.dynamicAlpha ?? 0.3).toFixed(2)} →{" "}
                  {Math.round((1 - (solveResult.dynamicAlpha ?? 0.3)) * 100)}%{" "}
                  {formula.piecewiseAlpha.baseBlockCode} +{" "}
                  {Math.round((solveResult.dynamicAlpha ?? 0.3) * 100)}%{" "}
                  {formula.piecewiseAlpha.targetBlockCode}
                </span>
              )}
            </div>

            {conditionString && (
              <div className="text-[11px] text-zinc-400 flex items-center gap-1">
                <span className="text-zinc-500">•</span>
                <span>{conditionString}</span>
              </div>
            )}
          </div>

          {formula.syllabusRequirementsNote && (
            <div className="text-[11px] text-zinc-400 pt-1 border-t border-zinc-800/70 leading-relaxed">
              <span className="font-semibold text-zinc-300">
                Requisitos USM:{" "}
              </span>
              {formula.syllabusRequirementsNote}
            </div>
          )}
        </div>

        {/* 4. Grade Grid (Numeric Inputs) + Bonificaciones / Multiplicador */}
        <div className="space-y-3 pt-1">
          <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span>Grilla de Evaluaciones</span>
              <span className="text-zinc-500 text-[10px] font-normal normal-case">
                (Escala 0 – 100 • Vacío = incógnita)
              </span>
            </div>

            {onUpdateFormula && (
              <button
                type="button"
                onClick={() => setShowBonusPanel((v) => !v)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold normal-case tracking-normal border transition-colors ${
                  hasActiveBonuses
                    ? "bg-emerald-950/60 border-emerald-600/60 text-emerald-300 hover:bg-emerald-900/60"
                    : "bg-zinc-950/80 border-zinc-800 text-amber-300 hover:bg-zinc-800"
                }`}
                title="Agregar puntos extra por actividades externas (a certámenes o nota final) o multiplicador de nota final"
              >
                <PlusCircle className="h-3.5 w-3.5 text-amber-400" />
                <span>
                  {hasActiveBonuses
                    ? "Bonificaciones / Multiplicador Activo"
                    : "Puntos Extra / Multiplicador"}
                </span>
              </button>
            )}
          </div>

          {/* Panel rápido de Bonificaciones por Actividades Externas y Multiplicador de Nota Final */}
          {showBonusPanel && onUpdateFormula && (
            <div className="rounded-xl border border-amber-500/30 bg-zinc-950/85 p-3 space-y-3 text-xs animate-in fade-in-50 duration-150">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800/80 pb-2">
                <div className="flex items-center gap-1.5 font-bold text-amber-300">
                  <Sparkles className="h-3.5 w-3.5 text-amber-400" />
                  <span>
                    Puntos Extra por Actividades Externas y Multiplicador de Nota Final
                  </span>
                </div>
                <span className="text-[11px] text-zinc-400">
                  Se descuentan automáticamente de la nota necesaria en lo restante
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {/* 1. Puntos extra a Certamen / Evaluación individual por bloque */}
                <div className="rounded-lg border border-zinc-800/90 bg-zinc-900/60 p-2.5 space-y-2">
                  <div className="font-semibold text-zinc-200 text-[11px]">
                    1. Puntos Extra a Certámenes / Bloques
                  </div>
                  <p className="text-[10px] text-zinc-400 leading-snug">
                    Si el profesor da puntos para un certamen (se divide en N eval.) o directo al promedio del bloque:
                  </p>
                  <div className="space-y-1.5 pt-0.5">
                    {blocks.map((b) => {
                      const usedN =
                        b.type === "drop_worst"
                          ? Math.max(
                              1,
                              (b.count || b.evaluations.length) -
                                (b.dropWorstCount || 0)
                            )
                          : Math.max(1, b.count || b.evaluations.length);
                      return (
                        <div
                          key={b.id}
                          className="flex items-center justify-between gap-1.5 text-[11px] bg-zinc-950/70 px-2 py-1 rounded border border-zinc-800/80"
                        >
                          <span className="font-mono font-bold text-amber-400">
                            {b.code}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <label
                              className="text-[10px] text-zinc-400 flex items-center gap-1"
                              title={`Puntos extra a 1 evaluación de ${b.name} (aporta +pts/${usedN} al promedio ${b.code})`}
                            >
                              <span>+Eval:</span>
                              <input
                                type="number"
                                min={0}
                                max={100}
                                step={1}
                                value={b.evalBonusPoints ?? 0}
                                onChange={(e) =>
                                  handleUpdateBlockBonus(
                                    b.id,
                                    "evalBonusPoints",
                                    Math.max(0, Number(e.target.value) || 0)
                                  )
                                }
                                className="w-12 h-6 text-center font-mono text-xs rounded bg-zinc-900 border border-zinc-700 text-emerald-300 focus:border-amber-500 outline-none"
                              />
                            </label>
                            <label
                              className="text-[10px] text-zinc-400 flex items-center gap-1"
                              title={`Puntos extra sumados directamente al promedio de ${b.name} (${b.code})`}
                            >
                              <span>+Prom:</span>
                              <input
                                type="number"
                                min={0}
                                max={50}
                                step={0.5}
                                value={b.bonusPoints ?? 0}
                                onChange={(e) =>
                                  handleUpdateBlockBonus(
                                    b.id,
                                    "bonusPoints",
                                    Math.max(0, Number(e.target.value) || 0)
                                  )
                                }
                                className="w-12 h-6 text-center font-mono text-xs rounded bg-zinc-900 border border-zinc-700 text-emerald-300 focus:border-amber-500 outline-none"
                              />
                            </label>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 2. Puntos extra directos a la Nota Final (NF) */}
                <div className="rounded-lg border border-zinc-800/90 bg-zinc-900/60 p-2.5 flex flex-col justify-between space-y-2">
                  <div className="space-y-1">
                    <div className="font-semibold text-zinc-200 text-[11px]">
                      2. Puntos Extra directos a Nota Final (NF)
                    </div>
                    <p className="text-[10px] text-zinc-400 leading-snug">
                      Puntos por talleres, charlas, asistencia o actividades que se suman directo a la NF (escala 0–100):
                    </p>
                  </div>
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <div className="flex gap-1">
                      {[0, 2, 3, 5].map((presetPts) => (
                        <button
                          key={presetPts}
                          type="button"
                          onClick={() =>
                            handleUpdateGlobalModifiers(
                              formula.finalGradeMultiplier ?? 1,
                              presetPts
                            )
                          }
                          className={`px-2 py-1 rounded text-[10px] font-mono font-bold border transition-colors ${
                            (formula.finalGradeBonusPoints ?? 0) === presetPts
                              ? "bg-emerald-950/80 border-emerald-500/60 text-emerald-300"
                              : "bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200"
                          }`}
                        >
                          +{presetPts}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-[11px] font-mono text-emerald-400 font-bold">
                        +
                      </span>
                      <input
                        type="number"
                        min={-20}
                        max={50}
                        step={0.5}
                        value={formula.finalGradeBonusPoints ?? 0}
                        onChange={(e) =>
                          handleUpdateGlobalModifiers(
                            formula.finalGradeMultiplier ?? 1,
                            Number(e.target.value) || 0
                          )
                        }
                        className="w-14 h-7 text-center font-mono text-xs font-bold rounded bg-zinc-950 border border-zinc-700 text-emerald-300 focus:border-amber-500 outline-none"
                      />
                      <span className="text-[10px] text-zinc-400">pts</span>
                    </div>
                  </div>
                </div>

                {/* 3. Multiplicador a la Nota Final */}
                <div className="rounded-lg border border-zinc-800/90 bg-zinc-900/60 p-2.5 flex flex-col justify-between space-y-2">
                  <div className="space-y-1">
                    <div className="font-semibold text-zinc-200 text-[11px]">
                      3. Multiplicador a la Nota Final (× Factor)
                    </div>
                    <p className="text-[10px] text-zinc-400 leading-snug">
                      Factor multiplicativo sobre la nota final de presentación (ej. 1.05 para bonificación de +5%):
                    </p>
                  </div>
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <div className="flex gap-1">
                      {[1, 1.03, 1.05, 1.1].map((presetMult) => (
                        <button
                          key={presetMult}
                          type="button"
                          onClick={() =>
                            handleUpdateGlobalModifiers(
                              presetMult,
                              formula.finalGradeBonusPoints ?? 0
                            )
                          }
                          className={`px-1.5 py-1 rounded text-[10px] font-mono font-bold border transition-colors ${
                            Math.abs(
                              (formula.finalGradeMultiplier ?? 1) - presetMult
                            ) < 0.001
                              ? "bg-amber-500/20 border-amber-500/60 text-amber-300"
                              : "bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200"
                          }`}
                        >
                          {presetMult.toFixed(2)}x
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-[11px] font-mono text-amber-400 font-bold">
                        ×
                      </span>
                      <input
                        type="number"
                        min={0.5}
                        max={2.0}
                        step={0.01}
                        value={formula.finalGradeMultiplier ?? 1}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          if (!isNaN(val) && val > 0) {
                            handleUpdateGlobalModifiers(
                              val,
                              formula.finalGradeBonusPoints ?? 0
                            );
                          }
                        }}
                        className="w-16 h-7 text-center font-mono text-xs font-bold rounded bg-zinc-950 border border-zinc-700 text-amber-300 focus:border-amber-500 outline-none"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-3">
            {blocks.map((block) => {
              const bResult = solveResult.blocks.find(
                (b) => b.blockId === block.id
              );
              const effWeight = bResult?.weightInFinal ?? block.weightInFinal;
              const droppedIds = getDroppedEvalIds(
                block.evaluations,
                bResult?.droppedScores
              );

              return (
                <div
                  key={block.id}
                  className="rounded-lg border border-zinc-800/60 bg-zinc-950/30 p-2.5 sm:p-3 space-y-2"
                >
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-zinc-200">
                        {block.name}
                      </span>
                      <span className="text-[10px] font-mono text-zinc-500">
                        ({block.code} •{" "}
                        {Math.round(effWeight * (effWeight <= 1 ? 100 : 1))}%)
                      </span>
                    </div>

                    <div className="text-[11px] text-zinc-400 font-mono">
                      {block.evaluations.filter((e) => e.score !== null).length}{" "}
                      / {block.evaluations.length} ingresadas
                    </div>
                  </div>

                  {/* Inputs row */}
                  <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
                    {block.evaluations.map((ev, idx) => {
                      const isDropped = droppedIds.has(ev.id);
                      const isUnknown =
                        ev.score === null ||
                        ev.score === undefined ||
                        isNaN(ev.score);
                      const displayLabel =
                        ev.name || `${block.prefix || block.code}${idx + 1}`;

                      return (
                        <div
                          key={ev.id}
                          className="flex flex-col items-center gap-1 relative group"
                        >
                          <span
                            className={`text-[10px] font-mono uppercase tracking-wider ${
                              isDropped
                                ? "text-zinc-500 line-through"
                                : isUnknown
                                ? "text-amber-400/80"
                                : "text-zinc-300 font-semibold"
                            }`}
                            title={ev.name}
                          >
                            {block.prefix
                              ? `${block.prefix}${idx + 1}`
                              : displayLabel}
                          </span>

                          <div className="relative">
                            <input
                              type="number"
                              min={0}
                              max={120}
                              step={1}
                              value={
                                ev.score !== null && ev.score !== undefined
                                  ? ev.score
                                  : ""
                              }
                              placeholder="—"
                              onChange={(e) => {
                                const raw = e.target.value.trim();
                                if (raw === "") {
                                  onScoreChange(sigla, block.id, ev.id, null);
                                } else {
                                  const num = Number(raw);
                                  if (!isNaN(num)) {
                                    onScoreChange(
                                      sigla,
                                      block.id,
                                      ev.id,
                                      Math.min(120, Math.max(0, num))
                                    );
                                  }
                                }
                              }}
                              className={`w-14 sm:w-16 h-8 text-center text-xs sm:text-sm font-mono font-medium rounded-md transition-all outline-none focus:ring-1 ${
                                isDropped
                                  ? "line-through opacity-55 text-zinc-400 bg-zinc-900 border border-zinc-800"
                                  : isUnknown
                                  ? "bg-zinc-950 border border-zinc-800/90 text-zinc-400 focus:border-amber-500 focus:ring-amber-500/40 placeholder:text-zinc-600"
                                  : "bg-zinc-950 border border-zinc-700 text-zinc-100 font-semibold focus:border-[#002B49] focus:ring-[#D99B00]"
                              }`}
                              title={
                                isDropped
                                  ? "Esta nota es la más baja y ha sido descartada por la regla del ramo"
                                  : isUnknown
                                  ? "Incógnita (x_i). Ingresa nota tentativa (0 a 100, o hasta 120 si incluye bonus)"
                                  : `Nota registrada: ${ev.score}`
                              }
                            />
                            {isDropped && (
                              <span
                                className="absolute -bottom-3.5 left-1/2 -translate-x-1/2 text-[9px] font-bold text-zinc-400 bg-zinc-800/90 px-1 rounded whitespace-nowrap pointer-events-none"
                                title="Nota descartada"
                              >
                                Descartada
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 5. Único Banner de Diagnóstico Limpio por Ramo + Simulador Certamen Global / Recuperativo */}
        <div className="pt-2 space-y-2.5">
          {/* APROBADO */}
          {isApproved && (
            <div className="rounded-xl border border-emerald-700/70 bg-emerald-950/40 p-3.5 sm:p-4 text-emerald-200 flex items-start gap-3 shadow-md">
              <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
              <div className="space-y-0.5 text-xs sm:text-sm">
                <div className="font-bold text-emerald-300">
                  ¡Aprobado! Puntos asegurados: {X.toFixed(1)} pts.
                </div>
                <div className="text-emerald-200/90">
                  Aún sacando 0 en lo restante apruebas el ramo (NF proyectada:
                  ≥ {formula.passingGrade}).
                </div>
              </div>
            </div>
          )}

          {/* REPROBADO (Todo evaluado y no aprobó) */}
          {isFailed && (
            <div className="rounded-xl border border-rose-800 bg-rose-950/40 p-3.5 sm:p-4 text-rose-200 flex items-start justify-between gap-3 shadow-md">
              <div className="flex items-start gap-3">
                <XCircle className="h-5 w-5 text-rose-400 shrink-0 mt-0.5" />
                <div className="space-y-0.5 text-xs sm:text-sm">
                  <div className="font-bold text-rose-300">
                    Reprobado en presentación: Nota obtenida:{" "}
                    {solveResult.currentFinalGrade.toFixed(1)}.
                  </div>
                  <div className="text-rose-200/90">
                    No alcanza el mínimo de aprobación ({formula.passingGrade})
                    o no cumplió con el requisito de bloque.
                  </div>
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowGlobalSim((v) => !v)}
                className="h-8 px-2.5 text-xs font-semibold border-rose-500/40 bg-rose-950/60 text-rose-200 hover:bg-rose-900/60 shrink-0 gap-1.5"
              >
                <LifeBuoy className="h-3.5 w-3.5 text-amber-400" />
                <span>Simular Global / Recup.</span>
              </Button>
            </div>
          )}

          {/* EN PELIGRO / REFIERE RECUPERATIVO / REQ > 80 O > 100 */}
          {isInDanger && (
            <div className="rounded-xl border border-rose-800/80 bg-rose-950/40 p-3.5 sm:p-4 text-rose-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-md">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-rose-400 shrink-0 mt-0.5" />
                <div className="space-y-0.5 text-xs sm:text-sm">
                  <div className="font-bold text-rose-300">
                    En Peligro: La nota requerida supera 80 (
                    {Y !== null ? Y.toFixed(1) : ">100"}).
                  </div>
                  <div className="text-rose-200/90">
                    {Y !== null && Y > 100
                      ? `Matemáticamente inviable con escala normal (exige ${Y.toFixed(
                          1
                        )}). Requiere examen recuperativo o certamen global.`
                      : `Necesitas promediar ${
                          Y?.toFixed(1) ?? "—"
                        } en las ${Z} evaluaciones restantes. Requiere rendimiento extraordinario o examen recuperativo.`}
                  </div>
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowGlobalSim((v) => !v)}
                className="h-8 px-2.5 text-xs font-semibold border-amber-500/40 bg-zinc-900/90 text-amber-300 hover:bg-zinc-800 shrink-0 gap-1.5"
              >
                <LifeBuoy className="h-3.5 w-3.5 text-amber-400" />
                <span>
                  {showGlobalSim ? "Ocultar Simulador" : "Simular Global / Recup."}
                </span>
              </Button>
            </div>
          )}

          {/* ATENCIÓN: BLOQUE MÍNIMO ES LA CONDICIÓN VINCULANTE */}
          {isCriticalMin && (
            <div className="rounded-xl border border-amber-800/80 bg-amber-950/40 p-3.5 sm:p-4 text-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-md">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
                <div className="space-y-0.5 text-xs sm:text-sm">
                  <div className="font-bold text-amber-300">
                    Atención: El bloque [
                    {solveResult.bindingBlockCode || "Mínimo"}] exige promediar{" "}
                    {Y?.toFixed(1) ?? "—"}
                  </div>
                  <div className="text-amber-200/90">
                    En los certámenes/evaluaciones restantes para alcanzar el
                    mínimo de bloque (restricción más exigente que la meta
                    global de NF ≥ {formula.passingGrade}).
                  </div>
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowGlobalSim((v) => !v)}
                className="h-8 px-2.5 text-xs font-semibold border-amber-500/40 bg-zinc-900/90 text-amber-300 hover:bg-zinc-800 shrink-0 gap-1.5"
              >
                <LifeBuoy className="h-3.5 w-3.5 text-amber-400" />
                <span>
                  {showGlobalSim ? "Ocultar Simulador" : "Simular Global / Recup."}
                </span>
              </Button>
            </div>
          )}

          {/* EN CARRERA (NORMAL) */}
          {isOnTrack && (
            <div className="rounded-xl border border-zinc-700/80 bg-zinc-950/80 p-3.5 sm:p-4 text-zinc-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-md">
              <div className="flex items-start gap-3">
                <TrendingUp className="h-5 w-5 text-blue-400 shrink-0 mt-0.5" />
                <div className="space-y-0.5 text-xs sm:text-sm">
                  <div className="font-bold text-zinc-100">
                    Puntos acumulados:{" "}
                    <span className="text-amber-400">{X.toFixed(1)} pts</span>.
                  </div>
                  <div className="text-zinc-300">
                    Necesitas promediar{" "}
                    <strong className="text-blue-300 font-mono text-sm">
                      {Y !== null ? Y.toFixed(1) : "—"}
                    </strong>{" "}
                    en las {Z}{" "}
                    {Z === 1 ? "evaluación restante" : "evaluaciones restantes"}{" "}
                    para cumplir los requisitos y aprobar con NF ≥{" "}
                    {formula.passingGrade}.
                  </div>
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowGlobalSim((v) => !v)}
                className="h-8 px-2.5 text-xs text-zinc-400 hover:text-amber-300 hover:bg-zinc-900 shrink-0 gap-1.5"
              >
                <LifeBuoy className="h-3.5 w-3.5 text-amber-400" />
                <span>
                  {showGlobalSim ? "Ocultar Global" : "¿Y si voy a Global?"}
                </span>
              </Button>
            </div>
          )}

          {/* Panel Desplegable: Simulador de Certamen Global / Examen Recuperativo USM */}
          <GlobalExamSimulatorPanel
            showGlobalSim={showGlobalSim}
            isApproved={isApproved}
            examModality={examModality}
            setExamModality={setExamModality}
            activeScenario={activeScenario}
            simulatedExamScore={simulatedExamScore}
            setSimulatedExamScore={setSimulatedExamScore}
            projectedPostGlobalGrade={projectedPostGlobalGrade}
            passingGrade={formula.passingGrade}
          />
        </div>
      </CardContent>

      {/* Modal de Configuración Interactiva de Fórmula y Requisitos */}
      {onUpdateFormula && (
        <FormulaEditorModal
          open={editorOpen}
          onOpenChange={setEditorOpen}
          sigla={sigla}
          courseInfo={courseInfo}
          currentFormula={formula}
          sede={sede}
          onSaveFormula={(newFormula) => onUpdateFormula(sigla, newFormula)}
        />
      )}
    </Card>
  );
}

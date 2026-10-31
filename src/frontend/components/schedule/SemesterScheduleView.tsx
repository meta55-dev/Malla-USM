import * as React from "react";
import { useAcademicStore } from "@/shared/store/useAcademicStore";
import {
  getCourseParallels,
  getPeriodCatalog,
  getProfessorReview,
  getSchedulePeriods,
  groupScheduleBlocks,
  SigaCatalogCourse,
  USM_BAR_DAYS,
  USM_BLOCK_PAIRS,
} from "@/curricula/services/sigaService";
import {
  CourseParallel,
  ProfessorReviewSummary,
} from "@/shared/types/academic";
import { EnrollCourseModal } from "@/frontend/components/solver/EnrollCourseModal";
import { ProfessorReviewModal } from "./ProfessorReviewModal";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/frontend/components/ui/card";
import { Badge } from "@/frontend/components/ui/badge";
import { Button } from "@/frontend/components/ui/button";
import { Input } from "@/frontend/components/ui/input";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/frontend/components/ui/popover";
import {
  Calendar,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Users,
  MapPin,
  Plus,
  Trash2,
  Wand2,
  Loader2,
  BookOpen,
  Star,
  GraduationCap,
  Search,
  Eye,
  EyeOff,
  Download,
  Sparkles,
  Check,
  ChevronUp,
} from "lucide-react";
import {
  optimizeSchedule,
  ScheduleOptimizationResult,
  ScheduleOptimizationStrategy,
} from "./scheduleOptimizer";

interface ScheduledCellEntry {
  sigla: string;
  nombre: string;
  paralelo: string;
  tipo: string;
  sala: string;
  profesor: string;
  color: string;
  isPreview?: boolean;
}

const SEDES_USM = [
  "Casa Central Valparaíso",
  "Santiago San Joaquín",
  "Santiago Vitacura",
  "Viña del Mar",
  "Concepción",
];

const COURSE_PALETTE = [
  "#0B72D4",
  "#2E8B57",
  "#D97706",
  "#7C3AED",
  "#DB2777",
  "#0891B2",
  "#4F46E5",
  "#EA580C",
];

export function SemesterScheduleView() {
  const {
    curriculum,
    inProgressCourses,
    enrollCourse,
    unenrollCourse,
    setSelectedParallel,
  } = useAcademicStore();

  const [selectedSede, setSelectedSede] = React.useState<string>(
    curriculum.sede || "Casa Central Valparaíso"
  );
  const [selectedJornada, setSelectedJornada] = React.useState<string>(
    curriculum.jornada || "Diurna"
  );
  const [periods, setPeriods] = React.useState<string[]>([]);
  const [selectedPeriod, setSelectedPeriod] = React.useState<string>("");
  const [periodCatalog, setPeriodCatalog] = React.useState<SigaCatalogCourse[]>(
    []
  );
  const [parallelsByCourse, setParallelsByCourse] = React.useState<
    Record<string, CourseParallel[]>
  >({});
  const [profReviews, setProfReviews] = React.useState<
    Record<string, ProfessorReviewSummary>
  >({});
  const [loading, setLoading] = React.useState<boolean>(false);
  const [globalSearch, setGlobalSearch] = React.useState<string>("");
  const [enrollModalOpen, setEnrollModalOpen] = React.useState<boolean>(false);
  const [selectedProfForModal, setSelectedProfForModal] = React.useState<{
    name: string;
    review: ProfessorReviewSummary | null;
  } | null>(null);

  // Live hover preview state (AlvinIsCrack style)
  const [hoveredPreview, setHoveredPreview] = React.useState<{
    sigla: string;
    parallel: CourseParallel;
  } | null>(null);

  // Multi-criteria Schedule Optimizer State
  const [optimizerStrategy, setOptimizerStrategy] =
    React.useState<ScheduleOptimizationStrategy>("minimize_clashes");
  const [optimizationResults, setOptimizationResults] = React.useState<
    ScheduleOptimizationResult[]
  >([]);
  const [isOptimizing, setIsOptimizing] = React.useState<boolean>(false);
  const [showOptimizerPanel, setShowOptimizerPanel] =
    React.useState<boolean>(false);
  const [previewCombo, setPreviewCombo] =
    React.useState<ScheduleOptimizationResult | null>(null);
  const [hoveredCombo, setHoveredCombo] =
    React.useState<ScheduleOptimizationResult | null>(null);
  const [appliedComboId, setAppliedComboId] = React.useState<string | null>(
    null
  );

  const activeComboPreview = hoveredCombo || previewCombo;

  // Sync default sede/jornada when curriculum changes
  React.useEffect(() => {
    if (curriculum.sede) setSelectedSede(curriculum.sede);
    if (curriculum.jornada) setSelectedJornada(curriculum.jornada);
  }, [curriculum.sede, curriculum.jornada]);

  // Load available periods and full SIGA catalog for the selected sede & jornada
  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getSchedulePeriods(selectedSede, selectedJornada)
      .then(async (pList) => {
        if (cancelled) return;
        setPeriods(pList);
        const targetP =
          selectedPeriod && pList.includes(selectedPeriod)
            ? selectedPeriod
            : pList[0] || "";
        if (targetP !== selectedPeriod) {
          setSelectedPeriod(targetP);
        }
        const cat = await getPeriodCatalog(
          selectedSede,
          selectedJornada,
          targetP || undefined
        );
        if (!cancelled) {
          setPeriodCatalog(cat.courses);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedSede, selectedJornada, selectedPeriod]);

  const enrolledSiglas = React.useMemo(
    () => Object.keys(inProgressCourses),
    [inProgressCourses]
  );

  // Load parallels and professor reviews for all enrolled courses
  React.useEffect(() => {
    let cancelled = false;
    if (enrolledSiglas.length === 0) {
      setParallelsByCourse({});
      return;
    }

    async function fetchAllParallels() {
      setLoading(true);
      try {
        const nextMap: Record<string, CourseParallel[]> = {};
        await Promise.all(
          enrolledSiglas.map(async (sigla) => {
            const list = await getCourseParallels(
              sigla,
              selectedSede,
              selectedJornada,
              selectedPeriod || undefined
            );
            nextMap[sigla] = list;
          })
        );
        if (cancelled) return;
        setParallelsByCourse(nextMap);

        // Fetch professor ratings for all professors in these parallels
        const allProfs = Array.from(
          new Set(
            Object.values(nextMap)
              .flat()
              .flatMap((p) => p.profesor || [])
          )
        ).filter((name) => name && !name.includes("DEFINIR"));

        const revMap: Record<string, ProfessorReviewSummary> = {};
        await Promise.all(
          allProfs.map(async (profName) => {
            const rev = await getProfessorReview(profName);
            if (rev) revMap[profName] = rev;
          })
        );
        if (!cancelled) {
          setProfReviews((prev) => ({ ...prev, ...revMap }));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchAllParallels();
    return () => {
      cancelled = true;
    };
  }, [enrolledSiglas, selectedSede, selectedJornada, selectedPeriod]);

  // Global search across both active Malla and full SIGA Period Catalog (including professor names!)
  const searchResults = React.useMemo(() => {
    const q = globalSearch.trim().toLowerCase();
    if (!q) return [];

    const results: Array<{
      sigla: string;
      nombre: string;
      departamento: string;
      inMalla: boolean;
      matchedProf?: string;
      matchedParallel?: string;
      parallelsCount: number;
    }> = [];

    const seen = new Set<string>();

    // 1. Search in SIGA period catalog (has real parallels & professors)
    for (const item of periodCatalog) {
      const matchSigla =
        item.sigla.toLowerCase().includes(q) ||
        item.rawSigla.toLowerCase().includes(q);
      const matchName = item.nombre.toLowerCase().includes(q);
      const matchDepto = item.departamento.toLowerCase().includes(q);
      const matchingParByProf = item.parallels.find((p) =>
        (p.profesor || []).some((prof) => prof.toLowerCase().includes(q))
      );

      if (matchSigla || matchName || matchDepto || matchingParByProf) {
        const inMalla = curriculum.ramos.some(
          (r) => r.sigla.toUpperCase() === item.sigla.toUpperCase()
        );
        seen.add(item.sigla.toUpperCase());
        results.push({
          sigla: item.sigla,
          nombre: item.nombre,
          departamento: item.departamento,
          inMalla,
          matchedProf: matchingParByProf
            ? matchingParByProf.profesor.join(" / ")
            : undefined,
          matchedParallel: matchingParByProf?.paralelo,
          parallelsCount: item.parallels.length,
        });
      }
      if (results.length >= 10) break;
    }

    // 2. Also include matching courses from active Malla if not already in results
    if (results.length < 10) {
      for (const r of curriculum.ramos) {
        if (seen.has(r.sigla.toUpperCase())) continue;
        if (
          r.sigla.toLowerCase().includes(q) ||
          r.nombre.toLowerCase().includes(q)
        ) {
          results.push({
            sigla: r.sigla,
            nombre: r.nombre,
            departamento: r.departamento || r.area,
            inMalla: true,
            parallelsCount: 0,
          });
        }
        if (results.length >= 10) break;
      }
    }

    return results;
  }, [globalSearch, periodCatalog, curriculum.ramos]);

  // Build grid cells (including live hover preview) & calculate block stats
  const {
    gridMap,
    conflicts,
    hasSaturday,
    totalIndividualBlocks,
    activeDaysCount,
    assignedCoursesCount,
  } = React.useMemo(() => {
    const map: Record<string, ScheduledCellEntry[]> = {};
    let saturdayUsed = false;
    const uniqueDayBlockSet = new Set<string>();
    const activeDaysSet = new Set<number>();
    let assignedCount = 0;

    const previewParallels = activeComboPreview?.parallels;

    enrolledSiglas.forEach((sigla, idx) => {
      const config = inProgressCourses[sigla];
      const isCandidatePreview = Boolean(previewParallels && previewParallels[sigla]);

      const chosenPar = isCandidatePreview
        ? previewParallels![sigla]
        : (parallelsByCourse[sigla] || []).find(
            (p) => p.paralelo === config?.selectedParallel
          );

      if (!chosenPar || !chosenPar.horario) return;
      const parId = chosenPar.paralelo;

      assignedCount++;
      const courseObj = curriculum.ramos.find((r) => r.sigla === sigla);
      const areaColor =
        (courseObj && curriculum.areas[courseObj.area]?.color) ||
        COURSE_PALETTE[idx % COURSE_PALETTE.length];
      const courseName =
        courseObj?.nombre || config?.customName || chosenPar.nombre || sigla;

      for (const b of chosenPar.horario) {
        uniqueDayBlockSet.add(`${b.dia}-${b.bloque}`);
        activeDaysSet.add(b.dia);
      }

      const isDiffFromCurrent = Boolean(
        isCandidatePreview && config?.selectedParallel !== parId
      );

      for (const pairObj of USM_BLOCK_PAIRS) {
        for (let dia = 0; dia < 6; dia++) {
          const matchingBlock = chosenPar.horario.find(
            (b) => b.dia === dia && pairObj.blocks.includes(b.bloque)
          );
          if (matchingBlock) {
            if (dia === 5) saturdayUsed = true;
            const cellKey = `${dia}-${pairObj.pair}`;
            if (!map[cellKey]) map[cellKey] = [];
            if (!map[cellKey].some((e) => e.sigla === sigla && !e.isPreview)) {
              map[cellKey].push({
                sigla,
                nombre: courseName,
                paralelo: parId,
                tipo: matchingBlock.tipo,
                sala: matchingBlock.sala,
                profesor:
                  chosenPar.profesor?.join(", ") || matchingBlock.profesor,
                color: isDiffFromCurrent ? "#D99B00" : areaColor,
                isPreview: isDiffFromCurrent,
              });
            }
          }
        }
      }
    });

    // Inject hoveredPreview blocks if the user is hovering a parallel
    if (hoveredPreview && hoveredPreview.parallel.horario) {
      const { sigla, parallel } = hoveredPreview;
      const currentSelected = inProgressCourses[sigla]?.selectedParallel;
      if (currentSelected !== parallel.paralelo) {
        const courseObj = curriculum.ramos.find((r) => r.sigla === sigla);
        const courseName =
          courseObj?.nombre ||
          inProgressCourses[sigla]?.customName ||
          parallel.nombre ||
          sigla;

        for (const pairObj of USM_BLOCK_PAIRS) {
          for (let dia = 0; dia < 6; dia++) {
            const matchingBlock = parallel.horario.find(
              (b) => b.dia === dia && pairObj.blocks.includes(b.bloque)
            );
            if (matchingBlock) {
              if (dia === 5) saturdayUsed = true;
              const cellKey = `${dia}-${pairObj.pair}`;
              if (!map[cellKey]) map[cellKey] = [];
              map[cellKey].push({
                sigla,
                nombre: courseName,
                paralelo: parallel.paralelo,
                tipo: matchingBlock.tipo,
                sala: matchingBlock.sala,
                profesor:
                  parallel.profesor?.join(", ") || matchingBlock.profesor,
                color: "#D99B00",
                isPreview: true,
              });
            }
          }
        }
      }
    }

    // Check if Saturday is used by existing blocks or could be used by any parallel
    const saturdayPossible = enrolledSiglas.some((sigla) =>
      (parallelsByCourse[sigla] || []).some((p) =>
        p.horario?.some((b) => b.dia === 5)
      )
    );

    const conflictList: Array<{
      dia: number;
      pair: string;
      entries: ScheduledCellEntry[];
    }> = [];

    // Conflict list for enrolled courses (stable, prevents layout shift during hover preview)
    for (const [key, entries] of Object.entries(map)) {
      const targetEntries = entries.filter((e) => !e.isPreview);
      if (targetEntries.length > 1) {
        const [diaStr, ...pairParts] = key.split("-");
        conflictList.push({
          dia: Number(diaStr),
          pair: pairParts.join("-"),
          entries: targetEntries,
        });
      }
    }

    return {
      gridMap: map,
      conflicts: conflictList,
      hasSaturday: saturdayUsed || saturdayPossible,
      totalIndividualBlocks: uniqueDayBlockSet.size,
      activeDaysCount: activeDaysSet.size,
      assignedCoursesCount: assignedCount,
    };
  }, [
    enrolledSiglas,
    inProgressCourses,
    parallelsByCourse,
    curriculum,
    hoveredPreview,
    activeComboPreview,
  ]);

  // Reset optimization preview when enrolled courses change
  React.useEffect(() => {
    setPreviewCombo(null);
    setHoveredCombo(null);
    setOptimizationResults([]);
    setAppliedComboId(null);
  }, [enrolledSiglas.length]);

  // Run multi-criteria schedule optimizer
  const handleRunOptimizer = React.useCallback(
    (customStrategy?: ScheduleOptimizationStrategy) => {
      const strat = customStrategy || optimizerStrategy;
      setIsOptimizing(true);
      setShowOptimizerPanel(true);

      setTimeout(() => {
        try {
          const results = optimizeSchedule({
            courses: enrolledSiglas,
            parallelsByCourse,
            strategy: strat,
            maxResults: 3,
          });
          setOptimizationResults(results);
          if (results.length > 0) {
            setAppliedComboId(null);
          }
        } finally {
          setIsOptimizing(false);
        }
      }, 10);
    },
    [enrolledSiglas, parallelsByCourse, optimizerStrategy]
  );

  // Apply a suggested combination of parallels
  const handleApplyCombination = React.useCallback(
    (combo: ScheduleOptimizationResult) => {
      Object.entries(combo.parallels).forEach(([sigla, par]) => {
        setSelectedParallel(sigla, par.paralelo);
      });
      setPreviewCombo(null);
      setHoveredCombo(null);
      setAppliedComboId(combo.id);
    },
    [setSelectedParallel]
  );

  // Auto-select conflict-free parallels for enrolled courses (upgraded with multi-criteria optimizer)
  const handleAutoAssignParallels = () => {
    const results = optimizeSchedule({
      courses: enrolledSiglas,
      parallelsByCourse,
      strategy: "minimize_clashes",
      maxResults: 1,
    });
    if (results.length > 0) {
      handleApplyCombination(results[0]);
    } else {
      const occupied = new Set<string>();
      for (const sigla of enrolledSiglas) {
        const parList = parallelsByCourse[sigla] || [];
        if (parList.length === 0) continue;

        let bestPar = parList[0];
        for (const candidate of parList) {
          const hasCollision = (candidate.horario || []).some((b) =>
            occupied.has(`${b.dia}-${b.bloque}`)
          );
          if (!hasCollision) {
            bestPar = candidate;
            break;
          }
        }

        setSelectedParallel(sigla, bestPar.paralelo);
        for (const b of bestPar.horario || []) {
          occupied.add(`${b.dia}-${b.bloque}`);
        }
      }
    }
  };

  const visibleDays = hasSaturday ? [0, 1, 2, 3, 4, 5] : [0, 1, 2, 3, 4];
  const weeklyChronologicalHours = (
    (totalIndividualBlocks * 35) /
    60
  ).toFixed(1);

  const handleOpenProfModal = async (
    e: React.MouseEvent,
    profName: string
  ) => {
    e.stopPropagation();
    const cached = profReviews[profName] || (await getProfessorReview(profName));
    setSelectedProfForModal({
      name: profName,
      review: cached || null,
    });
  };

  const handleExportIcs = () => {
    const lines: string[] = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Malla USM//Horario Semestral SIGA//ES",
      "CALSCALE:GREGORIAN",
    ];

    // Base Monday of current week
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0=Sun..6=Sat
    const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const baseMonday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + diffToMonday
    );

    const pad = (n: number) => String(n).padStart(2, "0");
    const fmtDate = (d: Date, hhmm: string) => {
      const [hh, mm] = hhmm.split(":");
      return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(
        d.getDate()
      )}T${hh}${mm}00`;
    };

    for (const pairObj of USM_BLOCK_PAIRS) {
      const [startStr, endStr] = pairObj.time.split(" - ").map((s) => s.trim());
      for (let dia = 0; dia < 6; dia++) {
        const entries = (gridMap[`${dia}-${pairObj.pair}`] || []).filter(
          (e) => !e.isPreview
        );
        for (const entry of entries) {
          const eventDate = new Date(baseMonday);
          eventDate.setDate(baseMonday.getDate() + dia);
          const dtStart = fmtDate(eventDate, startStr);
          const dtEnd = fmtDate(eventDate, endStr);
          lines.push("BEGIN:VEVENT");
          lines.push(
            `UID:${entry.sigla}-${entry.paralelo}-${dia}-${pairObj.pair}@malla-usm`
          );
          lines.push(`DTSTART:${dtStart}`);
          lines.push(`DTEND:${dtEnd}`);
          lines.push("RRULE:FREQ=WEEKLY;COUNT=17");
          lines.push(
            `SUMMARY:${entry.sigla} (${entry.tipo}) - Par. ${entry.paralelo}`
          );
          lines.push(
            `DESCRIPTION:${entry.nombre}\\nProfesor: ${
              entry.profesor || "Por definir"
            }`
          );
          if (entry.sala) {
            lines.push(`LOCATION:Sala ${entry.sala} (${selectedSede})`);
          }
          lines.push("END:VEVENT");
        }
      }
    }

    lines.push("END:VCALENDAR");
    const blob = new Blob([lines.join("\r\n")], {
      type: "text/calendar;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `horario-usm-${selectedPeriod || "semestre"}.ics`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const conflictPopoverContent = (
    <PopoverContent
      align="end"
      sideOffset={6}
      className="w-80 p-3 shadow-xl z-50 text-xs space-y-2 border-destructive/40"
    >
      <div className="flex items-center gap-1.5 font-bold text-destructive pb-1.5 border-b border-border/50">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span>Detalle de Topes ({conflicts.length})</span>
      </div>
      <div className="max-h-60 overflow-y-auto space-y-1.5 pr-1">
        {conflicts.map((c, idx) => (
          <div
            key={idx}
            className="p-2 rounded-md bg-destructive/10 border border-destructive/20 text-foreground space-y-1"
          >
            <div className="font-semibold text-destructive flex items-center gap-1">
              <span>
                {USM_BAR_DAYS[c.dia]} Bloque {c.pair}:
              </span>
            </div>
            <div className="text-[11px] text-muted-foreground leading-snug">
              {c.entries
                .map((e) => `${e.sigla} (Par. ${e.paralelo})`)
                .join(" choca con ")}
            </div>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-muted-foreground pt-1 border-t border-border/40 text-center">
        Cambia de paralelo o usa el Auto-Optimizador para resolver colisiones.
      </p>
    </PopoverContent>
  );

  return (
    <div className="space-y-5">
      {/* Header & Controls Card */}
      <Card className="border-t-4 border-t-[#002B49]">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-lg sm:text-xl flex items-center gap-2">
                <Calendar className="h-5 w-5 text-[#D99B00]" />
                <span>Calculadora de Horario y Bloques SIGA USM</span>
              </CardTitle>
              <CardDescription className="text-xs sm:text-sm">
                Elige profesor y paralelo para calcular tus bloques semanales, previsualizar horarios al pasar el mouse y detectar topes automáticamente.
              </CardDescription>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {/* Sede Selector */}
              <select
                value={selectedSede}
                onChange={(e) => setSelectedSede(e.target.value)}
                aria-label="Seleccionar Sede USM"
                className="h-8 rounded-md border bg-background px-2.5 text-xs font-medium"
              >
                {SEDES_USM.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>

              {/* Jornada Selector */}
              <select
                value={selectedJornada}
                onChange={(e) => setSelectedJornada(e.target.value)}
                aria-label="Seleccionar Jornada"
                className="h-8 rounded-md border bg-background px-2.5 text-xs font-medium"
              >
                <option value="Diurna">Diurna</option>
                <option value="Vespertina">Vespertina</option>
              </select>

              {/* Periodo Selector */}
              {periods.length > 0 && (
                <select
                  value={selectedPeriod}
                  onChange={(e) => setSelectedPeriod(e.target.value)}
                  aria-label="Seleccionar Periodo Académico"
                  className="h-8 rounded-md border bg-background px-2.5 text-xs font-semibold text-[#002B49] dark:text-[#D99B00]"
                >
                  {periods.map((p) => (
                    <option key={p} value={p}>
                      Semestre {p}
                    </option>
                  ))}
                </select>
              )}

              {enrolledSiglas.length > 0 && (
                <>
                  {/* Compact Clash Badge / Interactive Popover Button (h-8) */}
                  {conflicts.length === 0 ? (
                    <div className="h-8 px-2.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-xs font-semibold flex items-center gap-1.5">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span>0 Topes</span>
                    </div>
                  ) : (
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 px-2.5 text-xs font-semibold gap-1.5 border-destructive/50 bg-destructive/10 text-destructive hover:bg-destructive/20 shadow-xs"
                          title="Ver detalle de bloques en conflicto"
                        >
                          <AlertTriangle className="h-3.5 w-3.5" />
                          <span>
                            {conflicts.length}{" "}
                            {conflicts.length === 1 ? "Tope" : "Topes"}
                          </span>
                        </Button>
                      </PopoverTrigger>
                      {conflictPopoverContent}
                    </Popover>
                  )}

                  <Button
                    type="button"
                    variant={showOptimizerPanel ? "usm" : "gold"}
                    size="sm"
                    onClick={() => {
                      setShowOptimizerPanel((prev) => !prev);
                      if (!showOptimizerPanel || optimizationResults.length === 0) {
                        handleRunOptimizer(optimizerStrategy);
                      }
                    }}
                    className="h-8 gap-1.5 text-xs font-semibold shadow-xs"
                    title="Abrir panel de optimización multi-criterio de horarios"
                  >
                    <Sparkles className="h-3.5 w-3.5 text-[#D99B00]" />
                    <span>Auto-Optimizar Horario</span>
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleAutoAssignParallels}
                    className="h-8 gap-1.5 text-xs"
                    title="Asignar automáticamente la mejor combinación sin topes en 1 clic"
                  >
                    <Wand2 className="h-3.5 w-3.5" />
                    <span>Auto-asignar 1-Clic</span>
                  </Button>

                  {assignedCoursesCount > 0 && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleExportIcs}
                      className="h-8 gap-1.5 text-xs"
                      title="Exportar horario semanal a Google Calendar / Apple Calendar / Outlook (.ics)"
                    >
                      <Download className="h-3.5 w-3.5 text-[#D99B00]" />
                      <span>Exportar .ics</span>
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent className="pt-0 space-y-3">
          {/* Dual Enrollment Bar: Button for Malla Modal + Global SIGA Search */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
            <Button
              type="button"
              variant="usm"
              size="sm"
              onClick={() => setEnrollModalOpen(true)}
              className="h-9 px-3.5 text-xs font-semibold gap-1.5 shrink-0"
            >
              <GraduationCap className="h-4 w-4 text-[#D99B00]" />
              <span>Inscribir desde mi Malla (Disponibles / Bloqueados)</span>
            </Button>

            <div className="relative flex-1">
              <Search className="h-4 w-4 absolute left-3 top-2.5 text-muted-foreground" />
              <Input
                placeholder="Buscar en catálogo SIGA por ramo, sigla, departamento o nombre de profesor..."
                value={globalSearch}
                onChange={(e) => setGlobalSearch(e.target.value)}
                className="pl-9 h-9 text-xs"
              />
              {searchResults.length > 0 && (
                <div className="absolute z-30 mt-1 w-full rounded-lg border bg-popover shadow-xl p-1.5 space-y-1 max-h-72 overflow-y-auto">
                  {searchResults.map((item) => (
                    <button
                      key={item.sigla}
                      type="button"
                      onClick={() => {
                        enrollCourse(item.sigla, {
                          customName: item.nombre,
                          selectedParallel: item.matchedParallel,
                        });
                        setGlobalSearch("");
                      }}
                      className="w-full text-left px-2.5 py-2 rounded-md text-xs hover:bg-muted flex items-center justify-between gap-2 transition-colors"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <strong className="font-mono">{item.sigla}</strong>
                          <span className="font-medium truncate">
                            {item.nombre}
                          </span>
                          {item.inMalla ? (
                            <Badge variant="secondary" className="text-[9px]">
                              En tu Malla
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[9px]">
                              {item.departamento}
                            </Badge>
                          )}
                        </div>
                        {item.matchedProf && (
                          <div className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5">
                            Dictado por: <strong>{item.matchedProf}</strong>{" "}
                            (Par. {item.matchedParallel})
                          </div>
                        )}
                      </div>
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#002B49] dark:text-[#D99B00] shrink-0">
                        <Plus className="h-3.5 w-3.5" />
                        Agregar
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Calculated Schedule Summary KPIs */}
          {enrolledSiglas.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
              <div className="p-2.5 rounded-lg border bg-muted/20 flex items-center justify-between">
                <div>
                  <div className="text-[10px] uppercase font-semibold text-muted-foreground">
                    Paralelos Elegidos
                  </div>
                  <div className="text-sm font-black text-foreground">
                    {assignedCoursesCount} / {enrolledSiglas.length} ramos
                  </div>
                </div>
                <Users className="h-4 w-4 text-[#D99B00]" />
              </div>

              <div className="p-2.5 rounded-lg border bg-muted/20 flex items-center justify-between">
                <div>
                  <div className="text-[10px] uppercase font-semibold text-muted-foreground">
                    Bloques Calculados
                  </div>
                  <div className="text-sm font-black text-foreground">
                    {totalIndividualBlocks} bloques{" "}
                    <span className="text-[11px] font-normal text-muted-foreground">
                      ({weeklyChronologicalHours} hrs)
                    </span>
                  </div>
                </div>
                <Clock className="h-4 w-4 text-sky-500" />
              </div>

              <div className="p-2.5 rounded-lg border bg-muted/20 flex items-center justify-between">
                <div>
                  <div className="text-[10px] uppercase font-semibold text-muted-foreground">
                    Días en Campus
                  </div>
                  <div className="text-sm font-black text-foreground">
                    {activeDaysCount}{" "}
                    {activeDaysCount === 1 ? "día / sem" : "días / sem"}
                  </div>
                </div>
                <Calendar className="h-4 w-4 text-emerald-500" />
              </div>

              {conflicts.length === 0 ? (
                <div className="p-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 flex items-center justify-between">
                  <div>
                    <div className="text-[10px] uppercase font-semibold opacity-80">
                      Estado de Topes
                    </div>
                    <div className="text-sm font-black">0 Topes</div>
                  </div>
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                </div>
              ) : (
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="p-2.5 rounded-lg border border-destructive/50 bg-destructive/10 text-destructive flex items-center justify-between text-left cursor-pointer hover:bg-destructive/15 transition-colors focus:outline-none focus:ring-2 focus:ring-destructive/40"
                      title="Ver detalle de topes"
                    >
                      <div>
                        <div className="text-[10px] uppercase font-semibold opacity-80">
                          Estado de Topes
                        </div>
                        <div className="text-sm font-black">
                          {conflicts.length}{" "}
                          {conflicts.length === 1
                            ? "Tope - Ver detalle"
                            : "Topes - Ver detalle"}
                        </div>
                      </div>
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                    </button>
                  </PopoverTrigger>
                  {conflictPopoverContent}
                </Popover>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Auto-Optimizar Horario Multi-Criterio Panel */}
      {showOptimizerPanel && enrolledSiglas.length > 0 && (
        <Card className="border-2 border-[#D99B00]/40 bg-card shadow-md transition-all animate-in fade-in slide-in-from-top-2">
          <CardHeader className="p-4 pb-2">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base sm:text-lg flex items-center gap-2 text-foreground">
                  <Sparkles className="h-5 w-5 text-[#D99B00]" />
                  <span>Auto-Optimizador de Horario Multi-Criterio</span>
                </CardTitle>
                <CardDescription className="text-xs mt-0.5">
                  Evalúa combinaciones de paralelos en paralelo para eliminar choques, reducir bloques ventana y maximizar días libres.
                </CardDescription>
              </div>

              <div className="flex items-center gap-2 self-start sm:self-auto">
                <Button
                  type="button"
                  variant="gold"
                  size="sm"
                  onClick={() => handleRunOptimizer(optimizerStrategy)}
                  disabled={isOptimizing}
                  className="h-8 text-xs font-semibold gap-1.5 shadow-xs"
                >
                  {isOptimizing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Wand2 className="h-3.5 w-3.5" />
                  )}
                  <span>{isOptimizing ? "Optimizando..." : "Sugerir Mejor Horario"}</span>
                </Button>

                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    setShowOptimizerPanel(false);
                    setPreviewCombo(null);
                    setHoveredCombo(null);
                  }}
                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                  title="Cerrar panel de optimización"
                >
                  <ChevronUp className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-4 pt-2 space-y-4">
            {/* Strategy Selector */}
            <div className="space-y-1.5">
              <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <span>Estrategia de Optimización:</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setOptimizerStrategy("minimize_clashes");
                    handleRunOptimizer("minimize_clashes");
                  }}
                  className={`p-2.5 rounded-lg border text-left transition-all flex flex-col justify-between ${
                    optimizerStrategy === "minimize_clashes"
                      ? "border-[#002B49] bg-[#002B49]/10 dark:border-[#D99B00] dark:bg-[#D99B00]/15 ring-2 ring-[#002B49]/40 dark:ring-[#D99B00]/40 shadow-xs"
                      : "border-border hover:border-muted-foreground/40 bg-card/60"
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-bold text-xs flex items-center gap-1.5 text-foreground">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                      Minimizar Topes
                    </span>
                    {optimizerStrategy === "minimize_clashes" && (
                      <Badge variant="default" className="text-[9px] py-0 px-1">
                        Activa
                      </Badge>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
                    Prioriza 0 choques de horario primero, luego reduce ventanas y busca días libres.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setOptimizerStrategy("minimize_windows");
                    handleRunOptimizer("minimize_windows");
                  }}
                  className={`p-2.5 rounded-lg border text-left transition-all flex flex-col justify-between ${
                    optimizerStrategy === "minimize_windows"
                      ? "border-[#002B49] bg-[#002B49]/10 dark:border-[#D99B00] dark:bg-[#D99B00]/15 ring-2 ring-[#002B49]/40 dark:ring-[#D99B00]/40 shadow-xs"
                      : "border-border hover:border-muted-foreground/40 bg-card/60"
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-bold text-xs flex items-center gap-1.5 text-foreground">
                      <Clock className="h-3.5 w-3.5 text-amber-500" />
                      Minimizar Ventanas
                    </span>
                    {optimizerStrategy === "minimize_windows" && (
                      <Badge variant="default" className="text-[9px] py-0 px-1">
                        Activa
                      </Badge>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
                    Minimiza horas muertas entre clases para compactar los bloques del día continuo.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setOptimizerStrategy("maximize_free_time");
                    handleRunOptimizer("maximize_free_time");
                  }}
                  className={`p-2.5 rounded-lg border text-left transition-all flex flex-col justify-between ${
                    optimizerStrategy === "maximize_free_time"
                      ? "border-[#002B49] bg-[#002B49]/10 dark:border-[#D99B00] dark:bg-[#D99B00]/15 ring-2 ring-[#002B49]/40 dark:ring-[#D99B00]/40 shadow-xs"
                      : "border-border hover:border-muted-foreground/40 bg-card/60"
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-bold text-xs flex items-center gap-1.5 text-foreground">
                      <Calendar className="h-3.5 w-3.5 text-sky-500" />
                      Maximizar Tiempo Libre
                    </span>
                    {optimizerStrategy === "maximize_free_time" && (
                      <Badge variant="default" className="text-[9px] py-0 px-1">
                        Activa
                      </Badge>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
                    Agrupa clases para liberar días completos y medios días (mañanas o tardes libres).
                  </p>
                </button>
              </div>
            </div>

            {/* Top 3 Combinations Results */}
            {isOptimizing ? (
              <div className="p-8 text-center space-y-2 border rounded-lg bg-muted/10">
                <Loader2 className="h-6 w-6 animate-spin mx-auto text-[#D99B00]" />
                <div className="text-xs font-semibold text-foreground">
                  Evaluando miles de combinaciones de paralelos en paralelo...
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Calculando topes, ventanas y días libres garantizando respuesta en &lt; 50ms
                </div>
              </div>
            ) : optimizationResults.length === 0 ? (
              <div className="p-4 rounded-lg border border-dashed text-center text-xs text-muted-foreground">
                Haz clic en <strong>"Sugerir Mejor Horario"</strong> para calcular el Top 3 de combinaciones óptimas para tus {enrolledSiglas.length} asignaturas inscritas.
              </div>
            ) : (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between flex-wrap gap-1">
                  <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-[#D99B00]" />
                    <span>Top {optimizationResults.length} de Mejores Combinaciones Encontradas:</span>
                  </div>
                  <span className="text-[11px] text-muted-foreground">
                    Pasa el cursor sobre una opción para previsualizarla en la grilla
                  </span>
                </div>

                {/* Fixed-Height Static Inline Preview Status Bar (min-h-[44px], CLS = 0) */}
                <div
                  className={`min-h-[44px] px-3.5 py-1.5 rounded-lg border flex flex-wrap sm:flex-nowrap items-center justify-between gap-2 text-xs transition-colors duration-150 ${
                    activeComboPreview
                      ? "border-[#D99B00]/40 bg-[#D99B00]/10 text-foreground"
                      : "border-border/60 bg-muted/20 text-muted-foreground"
                  }`}
                >
                  {activeComboPreview ? (
                    <>
                      <div className="flex items-center gap-2 min-w-0">
                        <Eye className="h-4 w-4 text-[#D99B00] shrink-0" />
                        <div className="truncate">
                          <span className="font-bold text-[#002B49] dark:text-[#D99B00]">
                            Previsualizando Opción {activeComboPreview.rank}:
                          </span>
                          <span className="text-muted-foreground ml-1.5 font-medium">
                            {activeComboPreview.summaryBadges.join(" • ")}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Button
                          type="button"
                          size="sm"
                          variant="gold"
                          onClick={() => handleApplyCombination(activeComboPreview)}
                          className="h-7 text-xs font-semibold gap-1 shadow-2xs"
                        >
                          <Check className="h-3 w-3" />
                          <span>Aplicar esta combinación</span>
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setPreviewCombo(null);
                            setHoveredCombo(null);
                          }}
                          className="h-7 text-xs text-muted-foreground hover:text-foreground"
                        >
                          <span>Cerrar</span>
                        </Button>
                      </div>
                    </>
                  ) : (
                    <div className="flex items-center justify-between w-full">
                      <div className="flex items-center gap-2">
                        <Eye className="h-4 w-4 text-muted-foreground/60 shrink-0" />
                        <span>
                          Pasa el cursor sobre una opción para previsualizar los bloques en la grilla semanal sin alterar tu selección actual.
                        </span>
                      </div>
                      <span className="text-[10px] text-muted-foreground/75 font-mono hidden md:inline">
                        Hover interactivo
                      </span>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {optimizationResults.map((result) => {
                    const isPreviewed = activeComboPreview?.id === result.id;
                    const isApplied = appliedComboId === result.id;

                    return (
                      <div
                        key={result.id}
                        onMouseEnter={() => setHoveredCombo(result)}
                        onMouseLeave={() => setHoveredCombo(null)}
                        className={`rounded-lg border p-3 flex flex-col justify-between gap-2.5 transition-all relative ${
                          isPreviewed
                            ? "border-[#D99B00] ring-2 ring-[#D99B00]/40 bg-[#D99B00]/5 shadow-sm"
                            : isApplied
                            ? "border-emerald-500/50 bg-emerald-500/5"
                            : "border-border hover:border-muted-foreground/50 bg-card"
                        }`}
                      >
                        {/* Header of Option */}
                        <div>
                          <div className="flex items-center justify-between gap-1 mb-1.5">
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold text-xs text-foreground">
                                Opción {result.rank}
                              </span>
                              {result.rank === 1 && (
                                <Badge variant="usm" className="text-[9px] px-1 py-0 font-semibold">
                                  Recomendada
                                </Badge>
                              )}
                            </div>
                            <span className="text-[10px] font-mono font-bold text-muted-foreground">
                              Score: {result.score}/100
                            </span>
                          </div>

                          {/* Summary Badges: Topes, Ventanas, Dias Libres */}
                          <div className="flex flex-wrap gap-1 mb-2">
                            {result.clashCount === 0 ? (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 flex items-center gap-0.5">
                                <CheckCircle2 className="h-2.5 w-2.5" />
                                0 Topes
                              </span>
                            ) : (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-destructive/15 text-destructive border border-destructive/30 flex items-center gap-0.5">
                                <AlertTriangle className="h-2.5 w-2.5" />
                                {result.clashCount} Tope{result.clashCount > 1 ? "s" : ""}
                              </span>
                            )}

                            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 flex items-center gap-0.5">
                              <Clock className="h-2.5 w-2.5" />
                              {result.windowBlocks === 0
                                ? "0 Ventanas"
                                : `${result.windowBlocks} Ventana${result.windowBlocks > 1 ? "s" : ""}`}
                            </span>

                            {result.freeDays > 0 && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-sky-500/15 text-sky-700 dark:text-sky-300 border border-sky-500/30 flex items-center gap-0.5">
                                <Calendar className="h-2.5 w-2.5" />
                                {result.freeDays} Día{result.freeDays > 1 ? "s" : ""} libre{result.freeDays > 1 ? "s" : ""}
                              </span>
                            )}

                            {result.freeDays === 0 && result.freeHalfDays > 0 && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-500/15 text-purple-700 dark:text-purple-300 border border-purple-500/30">
                                {result.freeHalfDays} Medios días libres
                              </span>
                            )}
                          </div>

                          {/* Parallels Pill List */}
                          <div className="space-y-1 bg-muted/30 p-2 rounded border border-border/50 text-[11px]">
                            <div className="text-[10px] font-semibold text-muted-foreground uppercase">
                              Paralelos Asignados:
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {Object.entries(result.parallels).map(([sigla, par]) => (
                                <span
                                  key={sigla}
                                  className="px-1.5 py-0.5 rounded bg-background text-[10px] font-mono border inline-flex items-center gap-1"
                                  title={`${sigla}: Paralelo ${par.paralelo} (${par.profesor?.join(", ") || "Profesor por definir"})`}
                                >
                                  <strong>{sigla}</strong>
                                  <span className="text-[#002B49] dark:text-[#D99B00] font-bold">
                                    P{par.paralelo}
                                  </span>
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-1.5 pt-1">
                          <Button
                            type="button"
                            variant={isPreviewed ? "secondary" : "outline"}
                            size="sm"
                            onClick={() => {
                              if (previewCombo?.id === result.id) {
                                setPreviewCombo(null);
                              } else {
                                setPreviewCombo(result);
                              }
                            }}
                            className="h-7 text-[11px] gap-1 flex-1"
                            title="Previsualizar esta combinación en la grilla horaria"
                          >
                            {isPreviewed ? (
                              <>
                                <EyeOff className="h-3 w-3" />
                                <span>Ocultar</span>
                              </>
                            ) : (
                              <>
                                <Eye className="h-3 w-3" />
                                <span>Ver Grilla</span>
                              </>
                            )}
                          </Button>

                          <Button
                            type="button"
                            variant={isApplied ? "outline" : "gold"}
                            size="sm"
                            onClick={() => handleApplyCombination(result)}
                            className="h-7 text-[11px] font-semibold gap-1 flex-1 shadow-2xs"
                          >
                            {isApplied ? (
                              <>
                                <Check className="h-3 w-3 text-emerald-500" />
                                <span>Aplicada</span>
                              </>
                            ) : (
                              <>
                                <Check className="h-3 w-3" />
                                <span>Aplicar</span>
                              </>
                            )}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Main Layout: Professor/Parallel Picker + Weekly Calendar Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left Column: Enrolled Courses & Professor/Parallel Selector */}
        <div className="lg:col-span-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <BookOpen className="h-4 w-4 text-[#002B49] dark:text-[#D99B00]" />
              <span>Elegir Profesor y Paralelo ({enrolledSiglas.length})</span>
            </h3>
            {loading && (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            )}
          </div>

          {enrolledSiglas.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-8 text-center space-y-3">
                <Calendar className="h-8 w-8 mx-auto text-muted-foreground/50" />
                <p className="text-xs text-muted-foreground">
                  No tienes asignaturas en tu horario. Inscríbelas desde tu malla curricular o buscándolas en el catálogo SIGA.
                </p>
                <Button
                  type="button"
                  variant="usm"
                  size="sm"
                  onClick={() => setEnrollModalOpen(true)}
                  className="text-xs gap-1.5"
                >
                  <Plus className="h-3.5 w-3.5 text-[#D99B00]" />
                  <span>Inscribir desde mi Malla</span>
                </Button>
              </CardContent>
            </Card>
          ) : (
            enrolledSiglas.map((sigla, idx) => {
              const courseObj = curriculum.ramos.find((r) => r.sigla === sigla);
              const enrolledCfg = inProgressCourses[sigla];
              const areaColor =
                (courseObj && curriculum.areas[courseObj.area]?.color) ||
                COURSE_PALETTE[idx % COURSE_PALETTE.length];
              const parList = parallelsByCourse[sigla] || [];
              const selectedParId = enrolledCfg?.selectedParallel;
              const displayName =
                courseObj?.nombre ||
                enrolledCfg?.customName ||
                parList[0]?.nombre ||
                sigla;

              return (
                <Card key={sigla} className="overflow-hidden">
                  <div
                    className="h-1.5 w-full"
                    style={{ backgroundColor: areaColor }}
                  />
                  <CardHeader className="p-3 pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <Badge
                            variant="outline"
                            className="font-mono text-[11px]"
                          >
                            {sigla}
                          </Badge>
                          {selectedParId ? (
                            <Badge variant="default" className="text-[10px]">
                              Paralelo {selectedParId}
                            </Badge>
                          ) : (
                            <Badge variant="warning" className="text-[10px]">
                              Elige paralelo
                            </Badge>
                          )}
                        </div>
                        <CardTitle className="text-xs sm:text-sm font-bold mt-1">
                          {displayName}
                        </CardTitle>
                      </div>

                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          if (
                            typeof window !== "undefined" &&
                            !window.confirm(
                              `¿Estás seguro de quitar ${sigla} del semestre? Se desvinculará el horario asignado.`
                            )
                          ) {
                            return;
                          }
                          unenrollCourse(sigla);
                        }}
                        className="h-6 w-6 text-muted-foreground hover:text-destructive"
                        title="Quitar asignatura del semestre"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </CardHeader>

                  <CardContent className="p-3 pt-0 space-y-2">
                    {parList.length === 0 ? (
                      <p className="text-[11px] text-muted-foreground italic">
                        Sin paralelos publicados en {selectedSede} (
                        {selectedJornada} • {selectedPeriod}).
                      </p>
                    ) : (
                      <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
                        {parList.map((par) => {
                          const isSelected = selectedParId === par.paralelo;
                          const groupedBlocks = groupScheduleBlocks(
                            par.horario || []
                          );
                          const firstProf = par.profesor?.[0];
                          const profRev = firstProf
                            ? profReviews[firstProf]
                            : undefined;

                          return (
                            <button
                              key={par.paralelo}
                              type="button"
                              onMouseEnter={() =>
                                setHoveredPreview({ sigla, parallel: par })
                              }
                              onMouseLeave={() => setHoveredPreview(null)}
                              onClick={() => {
                                setHoveredPreview(null);
                                setSelectedParallel(
                                  sigla,
                                  isSelected ? undefined : par.paralelo
                                );
                              }}
                              className={`w-full text-left p-2 rounded-md border text-[11px] transition-all ${
                                isSelected
                                  ? "border-[#002B49] bg-[#002B49]/10 dark:border-[#D99B00] dark:bg-[#D99B00]/15 ring-1 ring-[#002B49]/30 dark:ring-[#D99B00]/40"
                                  : "hover:border-[#D99B00] bg-card/50"
                              }`}
                            >
                              <div className="flex items-center justify-between gap-1 font-semibold">
                                <span className="flex items-center gap-1.5">
                                  <Users className="h-3 w-3 text-[#D99B00]" />
                                  <span>Paralelo {par.paralelo}</span>
                                </span>
                                <div className="flex items-center gap-1.5">
                                  {profRev?.stats.claridad_expositiva && firstProf && (
                                    <span
                                      role="button"
                                      tabIndex={0}
                                      onClick={(e) =>
                                        handleOpenProfModal(e, firstProf)
                                      }
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                          handleOpenProfModal(
                                            e as unknown as React.MouseEvent,
                                            firstProf
                                          );
                                        }
                                      }}
                                      className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-amber-500/15 hover:bg-amber-500/30 border border-amber-500/30 text-[10px] text-amber-600 dark:text-amber-400 font-bold cursor-pointer transition-colors"
                                      title="Haz clic para ver reseñas, etiquetas y comentarios de este profesor"
                                    >
                                      <Star className="h-2.5 w-2.5 fill-current" />
                                      {profRev.stats.claridad_expositiva.avg.toFixed(
                                        1
                                      )}
                                      <span className="text-[9px] underline ml-0.5">
                                        Reseñas
                                      </span>
                                    </span>
                                  )}
                                  <span className="text-[10px] text-muted-foreground">
                                    Cupos: {par.cupo}
                                  </span>
                                </div>
                              </div>

                              <div className="text-foreground font-medium truncate mt-0.5">
                                {par.profesor?.length
                                  ? par.profesor.join(" / ")
                                  : "Profesor por definir"}
                              </div>

                              {groupedBlocks.length > 0 ? (
                                <div className="flex flex-wrap gap-1 mt-1.5">
                                  {groupedBlocks.map((gb, gIdx) => (
                                    <span
                                      key={gIdx}
                                      className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono inline-flex items-center gap-1"
                                    >
                                      <strong>
                                        {USM_BAR_DAYS[gb.dia]?.slice(0, 2)} B
                                        {gb.bloqueRange}
                                      </strong>
                                      <span className="opacity-75">
                                        ({gb.tipo}
                                        {gb.sala ? ` • ${gb.sala}` : ""})
                                      </span>
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <div className="text-[10px] text-muted-foreground italic mt-1">
                                  Sin bloques fijos en sala
                                </div>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>

        {/* Right Column: Weekly Schedule Grid */}
        <div className="lg:col-span-8 space-y-3">
          <div className="flex items-center justify-between h-5">
            <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Calendar className="h-4 w-4 text-[#002B49] dark:text-[#D99B00]" />
              <span>Horario Semanal de Bloques</span>
            </h3>
            {activeComboPreview && (
              <Badge
                variant="outline"
                className="text-[10px] font-semibold border-[#D99B00] text-amber-700 dark:text-amber-300 bg-amber-500/10 gap-1 animate-in fade-in"
              >
                <Eye className="h-3 w-3 text-[#D99B00]" />
                <span>Previsualizando Opción {activeComboPreview.rank}</span>
              </Badge>
            )}
          </div>

          <Card className="overflow-hidden">
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full border-collapse text-xs min-w-[640px]">
                <thead>
                  <tr className="bg-[#002B49] text-white">
                    <th className="p-2.5 text-left font-semibold w-28 border-r border-white/15">
                      <div className="flex items-center gap-1.5">
                        <Clock className="h-3.5 w-3.5 text-[#D99B00]" />
                        <span>Bloque USM</span>
                      </div>
                    </th>
                    {visibleDays.map((diaIdx) => (
                      <th
                        key={diaIdx}
                        className="p-2.5 text-center font-semibold border-r border-white/15 last:border-r-0"
                      >
                        {USM_BAR_DAYS[diaIdx]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {USM_BLOCK_PAIRS.map((pairObj) => (
                    <tr key={pairObj.pair} className="hover:bg-muted/20">
                      {/* Block Time Column */}
                      <td className="p-2 border-r bg-muted/30 align-middle">
                        <div className="font-bold text-foreground font-mono">
                          Bloque {pairObj.pair}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {pairObj.time}
                        </div>
                      </td>

                      {/* Day Cells */}
                      {visibleDays.map((diaIdx) => {
                        const cellKey = `${diaIdx}-${pairObj.pair}`;
                        const entries = gridMap[cellKey] || [];
                        const nonPreviewCount = entries.filter(
                          (e) => !e.isPreview
                        ).length;
                        const isConflict = entries.length > 1;

                        return (
                          <td
                            key={cellKey}
                            className={`p-1.5 border-r last:border-r-0 align-top h-20 w-[18%] transition-colors ${
                              isConflict ? "bg-destructive/10" : ""
                            }`}
                          >
                            <div className="space-y-1">
                              {entries.map((entry) => (
                                <div
                                  key={`${entry.sigla}-${entry.paralelo}-${
                                    entry.isPreview ? "prev" : "fixed"
                                  }`}
                                  className={`p-1.5 rounded border text-[11px] leading-tight shadow-2xs transition-all ${
                                    entry.isPreview
                                      ? isConflict
                                        ? "border-dashed border-2 border-destructive bg-destructive/20 animate-pulse"
                                        : "border-dashed border-2 border-[#D99B00] bg-[#D99B00]/15"
                                      : nonPreviewCount > 1
                                      ? "border-destructive bg-destructive/15"
                                      : "bg-card"
                                  }`}
                                  style={
                                    !entry.isPreview
                                      ? {
                                          borderLeftWidth: "4px",
                                          borderLeftColor:
                                            nonPreviewCount > 1
                                              ? "#EF4444"
                                              : entry.color,
                                        }
                                      : undefined
                                  }
                                >
                                  <div className="flex items-center justify-between gap-1 font-bold">
                                    <span className="font-mono flex items-center gap-1">
                                      {entry.isPreview && (
                                        <Eye className="h-3 w-3 text-[#D99B00]" />
                                      )}
                                      {entry.sigla}
                                    </span>
                                    <span className="text-[10px] px-1 rounded bg-muted font-normal">
                                      {entry.tipo} • P{entry.paralelo}
                                    </span>
                                  </div>
                                  <div className="text-[10px] text-muted-foreground truncate mt-0.5">
                                    {entry.profesor || entry.nombre}
                                  </div>
                                  <div className="flex items-center justify-between gap-1 mt-0.5">
                                    {entry.sala && (
                                      <span className="text-[10px] font-semibold text-foreground flex items-center gap-0.5">
                                        <MapPin className="h-2.5 w-2.5 text-[#D99B00]" />
                                        <span>{entry.sala}</span>
                                      </span>
                                    )}
                                    {entry.isPreview && isConflict && (
                                      <span className="text-[9px] font-bold text-destructive uppercase">
                                        ¡Tope!
                                      </span>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Shared Enrollment Modal filtered by Malla states */}
      <EnrollCourseModal
        open={enrollModalOpen}
        onOpenChange={setEnrollModalOpen}
      />

      {/* Professor Reviews & Metrics Modal */}
      <ProfessorReviewModal
        open={!!selectedProfForModal}
        onOpenChange={(open) => {
          if (!open) setSelectedProfForModal(null);
        }}
        professorName={selectedProfForModal?.name || ""}
        review={selectedProfForModal?.review || null}
      />
    </div>
  );
}

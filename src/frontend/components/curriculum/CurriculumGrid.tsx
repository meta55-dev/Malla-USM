import * as React from "react";
import { useAcademicStore } from "@/shared/store/useAcademicStore";
import { getCatalogPlans } from "@/curricula/services/curriculumService";
import { CareerPlanCatalogItem, Course } from "@/shared/types/academic";
import {
  computeCriticalPathMetrics,
  validatePlanConflicts,
} from "@/curricula/planner/criticalPathPlanner";
import { SemesterColumn } from "./SemesterColumn";
import { CourseDetailModal } from "./CourseDetailModal";
import { Input } from "@/frontend/components/ui/input";
import { Button } from "@/frontend/components/ui/button";
import { Badge } from "@/frontend/components/ui/badge";
import { Slider } from "@/frontend/components/ui/slider";
import { Alert } from "@/frontend/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/frontend/components/ui/dialog";
import {
  Search,
  Filter,
  X,
  Layers,
  Sparkles,
  BookOpen,
  CheckCircle2,
  Lock,
  GraduationCap,
  MapPin,
  Plus,
  RotateCcw,
  Sliders,
  Compass,
  AlertCircle,
  ArrowRight,
  Flame,
} from "lucide-react";

interface CurriculumGridProps {
  onNavigateToSolver?: (sigla: string) => void;
}

export function CurriculumGrid({ onNavigateToSolver }: CurriculumGridProps) {
  const {
    curriculum,
    activePlanId,
    approvedCourses,
    plannerMode,
    plannedSemesterOverrides,
    maxCreditsPerSemester,
    customMaxSemester,
    selectCurriculumPlan,
    toggleSemesterApproval,
    getCoursesStatus,
    setPlannerMode,
    setMaxCreditsPerSemester,
    setCustomMaxSemester,
    movePlannedCourse,
    resolvePlanConflicts,
    resetPlannedSemesters,
    applyAutoCriticalPathPlan,
  } = useAcademicStore();

  const coursesStatus = getCoursesStatus();

  // Search & Filter state
  const [searchTerm, setSearchTerm] = React.useState("");
  const [selectedArea, setSelectedArea] = React.useState<string | null>(null);
  const [selectedStatus, setSelectedStatus] = React.useState<string | null>(null);
  const [activeCourseDetail, setActiveCourseDetail] = React.useState<Course | null>(
    null
  );
  const [detailModalOpen, setDetailModalOpen] = React.useState(false);

  // Planner feedback & conflict modal state
  const [plannerFeedback, setPlannerFeedback] = React.useState<string | null>(null);
  const [conflictModal, setConflictModal] = React.useState<{
    open: boolean;
    sigla: string;
    targetSem: number;
    reason: string;
    canCascade: boolean;
  } | null>(null);

  // Catalog state for quick inline career/plan switching
  const [catalogPlans, setCatalogPlans] = React.useState<CareerPlanCatalogItem[]>([]);
  const [filterSede, setFilterSede] = React.useState<string>(
    curriculum.sede || "Casa Central Valparaíso"
  );

  React.useEffect(() => {
    let cancelled = false;
    getCatalogPlans().then((list) => {
      if (!cancelled) {
        setCatalogPlans(list);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    if (curriculum.sede) {
      setFilterSede(curriculum.sede);
    }
  }, [curriculum.sede]);

  const ramos = curriculum.ramos || [];
  const areas = curriculum.areas || {};

  // Compute Critical Path Metrics dynamically based on approved courses
  const criticalMetrics = React.useMemo(() => {
    const approvedSiglas = new Set(Object.keys(approvedCourses));
    return computeCriticalPathMetrics(ramos, approvedSiglas);
  }, [ramos, approvedCourses]);

  // Bottleneck count
  const bottleneckCount = React.useMemo(() => {
    let count = 0;
    for (const m of criticalMetrics.values()) {
      if (m.isCriticalBottleneck) count++;
    }
    return count;
  }, [criticalMetrics]);

  // Plan conflicts in planned mode
  const planConflicts = React.useMemo(() => {
    if (plannerMode !== "planned") return [];
    const approvedSiglas = new Set(Object.keys(approvedCourses));
    return validatePlanConflicts(
      curriculum.ramos || [],
      approvedSiglas,
      plannedSemesterOverrides
    );
  }, [plannerMode, curriculum.ramos, approvedCourses, plannedSemesterOverrides]);

  const conflictingSiglasSet = React.useMemo(() => {
    return new Set(planConflicts.flatMap((c) => [c.courseSigla, c.prereqSigla]));
  }, [planConflicts]);

  // Dynamic semester count based on official malla or planned overrides
  const totalSemesters = React.useMemo(() => {
    const maxFromRamos = ramos.reduce(
      (max, r) => (r.semestre > max ? r.semestre : max),
      0
    );
    if (plannerMode === "official") {
      return Math.max(curriculum.semestres_totales || 0, maxFromRamos, 1);
    }

    const maxPlanned = Object.values(plannedSemesterOverrides).reduce(
      (max, sem) => (sem > max ? sem : max),
      0
    );

    return Math.max(
      customMaxSemester || 0,
      curriculum.semestres_totales || 0,
      maxFromRamos,
      maxPlanned,
      1
    );
  }, [
    plannerMode,
    curriculum.semestres_totales,
    ramos,
    plannedSemesterOverrides,
    customMaxSemester,
  ]);

  const semesterNumbers = React.useMemo(
    () => Array.from({ length: totalSemesters }, (_, i) => i + 1),
    [totalSemesters]
  );

  const availableSedes = React.useMemo(() => {
    return Array.from(new Set(catalogPlans.map((p) => p.sede)));
  }, [catalogPlans]);

  const plansInSelectedSede = React.useMemo(() => {
    return catalogPlans.filter((p) => p.sede === filterSede);
  }, [catalogPlans, filterSede]);

  // Filter courses
  const filterCourse = (c: Course): boolean => {
    // 1. Text search
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase().trim();
      const matchSigla = c.sigla.toLowerCase().includes(term);
      const matchName = c.nombre.toLowerCase().includes(term);
      if (!matchSigla && !matchName) return false;
    }

    // 2. Area filter
    if (selectedArea && c.area !== selectedArea) {
      return false;
    }

    // 3. Status filter
    if (selectedStatus) {
      const status = coursesStatus[c.sigla]?.status;
      if (status !== selectedStatus) return false;
    }

    return true;
  };

  const handleOpenDetail = (course: Course) => {
    setActiveCourseDetail(course);
    setDetailModalOpen(true);
  };

  const hasActiveFilters = Boolean(searchTerm || selectedArea || selectedStatus);

  const clearFilters = () => {
    setSearchTerm("");
    setSelectedArea(null);
    setSelectedStatus(null);
  };

  // Area stats (count per area)
  const areaCounts = React.useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of ramos) {
      counts[r.area] = (counts[r.area] || 0) + 1;
    }
    return counts;
  }, [ramos]);

  // Action: Auto-plan fastest graduation using Critical Path DAG optimizer
  const handleAutoPlan = () => {
    const res = applyAutoCriticalPathPlan(maxCreditsPerSemester);
    setPlannerFeedback(
      `¡Planificación optimizada! Titulación en ${res.totalSemesters} semestres con carga compactada (máx. ${maxCreditsPerSemester} SCT/semestre).`
    );
  };

  // Action: Move course with conflict inspection
  const handleMoveCourse = (
    sigla: string,
    targetSem: number,
    cascadePush: boolean = false
  ) => {
    const res = movePlannedCourse(sigla, targetSem, cascadePush);
    if (!res.success) {
      const canCascade = (res.reason || "").includes("desplazamiento en cascada");
      setConflictModal({
        open: true,
        sigla,
        targetSem,
        reason: res.reason || "Conflicto de prerrequisitos al mover la asignatura.",
        canCascade,
      });
    } else {
      if (conflictModal) {
        setConflictModal(null);
      }
      if (res.pushedCourses && res.pushedCourses.length > 0) {
        setPlannerFeedback(
          `Se movió ${sigla} al Semestre ${targetSem} y se desplazaron en cascada: ${res.pushedCourses.join(", ")}`
        );
      }
    }
  };

  return (
    <div className="flex flex-col space-y-4">
      {/* Control & Filter Toolbar */}
      <div className="rounded-xl border bg-card/70 p-3 sm:p-4 shadow-xs space-y-3">
        {/* Top Row: Quick Career & Malla Selector Bar */}
        {catalogPlans.length > 1 && (
          <div className="pb-3 border-b flex flex-col lg:flex-row lg:items-center justify-between gap-2.5">
            <div className="flex items-center gap-2 flex-wrap">
              <GraduationCap className="h-4 w-4 text-[#D99B00] shrink-0" />
              <span className="text-xs font-bold text-foreground">
                {curriculum.carrera}
              </span>
              <Badge variant="outline" className="text-[10px] font-mono">
                Plan {curriculum.plan}
              </Badge>
              <span className="text-[11px] text-muted-foreground">
                • {totalSemesters} semestres • {ramos.length} asignaturas
              </span>
              {bottleneckCount > 0 && (
                <Badge
                  variant="secondary"
                  className="text-[10px] bg-amber-500/15 text-amber-700 dark:text-amber-300 font-semibold gap-1 border border-amber-500/30"
                >
                  <Flame className="h-3 w-3 text-amber-500" />
                  {bottleneckCount} Cuello(s) Crítico(s)
                </Badge>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="h-3.5 w-3.5 text-[#D99B00]" />
                <select
                  aria-label="Seleccionar Sede USM"
                  value={filterSede}
                  onChange={(e) => {
                    const nextSede = e.target.value;
                    setFilterSede(nextSede);
                    const firstPlan = catalogPlans.find(
                      (p) => p.sede === nextSede
                    );
                    if (firstPlan) {
                      selectCurriculumPlan(firstPlan.id);
                    }
                  }}
                  className="h-8 rounded-md border bg-background px-2 text-xs font-medium text-foreground"
                >
                  {availableSedes.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>

              <select
                aria-label="Seleccionar Carrera y Plan USM"
                value={activePlanId}
                onChange={(e) => selectCurriculumPlan(e.target.value)}
                className="h-8 rounded-md border bg-background px-2.5 text-xs font-semibold text-foreground max-w-[280px] sm:max-w-[380px] truncate"
              >
                {plansInSelectedSede.map((p) => {
                  const menLabel =
                    p.mentionName &&
                    p.mentionName.toLowerCase() !== "sin mención"
                      ? ` (${p.mentionName})`
                      : "";
                  return (
                    <option key={p.id} value={p.id}>
                      {p.careerName}
                      {menLabel} — Plan {p.planCode} ({p.jornada})
                    </option>
                  );
                })}
              </select>
            </div>
          </div>
        )}

        {/* View Mode Selector: Malla Oficial vs Mi Planificación */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b">
          <div className="flex items-center gap-1 p-1 bg-muted/60 dark:bg-muted/40 rounded-lg border w-fit">
            <button
              type="button"
              onClick={() => setPlannerMode("official")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                plannerMode === "official"
                  ? "bg-background text-foreground shadow-xs border"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Layers className="h-3.5 w-3.5 text-[#002B49] dark:text-[#D99B00]" />
              Malla Oficial
            </button>

            <button
              type="button"
              onClick={() => setPlannerMode("planned")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                plannerMode === "planned"
                  ? "bg-[#002B49] text-white dark:bg-[#D99B00] dark:text-[#002B49] shadow-xs font-bold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Compass className="h-3.5 w-3.5" />
              Mi Planificación
              {Object.keys(plannedSemesterOverrides).length > 0 && (
                <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-amber-500/25 text-amber-200 dark:text-[#002B49] font-mono font-black">
                  {Object.keys(plannedSemesterOverrides).length}
                </span>
              )}
            </button>
          </div>

          {/* Planned Mode Controls Bar */}
          {plannerMode === "planned" && (
            <div className="flex items-center gap-2 flex-wrap text-xs">
              {/* Max Credits Slider */}
              <div className="flex items-center gap-2 bg-background border rounded-lg px-2.5 py-1.5 shadow-2xs">
                <Sliders className="h-3.5 w-3.5 text-[#D99B00] shrink-0" />
                <span className="text-[11px] font-bold text-foreground shrink-0">
                  Límite SCT:
                </span>
                <div className="w-20 sm:w-28">
                  <Slider
                    value={[maxCreditsPerSemester]}
                    min={20}
                    max={36}
                    step={1}
                    onValueChange={([val]) => setMaxCreditsPerSemester(val)}
                  />
                </div>
                <Badge
                  variant="outline"
                  className="font-mono text-[11px] font-bold px-1.5 py-0.5"
                >
                  {maxCreditsPerSemester} SCT
                </Badge>
              </div>

              {/* Auto-Plan Button */}
              <Button
                type="button"
                variant="gold"
                size="sm"
                onClick={handleAutoPlan}
                className="h-8 gap-1.5 text-xs font-bold shadow-xs"
                title="Ejecutar algoritmo de Ruta Crítica para graduarse en el menor número de semestres posible"
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span>Auto-Planificar Salida Rápida</span>
              </Button>

              {/* Add Extra Semester Button */}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setCustomMaxSemester(totalSemesters + 1)}
                className="h-8 gap-1 text-xs"
                title="Añadir un semestre adicional al horizonte de planificación"
              >
                <Plus className="h-3.5 w-3.5 text-[#D99B00]" />
                <span>Añadir Semestre {totalSemesters + 1}</span>
              </Button>

              {/* Reset to Official Button */}
              {Object.keys(plannedSemesterOverrides).length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    resetPlannedSemesters();
                    setPlannerFeedback(null);
                  }}
                  className="h-8 text-xs text-muted-foreground hover:text-destructive"
                  title="Eliminar cambios manuales y restablecer a la malla oficial"
                >
                  <RotateCcw className="h-3 w-3 mr-1" />
                  Restablecer
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Impossible Prerequisites Conflict Banner in Planning Mode */}
        {plannerMode === "planned" && planConflicts.length > 0 && (
          <Alert
            variant="warning"
            className="border-amber-500/70 bg-amber-500/10 text-amber-900 dark:text-amber-200 p-3 sm:p-4 rounded-xl shadow-xs"
          >
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
              <div className="space-y-1.5 flex-1">
                <div className="flex items-center gap-2 font-bold text-sm text-amber-800 dark:text-amber-300">
                  <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
                  <span>
                    Combinación imposible de prerrequisitos detectada ({planConflicts.length} conflicto{planConflicts.length === 1 ? "" : "s"})
                  </span>
                </div>
                <p className="text-xs text-amber-900/90 dark:text-amber-300/90">
                  Tienes ramos planificados antes o al mismo tiempo que sus asignaturas prerrequisito:
                </p>
                <ul className="text-xs space-y-1 font-mono pt-1 max-h-36 overflow-y-auto pl-1">
                  {planConflicts.slice(0, 5).map((conf, idx) => (
                    <li key={idx} className="flex items-center gap-1.5 text-amber-950 dark:text-amber-100">
                      <span className="text-amber-600 font-bold">•</span>
                      <span>
                        <strong>{conf.courseSigla}</strong> (Sem {conf.courseSemester}) no puede cursarse antes de{" "}
                        <strong>{conf.prereqSigla}</strong> (Sem {conf.prereqSemester})
                      </span>
                    </li>
                  ))}
                  {planConflicts.length > 5 && (
                    <li className="text-[11px] text-amber-700 dark:text-amber-400 italic">
                      ... y {planConflicts.length - 5} conflicto{planConflicts.length - 5 === 1 ? "" : "s"} más.
                    </li>
                  )}
                </ul>
              </div>

              <div className="sm:self-center shrink-0">
                <Button
                  type="button"
                  variant="gold"
                  size="sm"
                  onClick={() => {
                    resolvePlanConflicts();
                    setPlannerFeedback("¡Conflictos resueltos automáticamente! Los ramos dependientes fueron desplazados.");
                  }}
                  className="h-8 gap-1.5 text-xs font-bold shadow-xs whitespace-nowrap"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Corregir conflictos automáticamente
                </Button>
              </div>
            </div>
          </Alert>
        )}

        {/* Informative Planner Feedback Banner */}
        {plannerFeedback && (
          <Alert
            variant="success"
            className="py-2.5 px-3 text-xs flex items-center justify-between"
          >
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
              <span>{plannerFeedback}</span>
            </div>
            <button
              type="button"
              onClick={() => setPlannerFeedback(null)}
              className="text-muted-foreground hover:text-foreground ml-2"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </Alert>
        )}

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          {/* Search Input */}
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Buscar por ramo o sigla (ej. MAT-021, Algoritmos, IWI)..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 h-9 text-xs sm:text-sm bg-background"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Status Quick Filters */}
          <div className="flex items-center gap-1.5 flex-wrap text-xs">
            <span className="text-muted-foreground text-xs font-semibold mr-1 flex items-center gap-1">
              <Filter className="h-3.5 w-3.5" /> Estado:
            </span>

            <Button
              variant={selectedStatus === null ? "usm" : "outline"}
              size="sm"
              onClick={() => setSelectedStatus(null)}
              className="h-7 text-xs px-2.5"
            >
              Todos
            </Button>

            <Button
              variant={selectedStatus === "AVAILABLE" ? "secondary" : "outline"}
              size="sm"
              onClick={() =>
                setSelectedStatus(selectedStatus === "AVAILABLE" ? null : "AVAILABLE")
              }
              className="h-7 text-xs px-2.5 gap-1"
            >
              <Sparkles className="h-3 w-3 text-amber-500" />
              Disponibles
            </Button>

            <Button
              variant={selectedStatus === "IN_PROGRESS" ? "secondary" : "outline"}
              size="sm"
              onClick={() =>
                setSelectedStatus(
                  selectedStatus === "IN_PROGRESS" ? null : "IN_PROGRESS"
                )
              }
              className="h-7 text-xs px-2.5 gap-1"
            >
              <BookOpen className="h-3 w-3 text-sky-500" />
              Cursando
            </Button>

            <Button
              variant={selectedStatus === "APPROVED" ? "secondary" : "outline"}
              size="sm"
              onClick={() =>
                setSelectedStatus(
                  selectedStatus === "APPROVED" ? null : "APPROVED"
                )
              }
              className="h-7 text-xs px-2.5 gap-1"
            >
              <CheckCircle2 className="h-3 w-3 text-emerald-500" />
              Aprobados
            </Button>

            <Button
              variant={selectedStatus === "LOCKED" ? "secondary" : "outline"}
              size="sm"
              onClick={() =>
                setSelectedStatus(selectedStatus === "LOCKED" ? null : "LOCKED")
              }
              className="h-7 text-xs px-2.5 gap-1"
            >
              <Lock className="h-3 w-3 text-slate-400" />
              Bloqueados
            </Button>

            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                className="h-7 text-xs px-2 text-destructive hover:bg-destructive/10 ml-auto sm:ml-1"
              >
                Limpiar filtros
              </Button>
            )}
          </div>
        </div>

        {/* Interactive Areas Legend Bar */}
        <div className="pt-2 border-t flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] font-bold text-muted-foreground uppercase flex items-center gap-1 mr-1">
            <Layers className="h-3 w-3" /> Áreas:
          </span>

          {Object.entries(areas)
            .filter(([code]) => (areaCounts[code] || 0) > 0)
            .map(([code, info]) => {
              const isSelected = selectedArea === code;
              const count = areaCounts[code] || 0;
              return (
                <button
                  key={code}
                  type="button"
                  onClick={() => setSelectedArea(isSelected ? null : code)}
                  className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium border transition-all ${
                    isSelected
                      ? "ring-2 ring-primary border-primary bg-primary/10 shadow-2xs font-bold"
                      : "bg-background/80 hover:bg-muted/60 border-border"
                  }`}
                  title={`${info.nombre} (${count} asignaturas)`}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0 shadow-xs"
                    style={{ backgroundColor: info.color }}
                  />
                  <span className="font-semibold">{code}</span>
                  <span className="text-muted-foreground text-[10px]">
                    ({count})
                  </span>
                </button>
              );
            })}
        </div>
      </div>

      {/* Dynamic Semesters Horizontal Scroll Container */}
      <div className="relative w-full overflow-x-auto pb-4 scroll-smooth">
        <div className="inline-flex space-x-3.5 min-w-full pb-2">
          {semesterNumbers.map((num) => {
            // Group courses by effective semester (planned override or official semester)
            const semesterAll = ramos.filter((r) => {
              const effectiveSem =
                plannerMode === "planned"
                  ? plannedSemesterOverrides[r.sigla] ?? r.semestre
                  : r.semestre;
              return effectiveSem === num;
            });

            const semesterFiltered = semesterAll.filter(filterCourse);

            return (
              <SemesterColumn
                key={num}
                semesterNumber={num}
                courses={semesterFiltered}
                coursesStatus={coursesStatus}
                areas={areas}
                onOpenDetail={handleOpenDetail}
                onNavigateToSolver={onNavigateToSolver}
                onToggleSemesterApproval={toggleSemesterApproval}
                isPlannedMode={plannerMode === "planned"}
                maxCreditsSct={maxCreditsPerSemester}
                criticalMetrics={criticalMetrics}
                totalPlannedSemesters={totalSemesters}
                onMoveCourse={handleMoveCourse}
                onCourseDrop={handleMoveCourse}
                conflictingSiglas={conflictingSiglasSet}
              />
            );
          })}
        </div>
      </div>

      {/* Conflict / Cascading Push Dialog */}
      {conflictModal && (
        <Dialog
          open={conflictModal.open}
          onOpenChange={(isOpen) => {
            if (!isOpen) setConflictModal(null);
          }}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                <AlertCircle className="h-5 w-5" />
                Restricción Académica de Prerrequisitos
              </DialogTitle>
              <DialogDescription className="text-xs text-foreground/80 mt-2 space-y-2">
                <div className="p-3 bg-muted/40 rounded-lg border text-xs leading-relaxed">
                  {conflictModal.reason}
                </div>
                {conflictModal.canCascade && (
                  <div className="text-xs text-muted-foreground">
                    ¿Deseas activar el <strong>desplazamiento en cascada</strong> para mover automáticamente los ramos dependientes hacia adelante?
                  </div>
                )}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="flex gap-2 sm:justify-end mt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setConflictModal(null)}
              >
                Cancelar
              </Button>
              {conflictModal.canCascade ? (
                <Button
                  type="button"
                  variant="gold"
                  size="sm"
                  onClick={() =>
                    handleMoveCourse(conflictModal.sigla, conflictModal.targetSem, true)
                  }
                  className="gap-1.5 font-bold"
                >
                  <ArrowRight className="h-3.5 w-3.5" />
                  Mover en Cascada
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="usm"
                  size="sm"
                  onClick={() => setConflictModal(null)}
                >
                  Entendido
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Course Detail Modal */}
      <CourseDetailModal
        course={activeCourseDetail}
        statusDetail={
          activeCourseDetail ? coursesStatus[activeCourseDetail.sigla] : undefined
        }
        open={detailModalOpen}
        onOpenChange={setDetailModalOpen}
        onNavigateToSolver={onNavigateToSolver}
      />
    </div>
  );
}

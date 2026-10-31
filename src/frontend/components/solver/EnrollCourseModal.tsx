import * as React from "react";
import { useAcademicStore } from "@/shared/store/useAcademicStore";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/frontend/components/ui/dialog";
import { Button } from "@/frontend/components/ui/button";
import { Badge } from "@/frontend/components/ui/badge";
import { Input } from "@/frontend/components/ui/input";
import {
  Search,
  Sparkles,
  Lock,
  CheckCircle2,
  BookOpen,
  Plus,
  Trash2,
  GraduationCap,
} from "lucide-react";

type StatusFilterTab = "AVAILABLE" | "LOCKED" | "APPROVED" | "ALL";

interface EnrollCourseModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EnrollCourseModal({
  open,
  onOpenChange,
}: EnrollCourseModalProps) {
  const {
    curriculum,
    inProgressCourses,
    enrollCourse,
    unenrollCourse,
    getCoursesStatus,
  } = useAcademicStore();

  const coursesStatus = getCoursesStatus();
  const ramos = curriculum.ramos || [];

  const [statusTab, setStatusTab] = React.useState<StatusFilterTab>("AVAILABLE");
  const [selectedSemester, setSelectedSemester] = React.useState<number | "ALL">(
    "ALL"
  );
  const [searchQuery, setSearchQuery] = React.useState<string>("");

  // Compute counts per status category
  const statusCounts = React.useMemo(() => {
    let available = 0;
    let locked = 0;
    let approved = 0;
    for (const r of ramos) {
      const st = coursesStatus[r.sigla]?.status ?? "AVAILABLE";
      if (st === "AVAILABLE" || st === "IN_PROGRESS") available++;
      else if (st === "LOCKED") locked++;
      else if (st === "APPROVED") approved++;
    }
    return {
      available,
      locked,
      approved,
      all: ramos.length,
    };
  }, [ramos, coursesStatus]);

  const semesters = React.useMemo(() => {
    const sems = Array.from(new Set(ramos.map((r) => r.semestre))).sort(
      (a, b) => a - b
    );
    return sems;
  }, [ramos]);

  const filteredCourses = React.useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return ramos.filter((course) => {
      const detail = coursesStatus[course.sigla];
      const st = detail?.status ?? "AVAILABLE";

      if (statusTab === "AVAILABLE") {
        if (st !== "AVAILABLE" && st !== "IN_PROGRESS") return false;
      } else if (statusTab === "LOCKED") {
        if (st !== "LOCKED") return false;
      } else if (statusTab === "APPROVED") {
        if (st !== "APPROVED") return false;
      }

      if (
        selectedSemester !== "ALL" &&
        course.semestre !== selectedSemester
      ) {
        return false;
      }

      if (q) {
        const matchSigla = course.sigla.toLowerCase().includes(q);
        const matchName = course.nombre.toLowerCase().includes(q);
        if (!matchSigla && !matchName) return false;
      }

      return true;
    });
  }, [ramos, coursesStatus, statusTab, selectedSemester, searchQuery]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[88vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <GraduationCap className="h-5 w-5 text-[#D99B00]" />
            <span>Inscribir Asignaturas de la Malla</span>
          </DialogTitle>
          <DialogDescription className="text-xs">
            Malla activa: <strong>{curriculum.carrera}</strong> (Plan{" "}
            {curriculum.plan}
            {curriculum.sede ? ` • ${curriculum.sede}` : ""}). Filtra tus
            asignaturas según prerrequisitos cumplidos, bloqueadas o ya aprobadas.
          </DialogDescription>
        </DialogHeader>

        {/* Status Filter Tabs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 pt-1">
          <button
            type="button"
            onClick={() => setStatusTab("AVAILABLE")}
            className={`flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg border text-xs font-semibold transition-all ${
              statusTab === "AVAILABLE"
                ? "bg-[#002B49] text-white border-[#002B49] dark:bg-[#D99B00] dark:text-slate-950 dark:border-[#D99B00] shadow-xs"
                : "bg-card hover:bg-muted/60 text-muted-foreground"
            }`}
          >
            <Sparkles className="h-3.5 w-3.5 text-amber-400 shrink-0" />
            <span>Disponibles</span>
            <Badge
              variant="secondary"
              className="px-1.5 py-0 text-[10px] font-mono"
            >
              {statusCounts.available}
            </Badge>
          </button>

          <button
            type="button"
            onClick={() => setStatusTab("LOCKED")}
            className={`flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg border text-xs font-semibold transition-all ${
              statusTab === "LOCKED"
                ? "bg-[#002B49] text-white border-[#002B49] dark:bg-[#D99B00] dark:text-slate-950 dark:border-[#D99B00] shadow-xs"
                : "bg-card hover:bg-muted/60 text-muted-foreground"
            }`}
          >
            <Lock className="h-3.5 w-3.5 text-rose-400 shrink-0" />
            <span>Bloqueados</span>
            <Badge
              variant="secondary"
              className="px-1.5 py-0 text-[10px] font-mono"
            >
              {statusCounts.locked}
            </Badge>
          </button>

          <button
            type="button"
            onClick={() => setStatusTab("APPROVED")}
            className={`flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg border text-xs font-semibold transition-all ${
              statusTab === "APPROVED"
                ? "bg-[#002B49] text-white border-[#002B49] dark:bg-[#D99B00] dark:text-slate-950 dark:border-[#D99B00] shadow-xs"
                : "bg-card hover:bg-muted/60 text-muted-foreground"
            }`}
          >
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
            <span>Aprobados</span>
            <Badge
              variant="secondary"
              className="px-1.5 py-0 text-[10px] font-mono"
            >
              {statusCounts.approved}
            </Badge>
          </button>

          <button
            type="button"
            onClick={() => setStatusTab("ALL")}
            className={`flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg border text-xs font-semibold transition-all ${
              statusTab === "ALL"
                ? "bg-[#002B49] text-white border-[#002B49] dark:bg-[#D99B00] dark:text-slate-950 dark:border-[#D99B00] shadow-xs"
                : "bg-card hover:bg-muted/60 text-muted-foreground"
            }`}
          >
            <BookOpen className="h-3.5 w-3.5 shrink-0" />
            <span>Toda la Malla</span>
            <Badge
              variant="secondary"
              className="px-1.5 py-0 text-[10px] font-mono"
            >
              {statusCounts.all}
            </Badge>
          </button>
        </div>

        {/* Search & Semester Filter Row */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 py-1">
          <div className="relative flex-1">
            <Search className="h-4 w-4 absolute left-3 top-2.5 text-muted-foreground" />
            <Input
              placeholder="Buscar por código o nombre (ej. INF-292, MAT-021, Física)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9 text-xs sm:text-sm"
            />
          </div>

          <select
            aria-label="Filtrar por semestre"
            value={selectedSemester}
            onChange={(e) =>
              setSelectedSemester(
                e.target.value === "ALL" ? "ALL" : Number(e.target.value)
              )
            }
            className="h-9 rounded-md border bg-background px-2.5 text-xs font-medium"
          >
            <option value="ALL">Todos los semestres</option>
            {semesters.map((s) => (
              <option key={s} value={s}>
                Semestre {s}
              </option>
            ))}
          </select>
        </div>

        {/* Course List */}
        <div className="flex-1 overflow-y-auto space-y-2 pr-1 min-h-[260px] max-h-[400px]">
          {filteredCourses.length === 0 ? (
            <div className="text-center py-12 space-y-2 text-xs text-muted-foreground">
              <p>
                No hay asignaturas en la categoría seleccionada que coincidan con
                tu búsqueda.
              </p>
              {statusTab !== "ALL" && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setStatusTab("ALL")}
                  className="text-xs h-7"
                >
                  Ver toda la malla ({statusCounts.all})
                </Button>
              )}
            </div>
          ) : (
            filteredCourses.map((course) => {
              const detail = coursesStatus[course.sigla];
              const st = detail?.status ?? "AVAILABLE";
              const isEnrolled = Boolean(
                inProgressCourses[course.sigla.toUpperCase()]
              );
              const missingPrereqs = detail?.missingPrerequisites || [];
              const areaColor =
                curriculum.areas[course.area]?.color || "#002B49";

              return (
                <div
                  key={course.sigla}
                  className={`p-3 rounded-lg border transition-all flex items-center justify-between gap-3 ${
                    isEnrolled
                      ? "border-sky-500/70 bg-sky-500/10"
                      : "bg-card/60 hover:border-muted-foreground/40"
                  }`}
                  style={{ borderLeftWidth: "4px", borderLeftColor: areaColor }}
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-bold text-xs sm:text-sm text-foreground">
                        {course.sigla}
                      </span>
                      <span className="font-semibold text-xs sm:text-sm text-foreground">
                        {course.nombre}
                      </span>
                      <Badge
                        variant="outline"
                        className="text-[10px] font-normal"
                      >
                        Sem. {course.semestre} • {course.creditos_sct} SCT
                      </Badge>
                    </div>

                    {/* Status Info Line */}
                    <div className="flex items-center gap-2 flex-wrap text-[11px]">
                      {st === "AVAILABLE" && !isEnrolled && (
                        <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 font-medium">
                          <Sparkles className="h-3 w-3" />
                          Disponible para cursar (prerrequisitos cumplidos)
                        </span>
                      )}

                      {isEnrolled && (
                        <span className="inline-flex items-center gap-1 text-sky-600 dark:text-sky-400 font-semibold">
                          <BookOpen className="h-3 w-3" />
                          Inscrito actualmente en tus ramos en curso
                        </span>
                      )}

                      {st === "LOCKED" && (
                        <span className="inline-flex items-center gap-1 text-destructive font-medium">
                          <Lock className="h-3 w-3" />
                          Bloqueado — Falta aprobar:{" "}
                          <strong>{missingPrereqs.join(", ")}</strong>
                        </span>
                      )}

                      {st === "APPROVED" && (
                        <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                          <CheckCircle2 className="h-3 w-3" />
                          Aprobado
                          {detail?.grade !== undefined
                            ? ` (Nota: ${detail.grade})`
                            : ""}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Action Button */}
                  <div className="shrink-0">
                    {isEnrolled ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          if (
                            typeof window !== "undefined" &&
                            !window.confirm(
                              `¿Estás seguro de quitar ${course.sigla} de las asignaturas en curso?`
                            )
                          ) {
                            return;
                          }
                          unenrollCourse(course.sigla);
                        }}
                        className="h-8 px-2.5 text-xs gap-1.5 text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        <span>Quitar</span>
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant={st === "AVAILABLE" ? "usm" : "outline"}
                        size="sm"
                        onClick={() => enrollCourse(course.sigla)}
                        className="h-8 px-3 text-xs gap-1.5 font-semibold"
                      >
                        <Plus className="h-3.5 w-3.5 text-[#D99B00]" />
                        <span>
                          {st === "LOCKED"
                            ? "Inscribir igual"
                            : st === "APPROVED"
                            ? "Re-cursar"
                            : "Inscribir"}
                        </span>
                      </Button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

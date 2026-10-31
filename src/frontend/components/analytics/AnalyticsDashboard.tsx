import * as React from "react";
import { useAcademicStore } from "@/shared/store/useAcademicStore";
import { Card, CardHeader, CardTitle, CardContent } from "@/frontend/components/ui/card";
import { Progress } from "@/frontend/components/ui/progress";
import { Badge } from "@/frontend/components/ui/badge";
import { Checkbox } from "@/frontend/components/ui/checkbox";
import { Label } from "@/frontend/components/ui/label";
import {
  Award,
  BookOpen,
  CheckCircle2,
  Clock,
  GraduationCap,
  Layers,
  TrendingUp,
} from "lucide-react";

export function AnalyticsDashboard() {
  const { curriculum, approvedCourses, milestones, toggleMilestone, getStatistics } =
    useAcademicStore();

  const stats = getStatistics();
  const ramos = curriculum.ramos || [];
  const areas = curriculum.areas || {};

  // Check if semesters 1-4 (Bachiller) and Licenciatura (SIGA requisito_licenciatura or sem 1-8) are completed
  const sem1to4Complete = React.useMemo(() => {
    const sem1to4 = ramos.filter((r) => r.semestre <= 4);
    return (
      sem1to4.length > 0 &&
      sem1to4.every((r) => !!approvedCourses[r.sigla.toUpperCase()])
    );
  }, [ramos, approvedCourses]);

  const licenciaturaStatus = React.useMemo(() => {
    const explicitLicCourses = ramos.filter((r) => r.requisito_licenciatura === true);
    const targetCourses =
      explicitLicCourses.length > 0
        ? explicitLicCourses
        : ramos.filter((r) => r.semestre <= 8);

    const approvedCount = targetCourses.filter(
      (r) => !!approvedCourses[r.sigla.toUpperCase()]
    ).length;

    return {
      total: targetCourses.length,
      approved: approvedCount,
      isComplete: targetCourses.length > 0 && approvedCount === targetCourses.length,
      usesExplicitSigaFlag: explicitLicCourses.length > 0,
    };
  }, [ramos, approvedCourses]);

  // Distribution by Knowledge Area
  const areaDistribution = React.useMemo(() => {
    const data: Record<
      string,
      {
        nombre: string;
        color: string;
        totalSct: number;
        approvedSct: number;
        totalCourses: number;
        approvedCourses: number;
      }
    > = {};

    for (const [code, info] of Object.entries(areas)) {
      data[code] = {
        nombre: info.nombre,
        color: info.color,
        totalSct: 0,
        approvedSct: 0,
        totalCourses: 0,
        approvedCourses: 0,
      };
    }

    for (const r of ramos) {
      if (!data[r.area]) {
        data[r.area] = {
          nombre: r.area,
          color: "#64748B",
          totalSct: 0,
          approvedSct: 0,
          totalCourses: 0,
          approvedCourses: 0,
        };
      }
      const sct = r.creditos_sct || 0;
      data[r.area].totalSct += sct;
      data[r.area].totalCourses += 1;

      if (approvedCourses[r.sigla.toUpperCase()]) {
        data[r.area].approvedSct += sct;
        data[r.area].approvedCourses += 1;
      }
    }

    return Object.entries(data)
      .filter(([, d]) => d.totalCourses > 0)
      .map(([code, d]) => ({
        code,
        ...d,
        percent: d.totalSct > 0 ? (d.approvedSct / d.totalSct) * 100 : 0,
      }));
  }, [ramos, areas, approvedCourses]);

  // Semester Pace Estimator: standard load is 30 SCT/semester
  const remainingSct = Math.max(0, stats.sctCreditsTotal - stats.sctCreditsApproved);
  const estimatedSemestersRemaining = Math.ceil(remainingSct / 30);

  return (
    <div className="space-y-6">
      {/* KPI Cards Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* SCT Credits Card */}
        <Card className="shadow-xs border-border/80">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-bold uppercase text-muted-foreground">
              Créditos SCT
            </CardTitle>
            <Award className="h-4 w-4 text-[#D99B00]" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-black text-foreground">
              {stats.sctCreditsApproved}{" "}
              <span className="text-xs font-medium text-muted-foreground">
                / {stats.sctCreditsTotal} SCT
              </span>
            </div>
            <Progress
              value={stats.percentProgress}
              className="h-2 mt-2"
              indicatorClassName="bg-[#D99B00]"
            />
            <p className="text-[11px] text-muted-foreground mt-1.5 flex justify-between">
              <span>{stats.percentProgress}% de la carrera</span>
              <span>Faltan {remainingSct} SCT</span>
            </p>
          </CardContent>
        </Card>

        {/* USM Credits Card */}
        <Card className="shadow-xs border-border/80">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-bold uppercase text-muted-foreground">
              Créditos USM
            </CardTitle>
            <BookOpen className="h-4 w-4 text-sky-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-black text-foreground">
              {stats.usmCreditsApproved}{" "}
              <span className="text-xs font-medium text-muted-foreground">
                / {stats.usmCreditsTotal} U
              </span>
            </div>
            <Progress
              value={
                stats.usmCreditsTotal > 0
                  ? (stats.usmCreditsApproved / stats.usmCreditsTotal) * 100
                  : 0
              }
              className="h-2 mt-2"
              indicatorClassName="bg-[#002B49] dark:bg-[#0B72D4]"
            />
            <p className="text-[11px] text-muted-foreground mt-1.5">
              Escala tradicional de carga horaria USM
            </p>
          </CardContent>
        </Card>

        {/* GPA Card */}
        <Card className="shadow-xs border-border/80">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-bold uppercase text-muted-foreground">
              Promedio Acumulado (GPA)
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-black text-foreground">
              {stats.gpa > 0 ? stats.gpa.toFixed(1) : "S/N"}
            </div>
            <div className="flex items-center gap-2 mt-2">
              <Badge
                variant={
                  stats.gpa <= 0
                    ? "outline"
                    : stats.gpa >= 70
                    ? "success"
                    : stats.gpa >= 55
                    ? "usm"
                    : "destructive"
                }
                className="text-[10px]"
              >
                {stats.gpa <= 0
                  ? "Sin Calificaciones"
                  : stats.gpa >= 70
                  ? "Distinción Máxima"
                  : stats.gpa >= 55
                  ? "Aprobado Regular"
                  : "Bajo 55"}
              </Badge>
              <span className="text-[11px] text-muted-foreground">
                Escala oficial 0 a 100
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1.5">
              Ponderado por créditos SCT con notas ingresadas
            </p>
          </CardContent>
        </Card>

        {/* Estimated Semesters Card */}
        <Card className="shadow-xs border-border/80">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-bold uppercase text-muted-foreground">
              Proyección de Egreso
            </CardTitle>
            <Clock className="h-4 w-4 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-black text-foreground">
              ~{estimatedSemestersRemaining}{" "}
              <span className="text-xs font-medium text-muted-foreground">
                semestres
              </span>
            </div>
            <div className="text-xs font-semibold text-foreground mt-2">
              {stats.approvedCoursesCount} de {stats.totalCoursesCount} asignaturas
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              Ritmo regular estimado (30 SCT semestrales)
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Graduation Milestones & Degree Requirements Checklist */}
      <Card className="shadow-xs">
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <GraduationCap className="h-5 w-5 text-secondary" />
              <div>
                <CardTitle className="text-base font-bold">
                  Requisitos de Titulación USM — {curriculum.carrera}
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Lista de verificación oficial para la obtención de grados académicos y título profesional (Plan {curriculum.plan})
                </p>
              </div>
            </div>
            <Badge variant="outline" className="text-xs font-semibold">
              {
                milestones.filter(
                  (m) =>
                    m.completed ||
                    (m.id === "milestone-bachiller" && sem1to4Complete) ||
                    (m.id === "milestone-licenciatura" && licenciaturaStatus.isComplete)
                ).length
              }{" "}
              / {milestones.length} cumplidos
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {milestones.map((milestone) => {
              const isAutoCompleted =
                (milestone.id === "milestone-bachiller" && sem1to4Complete) ||
                (milestone.id === "milestone-licenciatura" &&
                  licenciaturaStatus.isComplete);

              const isChecked = milestone.completed || isAutoCompleted;

              return (
                <div
                  key={milestone.id}
                  className={`p-3.5 rounded-xl border transition-all flex items-start gap-3 select-none ${
                    isChecked
                      ? "border-emerald-500/50 bg-emerald-500/5 dark:bg-emerald-950/20"
                      : "bg-card hover:bg-muted/30 border-border"
                  }`}
                >
                  <Checkbox
                    id={milestone.id}
                    checked={isChecked}
                    onCheckedChange={() => toggleMilestone(milestone.id)}
                    className="mt-0.5"
                  />
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <Label
                        htmlFor={milestone.id}
                        className={`text-xs font-bold cursor-pointer ${
                          isChecked
                            ? "text-emerald-700 dark:text-emerald-400"
                            : "text-foreground"
                        }`}
                      >
                        {milestone.title}
                      </Label>
                      {isChecked && (
                        <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      {milestone.description}
                    </p>
                    {milestone.id === "milestone-licenciatura" && (
                      <div className="text-[10px] font-mono text-muted-foreground pt-0.5">
                        Avance Licenciatura SIGA: {licenciaturaStatus.approved} /{" "}
                        {licenciaturaStatus.total} asignaturas requeridas
                      </div>
                    )}
                    {isAutoCompleted && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 className="h-3 w-3 inline shrink-0" />
                        <span>Verificado automáticamente por avance de malla</span>
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Distribution by Knowledge Area */}
      <Card className="shadow-xs">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-secondary" />
            <div>
              <CardTitle className="text-base font-bold">
                Distribución por Área de Conocimiento
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Progreso y créditos SCT acumulados por eje curricular en{" "}
                <strong>{curriculum.carrera}</strong> (Plan {curriculum.plan}
                {curriculum.sede ? ` • ${curriculum.sede}` : ""})
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {areaDistribution.map((area) => (
              <div key={area.code} className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-3 h-3 rounded-full shrink-0 shadow-xs"
                      style={{ backgroundColor: area.color }}
                    />
                    <span className="font-bold text-foreground">
                      {area.code} - {area.nombre}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      ({area.approvedCourses}/{area.totalCourses} ramos)
                    </span>
                  </div>
                  <div className="font-semibold text-foreground">
                    {area.approvedSct} / {area.totalSct} SCT{" "}
                    <span className="text-muted-foreground text-[11px]">
                      ({Math.round(area.percent)}%)
                    </span>
                  </div>
                </div>

                <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${area.percent}%`,
                      backgroundColor: area.color,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

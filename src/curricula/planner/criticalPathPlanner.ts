import { Course } from '@/shared/types/academic';
import { formatUsmSigla } from '@/curricula/services/sigaService';
import { validateGraphAcyclic } from '@/curricula/prerequisites/graphUnlock';

/**
 * Normaliza una sigla a formato estándar USM en mayúsculas (ej. "MAT021" -> "MAT-021").
 */
export function normalizeCourseSigla(sigla: string): string {
  if (!sigla || typeof sigla !== 'string') return '';
  return formatUsmSigla(sigla.trim().toUpperCase());
}

export interface CriticalPathMetric {
  sigla: string;
  criticalPathLength: number; // L_u: longitud del camino crítico en pasos descendientes
  totalDescendantsCount: number; // D_u: cantidad total de asignaturas futuras en la clausura transitiva
  priorityWeight: number; // W_u = 1000 * L_u + 10 * D_u - u.semestre
  isCriticalBottleneck: boolean; // Identifica asignaturas críticas que bloquean el avance de la carrera
}

export interface PlanConflict {
  courseSigla: string;
  courseName: string;
  courseSemester: number;
  prereqSigla: string;
  prereqName: string;
  prereqSemester: number;
  reason: string;
}

export interface SemesterCourseBreakdown {
  courses: Course[];
  totalSct: number;
  totalUsm: number;
}

export interface GraduationPlanResult {
  plannedSemesterOverrides: Record<string, number>;
  totalSemesters: number;
  semestersBreakdown: Record<number, SemesterCourseBreakdown>;
}

/**
 * Retorna las asignaturas que dependen directamente de `targetSigla` como prerrequisito
 * dentro del conjunto de asignaturas no aprobadas.
 */
function getDirectDependents(
  targetSigla: string,
  candidates: Course[]
): Course[] {
  const normTarget = normalizeCourseSigla(targetSigla);
  const rawTarget = targetSigla.trim().toUpperCase();

  return candidates.filter((c) => {
    if (normalizeCourseSigla(c.sigla) === normTarget) return false;

    // 1. Prerrequisitos estándar en arreglo
    const hasInBase = c.prerrequisitos.some((p) => {
      const pNorm = normalizeCourseSigla(p);
      return pNorm === normTarget || p.trim().toUpperCase() === rawTarget;
    });
    if (hasInBase) return true;

    // 2. Cláusulas DNF de requisitos
    if (Array.isArray(c.requisitos_dnf)) {
      return c.requisitos_dnf.some((clause) =>
        clause.some((r) => {
          if (!r || !r.sigla || typeof r.sigla !== 'string') return false;
          const rNorm = normalizeCourseSigla(r.sigla);
          return rNorm === normTarget || r.sigla.trim().toUpperCase() === rawTarget;
        })
      );
    }

    return false;
  });
}

/**
 * Calcula las métricas de ruta crítica formal para todas las asignaturas:
 * - L_u (Longitud de camino crítico): Máximo número de semestres/pasos descendientes consecutivos
 *   hasta el final de la carrera en el DAG para asignaturas aún no aprobadas.
 * - D_u (Grado de desbloqueo): Cantidad total de asignaturas futuras en la clausura transitiva.
 * - W_u (Peso de prioridad): W_u = 1000 * L_u + 10 * D_u - u.semestre.
 * - isCriticalBottleneck: Asignaturas clave que condicionan fuertemente la duración de la carrera.
 */
export function computeCriticalPathMetrics(
  allCourses: Course[],
  approvedSiglas: Set<string> | string[]
): Map<string, CriticalPathMetric> {
  const approvedSet = new Set<string>();
  const rawApproved = approvedSiglas instanceof Set ? approvedSiglas : new Set(approvedSiglas);
  for (const s of rawApproved) {
    approvedSet.add(s.trim().toUpperCase());
    approvedSet.add(normalizeCourseSigla(s));
  }

  // Filtrar asignaturas aprobadas (incluye equivalencias aprobadas)
  const isApproved = (course: Course): boolean => {
    const norm = normalizeCourseSigla(course.sigla);
    if (approvedSet.has(norm) || approvedSet.has(course.sigla.trim().toUpperCase())) {
      return true;
    }
    // Equivalencias DNF
    if (Array.isArray(course.equivalencias_dnf) && course.equivalencias_dnf.length > 0) {
      return course.equivalencias_dnf.some(
        (clause) =>
          clause.length > 0 &&
          clause.every(
            (eq) =>
              approvedSet.has(normalizeCourseSigla(eq.sigla)) ||
              approvedSet.has(eq.sigla.trim().toUpperCase())
          )
      );
    }
    return false;
  };

  const unapprovedCourses = allCourses.filter((c) => !isApproved(c));
  const unapprovedMap = new Map<string, Course>();
  for (const c of unapprovedCourses) {
    unapprovedMap.set(normalizeCourseSigla(c.sigla), c);
  }

  // Construir grafo dirigido de dependencias directas entre cursos no aprobados: u -> v (u desbloquea v)
  const adj = new Map<string, string[]>();
  for (const course of unapprovedCourses) {
    const uNorm = normalizeCourseSigla(course.sigla);
    const dependents = getDirectDependents(uNorm, unapprovedCourses);
    adj.set(
      uNorm,
      dependents.map((d) => normalizeCourseSigla(d.sigla))
    );
  }

  // 1. Longitud de camino crítico L_u con memoización y prevención de ciclos
  const memoL = new Map<string, number>();
  const visiting = new Set<string>();

  function computeL(sigla: string): number {
    if (memoL.has(sigla)) return memoL.get(sigla)!;
    if (visiting.has(sigla)) return 1; // Guarda ante ciclos

    visiting.add(sigla);
    const children = adj.get(sigla) || [];
    let maxChildL = 0;
    for (const child of children) {
      maxChildL = Math.max(maxChildL, computeL(child));
    }
    visiting.delete(sigla);

    const length = 1 + maxChildL;
    memoL.set(sigla, length);
    return length;
  }

  for (const c of unapprovedCourses) {
    computeL(normalizeCourseSigla(c.sigla));
  }

  // 2. Grado de desbloqueo D_u (clausura transitiva de descendientes)
  const descendantsMap = new Map<string, Set<string>>();
  for (const c of unapprovedCourses) {
    const startNorm = normalizeCourseSigla(c.sigla);
    const reachable = new Set<string>();
    const queue = [startNorm];

    while (queue.length > 0) {
      const curr = queue.shift()!;
      const children = adj.get(curr) || [];
      for (const child of children) {
        if (!reachable.has(child) && child !== startNorm) {
          reachable.add(child);
          queue.push(child);
        }
      }
    }
    descendantsMap.set(startNorm, reachable);
  }

  // Máxima longitud en el grafo de cursos pendientes
  const maxL = unapprovedCourses.reduce((max, c) => {
    const l = memoL.get(normalizeCourseSigla(c.sigla)) || 0;
    return l > max ? l : max;
  }, 0);

  const resultMap = new Map<string, CriticalPathMetric>();

  for (const course of allCourses) {
    const norm = normalizeCourseSigla(course.sigla);
    const approved = isApproved(course);

    if (approved) {
      resultMap.set(course.sigla, {
        sigla: course.sigla,
        criticalPathLength: 0,
        totalDescendantsCount: 0,
        priorityWeight: 0,
        isCriticalBottleneck: false,
      });
      continue;
    }

    const criticalPathLength = memoL.get(norm) ?? 1;
    const totalDescendantsCount = descendantsMap.get(norm)?.size ?? 0;

    // Fórmula formal de peso: W_u = 1000 * L_u + 10 * D_u - u.semestre
    const priorityWeight =
      1000 * criticalPathLength + 10 * totalDescendantsCount - (course.semestre || 1);

    // Identificación rigurosa de cuellos de botella:
    // Un ramo es crítico si:
    // a) Está en el camino más largo (L_u >= maxL - 1 con L_u >= 3)
    // b) O desbloquea una gran cantidad de ramos futuros (D_u >= 4 con L_u >= 2)
    // c) O si la carrera está avanzada (maxL < 3), aquellos ramos con L_u = maxL y descendientes.
    let isCriticalBottleneck = false;
    if (maxL >= 3) {
      if (criticalPathLength >= Math.max(3, maxL - 1) && totalDescendantsCount >= 2) {
        isCriticalBottleneck = true;
      } else if (totalDescendantsCount >= 5 && criticalPathLength >= 2) {
        isCriticalBottleneck = true;
      }
    } else if (maxL === 2) {
      if (criticalPathLength === 2 && totalDescendantsCount >= 1) {
        isCriticalBottleneck = true;
      }
    }

    resultMap.set(course.sigla, {
      sigla: course.sigla,
      criticalPathLength,
      totalDescendantsCount,
      priorityWeight,
      isCriticalBottleneck,
    });
  }

  return resultMap;
}

/**
 * Algoritmo Voraz de Planificación Topológica Nivel a Nivel (Critical Path Scheduler):
 * - Respeta estrictamente el límite de créditos SCT por semestre (por defecto 30 SCT).
 * - REGLA INQUEBRANTABLE: Ningún ramo B puede planificarse en semestre <= al semestre
 *   de sus prerrequisitos no aprobados A (Semestre(B) > Semestre(A)).
 * - Maximiza el avance seleccionando en cada semestre los ramos con mayor peso de ruta crítica W_u.
 */
export function planFastestGraduation(
  allCourses: Course[],
  approvedSiglas: Set<string> | string[],
  inProgressSiglas: Set<string> | string[] = new Set(),
  maxCreditsSct: number = 30,
  startSemester?: number
): GraduationPlanResult {
  const creditLimit = Math.max(10, Math.min(60, maxCreditsSct || 30));

  // Normalizar conjuntos
  const approvedSet = new Set<string>();
  const rawApproved = approvedSiglas instanceof Set ? approvedSiglas : new Set(approvedSiglas);
  for (const s of rawApproved) {
    approvedSet.add(s.trim().toUpperCase());
    approvedSet.add(normalizeCourseSigla(s));
  }

  const inProgressSet = new Set<string>();
  const rawInProgress = inProgressSiglas instanceof Set ? inProgressSiglas : new Set(inProgressSiglas);
  for (const s of rawInProgress) {
    inProgressSet.add(s.trim().toUpperCase());
    inProgressSet.add(normalizeCourseSigla(s));
  }

  const isCourseApproved = (course: Course): boolean => {
    const norm = normalizeCourseSigla(course.sigla);
    if (approvedSet.has(norm) || approvedSet.has(course.sigla.trim().toUpperCase())) {
      return true;
    }
    if (Array.isArray(course.equivalencias_dnf) && course.equivalencias_dnf.length > 0) {
      return course.equivalencias_dnf.some(
        (clause) =>
          clause.length > 0 &&
          clause.every(
            (eq) =>
              approvedSet.has(normalizeCourseSigla(eq.sigla)) ||
              approvedSet.has(eq.sigla.trim().toUpperCase())
          )
      );
    }
    return false;
  };

  const isCourseInProgress = (course: Course): boolean => {
    const norm = normalizeCourseSigla(course.sigla);
    return inProgressSet.has(norm) || inProgressSet.has(course.sigla.trim().toUpperCase());
  };

  // Calcular métricas de ruta crítica
  const metricsMap = computeCriticalPathMetrics(allCourses, approvedSet);

  // Determinar semestre de inicio si no fue provisto
  let currentStartSemester = 1;
  if (startSemester !== undefined && startSemester >= 1) {
    currentStartSemester = Math.floor(startSemester);
  } else {
    // Si hay ramos cursando, el semestre de inicio se toma del nivel de dichos ramos
    const inProgressList = allCourses.filter((c) => isCourseInProgress(c));
    const unapprovedCourses = allCourses.filter((c) => !isCourseApproved(c));

    if (inProgressList.length > 0) {
      currentStartSemester = Math.max(1, Math.max(...inProgressList.map((c) => c.semestre)));
    } else if (unapprovedCourses.length > 0) {
      // Primer semestre curricular que contiene ramos pendientes por aprobar
      currentStartSemester = Math.max(1, Math.min(...unapprovedCourses.map((c) => c.semestre)));
    }
  }

  const plannedSemesterOverrides: Record<string, number> = {};
  const scheduledSiglasSet = new Set<string>();

  // 1. Los ramos aprobados pertenecen a semestres históricos (< currentStartSemester o su semestre oficial)
  for (const course of allCourses) {
    if (isCourseApproved(course)) {
      if (currentStartSemester > 1 && course.semestre >= currentStartSemester) {
        plannedSemesterOverrides[course.sigla] = currentStartSemester - 1;
      } else {
        plannedSemesterOverrides[course.sigla] = course.semestre;
      }
      scheduledSiglasSet.add(normalizeCourseSigla(course.sigla));
    }
  }

  // 2. Los ramos actualmente en curso (in-progress) se asignan obligatoriamente a currentStartSemester
  let currentSemSct = 0;
  for (const course of allCourses) {
    if (isCourseInProgress(course) && !isCourseApproved(course)) {
      plannedSemesterOverrides[course.sigla] = currentStartSemester;
      scheduledSiglasSet.add(normalizeCourseSigla(course.sigla));
      currentSemSct += course.creditos_sct || 5;
    }
  }

  // 3. Ramos pendientes por programar (no aprobados y no in-progress)
  const pendingCourses = allCourses.filter(
    (c) => !isCourseApproved(c) && !isCourseInProgress(c)
  );

  // Función auxiliar para chequear si todos los prerrequisitos no aprobados de un curso
  // fueron programados en semestres estrictamente menores a `targetSemester`
  const arePrerequisitesMetForSemester = (course: Course, targetSemester: number): boolean => {
    // 1. Evaluar si equivalencias están aprobadas o programadas antes
    if (Array.isArray(course.equivalencias_dnf) && course.equivalencias_dnf.length > 0) {
      const eqSatisfied = course.equivalencias_dnf.some((clause) =>
        clause.every((eq) => {
          const normEq = normalizeCourseSigla(eq.sigla);
          if (approvedSet.has(normEq)) return true;
          const plannedSem = plannedSemesterOverrides[eq.sigla];
          return plannedSem !== undefined && plannedSem < targetSemester;
        })
      );
      if (eqSatisfied) return true;
    }

    const knownSiglas = new Set(allCourses.map((c) => normalizeCourseSigla(c.sigla)));

    // 2. Prerrequisitos estándar del plan
    for (const prereq of course.prerrequisitos) {
      if (!prereq) continue;
      const normPrereq = normalizeCourseSigla(prereq);
      if (approvedSet.has(normPrereq)) continue; // Aprobado históricamente
      if (!knownSiglas.has(normPrereq)) continue; // Si es un prerrequisito externo no existente en la malla, omitir

      // Debe haber sido programado y su semestre debe ser < targetSemester
      const plannedSem =
        plannedSemesterOverrides[prereq] ??
        plannedSemesterOverrides[normPrereq] ??
        Object.entries(plannedSemesterOverrides).find(
          ([k]) => normalizeCourseSigla(k) === normPrereq
        )?.[1];

      if (plannedSem === undefined || plannedSem >= targetSemester) {
        return false;
      }
    }

    // 3. Evaluar cláusulas OR disyuntivas (`requisitos_dnf`) si existen
    if (Array.isArray(course.requisitos_dnf) && course.requisitos_dnf.length > 0) {
      const anyClauseMet = course.requisitos_dnf.some((clause) =>
        clause.every((r) => {
          if (!r || !r.sigla) return true;
          const rNorm = normalizeCourseSigla(r.sigla);
          if (approvedSet.has(rNorm)) return true;
          if (!knownSiglas.has(rNorm)) return true;
          const plannedSem =
            plannedSemesterOverrides[r.sigla] ??
            plannedSemesterOverrides[rNorm] ??
            Object.entries(plannedSemesterOverrides).find(
              ([k]) => normalizeCourseSigla(k) === rNorm
            )?.[1];
          return plannedSem !== undefined && plannedSem < targetSemester;
        })
      );
      if (!anyClauseMet) return false;
    }

    return true;
  };

  // Programación voraz semestre a semestre
  let activeSemester = currentStartSemester;
  let remainingCourses = [...pendingCourses];
  const maxSemestersAllowed = Math.max(allCourses.length + 5, 25);

  while (remainingCourses.length > 0 && activeSemester <= maxSemestersAllowed) {
    // Calcular créditos ocupados en activeSemester por asignaturas en este semestre.
    let alreadyAssignedSct = 0;
    for (const [sigla, sem] of Object.entries(plannedSemesterOverrides)) {
      if (sem === activeSemester) {
        const c = allCourses.find((r) => r.sigla === sigla);
        if (c) alreadyAssignedSct += c.creditos_sct || 5;
      }
    }
    let availableSct = Math.max(0, creditLimit - alreadyAssignedSct);

    // Buscar candidatos elegibles para este semestre (prerrequisitos satisfechos en semestres anteriores)
    const eligibleCandidates = remainingCourses.filter((course) =>
      arePrerequisitesMetForSemester(course, activeSemester)
    );

    // Ordenar candidatos por:
    // 1. Mayor W_u (prioridad de ruta crítica)
    // 2. Mayor L_u (longitud de camino crítico)
    // 3. Mayor D_u (número de desbloqueos)
    // 4. Menor semestre curricular original (dar preferencia a ramos de cursos atrasados)
    eligibleCandidates.sort((a, b) => {
      const metricA = metricsMap.get(a.sigla);
      const metricB = metricsMap.get(b.sigla);
      const weightA = metricA?.priorityWeight ?? 0;
      const weightB = metricB?.priorityWeight ?? 0;

      if (weightB !== weightA) return weightB - weightA;

      const lenA = metricA?.criticalPathLength ?? 1;
      const lenB = metricB?.criticalPathLength ?? 1;
      if (lenB !== lenA) return lenB - lenA;

      const descA = metricA?.totalDescendantsCount ?? 0;
      const descB = metricB?.totalDescendantsCount ?? 0;
      if (descB !== descA) return descB - descA;

      return a.semestre - b.semestre;
    });

    const scheduledInThisSem: Course[] = [];

    for (const candidate of eligibleCandidates) {
      const courseSct = candidate.creditos_sct || 5;
      if (courseSct <= availableSct || scheduledInThisSem.length === 0) {
        // Asignar al semestre activo
        plannedSemesterOverrides[candidate.sigla] = activeSemester;
        scheduledSiglasSet.add(normalizeCourseSigla(candidate.sigla));
        scheduledInThisSem.push(candidate);
        availableSct -= courseSct;
      }
    }

    if (scheduledInThisSem.length > 0) {
      // Remover los programados de la lista de pendientes
      const scheduledThisSemSet = new Set(
        scheduledInThisSem.map((c) => normalizeCourseSigla(c.sigla))
      );
      remainingCourses = remainingCourses.filter(
        (c) => !scheduledThisSemSet.has(normalizeCourseSigla(c.sigla))
      );
    }

    // Avanzar al siguiente semestre
    activeSemester++;
  }

  // Si por alguna anomalía quedaron cursos sin programar (ej. grafos inconexos), asignarlos al final
  if (remainingCourses.length > 0) {
    const fallbackSem = activeSemester;
    for (const c of remainingCourses) {
      plannedSemesterOverrides[c.sigla] = fallbackSem;
    }
  }

  // 4. Pase de Compactación Retrógrada y Balance de Carga (Backward Compaction Pass):
  // Adelanta asignaturas de semestres tardíos hacia semestres anteriores con holgura disponible,
  // eliminando semestres solitarios/libres y reduciendo la carrera al menor número real de semestres.
  let compactionChanged = true;
  while (compactionChanged) {
    compactionChanged = false;
    // Evaluar asignaturas pendientes en orden descendente de semestre (las más tardías primero)
    const sortedDesc = [...pendingCourses].sort(
      (a, b) => (plannedSemesterOverrides[b.sigla] || 0) - (plannedSemesterOverrides[a.sigla] || 0)
    );

    for (const c of sortedDesc) {
      const currentSem = plannedSemesterOverrides[c.sigla];
      if (!currentSem || currentSem <= currentStartSemester) continue;

      const cSct = c.creditos_sct || 5;

      // Buscar el menor semestre s en [currentStartSemester, currentSem - 1] donde los prerrequisitos se cumplan
      // y donde el ramo quepa dentro del creditLimit
      for (let s = currentStartSemester; s < currentSem; s++) {
        if (arePrerequisitesMetForSemester(c, s)) {
          // Calcular SCT total ocupado en el semestre objetivo s
          let sctInS = 0;
          for (const [sigla, sem] of Object.entries(plannedSemesterOverrides)) {
            if (sigla !== c.sigla && sem === s) {
              const other = allCourses.find((r) => r.sigla === sigla);
              if (other) sctInS += other.creditos_sct || 5;
            }
          }

          if (sctInS + cSct <= creditLimit) {
            plannedSemesterOverrides[c.sigla] = s;
            compactionChanged = true;
            break;
          }
        }
      }
    }
  }

  // 5. Construir desglose por semestres (semestersBreakdown) y calcular total de semestres
  let maxAssignedSem = 0;
  for (const sem of Object.values(plannedSemesterOverrides)) {
    if (sem > maxAssignedSem) maxAssignedSem = sem;
  }
  for (const c of allCourses) {
    if (c.semestre > maxAssignedSem) maxAssignedSem = c.semestre;
  }

  const totalSemesters = Math.max(maxAssignedSem, 1);
  const semestersBreakdown: Record<number, SemesterCourseBreakdown> = {};

  for (let s = 1; s <= totalSemesters; s++) {
    semestersBreakdown[s] = {
      courses: [],
      totalSct: 0,
      totalUsm: 0,
    };
  }

  for (const course of allCourses) {
    const sem = plannedSemesterOverrides[course.sigla] || course.semestre;
    if (!semestersBreakdown[sem]) {
      semestersBreakdown[sem] = {
        courses: [],
        totalSct: 0,
        totalUsm: 0,
      };
    }
    semestersBreakdown[sem].courses.push(course);
    semestersBreakdown[sem].totalSct += course.creditos_sct || 0;
    semestersBreakdown[sem].totalUsm += course.creditos_usm || 0;
  }

  return {
    plannedSemesterOverrides,
    totalSemesters,
    semestersBreakdown,
  };
}

/**
 * Evalúa todos los cursos no aprobados en la planificación activa y retorna la lista
 * de conflictos formales donde un ramo está planificado en un semestre menor o igual a uno de sus prerrequisitos.
 */
export function validatePlanConflicts(
  allCourses: Course[],
  approvedSiglas: Set<string> | string[],
  plannedSemesterOverrides: Record<string, number>
): PlanConflict[] {
  const approvedSet = new Set<string>();
  const rawApproved = approvedSiglas instanceof Set ? approvedSiglas : new Set(approvedSiglas);
  for (const s of rawApproved) {
    approvedSet.add(s.trim().toUpperCase());
    approvedSet.add(normalizeCourseSigla(s));
  }

  const isApproved = (courseOrSigla: Course | string): boolean => {
    const sigla = typeof courseOrSigla === 'string' ? courseOrSigla : courseOrSigla.sigla;
    const norm = normalizeCourseSigla(sigla);
    if (approvedSet.has(norm) || approvedSet.has(sigla.trim().toUpperCase())) {
      return true;
    }
    if (
      typeof courseOrSigla !== 'string' &&
      Array.isArray(courseOrSigla.equivalencias_dnf) &&
      courseOrSigla.equivalencias_dnf.length > 0
    ) {
      return courseOrSigla.equivalencias_dnf.some(
        (clause) =>
          clause.length > 0 &&
          clause.every(
            (eq) =>
              approvedSet.has(normalizeCourseSigla(eq.sigla)) ||
              approvedSet.has(eq.sigla.trim().toUpperCase())
          )
      );
    }
    return false;
  };

  const courseByNorm = new Map<string, Course>();
  for (const c of allCourses) {
    courseByNorm.set(normalizeCourseSigla(c.sigla), c);
    courseByNorm.set(c.sigla.trim().toUpperCase(), c);
  }

  const getEffectiveSemester = (c: Course): number => {
    return (
      plannedSemesterOverrides[c.sigla] ??
      plannedSemesterOverrides[normalizeCourseSigla(c.sigla)] ??
      c.semestre
    );
  };

  const conflicts: PlanConflict[] = [];
  const reportedPairs = new Set<string>();

  for (const course of allCourses) {
    if (isApproved(course)) continue;

    const courseSem = getEffectiveSemester(course);

    // 1. Prerrequisitos estándar en arreglo
    for (const prereqSigla of course.prerrequisitos) {
      if (isApproved(prereqSigla)) continue;

      const prereqCourse = courseByNorm.get(normalizeCourseSigla(prereqSigla));
      const prereqSem = prereqCourse
        ? getEffectiveSemester(prereqCourse)
        : (plannedSemesterOverrides[prereqSigla] ?? 1);
      const prereqName = prereqCourse ? prereqCourse.nombre : prereqSigla;
      const cleanPrereqSigla = prereqCourse ? prereqCourse.sigla : prereqSigla;

      if (courseSem <= prereqSem) {
        const pairKey = `${course.sigla}->${cleanPrereqSigla}`;
        if (!reportedPairs.has(pairKey)) {
          reportedPairs.add(pairKey);
          conflicts.push({
            courseSigla: course.sigla,
            courseName: course.nombre,
            courseSemester: courseSem,
            prereqSigla: cleanPrereqSigla,
            prereqName,
            prereqSemester: prereqSem,
            reason: `${course.sigla} (Semestre ${courseSem}) está planificado al mismo tiempo o antes que su prerrequisito ${cleanPrereqSigla} (Semestre ${prereqSem})`,
          });
        }
      }
    }

    // 2. Cláusulas DNF si existen
    if (Array.isArray(course.requisitos_dnf) && course.requisitos_dnf.length > 0) {
      const anyClauseSatisfied = course.requisitos_dnf.some((clause) =>
        clause.every((r) => {
          if (isApproved(r.sigla)) return true;
          const pCourse = courseByNorm.get(normalizeCourseSigla(r.sigla));
          const pSem = pCourse
            ? getEffectiveSemester(pCourse)
            : (plannedSemesterOverrides[r.sigla] ?? 1);
          return courseSem > pSem;
        })
      );

      if (!anyClauseSatisfied) {
        for (const clause of course.requisitos_dnf) {
          for (const r of clause) {
            if (isApproved(r.sigla)) continue;
            const pCourse = courseByNorm.get(normalizeCourseSigla(r.sigla));
            const pSem = pCourse
              ? getEffectiveSemester(pCourse)
              : (plannedSemesterOverrides[r.sigla] ?? 1);

            if (courseSem <= pSem) {
              const cleanPrereqSigla = pCourse ? pCourse.sigla : r.sigla;
              const prereqName = pCourse ? pCourse.nombre : r.sigla;
              const pairKey = `${course.sigla}->${cleanPrereqSigla}`;
              if (!reportedPairs.has(pairKey)) {
                reportedPairs.add(pairKey);
                conflicts.push({
                  courseSigla: course.sigla,
                  courseName: course.nombre,
                  courseSemester: courseSem,
                  prereqSigla: cleanPrereqSigla,
                  prereqName,
                  prereqSemester: pSem,
                  reason: `${course.sigla} (Semestre ${courseSem}) está planificado al mismo tiempo o antes que su prerrequisito ${cleanPrereqSigla} (Semestre ${pSem})`,
                });
              }
            }
          }
        }
      }
    }
  }

  return conflicts;
}

/**
 * Resuelve automáticamente todos los conflictos de prelación en la planificación:
 * Recorre en orden topológico; si un curso tiene sem <= max(prereqSem), lo empuja
 * a max(prereqSem) + 1. Retorna el mapa de overrides saneado sin conflictos.
 */
export function resolveAllPlanConflicts(
  allCourses: Course[],
  approvedSiglas: Set<string> | string[],
  plannedSemesterOverrides: Record<string, number>
): Record<string, number> {
  const graphCheck = validateGraphAcyclic(allCourses);
  if (!graphCheck.isAcyclic) {
    console.warn('Ciclo detectado en las dependencias. No se pueden resolver automáticamente:', graphCheck.cycleNodes);
    return plannedSemesterOverrides;
  }
  const newOverrides: Record<string, number> = { ...plannedSemesterOverrides };

  let iterations = 0;
  const maxIterations = Math.max(allCourses.length * 3, 50);

  while (iterations < maxIterations) {
    const conflicts = validatePlanConflicts(allCourses, approvedSiglas, newOverrides);
    if (conflicts.length === 0) break;

    let changed = false;
    for (const conf of conflicts) {
      const course = allCourses.find(
        (c) =>
          c.sigla === conf.courseSigla ||
          normalizeCourseSigla(c.sigla) === normalizeCourseSigla(conf.courseSigla)
      );
      if (!course) continue;

      const currentSem =
        newOverrides[course.sigla] ??
        newOverrides[normalizeCourseSigla(course.sigla)] ??
        course.semestre;

      const targetSem = Math.max(currentSem, conf.prereqSemester + 1);
      if (targetSem !== currentSem) {
        newOverrides[course.sigla] = targetSem;
        changed = true;
      }
    }

    if (!changed) break;
    iterations++;
  }

  return newOverrides;
}


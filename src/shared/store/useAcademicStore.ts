import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  CurriculumPlan,
  ApprovedCourseRecord,
  EnrolledCourseConfig,
  GraduationMilestone,
  CourseStatusDetail,
  AcademicStatistics,
  CourseSolveResult,
  SubFormulaCourseSolveResult,
  PlannerViewMode,
  MoveCourseResult,
  Course,
} from '@/shared/types/academic';
import {
  planFastestGraduation,
  GraduationPlanResult,
  normalizeCourseSigla,
  resolveAllPlanConflicts,
} from '@/curricula/planner/criticalPathPlanner';
import ici2014Data from '@/curricula/careers/ici-2014.json';
import {
  createSmartCourseConfig,
  DEFAULT_GRADUATION_MILESTONES,
  createInf292ExampleScenario,
  ensureFormulaConfig,
} from '@/wolfram-solver/templates/defaultTemplates';
import { calculateCurriculumGraph } from '@/curricula/prerequisites/graphUnlock';
import { solveCourseStatus } from '@/wolfram-solver/engine/gradeSolver';
import { solveSubFormulaCourse } from '@/wolfram-solver/engine/subFormulaSolver';
import { sigaService } from '@/curricula/services/sigaService';
import { curriculumService } from '@/curricula/services/curriculumService';

export interface EnrollCourseOptions {
  customName?: string;
  customCreditsSct?: number;
  selectedParallel?: string;
}

export interface AcademicStoreState {
  // Curriculum configuration
  curriculum: CurriculumPlan;
  activePlanId: string;
  selectedCourseSigla: string | null;

  // Persisted academic states
  approvedCourses: Record<string, ApprovedCourseRecord>;
  inProgressCourses: Record<string, EnrolledCourseConfig>;
  milestones: GraduationMilestone[];

  // Planner state
  plannerMode: PlannerViewMode;
  plannedSemesterOverrides: Record<string, number>;
  maxCreditsPerSemester: number;
  customMaxSemester: number;

  // Actions
  setSelectedCourse: (sigla: string | null) => void;
  selectCurriculumPlan: (planId: string) => Promise<void>;
  setSelectedParallel: (sigla: string, paralelo: string | undefined) => void;
  setPlannerMode: (mode: PlannerViewMode) => void;
  setMaxCreditsPerSemester: (credits: number) => void;
  setCustomMaxSemester: (sem: number) => void;
  movePlannedCourse: (
    sigla: string,
    targetSemester: number,
    cascadePush?: boolean
  ) => MoveCourseResult;
  resolvePlanConflicts: () => void;
  resetPlannedSemesters: () => void;
  applyAutoCriticalPathPlan: (maxCreditsSct?: number) => GraduationPlanResult;
  toggleCourseApproval: (sigla: string, grade?: number) => void;
  toggleSemesterApproval: (semesterNumber: number) => void;
  setCourseGrade: (sigla: string, grade: number) => void;
  enrollCourse: (sigla: string, options?: EnrollCourseOptions) => void;
  unenrollCourse: (sigla: string) => void;
  loadInf292Example: () => void;
  setEvaluationScore: (
    sigla: string,
    groupId: string,
    evalId: string,
    score: number | null
  ) => void;
  setSubFormulaEvaluationScore: (
    sigla: string,
    blockId: string,
    evalId: string,
    score: number | null
  ) => void;
  setRecoveryScore: (sigla: string, groupId: string, score: number | null) => void;
  updateCourseFormula: (
    sigla: string,
    updater: (config: EnrolledCourseConfig) => EnrolledCourseConfig
  ) => void;
  toggleMilestone: (id: string) => void;
  resetToTemplate: (sigla: string) => void;
  importJSON: (data: string) => boolean;
  exportJSON: () => string;
  resetAll: () => void;

  // Reactive Selectors / Getters
  getCoursesStatus: () => Record<string, CourseStatusDetail>;
  getStatistics: () => AcademicStatistics;
  getCourseSolveResult: (sigla: string) => CourseSolveResult | null;
  getSubFormulaSolveResult: (sigla: string) => SubFormulaCourseSolveResult | null;
}

const getSafeStorage = () => {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  const memoryStore = new Map<string, string>();
  return {
    getItem: (key: string) => memoryStore.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memoryStore.set(key, value);
    },
    removeItem: (key: string) => {
      memoryStore.delete(key);
    },
  };
};

export const useAcademicStore = create<AcademicStoreState>()(
  persist(
    (set, get) => ({
      curriculum: {
        ...(ici2014Data as CurriculumPlan),
        sede: 'Casa Central Valparaíso',
        jornada: 'Diurna',
        semestres_totales: 11,
      },
      activePlanId: '7313-2014',
      selectedCourseSigla: null,
      approvedCourses: {},
      inProgressCourses: {},
      milestones: DEFAULT_GRADUATION_MILESTONES,
      plannerMode: 'official' as PlannerViewMode,
      plannedSemesterOverrides: {},
      maxCreditsPerSemester: 30,
      customMaxSemester: 11,

      setSelectedCourse: (sigla: string | null) => {
        set({ selectedCourseSigla: sigla });
      },

      selectCurriculumPlan: async (planId: string) => {
        const plan = await curriculumService.getCurriculum(planId);
        set({
          activePlanId: planId,
          curriculum: plan,
          selectedCourseSigla: null,
          customMaxSemester: Math.max(plan.semestres_totales || 11, Number(get().customMaxSemester) || 11),
        });
      },

      setPlannerMode: (mode: PlannerViewMode) => {
        set({ plannerMode: mode });
      },

      setMaxCreditsPerSemester: (credits: number) => {
        const clamped = Math.max(10, Math.min(60, Number(credits) || 30));
        set({ maxCreditsPerSemester: clamped });
      },

      setCustomMaxSemester: (sem: number) => {
        const clamped = Math.max(1, Math.floor(sem));
        set({ customMaxSemester: clamped });
      },

      movePlannedCourse: (
        sigla: string,
        targetSemester: number,
        cascadePush: boolean = false
      ): MoveCourseResult => {
        const targetSem = Math.max(1, Math.floor(targetSemester));
        const norm = normalizeCourseSigla(sigla);
        const { curriculum, approvedCourses, plannedSemesterOverrides, customMaxSemester } = get();
        const ramos = curriculum.ramos || [];

        const targetCourse = ramos.find(
          (r) => normalizeCourseSigla(r.sigla) === norm || r.sigla.toUpperCase() === norm
        );

        if (!targetCourse) {
          return {
            success: false,
            reason: `No se encontró la asignatura con sigla ${sigla} en la malla activa.`,
          };
        }

        const isApproved = (s: string) => {
          const sNorm = normalizeCourseSigla(s);
          return Object.keys(approvedCourses).some((k) => normalizeCourseSigla(k) === sNorm);
        };

        const getEffectiveSemester = (c: Course, overrides: Record<string, number>) => {
          return (
            overrides[c.sigla] ??
            overrides[normalizeCourseSigla(c.sigla)] ??
            c.semestre
          );
        };

        // En modo libre de planificación: siempre permitimos colocar el ramo en targetSemester sin bloqueo rígido.
        const newOverrides: Record<string, number> = { ...plannedSemesterOverrides };
        newOverrides[targetCourse.sigla] = targetSem;

        const pushedList: string[] = [];
        if (cascadePush) {
          const queue: Array<{ sigla: string; minSem: number }> = [
            { sigla: targetCourse.sigla, minSem: targetSem + 1 },
          ];
          const visited = new Set<string>();

          while (queue.length > 0) {
            const { sigla: currSigla, minSem } = queue.shift()!;
            const currNorm = normalizeCourseSigla(currSigla);
            if (visited.has(currNorm)) continue;
            visited.add(currNorm);

            for (const depCourse of ramos) {
              if (isApproved(depCourse.sigla)) continue;

              const dependsOnCurr =
                depCourse.prerrequisitos.some(
                  (p) => normalizeCourseSigla(p) === currNorm
                ) ||
                (Array.isArray(depCourse.requisitos_dnf) &&
                  depCourse.requisitos_dnf.some((clause) =>
                    clause.some((r) => normalizeCourseSigla(r.sigla) === currNorm)
                  ));

              if (dependsOnCurr) {
                const currentDepSem = getEffectiveSemester(depCourse, newOverrides);
                if (currentDepSem < minSem) {
                  newOverrides[depCourse.sigla] = minSem;
                  pushedList.push(`${depCourse.sigla} -> Semestre ${minSem}`);
                  queue.push({ sigla: depCourse.sigla, minSem: minSem + 1 });
                }
              }
            }
          }
        }

        let maxSem = Math.max(Number(customMaxSemester) || 11, targetSem);
        for (const s of Object.values(newOverrides)) {
          if (s > maxSem) maxSem = s;
        }

        set({
          plannedSemesterOverrides: newOverrides,
          customMaxSemester: maxSem,
        });

        return {
          success: true,
          pushedCourses: pushedList.length > 0 ? pushedList : undefined,
        };
      },

      resolvePlanConflicts: () => {
        const { curriculum, approvedCourses, plannedSemesterOverrides, customMaxSemester } = get();
        const approvedSiglas = new Set(Object.keys(approvedCourses));
        const sanitized = resolveAllPlanConflicts(
          curriculum.ramos || [],
          approvedSiglas,
          plannedSemesterOverrides
        );

        let maxSem = Number(customMaxSemester) || 11;
        for (const s of Object.values(sanitized)) {
          if (s > maxSem) maxSem = s;
        }

        set({
          plannedSemesterOverrides: sanitized,
          customMaxSemester: maxSem,
        });
      },

      resetPlannedSemesters: () => {
        const defaultTotal = get().curriculum.semestres_totales || 11;
        set({
          plannedSemesterOverrides: {},
          customMaxSemester: defaultTotal,
        });
      },

      applyAutoCriticalPathPlan: (maxCreditsSct?: number): GraduationPlanResult => {
        const {
          curriculum,
          approvedCourses,
          inProgressCourses,
          maxCreditsPerSemester,
        } = get();
        const credits = maxCreditsSct ?? maxCreditsPerSemester ?? 30;
        const approvedSiglas = new Set(Object.keys(approvedCourses));
        const inProgressSiglas = new Set(Object.keys(inProgressCourses));

        const result = planFastestGraduation(
          curriculum.ramos,
          approvedSiglas,
          inProgressSiglas,
          credits
        );

        set({
          plannedSemesterOverrides: result.plannedSemesterOverrides,
          customMaxSemester: Math.max(
            curriculum.semestres_totales || 11,
            result.totalSemesters
          ),
          plannerMode: 'planned',
        });

        return result;
      },

      setSelectedParallel: (sigla: string, paralelo: string | undefined) => {
        const norm = sigla.trim().toUpperCase();
        const current = get().inProgressCourses[norm];
        if (!current) return;
        set({
          inProgressCourses: {
            ...get().inProgressCourses,
            [norm]: {
              ...current,
              selectedParallel: paralelo,
            },
          },
        });
      },

      toggleCourseApproval: (sigla: string, grade?: number) => {
        const norm = sigla.trim().toUpperCase();
        const currentApproved = { ...get().approvedCourses };
        const currentInProgress = { ...get().inProgressCourses };

        if (currentApproved[norm]) {
          // If already approved, unapprove
          delete currentApproved[norm];
          set({ approvedCourses: currentApproved });
        } else {
          // Approve course
          currentApproved[norm] = {
            sigla: norm,
            grade: grade !== undefined ? Number(grade) : undefined,
            approvedAt: new Date().toISOString(),
          };
          // Remove from in-progress if it was currently enrolled
          if (currentInProgress[norm]) {
            delete currentInProgress[norm];
          }
          set({
            approvedCourses: currentApproved,
            inProgressCourses: currentInProgress,
          });
        }
      },

      toggleSemesterApproval: (semesterNumber: number) => {
        const semCourses = (get().curriculum.ramos || []).filter(
          (r) => r.semestre === semesterNumber
        );
        if (semCourses.length === 0) return;

        const currentApproved = { ...get().approvedCourses };
        const currentInProgress = { ...get().inProgressCourses };
        const allApproved = semCourses.every(
          (r) => !!currentApproved[r.sigla.trim().toUpperCase()]
        );

        const now = new Date().toISOString();
        for (const r of semCourses) {
          const norm = r.sigla.trim().toUpperCase();
          if (allApproved) {
            delete currentApproved[norm];
          } else {
            if (!currentApproved[norm]) {
              currentApproved[norm] = {
                sigla: norm,
                approvedAt: now,
              };
            }
            if (currentInProgress[norm]) {
              delete currentInProgress[norm];
            }
          }
        }

        set({
          approvedCourses: currentApproved,
          inProgressCourses: currentInProgress,
        });
      },

      setCourseGrade: (sigla: string, grade: number) => {
        const norm = sigla.trim().toUpperCase();
        const currentApproved = { ...get().approvedCourses };
        if (currentApproved[norm]) {
          currentApproved[norm] = {
            ...currentApproved[norm],
            grade: Number(grade),
          };
          set({ approvedCourses: currentApproved });
        }
      },

      enrollCourse: (sigla: string, options?: EnrollCourseOptions) => {
        const norm = sigla.trim().toUpperCase();
        const currentInProgress = { ...get().inProgressCourses };
        const currentApproved = { ...get().approvedCourses };
        const courseFromMalla =
          get().curriculum.ramos.find((r) => r.sigla.toUpperCase() === norm) || null;

        // If course is not enrolled, initialize with SIGA official formula or smart departmental template
        if (!currentInProgress[norm]) {
          currentInProgress[norm] = {
            ...createSmartCourseConfig(norm, courseFromMalla),
            ...(options?.customName ? { customName: options.customName } : {}),
            ...(options?.customCreditsSct !== undefined
              ? { customCreditsSct: options.customCreditsSct }
              : {}),
            ...(options?.selectedParallel
              ? { selectedParallel: options.selectedParallel }
              : {}),
          };
        } else if (options) {
          currentInProgress[norm] = {
            ...currentInProgress[norm],
            ...(options.customName ? { customName: options.customName } : {}),
            ...(options.customCreditsSct !== undefined
              ? { customCreditsSct: options.customCreditsSct }
              : {}),
            ...(options.selectedParallel !== undefined
              ? { selectedParallel: options.selectedParallel }
              : {}),
          };
        }

        // If it was marked as approved, un-approve it because it is being taken now
        if (currentApproved[norm]) {
          delete currentApproved[norm];
        }

        set({
          inProgressCourses: currentInProgress,
          approvedCourses: currentApproved,
          selectedCourseSigla: norm,
        });
      },

      unenrollCourse: (sigla: string) => {
        const norm = sigla.trim().toUpperCase();
        const currentInProgress = { ...get().inProgressCourses };
        if (currentInProgress[norm]) {
          delete currentInProgress[norm];
          const newSelected =
            get().selectedCourseSigla === norm ? null : get().selectedCourseSigla;
          set({
            inProgressCourses: currentInProgress,
            selectedCourseSigla: newSelected,
          });
        }
      },

      loadInf292Example: () => {
        const norm = 'INF-292';
        const currentInProgress = { ...get().inProgressCourses };
        const currentApproved = { ...get().approvedCourses };

        delete currentApproved[norm];
        currentInProgress[norm] = createInf292ExampleScenario();

        set({
          inProgressCourses: currentInProgress,
          approvedCourses: currentApproved,
          selectedCourseSigla: norm,
        });
      },

      setEvaluationScore: (
        sigla: string,
        groupId: string,
        evalId: string,
        score: number | null
      ) => {
        const norm = sigla.trim().toUpperCase();
        const course = get().inProgressCourses[norm];
        if (!course) return;

        const parsedScore = score !== null && !isNaN(score) ? Number(score) : null;

        const updatedGroups = course.groups.map((group) => {
          if (group.id !== groupId) return group;
          return {
            ...group,
            evaluations: group.evaluations.map((ev) => {
              if (ev.id !== evalId) return ev;
              return {
                ...ev,
                score: parsedScore,
              };
            }),
          };
        });

        let updatedFormula = course.formulaConfig;
        if (course.formulaConfig) {
          updatedFormula = {
            ...course.formulaConfig,
            subFormulas: course.formulaConfig.subFormulas.map((b) => {
              if (b.id !== groupId && b.code.toLowerCase() !== groupId.toLowerCase()) {
                return b;
              }
              return {
                ...b,
                evaluations: b.evaluations.map((ev) => {
                  if (ev.id !== evalId) return ev;
                  return { ...ev, score: parsedScore };
                }),
              };
            }),
          };
        }

        set({
          inProgressCourses: {
            ...get().inProgressCourses,
            [norm]: {
              ...course,
              groups: updatedGroups,
              formulaConfig: updatedFormula,
            },
          },
        });
      },

      setSubFormulaEvaluationScore: (
        sigla: string,
        blockId: string,
        evalId: string,
        score: number | null
      ) => {
        const norm = sigla.trim().toUpperCase();
        const baseCourse = get().inProgressCourses[norm];
        if (!baseCourse) return;

        const course = baseCourse.formulaConfig
          ? baseCourse
          : { ...baseCourse, formulaConfig: ensureFormulaConfig(baseCourse) };

        const parsedScore = score !== null && !isNaN(score) ? Number(score) : null;

        let updatedFormula = course.formulaConfig;
        if (updatedFormula) {
          updatedFormula = {
            ...updatedFormula,
            subFormulas: updatedFormula.subFormulas.map((b) => {
              if (b.id !== blockId && b.code.toLowerCase() !== blockId.toLowerCase()) {
                return b;
              }
              return {
                ...b,
                evaluations: b.evaluations.map((ev) => {
                  if (ev.id !== evalId) return ev;
                  return { ...ev, score: parsedScore };
                }),
              };
            }),
          };
        }

        const updatedGroups = (course.groups || []).map((group) => {
          if (group.id !== blockId && group.id.toLowerCase() !== blockId.toLowerCase()) {
            return group;
          }
          return {
            ...group,
            evaluations: group.evaluations.map((ev) => {
              if (ev.id !== evalId) return ev;
              return { ...ev, score: parsedScore };
            }),
          };
        });

        set({
          inProgressCourses: {
            ...get().inProgressCourses,
            [norm]: {
              ...course,
              groups: updatedGroups,
              formulaConfig: updatedFormula,
            },
          },
        });
      },

      setRecoveryScore: (sigla: string, groupId: string, score: number | null) => {
        const norm = sigla.trim().toUpperCase();
        const course = get().inProgressCourses[norm];
        if (!course) return;

        const updatedGroups = course.groups.map((group) => {
          if (group.id !== groupId) return group;
          return {
            ...group,
            recoveryGrade: score !== null && !isNaN(score) ? Number(score) : null,
          };
        });

        set({
          inProgressCourses: {
            ...get().inProgressCourses,
            [norm]: {
              ...course,
              groups: updatedGroups,
            },
          },
        });
      },

      updateCourseFormula: (
        sigla: string,
        updater: (config: EnrolledCourseConfig) => EnrolledCourseConfig
      ) => {
        const norm = sigla.trim().toUpperCase();
        const current = get().inProgressCourses[norm];
        if (!current) return;

        const updated = updater(JSON.parse(JSON.stringify(current)));
        set({
          inProgressCourses: {
            ...get().inProgressCourses,
            [norm]: updated,
          },
        });
      },

      toggleMilestone: (id: string) => {
        const currentMilestones = get().milestones.map((m) => {
          if (m.id !== id) return m;
          const nextCompleted = !m.completed;
          return {
            ...m,
            completed: nextCompleted,
            completedAt: nextCompleted ? new Date().toISOString() : undefined,
          };
        });
        set({ milestones: currentMilestones });
      },

      resetToTemplate: (sigla: string) => {
        const norm = sigla.trim().toUpperCase();
        const current = get().inProgressCourses[norm];
        if (current) {
          const courseFromMalla =
            get().curriculum.ramos.find((r) => r.sigla.toUpperCase() === norm) || null;
          set({
            inProgressCourses: {
              ...get().inProgressCourses,
              [norm]: {
                ...createSmartCourseConfig(norm, courseFromMalla),
                selectedParallel: current.selectedParallel,
                customName: current.customName,
                customCreditsSct: current.customCreditsSct,
              },
            },
          });
        }
      },

      importJSON: (data: string): boolean => {
        const res = sigaService.importBackup(data);
        if (!res.success || !res.data) {
          return false;
        }

        const nextPlanId = res.data.activePlanId || get().activePlanId;
        const defaultTotal = get().curriculum.semestres_totales || 11;
        set({
          activePlanId: nextPlanId,
          approvedCourses: res.data.approvedCourses || {},
          inProgressCourses: res.data.inProgressCourses || {},
          milestones:
            Array.isArray(res.data.milestones) && res.data.milestones.length > 0
              ? res.data.milestones
              : DEFAULT_GRADUATION_MILESTONES,
          plannerMode: res.data.plannerMode || 'official',
          plannedSemesterOverrides: res.data.plannedSemesterOverrides || {},
          maxCreditsPerSemester: res.data.maxCreditsPerSemester || 30,
          customMaxSemester: res.data.customMaxSemester || defaultTotal,
        });

        if (res.data.activePlanId && res.data.activePlanId !== get().curriculum.codigo_plan) {
          curriculumService
            .getCurriculum(res.data.activePlanId)
            .then((plan) => {
              useAcademicStore.setState({ curriculum: plan });
            })
            .catch(() => {
              // Keeps current curriculum if offline
            });
        }

        return true;
      },

      exportJSON: (): string => {
        return sigaService.exportBackup({
          activePlanId: get().activePlanId,
          approvedCourses: get().approvedCourses,
          inProgressCourses: get().inProgressCourses,
          milestones: get().milestones,
          plannerMode: get().plannerMode,
          plannedSemesterOverrides: get().plannedSemesterOverrides,
          maxCreditsPerSemester: get().maxCreditsPerSemester,
          customMaxSemester: get().customMaxSemester,
        });
      },

      resetAll: () => {
        const defaultTotal = get().curriculum.semestres_totales || 11;
        set({
          approvedCourses: {},
          inProgressCourses: {},
          selectedCourseSigla: null,
          milestones: DEFAULT_GRADUATION_MILESTONES.map((m) => ({
            ...m,
            completed: false,
            completedAt: undefined,
          })),
          plannerMode: 'official',
          plannedSemesterOverrides: {},
          maxCreditsPerSemester: 30,
          customMaxSemester: defaultTotal,
        });
      },

      // Reactive Computations
      getCoursesStatus: () => {
        const { curriculum, approvedCourses, inProgressCourses } = get();
        const inProgressSiglas = new Set(Object.keys(inProgressCourses));
        return calculateCurriculumGraph(curriculum.ramos, approvedCourses, inProgressSiglas);
      },

      getStatistics: (): AcademicStatistics => {
        const { curriculum, approvedCourses, inProgressCourses } = get();
        const ramos = curriculum.ramos || [];

        let sctTotal = 0;
        let usmTotal = 0;
        let sctApproved = 0;
        let usmApproved = 0;
        let gradeSum = 0;
        let creditsWithGrade = 0;
        let approvedInPlanCount = 0;

        for (const r of ramos) {
          const sct = r.creditos_sct || (r.creditos_usm ? Math.round(r.creditos_usm * 1.67) : 0);
          const usm = r.creditos_usm || 0;
          sctTotal += sct;
          usmTotal += usm;

          const record = approvedCourses[r.sigla.toUpperCase()];
          if (record) {
            approvedInPlanCount++;
            sctApproved += sct;
            usmApproved += usm;
            if (record.grade !== undefined && !isNaN(record.grade)) {
              const weight = sct > 0 ? sct : (usm > 0 ? usm : 1);
              gradeSum += record.grade * weight;
              creditsWithGrade += weight;
            }
          }
        }

        const percentProgress =
          sctTotal > 0
            ? (sctApproved / sctTotal) * 100
            : usmTotal > 0
            ? (usmApproved / usmTotal) * 100
            : 0;
        const gpa = creditsWithGrade > 0 ? gradeSum / creditsWithGrade : 0;

        return {
          sctCreditsApproved: sctApproved,
          sctCreditsTotal: sctTotal,
          usmCreditsApproved: usmApproved,
          usmCreditsTotal: usmTotal,
          percentProgress: Math.min(100, Math.round(percentProgress * 10) / 10),
          gpa: Math.round(gpa * 10) / 10,
          approvedCoursesCount: approvedInPlanCount,
          inProgressCoursesCount: Object.keys(inProgressCourses).length,
          totalCoursesCount: ramos.length,
        };
      },

      getCourseSolveResult: (sigla: string): CourseSolveResult | null => {
        const norm = sigla.trim().toUpperCase();
        const config = get().inProgressCourses[norm];
        if (!config) return null;
        return solveCourseStatus(config, get().curriculum.escala_notas.aprobacion);
      },

      getSubFormulaSolveResult: (sigla: string): SubFormulaCourseSolveResult | null => {
        const norm = sigla.trim().toUpperCase();
        const config = get().inProgressCourses[norm];
        if (!config) return null;
        const formulaConfig = ensureFormulaConfig(config);
        return solveSubFormulaCourse(
          formulaConfig,
          get().curriculum.escala_notas.aprobacion
        );
      },
    }),
    {
      name: 'sansano-academic-tracker-v1',
      version: 1,
      storage: createJSONStorage(getSafeStorage),
      migrate: (persistedState: any) => {
        if (!persistedState) return persistedState;
        if (
          persistedState.customMaxSemester === undefined ||
          persistedState.customMaxSemester === null ||
          isNaN(Number(persistedState.customMaxSemester))
        ) {
          persistedState.customMaxSemester = 11;
        } else {
          persistedState.customMaxSemester = Number(persistedState.customMaxSemester);
        }
        if (!persistedState.plannedSemesterOverrides || typeof persistedState.plannedSemesterOverrides !== 'object') {
          persistedState.plannedSemesterOverrides = {};
        }
        if (!persistedState.approvedCourses || typeof persistedState.approvedCourses !== 'object') {
          persistedState.approvedCourses = {};
        }
        if (!persistedState.inProgressCourses || typeof persistedState.inProgressCourses !== 'object') {
          persistedState.inProgressCourses = {};
        }
        return persistedState;
      },
      partialize: (state) => ({
        activePlanId: state.activePlanId,
        curriculum: state.curriculum,
        approvedCourses: state.approvedCourses,
        inProgressCourses: state.inProgressCourses,
        milestones: state.milestones,
        selectedCourseSigla: state.selectedCourseSigla,
        plannerMode: state.plannerMode,
        plannedSemesterOverrides: state.plannedSemesterOverrides,
        maxCreditsPerSemester: state.maxCreditsPerSemester,
        customMaxSemester: state.customMaxSemester,
      }),
      onRehydrateStorage: () => (state) => {
        if (state && state.activePlanId && state.activePlanId !== '7313-2014') {
          curriculumService
            .getCurriculum(state.activePlanId)
            .then((plan) => {
              if (
                plan &&
                plan.codigo_plan === state.activePlanId &&
                Array.isArray(plan.ramos) &&
                plan.ramos.length > 0
              ) {
                useAcademicStore.setState({ curriculum: plan });
              }
            })
            .catch(() => {
              // Keeps persisted curriculum if offline
            });
        }
      },
    }
  )
);

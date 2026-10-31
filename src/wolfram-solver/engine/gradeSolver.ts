import {
  EnrolledCourseConfig,
  CourseSolveResult,
  GroupSolveResult,
  UnknownEvaluationDetail,
  SolverStatus,
  SliderRebalanceResult,
  RecoveryScenario,
} from '@/shared/types/academic';

/**
 * Normalizes an array of weights so they sum to 1.0.
 * Handles weights given in percentages (e.g. 70, 30) or fractions (0.7, 0.3).
 */
export function normalizeWeights(weights: number[]): number[] {
  if (weights.length === 0) return [];
  const sum = weights.reduce((acc, w) => acc + (w > 0 ? w : 0), 0);
  if (sum <= 0) {
    const uniform = 1 / weights.length;
    return weights.map(() => uniform);
  }
  return weights.map((w) => (w > 0 ? w / sum : 0));
}

/**
 * Rounds a number to a specified number of decimal places (default 1).
 */
export function roundTo(val: number, decimals: number = 1): number {
  const factor = Math.pow(10, decimals);
  return Math.round(val * factor) / factor;
}

/**
 * Main Pure Engine Function: Solves course status, accumulated points,
 * global passing grade, group minimum requirements, and recovery exam impact.
 *
 * Implements the mathematical modeling defined in Section 5 of CONTEXTO.md:
 * - P_acum = sum(alpha_e * N_e)
 * - alpha_rest = sum_U(alpha_e)
 * - X_global = (55 - P_acum) / alpha_rest
 * - X_grupo_g = (M_g - sum_Kg(w_ge * N_ge)) / sum_Ug(w_ge)
 */
export function solveCourseStatus(
  courseConfig: EnrolledCourseConfig,
  passingTarget: number = 55
): CourseSolveResult {
  const groups = courseConfig.groups || [];

  if (groups.length === 0) {
    return {
      sigla: courseConfig.sigla,
      status: 'FAILED',
      finalGrade: 0,
      accumulatedPoints: 0,
      remainingWeight: 0,
      requiredGlobalGrade: null,
      effectiveRequiredGrade: null,
      bindingConstraint: 'NONE',
      groups: [],
      unknownEvaluations: [],
      message: 'No hay grupos de evaluación configurados para este ramo.',
    };
  }

  // 1. Normalize group weights W_g
  const normalizedGroupWeights = normalizeWeights(groups.map((g) => g.weight));

  let totalAccumulatedPoints = 0;
  let totalRemainingWeight = 0;
  const groupResults: GroupSolveResult[] = [];
  const unknownEvaluations: UnknownEvaluationDetail[] = [];

  // Intermediate storage for recovery exam analysis
  let canUseRecoveryGlobal = false;
  let candidateRecoveryGroupIdx = -1;
  let candidateReplacedEvalId: string | undefined;
  let candidateReplacedScore: number | undefined;

  // 2. Iterate each group to process known grades, recovery substitutions, and unknowns
  for (let gIdx = 0; gIdx < groups.length; gIdx++) {
    const group = groups[gIdx];
    const groupWeight = normalizedGroupWeights[gIdx];
    const evals = group.evaluations || [];

    // Normalize weights within group w_{g,e}
    const normalizedEvalWeights = normalizeWeights(evals.map((e) => e.weight));

    // Identify known evaluations (K_g) and unknowns (U_g)
    const knowns: Array<{ evalIndex: number; score: number; weight: number }> = [];
    const unknowns: Array<{ evalIndex: number; weight: number }> = [];

    for (let eIdx = 0; eIdx < evals.length; eIdx++) {
      const e = evals[eIdx];
      const w = normalizedEvalWeights[eIdx];
      if (e.score !== null && e.score !== undefined && !isNaN(e.score)) {
        knowns.push({ evalIndex: eIdx, score: Number(e.score), weight: w });
      } else {
        unknowns.push({ evalIndex: eIdx, weight: w });
      }
    }

    // Handle Certamen Recuperativo (recovery exam) substitution if applicable
    let recoveryApplied = false;
    let replacedEvaluationId: string | undefined;
    let originalReplacedGrade: number | undefined;

    // Make an effective copy of known scores for calculations
    const effectiveKnowns = knowns.map((k) => ({ ...k }));

    if (group.hasRecoveryExam) {
      canUseRecoveryGlobal = true;
      candidateRecoveryGroupIdx = gIdx;

      // If a recovery exam grade is explicitly registered:
      if (
        group.recoveryGrade !== null &&
        group.recoveryGrade !== undefined &&
        !isNaN(group.recoveryGrade)
      ) {
        const recGrade = Number(group.recoveryGrade);
        if (effectiveKnowns.length > 0) {
          // Find the lowest known score in this group
          let lowestIdx = 0;
          let lowestScore = effectiveKnowns[0].score;

          for (let i = 1; i < effectiveKnowns.length; i++) {
            if (effectiveKnowns[i].score < lowestScore) {
              lowestScore = effectiveKnowns[i].score;
              lowestIdx = i;
            }
          }

          // If recovery grade improves the lowest score, substitute it
          if (recGrade > lowestScore) {
            recoveryApplied = true;
            replacedEvaluationId = evals[effectiveKnowns[lowestIdx].evalIndex].id;
            originalReplacedGrade = lowestScore;
            effectiveKnowns[lowestIdx].score = recGrade;
          }
        }
      } else if (effectiveKnowns.length > 0) {
        // Track candidate for potential recovery scenario
        let minScore = effectiveKnowns[0].score;
        let minId = evals[effectiveKnowns[0].evalIndex].id;
        for (let i = 1; i < effectiveKnowns.length; i++) {
          if (effectiveKnowns[i].score < minScore) {
            minScore = effectiveKnowns[i].score;
            minId = evals[effectiveKnowns[i].evalIndex].id;
          }
        }
        candidateReplacedEvalId = minId;
        candidateReplacedScore = minScore;
      }
    }

    // Group calculations
    const groupKnownWeight = effectiveKnowns.reduce((sum, k) => sum + k.weight, 0);
    const groupUnknownWeight = unknowns.reduce((sum, u) => sum + u.weight, 0);

    const groupKnownPoints = effectiveKnowns.reduce(
      (sum, k) => sum + k.score * k.weight,
      0
    );

    // Current known average for the group
    const currentAverage =
      groupKnownWeight > 0 ? groupKnownPoints / groupKnownWeight : null;

    // Minimum grade constraint check for this group
    const minGrade =
      group.minGrade !== null && group.minGrade !== undefined
        ? Number(group.minGrade)
        : null;

    let requiredGradeForMin: number | null = null;
    let meetsMinGrade = true;

    if (minGrade !== null) {
      if (groupUnknownWeight > 0.0001) {
        // X_{grupo_g} = (M_g - sum_{K_g} w_e * N_e) / sum_{U_g} w_e
        requiredGradeForMin = Math.max(0, (minGrade - groupKnownPoints) / groupUnknownWeight);
        meetsMinGrade = requiredGradeForMin <= 100;
      } else {
        // All evaluations in this group have been taken
        meetsMinGrade = (currentAverage ?? 0) >= minGrade - 0.001;
        requiredGradeForMin = null;
      }
    }

    // Accumulate to global totals
    totalAccumulatedPoints += groupWeight * groupKnownPoints;
    totalRemainingWeight += groupWeight * groupUnknownWeight;

    // Record unknown evaluations with their global weight alpha_e = W_g * w_ge
    for (const u of unknowns) {
      const e = evals[u.evalIndex];
      const alpha_e = groupWeight * u.weight;
      unknownEvaluations.push({
        groupId: group.id,
        groupName: group.name,
        evalId: e.id,
        evalName: e.name,
        weightInGroup: u.weight,
        globalWeight: alpha_e,
        requiredUniformGrade: null, // populated after global solve
      });
    }

    groupResults.push({
      groupId: group.id,
      groupName: group.name,
      groupWeight,
      currentAverage: currentAverage !== null ? roundTo(currentAverage) : null,
      minGradeRequired: minGrade,
      requiredGradeForMin:
        requiredGradeForMin !== null ? roundTo(requiredGradeForMin) : null,
      meetsMinGrade,
      isMinGradeCritical: false, // will flag later if it binds over global
      hasRecoveryExam: !!group.hasRecoveryExam,
      recoveryApplied,
      replacedEvaluationId,
      originalReplacedGrade,
    });
  }

  // 3. Global algebraic solve: X_global = (55 - P_acum) / alpha_rest
  let requiredGlobalGrade: number | null = null;
  if (totalRemainingWeight > 0.0001) {
    requiredGlobalGrade = Math.max(0, (passingTarget - totalAccumulatedPoints) / totalRemainingWeight);
  }

  // 4. Evaluate binding constraints (Global vs Group Minimums)
  let effectiveRequiredGrade: number | null = null;
  let bindingConstraint: 'GLOBAL' | 'GROUP_MIN' | 'NONE' = 'NONE';
  let bindingGroupId: string | undefined;
  let bindingGroupName: string | undefined;

  if (totalRemainingWeight > 0.0001 && requiredGlobalGrade !== null) {
    let maxRequired = requiredGlobalGrade;
    bindingConstraint = 'GLOBAL';

    for (const grp of groupResults) {
      if (grp.minGradeRequired !== null && grp.requiredGradeForMin !== null) {
        if (grp.requiredGradeForMin > maxRequired) {
          maxRequired = grp.requiredGradeForMin;
          bindingConstraint = 'GROUP_MIN';
          bindingGroupId = grp.groupId;
          bindingGroupName = grp.groupName;
          grp.isMinGradeCritical = true;
        }
      }
    }

    effectiveRequiredGrade = Math.max(0, maxRequired);

    // Populate required uniform grade in unknown evaluations
    for (const u of unknownEvaluations) {
      const grp = groupResults.find((g) => g.groupId === u.groupId);
      // If group minimum constraint is higher, that group's evaluations strictly need the group minimum
      if (grp && grp.requiredGradeForMin !== null && grp.requiredGradeForMin > requiredGlobalGrade) {
        u.requiredUniformGrade = roundTo(Math.max(0, grp.requiredGradeForMin));
      } else {
        u.requiredUniformGrade = roundTo(Math.max(0, maxRequired));
      }
    }
  }

  // 5. Recovery scenario analysis
  let recoveryScenario: RecoveryScenario | undefined;
  if (canUseRecoveryGlobal && candidateRecoveryGroupIdx >= 0) {
    const recGroup = groups[candidateRecoveryGroupIdx];
    const recGroupResult = groupResults[candidateRecoveryGroupIdx];

    // Check if recovery is needed (either regular exams require > 100 or group min requires > 100)
    const regularExceeds100 =
      (effectiveRequiredGrade !== null && effectiveRequiredGrade > 100) ||
      (totalRemainingWeight <= 0.0001 &&
        (totalAccumulatedPoints < passingTarget || !recGroupResult.meetsMinGrade));

    if (regularExceeds100 && !recGroupResult.recoveryApplied && candidateReplacedScore !== undefined) {
      // Calculate what recovery grade would be needed to bridge the gap
      // If student gets R in recovery exam, points gained in group = (R - candidateReplacedScore) * evalWeight
      // Global points gained = groupWeight * evalWeight * (R - candidateReplacedScore)
      const evals = recGroup.evaluations || [];
      const replacedEval = evals.find((e) => e.id === candidateReplacedEvalId);
      const replacedWeightNorm = replacedEval
        ? (normalizeWeights(evals.map((e) => e.weight))[evals.indexOf(replacedEval)] || 0.333)
        : 0.333;
      const alpha_rep = recGroupResult.groupWeight * replacedWeightNorm;

      // Suppose student gets 100 in all remaining unknowns. Points needed from recovery:
      const pointsWith100Unknowns = totalAccumulatedPoints + 100 * totalRemainingWeight;
      const deficit = passingTarget - pointsWith100Unknowns;

      let scoreNeeded: number | null = null;
      let possible = false;

      if (deficit <= 0) {
        // Can already pass with unknowns if unknown scores are high enough
        scoreNeeded = null;
        possible = true;
      } else if (alpha_rep > 0.0001) {
        // Deficit = alpha_rep * (R - candidateReplacedScore)
        scoreNeeded = candidateReplacedScore + deficit / alpha_rep;
        possible = scoreNeeded <= 100;
      }

      recoveryScenario = {
        needed: true,
        possible,
        minScoreNeeded: scoreNeeded !== null ? roundTo(Math.max(0, scoreNeeded)) : null,
        replacesEvaluationId: candidateReplacedEvalId,
        originalGrade: candidateReplacedScore,
        description: possible
          ? `Rindiendo el Certamen Recuperativo y obteniendo nota $\\ge$ ${scoreNeeded !== null ? roundTo(scoreNeeded) : '100'}, reemplazas el ${roundTo(candidateReplacedScore)} de ${candidateReplacedEvalId} y puedes aprobar.`
          : 'Matemáticamente imposible aprobar incluso reemplazando la peor nota con 100 en el Recuperativo.',
      };
    }
  }

  // 6. Final Status Detection
  let status: SolverStatus;
  let message = '';

  const roundedAccum = roundTo(totalAccumulatedPoints);
  const allGroupsMet = groupResults.every((g) => g.meetsMinGrade);

  if (totalRemainingWeight <= 0.0001) {
    // 100% of evaluations completed
    if (roundedAccum >= passingTarget && allGroupsMet) {
      status = 'APPROVED';
      message = `¡Ramo Aprobado! Nota final calculada: ${roundedAccum}. Cumple todos los requisitos.`;
    } else if (recoveryScenario?.possible) {
      status = 'REQUIRES_RECOVERY';
      message = `Promedio insuficiente (${roundedAccum}). Requiere certamen recuperativo para aprobar.`;
    } else {
      status = 'FAILED';
      const failedGroup = groupResults.find((g) => !g.meetsMinGrade);
      if (failedGroup) {
        message = `Reprobado por restricción de grupo: ${failedGroup.groupName} promedió ${failedGroup.currentAverage ?? 0} (mínimo exigido: ${failedGroup.minGradeRequired}).`;
      } else {
        message = `Reprobado. Nota final: ${roundedAccum} (mínimo de aprobación: ${passingTarget}).`;
      }
    }
  } else {
    // Unknown evaluations still remain
    // Check if mathematically approved with 0 in all remaining
    const minPossiblePoints = totalAccumulatedPoints;
    const minPossibleAllGroups = groupResults.every((g) => {
      if (g.minGradeRequired === null) return true;
      return (g.requiredGradeForMin ?? 0) <= 0;
    });

    if (minPossiblePoints >= passingTarget && minPossibleAllGroups) {
      status = 'APPROVED';
      message = `¡Matemáticamente Aprobado! Tienes ${roundedAccum} pts acumulados. Aún sacando 0 en lo restante apruebas el ramo.`;
    } else {
      // Check maximum possible points with 100 in all remaining
      const maxPossiblePoints = totalAccumulatedPoints + 100 * totalRemainingWeight;
      const canMeetAllGroupsWith100 = groupResults.every((g) => {
        if (g.minGradeRequired === null) return true;
        return (g.requiredGradeForMin ?? 0) <= 100;
      });

      if (maxPossiblePoints < passingTarget || !canMeetAllGroupsWith100) {
        if (recoveryScenario?.possible) {
          status = 'REQUIRES_RECOVERY';
          message = `Las notas requeridas superan 100. Necesitas rendir el Certamen Recuperativo para tener opción de aprobar.`;
        } else {
          status = 'FAILED';
          message = `Matemáticamente imposible aprobar el ramo, incluso obteniendo 100 en todas las evaluaciones restantes.`;
        }
      } else {
        // Achievable with grades between 0 and 100
        const reqGrade = effectiveRequiredGrade !== null ? roundTo(effectiveRequiredGrade) : 0;

        if (reqGrade > 80) {
          status = 'IN_DANGER';
          if (bindingConstraint === 'GROUP_MIN') {
            message = `¡Atención! Restricción crítica en ${bindingGroupName}: necesitas promediar al menos ${reqGrade} en evaluaciones restantes para cumplir el mínimo de ${groupResults.find((g) => g.groupId === bindingGroupId)?.minGradeRequired}.`;
          } else {
            message = `Exigencia alta: Tienes ${roundedAccum} pts. Necesitas promediar ${reqGrade} en las evaluaciones restantes para alcanzar la nota 55.`;
          }
        } else {
          status = 'ON_TRACK';
          if (bindingConstraint === 'GROUP_MIN') {
            message = `Tienes ${roundedAccum} pts asegurados. Para cumplir el promedio mínimo de ${bindingGroupName} necesitas promediar al menos ${reqGrade} en lo restante.`;
          } else {
            const unknownCount = unknownEvaluations.length;
            const evalNames = unknownEvaluations.map((u) => u.evalName).join(', ');
            message = `Tienes ${roundedAccum} pts asegurados. Necesitas promediar ${reqGrade} en ${unknownCount > 1 ? `[${evalNames}]` : evalNames} para aprobar el ramo (NF $\\ge$ 55).`;
          }
        }
      }
    }
  }

  return {
    sigla: courseConfig.sigla,
    status,
    finalGrade: roundedAccum,
    accumulatedPoints: roundedAccum,
    remainingWeight: roundTo(totalRemainingWeight, 4),
    requiredGlobalGrade:
      requiredGlobalGrade !== null ? roundTo(requiredGlobalGrade) : null,
    effectiveRequiredGrade:
      effectiveRequiredGrade !== null ? roundTo(effectiveRequiredGrade) : null,
    bindingConstraint,
    bindingGroupId,
    bindingGroupName,
    groups: groupResults,
    unknownEvaluations,
    recoveryScenario,
    message,
  };
}

/**
 * Rebalances interactive sliders when a student manipulates hypothetical grades.
 *
 * Given a set of fixed slider values for some unknowns, redistributes the remaining
 * required points among the unfixed unknowns so that simulated NF = 55 (or reports feasibility).
 */
export function rebalanceSliders(
  courseConfig: EnrolledCourseConfig,
  fixedValues: Record<string, number>, // evalId -> hypothetical score (0 to 100)
  passingTarget: number = 55
): SliderRebalanceResult {
  const baseResult = solveCourseStatus(courseConfig, passingTarget);
  const unknowns = baseResult.unknownEvaluations;

  if (unknowns.length === 0) {
    return {
      simulatedFinalGrade: baseResult.finalGrade,
      simulatedAccumulatedPoints: baseResult.accumulatedPoints,
      remainingWeight: 0,
      otherUnknownsRequiredGrade: null,
      values: {},
      isFeasible: baseResult.status !== 'FAILED',
      meetsAllConstraints: baseResult.status === 'APPROVED',
      groupAverages: {},
    };
  }

  // Separate fixed unknowns vs free unknowns
  let pointsFromFixed = 0;
  let remainingFreeWeight = 0;
  const freeUnknowns: UnknownEvaluationDetail[] = [];
  const currentValues: Record<string, number> = {};

  for (const u of unknowns) {
    if (fixedValues[u.evalId] !== undefined) {
      const fixedScore = Math.max(0, Math.min(100, Number(fixedValues[u.evalId])));
      currentValues[u.evalId] = fixedScore;
      pointsFromFixed += u.globalWeight * fixedScore;
    } else {
      freeUnknowns.push(u);
      remainingFreeWeight += u.globalWeight;
    }
  }

  const basePoints = baseResult.accumulatedPoints;
  const totalSimulatedPoints = basePoints + pointsFromFixed;
  const pointsNeeded = passingTarget - totalSimulatedPoints;

  let otherUnknownsRequiredGrade: number | null = null;
  if (remainingFreeWeight > 0.0001) {
    otherUnknownsRequiredGrade = roundTo(pointsNeeded / remainingFreeWeight);
    // Assign the required grade to each free unknown
    for (const free of freeUnknowns) {
      currentValues[free.evalId] = Math.max(0, Math.min(100, otherUnknownsRequiredGrade));
    }
  }

  // Calculate simulated group averages and verify constraints
  const groupAverages: Record<string, number> = {};
  let meetsAllConstraints = true;
  let bindingConstraintDescription: string | undefined;

  for (const group of courseConfig.groups) {
    const evalWeights = normalizeWeights(group.evaluations.map((e) => e.weight));

    let groupPoints = 0;
    for (let i = 0; i < group.evaluations.length; i++) {
      const e = group.evaluations[i];
      const w = evalWeights[i];
      let score = 0;

      if (e.score !== null && e.score !== undefined && !isNaN(e.score)) {
        score = Number(e.score);
      } else if (currentValues[e.id] !== undefined) {
        score = currentValues[e.id];
      }

      groupPoints += score * w;
    }

    groupAverages[group.id] = roundTo(groupPoints);

    if (group.minGrade !== null && group.minGrade !== undefined) {
      if (groupPoints < group.minGrade - 0.05) {
        meetsAllConstraints = false;
        bindingConstraintDescription = `Promedio de ${group.name} (${roundTo(groupPoints)}) es menor al mínimo exigido (${group.minGrade}).`;
      }
    }
  }

  // Total simulated final grade
  let simulatedFinalGrade = 0;
  for (const group of courseConfig.groups) {
    const groupWeight = normalizeWeights(courseConfig.groups.map((g) => g.weight))[
      courseConfig.groups.indexOf(group)
    ];
    simulatedFinalGrade += groupWeight * (groupAverages[group.id] || 0);
  }

  const isFeasible =
    (otherUnknownsRequiredGrade === null || otherUnknownsRequiredGrade <= 100) &&
    meetsAllConstraints;

  return {
    simulatedFinalGrade: roundTo(simulatedFinalGrade),
    simulatedAccumulatedPoints: roundTo(totalSimulatedPoints),
    remainingWeight: roundTo(remainingFreeWeight, 4),
    otherUnknownsRequiredGrade,
    values: currentValues,
    isFeasible,
    meetsAllConstraints,
    groupAverages,
    bindingConstraintDescription,
  };
}

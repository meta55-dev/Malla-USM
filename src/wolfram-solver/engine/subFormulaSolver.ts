import {
  SubFormulaBlock,
  CourseFinalFormula,
  PiecewiseAlphaRule,
  SubFormulaCourseSolveResult,
  SubFormulaBlockSolveResult,
  SubFormulaSolverStatus,
} from '@/shared/types/academic';

/**
 * Rounds a number to a specified number of decimal places (default 1).
 */
export function roundTo(val: number, decimals: number = 1): number {
  const factor = Math.pow(10, decimals);
  return Math.round(val * factor) / factor;
}

/**
 * Computes the dynamic weight α(PC) for USM Informática piecewise formulas
 * (e.g., INF-245, INF-256):
 *   α = 0          if PC <= minThreshold (30)
 *   α = maxAlpha   if PC >= maxThreshold (60)
 *   α = maxAlpha * (PC - minThreshold) / (maxThreshold - minThreshold)  otherwise
 */
export function computePiecewiseAlpha(
  baseScore: number,
  rule: PiecewiseAlphaRule
): number {
  const minT = rule.minThreshold ?? 30;
  const maxT = rule.maxThreshold ?? 60;
  const maxA = rule.maxAlpha ?? 0.3;
  if (baseScore <= minT) return 0;
  if (baseScore >= maxT) return maxA;
  if (maxT <= minT) return maxA;
  return maxA * ((baseScore - minT) / (maxT - minT));
}

/**
 * Normalizes an array of weights (supports percentages e.g. [10, 45, 45] or decimals [0.1, 0.45, 0.45]).
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

export interface BlockEvaluationBreakdown {
  average: number | null;
  rawAverage: number | null;
  effectiveBonus: number;
  droppedScores: number[];
  usedScores: number[];
  knownCount: number;
  unknownCount: number;
}

/**
 * Computes the effective bonus points added to a block's average (0-100 scale):
 * - bonusPoints: direct points added to the block average (e.g. +3 pts to PC).
 * - evalBonusPoints: points added to a single evaluation/certamen in the block,
 *   which contributes (evalBonusPoints / usedEvaluationsCount) to the block average.
 */
export function computeEffectiveBlockBonus(block: SubFormulaBlock): number {
  const directBonus = Number(block.bonusPoints) || 0;
  const evalBonus = Number(block.evalBonusPoints) || 0;
  const totalCount = Math.max(
    1,
    block.count || (block.evaluations ? block.evaluations.length : 1)
  );
  const dropWorst =
    block.type === 'drop_worst' ? Math.max(0, block.dropWorstCount || 0) : 0;
  const usedCount = Math.max(1, totalCount - dropWorst);
  return directBonus + evalBonus / usedCount;
}

function applyBlockBonus(
  rawAverage: number | null,
  effectiveBonus: number,
  treatEmptyAsZero: boolean
): number | null {
  if (rawAverage === null) {
    if (treatEmptyAsZero && effectiveBonus !== 0) {
      return Math.min(100, Math.max(0, effectiveBonus));
    }
    return null;
  }
  return Math.min(100, Math.max(0, rawAverage + effectiveBonus));
}

/**
 * Computes detailed evaluation breakdown for a sub-formula block.
 */
export function computeBlockDetails(
  block: SubFormulaBlock,
  treatEmptyAsZero: boolean = false
): BlockEvaluationBreakdown {
  const evals = block.evaluations || [];
  const totalCount = block.count || evals.length;
  const dropWorst = Math.max(0, block.dropWorstCount || 0);
  const effectiveBonus = computeEffectiveBlockBonus(block);

  const knownScores: number[] = [];
  let unknownCount = 0;

  for (const ev of evals) {
    if (ev.score !== null && ev.score !== undefined && !isNaN(ev.score)) {
      knownScores.push(Number(ev.score));
    } else {
      unknownCount++;
      if (treatEmptyAsZero) {
        knownScores.push(0);
      }
    }
  }

  const knownCount = evals.length - unknownCount;

  // If no known scores and empty values are not treated as zero, average is null
  if (!treatEmptyAsZero && knownScores.length === 0) {
    return {
      average: effectiveBonus > 0 ? Math.min(100, effectiveBonus) : null,
      rawAverage: null,
      effectiveBonus,
      droppedScores: [],
      usedScores: [],
      knownCount: 0,
      unknownCount,
    };
  }

  // 1. Simple Average
  if (block.type === 'simple_average') {
    if (knownScores.length === 0) {
      return {
        average: applyBlockBonus(null, effectiveBonus, treatEmptyAsZero),
        rawAverage: null,
        effectiveBonus,
        droppedScores: [],
        usedScores: [],
        knownCount,
        unknownCount,
      };
    }
    const sum = knownScores.reduce((a, b) => a + b, 0);
    const rawAverage = sum / knownScores.length;
    return {
      average: applyBlockBonus(rawAverage, effectiveBonus, treatEmptyAsZero),
      rawAverage,
      effectiveBonus,
      droppedScores: [],
      usedScores: [...knownScores],
      knownCount,
      unknownCount,
    };
  }

  // 2. Drop Worst K scores
  if (block.type === 'drop_worst') {
    if (knownScores.length === 0) {
      return {
        average: applyBlockBonus(null, effectiveBonus, treatEmptyAsZero),
        rawAverage: null,
        effectiveBonus,
        droppedScores: [],
        usedScores: [],
        knownCount,
        unknownCount,
      };
    }

    const sorted = [...knownScores].sort((a, b) => a - b);

    if (treatEmptyAsZero) {
      // With empty as zero, all evaluations exist (unknowns are 0)
      const dropsAllowed = Math.min(dropWorst, Math.max(0, sorted.length - 1));
      const dropped = sorted.slice(0, dropsAllowed);
      const used = sorted.slice(dropsAllowed);
      const sum = used.reduce((a, b) => a + b, 0);
      const rawAverage = used.length > 0 ? sum / used.length : null;
      return {
        average: applyBlockBonus(rawAverage, effectiveBonus, treatEmptyAsZero),
        rawAverage,
        effectiveBonus,
        droppedScores: dropped,
        usedScores: used,
        knownCount,
        unknownCount,
      };
    } else {
      // Partial progress without zero-fill:
      // Drop lowest K only if at least (count - dropWorstCount) evaluations have been taken
      const requiredToDrop = Math.max(1, totalCount - dropWorst);
      if (knownScores.length >= requiredToDrop && dropWorst > 0) {
        const dropsAllowed = Math.min(dropWorst, Math.max(0, sorted.length - 1));
        const dropped = sorted.slice(0, dropsAllowed);
        const used = sorted.slice(dropsAllowed);
        const sum = used.reduce((a, b) => a + b, 0);
        const rawAverage = used.length > 0 ? sum / used.length : null;
        return {
          average: applyBlockBonus(rawAverage, effectiveBonus, treatEmptyAsZero),
          rawAverage,
          effectiveBonus,
          droppedScores: dropped,
          usedScores: used,
          knownCount,
          unknownCount,
        };
      } else {
        // Not enough evaluations taken yet to drop worst: average all known scores
        const sum = sorted.reduce((a, b) => a + b, 0);
        const rawAverage = sum / sorted.length;
        return {
          average: applyBlockBonus(rawAverage, effectiveBonus, treatEmptyAsZero),
          rawAverage,
          effectiveBonus,
          droppedScores: [],
          usedScores: sorted,
          knownCount,
          unknownCount,
        };
      }
    }
  }

  // 3. Weighted within block
  if (block.type === 'weighted') {
    let weightSum = 0;
    let pointSum = 0;
    const used: number[] = [];

    for (const ev of evals) {
      const isKnown = ev.score !== null && ev.score !== undefined && !isNaN(ev.score);
      const w = ev.weight > 0 ? ev.weight : 1;
      if (isKnown) {
        const score = Number(ev.score);
        pointSum += w * score;
        weightSum += w;
        used.push(score);
      } else if (treatEmptyAsZero) {
        weightSum += w;
        used.push(0);
      }
    }

    if (weightSum <= 0) {
      return {
        average: applyBlockBonus(null, effectiveBonus, treatEmptyAsZero),
        rawAverage: null,
        effectiveBonus,
        droppedScores: [],
        usedScores: [],
        knownCount,
        unknownCount,
      };
    }

    const rawAverage = pointSum / weightSum;
    return {
      average: applyBlockBonus(rawAverage, effectiveBonus, treatEmptyAsZero),
      rawAverage,
      effectiveBonus,
      droppedScores: [],
      usedScores: used,
      knownCount,
      unknownCount,
    };
  }

  return {
    average: null,
    rawAverage: null,
    effectiveBonus,
    droppedScores: [],
    usedScores: [],
    knownCount,
    unknownCount,
  };
}

/**
 * Pure function: Computes current average of a sub-formula block.
 * - simple_average: average of known grades. If all empty, returns null.
 * - drop_worst: drops lowest K grades if at least (count - dropWorstCount) knowns exist.
 * - weighted: normalized weighted sum of known evaluations.
 * If treatEmptyAsZero is true, unknown scores are treated as 0.
 */
export function computeBlockAverage(
  block: SubFormulaBlock,
  treatEmptyAsZero: boolean = false
): number | null {
  const breakdown = computeBlockDetails(block, treatEmptyAsZero);
  return breakdown.average !== null ? roundTo(breakdown.average, 2) : null;
}

/**
 * Helper: Computes the simulated average of a block if ALL unknown evaluations
 * within this block receive uniform score X.
 */
export function computeBlockAverageWithScore(
  block: SubFormulaBlock,
  uniformUnknownScore: number,
  clampTo100: boolean = true
): number {
  const evals = block.evaluations || [];
  const totalCount = block.count || evals.length;
  const dropWorst = Math.max(0, block.dropWorstCount || 0);
  const effectiveBonus = computeEffectiveBlockBonus(block);

  const scores: number[] = [];
  for (const ev of evals) {
    if (ev.score !== null && ev.score !== undefined && !isNaN(ev.score)) {
      scores.push(Number(ev.score));
    } else {
      scores.push(uniformUnknownScore);
    }
  }

  if (scores.length === 0) return Math.min(100, Math.max(0, effectiveBonus));

  let rawAvg = 0;

  if (block.type === 'simple_average') {
    const sum = scores.reduce((a, b) => a + b, 0);
    rawAvg = sum / scores.length;
  } else if (block.type === 'drop_worst') {
    const sorted = [...scores].sort((a, b) => a - b);
    const dropsAllowed = Math.min(dropWorst, Math.max(0, totalCount - 1));
    const used = sorted.slice(dropsAllowed);
    const sum = used.reduce((a, b) => a + b, 0);
    rawAvg = used.length > 0 ? sum / used.length : 0;
  } else if (block.type === 'weighted') {
    const weights = normalizeWeights(evals.map((e) => e.weight));
    let sum = 0;
    for (let i = 0; i < scores.length; i++) {
      sum += weights[i] * scores[i];
    }
    rawAvg = sum;
  }

  const withBonus = rawAvg + effectiveBonus;
  return clampTo100
    ? Math.min(100, Math.max(0, withBonus))
    : Math.max(0, withBonus);
}

/**
 * Algebraic Clearance: Solves for uniform score X in unknown evaluations of a single block
 * needed to satisfy the block's minimum threshold (A_b(X) >= targetMin).
 * Returns:
 * - 0 if already satisfied even with 0 in all unknowns.
 * - Required score X (can be > 100 if mathematically impossible under normal scale).
 * - null if the block has no unknowns and already fails/passes.
 */
export function solveBlockRequiredGrade(
  block: SubFormulaBlock,
  targetMin: number
): number | null {
  const evals = block.evaluations || [];
  const unknownCount = evals.filter(
    (e) => e.score === null || e.score === undefined || isNaN(e.score)
  ).length;
  const effectiveBonus = computeEffectiveBlockBonus(block);
  const adjustedTargetMin = Math.max(0, targetMin - effectiveBonus);

  if (unknownCount === 0) {
    const current = computeBlockAverage(block, true) ?? 0;
    return current >= targetMin ? 0 : null; // null indicates no clearance possible (fixed outcome)
  }

  // Check if 0 is already sufficient
  const avgAt0 = computeBlockAverageWithScore(block, 0);
  if (avgAt0 >= targetMin) {
    return 0;
  }

  // Analytical clearance for simple_average: (sum(known) + U*X) / N >= adjustedTargetMin
  if (block.type === 'simple_average') {
    const N = evals.length;
    const knownSum = evals
      .filter((e) => e.score !== null && e.score !== undefined && !isNaN(e.score))
      .reduce((acc, e) => acc + Number(e.score), 0);
    const needed = (N * adjustedTargetMin - knownSum) / unknownCount;
    return roundTo(needed, 2);
  }

  // Analytical clearance for weighted: (knownPoints + sum(U_w)*X) / totalW >= adjustedTargetMin
  if (block.type === 'weighted') {
    const normalizedEvalWeights = normalizeWeights(evals.map((e) => e.weight));
    let knownPoints = 0;
    let unknownWeight = 0;
    evals.forEach((e, idx) => {
      const w = normalizedEvalWeights[idx];
      if (e.score !== null && e.score !== undefined && !isNaN(e.score)) {
        knownPoints += w * Number(e.score);
      } else {
        unknownWeight += w;
      }
    });

    if (unknownWeight <= 0) return null;
    const needed = (adjustedTargetMin - knownPoints) / unknownWeight;
    return roundTo(needed, 2);
  }

  // Bisection search for piecewise linear drop_worst:
  let low = 0;
  let high = 300; // allow searching beyond 100 to detect impossible requirements cleanly

  for (let iter = 0; iter < 40; iter++) {
    const mid = (low + high) / 2;
    const val = computeBlockAverageWithScore(block, mid);
    if (val >= targetMin) {
      high = mid;
    } else {
      low = mid;
    }
  }

  return roundTo(high, 2);
}

/**
 * Helper: Solves the uniform score X required across ALL course unknowns
 * to reach the global passing grade (formulaFinalGrade >= passingGrade),
 * without considering block sudden-death minimums.
 */
export function solveGlobalFormulaUniformGrade(
  config: CourseFinalFormula,
  passingGrade: number
): number | null {
  const blocks = config.subFormulas || [];
  const normalizedWeights = normalizeWeights(blocks.map((b) => b.weightInFinal));
  const pwRule = config.piecewiseAlpha;
  const multiplier =
    config.finalGradeMultiplier && config.finalGradeMultiplier > 0
      ? config.finalGradeMultiplier
      : 1;
  const globalBonus = Number(config.finalGradeBonusPoints) || 0;

  const baseIdx = pwRule
    ? blocks.findIndex(
        (b) => b.code.toUpperCase() === pwRule.baseBlockCode.toUpperCase()
      )
    : -1;
  const targetIdx = pwRule
    ? blocks.findIndex(
        (b) => b.code.toUpperCase() === pwRule.targetBlockCode.toUpperCase()
      )
    : -1;

  // Count total unknowns across entire course
  let totalUnknowns = 0;
  for (const block of blocks) {
    const u = (block.evaluations || []).filter(
      (e) => e.score === null || e.score !== null && isNaN(e.score) || e.score === undefined
    ).length;
    totalUnknowns += u;
  }

  // Function to evaluate global formula with uniform score X
  const evalFormulaWithX = (X: number): number => {
    let baseNf = 0;
    if (pwRule && baseIdx !== -1 && targetIdx !== -1) {
      const pc = computeBlockAverageWithScore(blocks[baseIdx], X, false);
      const pt = computeBlockAverageWithScore(blocks[targetIdx], X, false);
      const alpha = computePiecewiseAlpha(pc, pwRule);
      baseNf = pc * (1 - alpha) + alpha * pt;
    } else {
      for (let i = 0; i < blocks.length; i++) {
        const w = normalizedWeights[i];
        const avg = computeBlockAverageWithScore(blocks[i], X, false);
        baseNf += w * avg;
      }
    }
    const finalVal = baseNf * multiplier + globalBonus;
    return Math.max(0, finalVal);
  };

  if (totalUnknowns === 0) {
    const finalGrade = evalFormulaWithX(0);
    return finalGrade >= passingGrade ? 0 : null;
  }

  if (evalFormulaWithX(0) >= passingGrade) {
    return 0;
  }

  // If even score 300 cannot reach passing grade, it is mathematically impossible
  if (evalFormulaWithX(300) < passingGrade) {
    return null;
  }

  // Bisection search on [0, 300]
  let low = 0;
  let high = 300;

  for (let iter = 0; iter < 40; iter++) {
    const mid = (low + high) / 2;
    const nf = evalFormulaWithX(mid);
    if (nf >= passingGrade) {
      high = mid;
    } else {
      low = mid;
    }
  }

  return roundTo(high, 2);
}

/**
 * Pure Mathematical Engine: Solves Sub-Formula Course Status.
 *
 * Implements:
 * 1. Current average of each sub-formula block (drop worst, simple, weighted).
 * 2. Minimum threshold satisfaction per block (e.g. >= 50 or >= 60).
 * 3. Piecewise dynamic weight α(PC) (e.g. INF-245, INF-256).
 * 4. USM Penalty Condition:
 *    IF all blocks with minGrade >= minGrade THEN NF = formula ELSE NF = min(block averages).
 * 5. Algebraic clearance:
 *    - X_block: uniform grade needed in empty evaluations of block b to reach M_b.
 *    - X_global: uniform grade needed across all empty evaluations to reach NF >= 55.
 *    - X_effective: max(X_global, max_b(X_block)).
 * 6. Binding condition detection ('GLOBAL' | 'BLOCK_MIN' | 'NONE').
 * 7. Academic status ('APPROVED' | 'ON_TRACK' | 'IN_DANGER' | 'REQUIRES_PERFECT' | 'FAILED').
 */
export function solveSubFormulaCourse(
  config: CourseFinalFormula,
  passingGradeOverride?: number
): SubFormulaCourseSolveResult {
  const passingGrade = passingGradeOverride ?? config.passingGrade ?? 55;
  const blocks = config.subFormulas || [];
  const normalizedBlockWeights = normalizeWeights(blocks.map((b) => b.weightInFinal));
  const pwRule = config.piecewiseAlpha;
  const multiplier =
    config.finalGradeMultiplier && config.finalGradeMultiplier > 0
      ? config.finalGradeMultiplier
      : 1;
  const globalBonus = Number(config.finalGradeBonusPoints) || 0;

  // 1. Solve each block independently
  const blockResults: SubFormulaBlockSolveResult[] = [];
  let totalUnknowns = 0;

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const weightInFinal = normalizedBlockWeights[i];
    const breakdown = computeBlockDetails(block, false);
    const zeroFilledBreakdown = computeBlockDetails(block, true);

    const minGrade = block.minGradeRequired ?? null;
    const knownCount = breakdown.knownCount;
    const unknownCount = breakdown.unknownCount;
    totalUnknowns += unknownCount;

    const currentAvg = breakdown.average !== null ? roundTo(breakdown.average, 2) : null;
    const rawAvg = breakdown.rawAverage !== null ? roundTo(breakdown.rawAverage, 2) : null;
    const effectiveBonus = roundTo(breakdown.effectiveBonus, 2);
    const projectedWithZero = roundTo(zeroFilledBreakdown.average ?? 0, 2);

    let requiredForBlockMin: number | null = null;
    if (minGrade !== null) {
      requiredForBlockMin = solveBlockRequiredGrade(block, minGrade);
    }

    const meetsMin =
      minGrade === null
        ? true
        : currentAvg !== null
        ? currentAvg >= minGrade
        : false;

    blockResults.push({
      blockId: block.id,
      blockCode: block.code,
      blockName: block.name,
      type: block.type,
      weightInFinal: roundTo(weightInFinal, 4),
      minGradeRequired: minGrade,
      currentAverage: currentAvg,
      rawAverage: rawAvg,
      effectiveBonusPoints: effectiveBonus,
      projectedAverageWithZero: projectedWithZero,
      requiredForBlockMin,
      meetsMinGrade: meetsMin,
      isMinGradeCritical: false,
      knownCount,
      unknownCount,
      droppedScores: breakdown.droppedScores,
    });
  }

  // 2. Compute current final grade (supporting piecewise α(PC), multiplier & bonus points)
  let baseFormulaFinalGrade = 0;
  let hasAnyEvaluatedBlock = false;
  let dynamicAlpha: number | null = null;
  const currentBlockAveragesForPenalty: number[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const bResult = blockResults[i];
    currentBlockAveragesForPenalty.push(bResult.currentAverage ?? 0);
  }

  const baseIdx = pwRule
    ? blocks.findIndex(
        (b) => b.code.toUpperCase() === pwRule.baseBlockCode.toUpperCase()
      )
    : -1;
  const targetIdx = pwRule
    ? blocks.findIndex(
        (b) => b.code.toUpperCase() === pwRule.targetBlockCode.toUpperCase()
      )
    : -1;

  if (pwRule && baseIdx !== -1 && targetIdx !== -1) {
    const baseAvg = blockResults[baseIdx].currentAverage;
    const targetAvg = blockResults[targetIdx].currentAverage;

    if (baseAvg !== null) {
      hasAnyEvaluatedBlock = true;
      const alpha = computePiecewiseAlpha(baseAvg, pwRule);
      dynamicAlpha = roundTo(alpha, 3);
      blockResults[baseIdx].weightInFinal = roundTo(1 - alpha, 4);
      blockResults[targetIdx].weightInFinal = roundTo(alpha, 4);

      if (targetAvg !== null) {
        baseFormulaFinalGrade = baseAvg * (1 - alpha) + alpha * targetAvg;
      } else {
        baseFormulaFinalGrade = baseAvg;
      }
    } else {
      dynamicAlpha = roundTo(pwRule.maxAlpha ?? 0.3, 3);
      if (targetAvg !== null) {
        hasAnyEvaluatedBlock = true;
        baseFormulaFinalGrade = targetAvg;
      }
    }
  } else {
    let knownWeightedSum = 0;
    let knownWeightSum = 0;

    for (let i = 0; i < blocks.length; i++) {
      const bResult = blockResults[i];
      const w = normalizedBlockWeights[i];
      if (bResult.currentAverage !== null) {
        knownWeightedSum += w * bResult.currentAverage;
        knownWeightSum += w;
        hasAnyEvaluatedBlock = true;
      }
    }

    baseFormulaFinalGrade =
      knownWeightSum > 0 ? knownWeightedSum / knownWeightSum : 0;
  }

  const formulaFinalGrade =
    hasAnyEvaluatedBlock || globalBonus > 0
      ? roundTo(
          Math.min(100, Math.max(0, baseFormulaFinalGrade * multiplier + globalBonus)),
          2
        )
      : 0;

  // Compute guaranteed minimum possible grade (with 0 in all remaining unknowns)
  let baseMinPossiblePoints = 0;
  if (pwRule && baseIdx !== -1 && targetIdx !== -1) {
    const pc0 = blockResults[baseIdx].projectedAverageWithZero;
    const pt0 = blockResults[targetIdx].projectedAverageWithZero;
    const alpha0 = computePiecewiseAlpha(pc0, pwRule);
    baseMinPossiblePoints = pc0 * (1 - alpha0) + alpha0 * pt0;
  } else {
    baseMinPossiblePoints = blockResults.reduce(
      (acc, b, idx) => acc + normalizedBlockWeights[idx] * b.projectedAverageWithZero,
      0
    );
  }
  const minPossiblePoints = roundTo(
    Math.min(100, Math.max(0, baseMinPossiblePoints * multiplier + globalBonus)),
    2
  );

  // 3. Evaluate USM Penalty Rule
  const penaltyRuleApplies =
    !!config.applyPenaltyRule && blocks.some((b) => b.minGradeRequired !== null);

  let isPenaltyTriggered = false;
  let penaltyGrade: number | null = null;

  if (penaltyRuleApplies) {
    const definitelyFailingBlock = blockResults.find(
      (b) =>
        b.minGradeRequired !== null &&
        b.unknownCount === 0 &&
        b.currentAverage !== null &&
        b.currentAverage < b.minGradeRequired
    );
    if (definitelyFailingBlock) {
      isPenaltyTriggered = true;
      const failingBlockAverages = blockResults
        .filter((b) => b.minGradeRequired !== null && b.currentAverage !== null)
        .map((b) => b.currentAverage!);
      const minBlockAvg = failingBlockAverages.length > 0
        ? Math.min(...failingBlockAverages)
        : formulaFinalGrade;
      penaltyGrade = roundTo(minBlockAvg, 2);
    }
  }

  const currentFinalGrade =
    isPenaltyTriggered && penaltyGrade !== null ? penaltyGrade : formulaFinalGrade;

  // 4. Algebraic Clearance: Global grade vs Block minimums
  const requiredGlobalGrade = solveGlobalFormulaUniformGrade(config, passingGrade);

  let effectiveRequiredGrade: number | null = null;
  let bindingCondition: 'GLOBAL' | 'BLOCK_MIN' | 'NONE' = 'NONE';
  let bindingBlockCode: string | undefined;
  let bindingBlockName: string | undefined;

  if (totalUnknowns > 0) {
    let maxRequired = requiredGlobalGrade ?? 0;
    bindingCondition = maxRequired > 0 ? 'GLOBAL' : 'NONE';

    for (const bResult of blockResults) {
      if (bResult.minGradeRequired !== null && bResult.requiredForBlockMin !== null) {
        if (bResult.requiredForBlockMin > maxRequired) {
          maxRequired = bResult.requiredForBlockMin;
          bindingCondition = 'BLOCK_MIN';
          bindingBlockCode = bResult.blockCode;
          bindingBlockName = bResult.blockName;
          bResult.isMinGradeCritical = true;
        }
      }
    }

    effectiveRequiredGrade = roundTo(maxRequired, 2);
  }

  // 5. Status Determination & Diagnostic Message
  let status: SubFormulaSolverStatus = 'ON_TRACK';
  let diagnosticMessage = '';

  if (totalUnknowns === 0) {
    const allMinsMet = blockResults.every((b) => {
      if (b.minGradeRequired === null) return true;
      return (b.currentAverage ?? 0) >= b.minGradeRequired;
    });

    if (currentFinalGrade >= passingGrade && allMinsMet) {
      status = 'APPROVED';
      diagnosticMessage = `¡Ramo Aprobado! Nota final: ${currentFinalGrade} (cumple todos los mínimos exigidos).`;
    } else {
      status = 'FAILED';
      if (isPenaltyTriggered) {
        const failed = blockResults.find(
          (b) => b.minGradeRequired !== null && b.currentAverage === penaltyGrade
        ) || blockResults.find(
          (b) => b.minGradeRequired !== null && (b.currentAverage ?? 0) < b.minGradeRequired
        );
        diagnosticMessage = `Reprobado por regla de penalización USM y requisito de aprobación: ${failed?.blockName} (${failed?.blockCode}) promedió ${failed?.currentAverage ?? 0} (mínimo exigido: ${failed?.minGradeRequired}). Nota final penalizada: ${currentFinalGrade}.`;
      } else {
        diagnosticMessage = `Reprobado. Nota final: ${currentFinalGrade} (mínimo de aprobación: ${passingGrade}).`;
      }
    }
  } else {
    const req = effectiveRequiredGrade ?? 0;

    const allMinsMetWithZero = blockResults.every((b) => {
      if (b.minGradeRequired === null) return true;
      if (b.requiredForBlockMin === null) {
        return (b.currentAverage ?? 0) >= b.minGradeRequired;
      }
      return b.requiredForBlockMin <= 0;
    });

    if (minPossiblePoints >= passingGrade && allMinsMetWithZero) {
      status = 'APPROVED';
      bindingCondition = 'NONE';
      effectiveRequiredGrade = 0;
      diagnosticMessage = `¡Matemáticamente Aprobado! Tienes ${roundTo(minPossiblePoints, 1)} asegurado. Aún obteniendo 0 en lo restante apruebas el ramo.`;
    } else if (req > 100) {
      status = 'REQUIRES_PERFECT';
      if (bindingCondition === 'BLOCK_MIN') {
        const minReq = blockResults.find((b) => b.blockCode === bindingBlockCode)?.minGradeRequired;
        diagnosticMessage = `Exigencia extrema: ${bindingBlockName} (${bindingBlockCode}) requiere ${req} (> 100) para cumplir el mínimo de ${minReq}.`;
      } else {
        diagnosticMessage = `Exigencia extrema: Se requiere promediar ${req} (> 100) en evaluaciones restantes para alcanzar la nota ${passingGrade}.`;
      }
    } else if (req > 80) {
      status = 'IN_DANGER';
      if (bindingCondition === 'BLOCK_MIN') {
        const minReq = blockResults.find((b) => b.blockCode === bindingBlockCode)?.minGradeRequired;
        diagnosticMessage = `¡En Peligro! Restricción crítica en ${bindingBlockName} (${bindingBlockCode}): necesitas promediar al menos ${req} para cumplir el mínimo de ${minReq}.`;
      } else {
        diagnosticMessage = `¡En Peligro! Necesitas promediar ${req} en las evaluaciones restantes para alcanzar la nota de aprobación ${passingGrade}.`;
      }
    } else {
      status = 'ON_TRACK';
      if (bindingCondition === 'BLOCK_MIN') {
        const minReq = blockResults.find((b) => b.blockCode === bindingBlockCode)?.minGradeRequired;
        diagnosticMessage = `En curso. Condición vinculante: ${bindingBlockName} (${bindingBlockCode}) exige promediar al menos ${req} en sus evaluaciones restantes para asegurar el mínimo de ${minReq}.`;
      } else {
        diagnosticMessage = `En curso. Necesitas promediar ${req} en las evaluaciones restantes para aprobar el ramo (NF >= ${passingGrade}).`;
      }
    }
  }

  return {
    status,
    currentFinalGrade,
    formulaFinalGrade,
    minPossibleGrade: minPossiblePoints,
    dynamicAlpha,
    finalGradeMultiplier: multiplier,
    finalGradeBonusPoints: globalBonus,
    penaltyRuleApplies,
    isPenaltyTriggered,
    penaltyGrade,
    requiredUniformGrade: effectiveRequiredGrade,
    requiredGlobalGrade: requiredGlobalGrade !== null ? roundTo(requiredGlobalGrade, 2) : null,
    bindingCondition,
    bindingBlockCode,
    bindingBlockName,
    blocks: blockResults,
    diagnosticMessage,
  };
}

/**
 * Simulates final grade with custom simulated scores for unknowns.
 */
export function simulateSubFormulaGrades(
  config: CourseFinalFormula,
  simulatedScores: Record<string, number>
): SubFormulaCourseSolveResult {
  const clonedConfig: CourseFinalFormula = JSON.parse(JSON.stringify(config));

  for (const block of clonedConfig.subFormulas) {
    for (const ev of block.evaluations) {
      if (ev.score === null || ev.score === undefined || isNaN(ev.score)) {
        if (simulatedScores[ev.id] !== undefined) {
          ev.score = simulatedScores[ev.id];
        }
      }
    }
  }

  return solveSubFormulaCourse(clonedConfig);
}

export type GlobalExamModality = 'mat_70_30' | 'fis_60_40' | 'replace_worst';

export interface GlobalExamScenarioResult {
  modality: GlobalExamModality;
  label: string;
  formulaDescription: string;
  presentationGrade: number;
  isEligibleByRange: boolean;
  eligibilityNote: string;
  requiredExamScore: number | null;
  isReachable: boolean;
  replacedEvalLabel?: string;
  replacedOriginalScore?: number | null;
  projectFinalGrade: (examScore: number) => number;
}

/**
 * Calcula los escenarios oficiales de Certamen Global / Examen Recuperativo USM:
 * 1. Modalidad Depto. Matemática (`mat_70_30`): NF = 0,70 * NP + 0,30 * E (si 45 <= NP < 55).
 * 2. Modalidad Depto. Física (`fis_60_40`): NF = 0,60 * PS + 0,40 * CG (si PS >= 50 y CG >= 50).
 * 3. Modalidad Reemplazo Peor Certamen (`replace_worst`): Reemplaza la menor nota del bloque principal (PC).
 */
export function computeGlobalExamScenarios(
  config: CourseFinalFormula,
  solveResult: SubFormulaCourseSolveResult
): Record<GlobalExamModality, GlobalExamScenarioResult> {
  const passingGrade = config.passingGrade ?? 55;
  const blocks = config.subFormulas || [];
  const normalizedWeights = normalizeWeights(blocks.map((b) => b.weightInFinal));

  // Nota de presentación proyectada (considerando notas ingresadas o promedio con 0 si todo se rindió)
  const np =
    solveResult.formulaFinalGrade > 0
      ? solveResult.formulaFinalGrade
      : solveResult.blocks.reduce(
          (acc, b, idx) => acc + normalizedWeights[idx] * b.projectedAverageWithZero,
          0
        );

  // 1. MAT 70/30: NF = 0.70 * NP + 0.30 * E
  const isApprovedMat = np >= passingGrade;
  const isEligibleMat = np >= 45 && !isApprovedMat;
  const reqMat = isApprovedMat ? 0 : roundTo(Math.max(0, (passingGrade - 0.7 * np) / 0.3), 1);
  const matScenario: GlobalExamScenarioResult = {
    modality: 'mat_70_30',
    label: 'Global Matemática (70% NP + 30% Global)',
    formulaDescription: 'NF = 0,70 × NP + 0,30 × E (Derecho a Global con 45 ≤ NP < 55)',
    presentationGrade: roundTo(np, 1),
    isEligibleByRange: isEligibleMat,
    eligibilityNote: isApprovedMat
      ? 'Ya tienes NP ≥ 55 (Aprobado sin requerir examen global).'
      : isEligibleMat
      ? 'Cumples rango 45 ≤ NP < 55 para rendir Certamen Global.'
      : 'NP actual bajo 45 (sube tus notas restantes para entrar al rango 45–54).',
    requiredExamScore: isApprovedMat ? 0 : (isEligibleMat ? reqMat : null),
    isReachable: isApprovedMat ? true : (isEligibleMat && reqMat <= 100),
    projectFinalGrade: (examScore: number) => roundTo(0.7 * np + 0.3 * examScore, 1),
  };

  // 2. FIS 60/40: NF = 0.60 * PS + 0.40 * CG (con CG >= 50)
  const isApprovedFis = np >= passingGrade;
  const isEligibleFis = np >= 50 && !isApprovedFis;
  const rawFis = (passingGrade - 0.6 * np) / 0.4;
  const reqFis = isApprovedFis ? 0 : roundTo(Math.max(50, rawFis), 1);
  const fisScenario: GlobalExamScenarioResult = {
    modality: 'fis_60_40',
    label: 'Global Física (60% PS + 40% Global, mín. 50)',
    formulaDescription: 'NF = 0,60 × PS + 0,40 × CG (Exige PS ≥ 50 y nota CG ≥ 50)',
    presentationGrade: roundTo(np, 1),
    isEligibleByRange: isEligibleFis,
    eligibilityNote: isApprovedFis
      ? 'Ya tienes PS ≥ 55 (Aprobado sin requerir examen global).'
      : isEligibleFis
      ? 'Cumples PS ≥ 50 para rendir Certamen Global.'
      : 'En Física se exige promedio semestral PS ≥ 50 para derecho a Global.',
    requiredExamScore: isApprovedFis ? 0 : (isEligibleFis ? reqFis : null),
    isReachable: isApprovedFis ? true : (isEligibleFis && reqFis <= 100),
    projectFinalGrade: (examScore: number) => {
      const weighted = 0.6 * np + 0.4 * examScore;
      return examScore < 50
        ? roundTo(Math.min(54, weighted), 1)
        : roundTo(weighted, 1);
    },
  };

  // 3. Reemplazo del peor certamen/evaluación en el bloque principal (PC o bloque 0)
  const targetBlockIdx = Math.max(
    0,
    blocks.findIndex(
      (b) =>
        b.code.toUpperCase() === 'PC' ||
        b.name.toLowerCase().includes('certam')
    )
  );
  const targetBlock = blocks[targetBlockIdx];

  let worstEvalIdx = -1;
  let worstScore: number | null = null;
  if (targetBlock && targetBlock.evaluations.length > 0) {
    targetBlock.evaluations.forEach((ev, idx) => {
      if (ev.score !== null && ev.score !== undefined && !isNaN(ev.score)) {
        const val = Number(ev.score);
        if (worstScore === null || val < worstScore) {
          worstScore = val;
          worstEvalIdx = idx;
        }
      }
    });
  }

  if (worstEvalIdx === -1) {
    worstEvalIdx = 0;
  }

  const evalWithReplacedScore = (examScore: number): number => {
    if (!targetBlock) return np;
    const cloned: CourseFinalFormula = JSON.parse(JSON.stringify(config));
    const b = cloned.subFormulas[targetBlockIdx];
    b.evaluations.forEach((ev, idx) => {
      if (idx === worstEvalIdx) {
        ev.score = examScore;
      } else if (ev.score === null || ev.score === undefined) {
        ev.score = 0;
      }
    });
    const res = solveSubFormulaCourse(cloned, passingGrade);
    return res.currentFinalGrade;
  };

  let reqReplace: number | null = null;
  if (targetBlock) {
    let low = 0;
    let high = 200;
    for (let iter = 0; iter < 35; iter++) {
      const mid = (low + high) / 2;
      if (evalWithReplacedScore(mid) >= passingGrade) {
        high = mid;
      } else {
        low = mid;
      }
    }
    reqReplace = roundTo(high, 1);
  }

  const replacedEval = targetBlock?.evaluations[worstEvalIdx];
  const replacedLabel = replacedEval
    ? `${targetBlock.prefix || targetBlock.code}${worstEvalIdx + 1}`
    : 'C1';

  const replaceScenario: GlobalExamScenarioResult = {
    modality: 'replace_worst',
    label: `Recuperativo Reemplaza Peor Nota (${replacedLabel})`,
    formulaDescription: `El examen recuperativo sustituye la calificación más baja de ${
      targetBlock?.name || 'Certámenes'
    } (${replacedLabel}: ${
      replacedEval?.score !== null && replacedEval?.score !== undefined
        ? replacedEval.score
        : '—'
    }).`,
    presentationGrade: roundTo(np, 1),
    isEligibleByRange: true,
    eligibilityNote: `Simula reemplazar ${replacedLabel} manteniendo las demás notas actuales.`,
    requiredExamScore: reqReplace,
    isReachable: reqReplace !== null && reqReplace <= 100,
    replacedEvalLabel: replacedLabel,
    replacedOriginalScore: replacedEval?.score ?? null,
    projectFinalGrade: (examScore: number) => roundTo(evalWithReplacedScore(examScore), 1),
  };

  return {
    mat_70_30: matScenario,
    fis_60_40: fisScenario,
    replace_worst: replaceScenario,
  };
}

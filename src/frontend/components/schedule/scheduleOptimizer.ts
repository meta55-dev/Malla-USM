import { CourseParallel } from '@/shared/types/academic';

export type ScheduleOptimizationStrategy =
  | 'minimize_clashes'
  | 'minimize_windows'
  | 'maximize_free_time';

export interface ScheduleOptimizationMetrics {
  clashCount: number;
  windowBlocks: number;
  freeDays: number;
  freeHalfDays: number;
}

export interface ScheduleOptimizationResult {
  id: string;
  rank: number;
  strategy: ScheduleOptimizationStrategy;
  metrics: ScheduleOptimizationMetrics;
  clashCount: number;
  windowBlocks: number;
  freeDays: number;
  freeHalfDays: number;
  parallels: Record<string, CourseParallel>; // sigla -> CourseParallel
  score: number;
  summaryBadges: string[];
}

export interface PrecomputedParallel {
  sigla: string;
  parallel: CourseParallel;
  dayMasks: number[]; // 7 elements (0=Lunes..6=Domingo), up to 24-bit masks for blocks 1..24
  occupiedDays: number;
  hasSaturday: boolean;
  hasSunday: boolean;
}

/**
 * Fast 32-bit popcount (Hamming weight)
 */
export function popcount(n: number): number {
  n = n - ((n >>> 1) & 0x55555555);
  n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
  return (((n + (n >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/**
 * Precompute bitmasks for each parallel to enable ultra-fast clash,
 * window, and free-time calculations in microsecond time.
 */
export function precomputeParallel(sigla: string, parallel: CourseParallel): PrecomputedParallel {
  const dayMasks = [0, 0, 0, 0, 0, 0, 0];
  let hasSat = false;
  let hasSun = false;

  for (const block of parallel.horario || []) {
    const dia = block.dia;
    const bNum = block.bloque;
    if (dia >= 0 && dia <= 6 && bNum >= 1 && bNum <= 24) {
      dayMasks[dia] |= 1 << (bNum - 1);
      if (dia === 5) hasSat = true;
      if (dia === 6) hasSun = true;
    }
  }

  let occupiedDays = 0;
  for (let d = 0; d < 7; d++) {
    if (dayMasks[d] > 0) occupiedDays++;
  }

  return {
    sigla,
    parallel,
    dayMasks,
    occupiedDays,
    hasSaturday: hasSat,
    hasSunday: hasSun,
  };
}

/**
 * Evaluates a combination of parallels.
 * 
 * - clashCount: number of pairs of blocks overlapping on the same day and block slot.
 * - windowBlocks: for each day d with >= 2 occupied blocks:
 *     Ventanas_d = (Bloque_max,d - Bloque_min,d + 1) - BloquesOcupados_d
 *     Total = sum_d Ventanas_d
 * - freeDays: number of days (Mon-Fri, or Mon-Sat if Saturday is considered) with 0 occupied blocks.
 * - freeHalfDays: number of free mornings (blocks 1-8 without classes) and free afternoons (blocks 9-16).
 */
export function evaluateScheduleCombination(
  parallels: Record<string, CourseParallel>,
  considerSaturday = false,
  considerSunday = false
): ScheduleOptimizationMetrics {
  const parList = Object.values(parallels).filter(Boolean);
  const totalDays = considerSunday ? 7 : (considerSaturday ? 6 : 5);
  if (parList.length === 0) {
    return {
      clashCount: 0,
      windowBlocks: 0,
      freeDays: totalDays,
      freeHalfDays: totalDays * 2,
    };
  }

  const precomputed = Object.entries(parallels)
    .filter(([_, p]) => Boolean(p))
    .map(([sigla, p]) => precomputeParallel(sigla, p));

  return evaluatePrecomputedCombination(precomputed, considerSaturday, considerSunday);
}

/**
 * Fast evaluation of precomputed parallels combination.
 */
export function evaluatePrecomputedCombination(
  list: PrecomputedParallel[],
  considerSaturday: boolean,
  considerSunday: boolean = false
): ScheduleOptimizationMetrics {
  const totalDays = considerSunday ? 7 : (considerSaturday ? 6 : 5); // 0..4 (Mon-Fri), 0..5 (Mon-Sat) or 0..6 (Mon-Sun)

  // 1. Clash count (pairwise overlaps on same day and block)
  let clashCount = 0;
  const n = list.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let d = 0; d < 7; d++) {
        const overlap = list[i].dayMasks[d] & list[j].dayMasks[d];
        if (overlap !== 0) {
          clashCount += popcount(overlap);
        }
      }
    }
  }

  // 2. Windows, Free Days, Free Half Days
  let windowBlocks = 0;
  let freeDays = 0;
  let freeHalfDays = 0;

  for (let d = 0; d < totalDays; d++) {
    let combinedMask = 0;
    for (let i = 0; i < n; i++) {
      combinedMask |= list[i].dayMasks[d];
    }

    if (combinedMask === 0) {
      // Entire day is free
      freeDays++;
      freeHalfDays += 2; // morning and afternoon both free
      continue;
    }

    // Free morning (blocks 1..8 -> bits 0..7, mask 0x00FF)
    if ((combinedMask & 0x00ff) === 0) {
      freeHalfDays++;
    }
    // Free afternoon (blocks 9..16 -> bits 8..15, mask 0xFF00)
    if ((combinedMask & 0xff00) === 0) {
      freeHalfDays++;
    }

    // Windows calculation
    const occupiedCount = popcount(combinedMask);
    if (occupiedCount >= 2) {
      // Lowest bit set (1-based block index)
      const lowestBit = combinedMask & -combinedMask;
      const minBlock = 31 - Math.clz32(lowestBit) + 1;
      // Highest bit set (1-based block index)
      const maxBlock = 32 - Math.clz32(combinedMask);
      const span = maxBlock - minBlock + 1;
      const dayWindow = span - occupiedCount;
      if (dayWindow > 0) {
        windowBlocks += dayWindow;
      }
    }
  }

  return {
    clashCount,
    windowBlocks,
    freeDays,
    freeHalfDays,
  };
}

/**
 * Strict multi-criteria comparator based on chosen strategy:
 * 
 * - 'minimize_clashes':
 *    1. clashCount ASC
 *    2. windowBlocks ASC
 *    3. freeDays DESC
 *    4. freeHalfDays DESC
 * 
 * - 'minimize_windows':
 *    1. clashCount ASC (clashes first)
 *    2. windowBlocks ASC
 *    3. freeDays DESC
 *    4. freeHalfDays DESC
 * 
 * - 'maximize_free_time':
 *    1. clashCount ASC (clashes first)
 *    2. freeDays DESC
 *    3. freeHalfDays DESC
 *    4. windowBlocks ASC
 */
export function compareScheduleMetrics(
  a: ScheduleOptimizationMetrics,
  b: ScheduleOptimizationMetrics,
  strategy: ScheduleOptimizationStrategy
): number {
  // Primary criterion across all modes: MINIMIZE CLASHES
  if (a.clashCount !== b.clashCount) {
    return a.clashCount - b.clashCount;
  }

  if (strategy === 'maximize_free_time') {
    if (a.freeDays !== b.freeDays) {
      return b.freeDays - a.freeDays; // DESC
    }
    if (a.freeHalfDays !== b.freeHalfDays) {
      return b.freeHalfDays - a.freeHalfDays; // DESC
    }
    if (a.windowBlocks !== b.windowBlocks) {
      return a.windowBlocks - b.windowBlocks; // ASC
    }
    return 0;
  }

  if (strategy === 'minimize_windows') {
    if (a.windowBlocks !== b.windowBlocks) {
      return a.windowBlocks - b.windowBlocks; // ASC
    }
    if (a.freeDays !== b.freeDays) {
      return b.freeDays - a.freeDays; // DESC
    }
    if (a.freeHalfDays !== b.freeHalfDays) {
      return b.freeHalfDays - a.freeHalfDays; // DESC
    }
    return 0;
  }

  // 'minimize_clashes'
  if (a.windowBlocks !== b.windowBlocks) {
    return a.windowBlocks - b.windowBlocks; // ASC
  }
  if (a.freeDays !== b.freeDays) {
    return b.freeDays - a.freeDays; // DESC
  }
  if (a.freeHalfDays !== b.freeHalfDays) {
    return b.freeHalfDays - a.freeHalfDays; // DESC
  }
  return 0;
}

/**
 * Computes a normalized score (0 - 100) for visual feedback.
 */
export function computeScheduleScore(
  metrics: ScheduleOptimizationMetrics,
  strategy: ScheduleOptimizationStrategy
): number {
  let score = 100;

  // Severe penalty for clashes (each clash costs 30 points)
  score -= metrics.clashCount * 30;

  if (strategy === 'minimize_windows') {
    score -= metrics.windowBlocks * 4;
    score += metrics.freeDays * 4;
    score += metrics.freeHalfDays * 1.5;
  } else if (strategy === 'maximize_free_time') {
    score += metrics.freeDays * 8;
    score += metrics.freeHalfDays * 3;
    score -= metrics.windowBlocks * 2;
  } else {
    // minimize_clashes
    score -= metrics.windowBlocks * 3;
    score += metrics.freeDays * 5;
    score += metrics.freeHalfDays * 2;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Generates badge labels for summary presentation in UI.
 */
export function generateOptimizationBadges(metrics: ScheduleOptimizationMetrics): string[] {
  const badges: string[] = [];

  if (metrics.clashCount === 0) {
    badges.push('0 Topes');
  } else {
    badges.push(`${metrics.clashCount} Tope${metrics.clashCount > 1 ? 's' : ''}`);
  }

  if (metrics.windowBlocks === 0) {
    badges.push('0 Ventanas');
  } else {
    badges.push(
      `${metrics.windowBlocks} Ventana${metrics.windowBlocks > 1 ? 's' : ''}`
    );
  }

  if (metrics.freeDays > 0) {
    badges.push(`${metrics.freeDays} Día${metrics.freeDays > 1 ? 's' : ''} libre${metrics.freeDays > 1 ? 's' : ''}`);
  } else if (metrics.freeHalfDays > 0) {
    badges.push(`${metrics.freeHalfDays} Medio${metrics.freeHalfDays > 1 ? 's' : ''} día libre`);
  }

  return badges;
}

export interface OptimizeScheduleOptions {
  courses: string[]; // Siglas of enrolled courses
  parallelsByCourse: Record<string, CourseParallel[]>;
  strategy?: ScheduleOptimizationStrategy;
  maxResults?: number;
}

/**
 * Main Schedule Optimization Entry Point.
 * 
 * - Determines if Saturday should be included.
 * - Computes total combinations.
 * - If total <= 5,000, performs exhaustive branch search.
 * - If total > 5,000, executes beam search (width ~600) guaranteeing < 50ms runtime.
 * - Returns Top 3 best combinations formatted with metrics and badges.
 */
export function optimizeSchedule(options: OptimizeScheduleOptions): ScheduleOptimizationResult[] {
  const {
    courses,
    parallelsByCourse,
    strategy = 'minimize_clashes',
    maxResults = 3,
  } = options;

  // Filter courses that have at least 1 parallel available
  const activeCourses = courses.filter(
    (c) => parallelsByCourse[c] && parallelsByCourse[c].length > 0
  );

  if (activeCourses.length === 0) {
    return [];
  }

  // Precompute parallels for all active courses
  let globalHasSaturday = false;
  let globalHasSunday = false;
  const courseCandidates: Array<{
    sigla: string;
    parallels: PrecomputedParallel[];
  }> = [];

  for (const sigla of activeCourses) {
    const rawList = parallelsByCourse[sigla] || [];
    const preList = rawList.map((p) => precomputeParallel(sigla, p));
    for (const item of preList) {
      if (item.hasSaturday) globalHasSaturday = true;
      if (item.hasSunday) globalHasSunday = true;
    }
    courseCandidates.push({
      sigla,
      parallels: preList,
    });
  }

  // Calculate total combinations
  let totalCombinations = 1;
  for (const c of courseCandidates) {
    totalCombinations *= c.parallels.length;
  }

  let rawResults: PrecomputedParallel[][];

  if (totalCombinations <= 5000) {
    rawResults = exhaustiveSearch(courseCandidates, globalHasSaturday, globalHasSunday, strategy);
  } else {
    rawResults = beamSearch(courseCandidates, globalHasSaturday, globalHasSunday, strategy, 800);
  }

  // Deduplicate and format results
  const seenSignatures = new Set<string>();
  const topResults: ScheduleOptimizationResult[] = [];

  for (const combo of rawResults) {
    const signature = combo
      .map((cp) => `${cp.sigla}:${cp.parallel.paralelo}`)
      .sort()
      .join('|');

    if (seenSignatures.has(signature)) continue;
    seenSignatures.add(signature);

    const metrics = evaluatePrecomputedCombination(combo, globalHasSaturday, globalHasSunday);
    const parallelsMap: Record<string, CourseParallel> = {};
    for (const cp of combo) {
      parallelsMap[cp.sigla] = cp.parallel;
    }

    const score = computeScheduleScore(metrics, strategy);
    const summaryBadges = generateOptimizationBadges(metrics);

    topResults.push({
      id: `combo-${topResults.length + 1}-${signature}`,
      rank: topResults.length + 1,
      strategy,
      metrics,
      clashCount: metrics.clashCount,
      windowBlocks: metrics.windowBlocks,
      freeDays: metrics.freeDays,
      freeHalfDays: metrics.freeHalfDays,
      parallels: parallelsMap,
      score,
      summaryBadges,
    });

    if (topResults.length >= maxResults) break;
  }

  return topResults;
}

/**
 * Exhaustive search for combination space <= 5,000.
 */
function exhaustiveSearch(
  courseCandidates: Array<{ sigla: string; parallels: PrecomputedParallel[] }>,
  considerSaturday: boolean,
  considerSunday: boolean,
  strategy: ScheduleOptimizationStrategy
): PrecomputedParallel[][] {
  const allCombos: PrecomputedParallel[][] = [];
  const n = courseCandidates.length;
  const current: PrecomputedParallel[] = new Array(n);

  function backtrack(depth: number) {
    if (depth === n) {
      allCombos.push([...current]);
      return;
    }

    const candidates = courseCandidates[depth].parallels;
    for (let i = 0; i < candidates.length; i++) {
      current[depth] = candidates[i];
      backtrack(depth + 1);
    }
  }

  backtrack(0);

  // Sort all combinations using the exact multi-criteria comparator
  allCombos.sort((a, b) => {
    const mA = evaluatePrecomputedCombination(a, considerSaturday, considerSunday);
    const mB = evaluatePrecomputedCombination(b, considerSaturday, considerSunday);
    return compareScheduleMetrics(mA, mB, strategy);
  });

  return allCombos;
}

/**
 * Beam search for combination space > 5,000.
 * Orders courses by most constrained (fewest parallels) first.
 * Keeps top beamWidth partial combinations at each step.
 */
function beamSearch(
  courseCandidates: Array<{ sigla: string; parallels: PrecomputedParallel[] }>,
  considerSaturday: boolean,
  considerSunday: boolean,
  strategy: ScheduleOptimizationStrategy,
  beamWidth = 800
): PrecomputedParallel[][] {
  // Sort courses by candidate count ascending (most constrained first)
  const sortedCourses = [...courseCandidates].sort(
    (a, b) => a.parallels.length - b.parallels.length
  );

  let beam: PrecomputedParallel[][] = [[]];

  for (const course of sortedCourses) {
    const nextCandidates: Array<{
      combo: PrecomputedParallel[];
      metrics: ScheduleOptimizationMetrics;
    }> = [];

    for (const partial of beam) {
      for (const par of course.parallels) {
        const nextCombo = [...partial, par];
        const metrics = evaluatePrecomputedCombination(nextCombo, considerSaturday, considerSunday);
        nextCandidates.push({ combo: nextCombo, metrics });
      }
    }

    // Sort next candidates according to strategy
    nextCandidates.sort((a, b) =>
      compareScheduleMetrics(a.metrics, b.metrics, strategy)
    );

    // Keep top beamWidth candidates
    beam = nextCandidates.slice(0, beamWidth).map((item) => item.combo);
  }

  // Final sort to guarantee top results
  beam.sort((a, b) => {
    const mA = evaluatePrecomputedCombination(a, considerSaturday, considerSunday);
    const mB = evaluatePrecomputedCombination(b, considerSaturday, considerSunday);
    return compareScheduleMetrics(mA, mB, strategy);
  });

  return beam;
}

import {
  evaluateScheduleCombination,
  compareScheduleMetrics,
  optimizeSchedule,
  ScheduleOptimizationMetrics,
  popcount,
} from '../scheduleOptimizer';
import { CourseParallel, ScheduleBlock } from '@/shared/types/academic';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${msg}`);
  }
}

function makeBlock(dia: number, bloque: number): ScheduleBlock {
  return {
    dia,
    bloque,
    tipo: 'Cát',
    sala: 'A100',
    campus: 'Casa Central',
    profesor: 'Test Prof',
  };
}

function makeParallel(sigla: string, parId: string, blocks: Array<[number, number]>): CourseParallel {
  return {
    sigla,
    nombre: `Curso ${sigla}`,
    departamento: 'INF',
    paralelo: parId,
    profesor: ['Test Prof'],
    cupo: 40,
    horario: blocks.map(([d, b]) => makeBlock(d, b)),
  };
}

console.log('=== RUNNING SCHEDULE OPTIMIZER TESTS ===\n');

// Test 1: Popcount correctness
console.log('Test 1: Popcount function');
assert(popcount(0) === 0, 'popcount(0) should be 0');
assert(popcount(1) === 1, 'popcount(1) should be 1');
assert(popcount(3) === 2, 'popcount(3) should be 2');
assert(popcount(0b101010) === 3, 'popcount(42) should be 3');
assert(popcount(0xffff) === 16, 'popcount(0xffff) should be 16');
console.log('  ✓ Popcount passed.\n');

// Test 2: Single Course Evaluation
console.log('Test 2: Single Course Evaluation (Windows & Free Days)');
// Monday blocks 1, 2, 5, 6 -> window = (6 - 1 + 1) - 4 = 2.
// Tuesday, Wednesday, Thursday, Friday are free -> 4 free days.
// Free mornings: Tuesday, Wednesday, Thursday, Friday (4). Monday has classes in 1,2,5,6 so morning is not free.
// Free afternoons: Monday has no classes in 9..16 -> free afternoon! Plus Tue, Wed, Thu, Fri (4) -> 1 + 4 = 5 free afternoons.
// Total freeHalfDays = 4 mornings + 5 afternoons = 9.
const parA = makeParallel('MAT021', '1', [
  [0, 1],
  [0, 2],
  [0, 5],
  [0, 6],
]);
const m1 = evaluateScheduleCombination({ MAT021: parA }, false);
assert(m1.clashCount === 0, `Expected 0 clashes, got ${m1.clashCount}`);
assert(m1.windowBlocks === 2, `Expected 2 window blocks, got ${m1.windowBlocks}`);
assert(m1.freeDays === 4, `Expected 4 free days, got ${m1.freeDays}`);
assert(m1.freeHalfDays === 9, `Expected 9 free half days, got ${m1.freeHalfDays}`);
console.log('  ✓ Single course evaluation passed.\n');

// Test 3: Clash Count Evaluation
console.log('Test 3: Clash Count with Overlapping Parallels');
// Course A has Monday block 1, 2. Course B has Monday block 2, 3.
// Overlap on Monday block 2 -> 1 clash pair.
const parB1 = makeParallel('FIS100', '1', [
  [0, 2],
  [0, 3],
]);
const m2 = evaluateScheduleCombination({ MAT021: parA, FIS100: parB1 }, false);
assert(m2.clashCount === 1, `Expected 1 clash, got ${m2.clashCount}`);

// Course C also has Monday block 2 -> 3 courses share Monday block 2 -> 3 pairwise clashes
const parC1 = makeParallel('QUI010', '1', [
  [0, 2],
  [1, 1],
]);
const m3 = evaluateScheduleCombination(
  { MAT021: parA, FIS100: parB1, QUI010: parC1 },
  false
);
assert(m3.clashCount === 3, `Expected 3 clashes on Monday block 2, got ${m3.clashCount}`);
console.log('  ✓ Clash detection passed.\n');

// Test 4: Strategy Comparison Hierarchy
console.log('Test 4: Strategy Comparison Hierarchy');
// Combo 1: 0 clashes, 4 window blocks, 2 free days, 4 half days
const c1: ScheduleOptimizationMetrics = {
  clashCount: 0,
  windowBlocks: 4,
  freeDays: 2,
  freeHalfDays: 4,
};
// Combo 2: 0 clashes, 0 window blocks, 1 free day, 3 half days
const c2: ScheduleOptimizationMetrics = {
  clashCount: 0,
  windowBlocks: 0,
  freeDays: 1,
  freeHalfDays: 3,
};
// Combo 3: 1 clash, 0 window blocks, 3 free days, 6 half days
const c3: ScheduleOptimizationMetrics = {
  clashCount: 1,
  windowBlocks: 0,
  freeDays: 3,
  freeHalfDays: 6,
};

// Under 'minimize_clashes' or 'minimize_windows': c2 has 0 windows vs c1's 4 windows -> c2 wins
assert(
  compareScheduleMetrics(c2, c1, 'minimize_windows') < 0,
  'minimize_windows should prefer c2 (0 windows) over c1 (4 windows)'
);

// Under 'maximize_free_time': c1 has 2 free days vs c2's 1 free day -> c1 wins
assert(
  compareScheduleMetrics(c1, c2, 'maximize_free_time') < 0,
  'maximize_free_time should prefer c1 (2 free days) over c2 (1 free day)'
);

// In all strategies, c3 has 1 clash so it loses to both c1 and c2
assert(
  compareScheduleMetrics(c3, c1, 'maximize_free_time') > 0,
  'Clash in c3 should make it worse than c1 even if c3 has more free time'
);
assert(
  compareScheduleMetrics(c3, c2, 'minimize_windows') > 0,
  'Clash in c3 should make it worse than c2'
);
console.log('  ✓ Strategy comparisons verified.\n');

// Test 5: Optimization with Exhaustive Search (<= 5,000 combinations)
console.log('Test 5: Exhaustive Search (4 courses, 3x2x3x2 = 36 combinations)');
const parallelsByCourseSmall: Record<string, CourseParallel[]> = {
  MAT021: [
    makeParallel('MAT021', '1', [[0, 1], [0, 2]]),
    makeParallel('MAT021', '2', [[0, 3], [0, 4]]),
    makeParallel('MAT021', '3', [[1, 1], [1, 2]]),
  ],
  FIS100: [
    makeParallel('FIS100', '1', [[0, 1], [0, 2]]), // clashes with MAT021-1!
    makeParallel('FIS100', '2', [[2, 1], [2, 2]]),
  ],
  INF130: [
    makeParallel('INF130', '1', [[0, 5], [0, 6]]),
    makeParallel('INF130', '2', [[2, 3], [2, 4]]),
    makeParallel('INF130', '3', [[3, 1], [3, 2]]),
  ],
  CSJ110: [
    makeParallel('CSJ110', '1', [[1, 3], [1, 4]]),
    makeParallel('CSJ110', '2', [[4, 1], [4, 2]]),
  ],
};

const tStart = performance.now();
const resultsExhaustive = optimizeSchedule({
  courses: ['MAT021', 'FIS100', 'INF130', 'CSJ110'],
  parallelsByCourse: parallelsByCourseSmall,
  strategy: 'minimize_clashes',
  maxResults: 3,
});
const tElapsed = performance.now() - tStart;

assert(resultsExhaustive.length === 3, `Expected 3 results, got ${resultsExhaustive.length}`);
assert(resultsExhaustive[0].clashCount === 0, 'Top result must have 0 clashes');
console.log(`  ✓ Exhaustive search found 3 results in ${tElapsed.toFixed(2)}ms`);
console.log('    Top 1 Badges:', resultsExhaustive[0].summaryBadges.join(' • '));

// Test 6: Optimization with Beam Search (> 5,000 combinations)
console.log('\nTest 6: Beam Search (> 5,000 combinations, response time < 50ms)');
// 6 courses with 4 parallels each: 4^6 = 4,096
// 7 courses with 4 parallels each: 4^7 = 16,384 combinations (> 5,000)
const parallelsByCourseLarge: Record<string, CourseParallel[]> = {};
const courses7 = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'];
courses7.forEach((cId, idx) => {
  parallelsByCourseLarge[cId] = [
    makeParallel(cId, '1', [[(idx + 0) % 5, 1], [(idx + 0) % 5, 2]]),
    makeParallel(cId, '2', [[(idx + 1) % 5, 3], [(idx + 1) % 5, 4]]),
    makeParallel(cId, '3', [[(idx + 2) % 5, 5], [(idx + 2) % 5, 6]]),
    makeParallel(cId, '4', [[(idx + 3) % 5, 7], [(idx + 3) % 5, 8]]),
  ];
});

// Warm up JIT
optimizeSchedule({
  courses: courses7,
  parallelsByCourse: parallelsByCourseLarge,
  strategy: 'maximize_free_time',
  maxResults: 1,
});

const tStartLarge = performance.now();
const resultsBeam = optimizeSchedule({
  courses: courses7,
  parallelsByCourse: parallelsByCourseLarge,
  strategy: 'maximize_free_time',
  maxResults: 3,
});
const tElapsedLarge = performance.now() - tStartLarge;

assert(resultsBeam.length === 3, `Expected 3 results, got ${resultsBeam.length}`);
assert(tElapsedLarge < 50, `Execution took ${tElapsedLarge.toFixed(2)}ms, must be < 50ms`);
console.log(`  ✓ Beam search solved 16,384 combination space in ${tElapsedLarge.toFixed(2)}ms (< 50ms requirement!)`);
console.log('    Top 1 metrics:', JSON.stringify(resultsBeam[0].metrics));
console.log('    Top 1 Badges:', resultsBeam[0].summaryBadges.join(' • '));

// Test 7: Vespertino Blocks (17-20) & Sunday Schedule Optimization
console.log('\nTest 7: Vespertino Blocks (17-20) & Sunday Evaluation');
const parVespA = makeParallel('IWI131', '100', [
  [0, 17], // Monday block 17
  [0, 18], // Monday block 18
]);
const parVespB = makeParallel('MAT021', '100', [
  [0, 18], // Monday block 18 (clashes with IWI131 block 18)
  [0, 19], // Monday block 19
]);
const mVespClash = evaluateScheduleCombination({ IWI131: parVespA, MAT021: parVespB }, false, false);
assert(mVespClash.clashCount === 1, `Expected 1 clash on block 18, got ${mVespClash.clashCount}`);

const parSunday = makeParallel('DEPORTES', '1', [
  [6, 3], // Sunday block 3
  [6, 4], // Sunday block 4
]);
const mSun = evaluateScheduleCombination({ DEPORTES: parSunday }, false, true);
assert(mSun.freeDays === 6, `Expected 6 free days when considering Sunday, got ${mSun.freeDays}`);
assert(mSun.clashCount === 0, `Expected 0 clashes on Sunday, got ${mSun.clashCount}`);
console.log('  ✓ Vespertino blocks and Sunday evaluation verified successfully.');

console.log('\nALL SCHEDULE OPTIMIZER TESTS PASSED SUCCESSFULLY! ✓');

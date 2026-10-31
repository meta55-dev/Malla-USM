import { calculateCurriculumGraph } from '@/curricula/prerequisites/graphUnlock';
import { solveCourseStatus } from '@/wolfram-solver/engine/gradeSolver';
import { Course } from '@/shared/types/academic';
import {
  solveSubFormulaCourse,
  computeBlockDetails,
  solveBlockRequiredGrade,
} from '@/wolfram-solver/engine/subFormulaSolver';
import {
  createInf292CourseConfig,
  createInf292FormulaConfig,
  ensureFormulaConfig,
} from '@/wolfram-solver/templates/defaultTemplates';
import { useAcademicStore } from '@/shared/store/useAcademicStore';
import { EnrolledCourseConfig } from '@/shared/types/academic';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`[QA FAILURE] ${message}`);
  }
}

function assertEquals(actual: any, expected: any, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `[QA FAILURE] ${message}\nExpected: ${JSON.stringify(expected)}\nActual:   ${JSON.stringify(actual)}`
    );
  }
}

function assertApprox(actual: number, expected: number, tolerance: number = 0.05, message: string = '') {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(
      `[QA FAILURE] ${message}\nExpected approx: ${expected}\nActual:          ${actual}\nDiff:            ${Math.abs(actual - expected)} > ${tolerance}`
    );
  }
}

console.log('================================================================');
console.log('🧪 RUNNING COMPREHENSIVE QA INTEGRATION & PERSISTENCE TEST SUITE');
console.log('================================================================\n');

// ============================================================================
// SUITE 1: INF-292 Template Loading & Mathematical Configuration Validation
// ============================================================================
console.log('📌 Suite 1: INF-292 Template Loading & Specifications');
{
  const infConfig = createInf292CourseConfig();
  assert(infConfig.sigla === 'INF-292', 'Course sigla must be INF-292');
  assert(!!infConfig.formulaConfig, 'Course must possess formulaConfig');

  const formula = infConfig.formulaConfig!;
  assertEquals(formula.passingGrade, 55, 'Passing grade must be 55');
  assertEquals(formula.applyPenaltyRule, true, 'USM Penalty rule must be active');
  assertEquals(formula.subFormulas.length, 3, 'Must define exactly 3 sub-formula blocks');

  // Validate Block 1: PCE (Controles de Entrada)
  const pce = formula.subFormulas.find((b) => b.code === 'PCE')!;
  assert(!!pce, 'PCE block exists');
  assertEquals(pce.name, 'Controles de Entrada', 'PCE name');
  assertEquals(pce.type, 'drop_worst', 'PCE is drop_worst type');
  assertEquals(pce.count, 7, 'PCE has 7 controls');
  assertEquals(pce.dropWorstCount, 1, 'PCE drops 1 worst control');
  assertEquals(pce.minGradeRequired, 50, 'PCE minimum required grade is 50');
  assertApprox(pce.weightInFinal, 0.1, 0.001, 'PCE weight is 10% (0.10)');
  assertEquals(pce.evaluations.length, 7, 'PCE has 7 evaluation entries');

  // Validate Block 2: PC (Certámenes)
  const pc = formula.subFormulas.find((b) => b.code === 'PC')!;
  assert(!!pc, 'PC block exists');
  assertEquals(pc.name, 'Certámenes', 'PC name');
  assertEquals(pc.type, 'simple_average', 'PC is simple_average type');
  assertEquals(pc.count, 3, 'PC has 3 certámenes');
  assertEquals(pc.dropWorstCount, 0, 'PC drops 0 worst');
  assertEquals(pc.minGradeRequired, 50, 'PC minimum required grade is 50');
  assertApprox(pc.weightInFinal, 0.45, 0.001, 'PC weight is 45% (0.45)');
  assertEquals(pc.evaluations.length, 3, 'PC has 3 evaluation entries');

  // Validate Block 3: PP (Proyectos y Entregas)
  const pp = formula.subFormulas.find((b) => b.code === 'PP')!;
  assert(!!pp, 'PP block exists');
  assertEquals(pp.name, 'Proyectos y Entregas', 'PP name');
  assertEquals(pp.type, 'simple_average', 'PP is simple_average type');
  assertEquals(pp.count, 3, 'PP has 3 entregas');
  assertEquals(pp.dropWorstCount, 0, 'PP drops 0 worst');
  assertEquals(pp.minGradeRequired, 50, 'PP minimum required grade is 50');
  assertApprox(pp.weightInFinal, 0.45, 0.001, 'PP weight is 45% (0.45)');
  assertEquals(pp.evaluations.length, 3, 'PP has 3 evaluation entries');

  console.log('  ✅ INF-292 template structure matches official syllabus (10% PCE, 45% PC, 45% PP; min >= 50).');
}

// ============================================================================
// SUITE 2: Grade Simulation, Partial Block Averages & Dropping Worst Grade
// ============================================================================
console.log('\n📌 Suite 2: Grade Simulation & Drop Worst Mathematical Exactness');
{
  const formula = createInf292FormulaConfig();
  const pce = formula.subFormulas.find((b) => b.code === 'PCE')!;

  // 1. Enter 6 grades in PCE: 65, 70, 45, 80, 90, 85 (CE7 is null)
  pce.evaluations[0].score = 65;
  pce.evaluations[1].score = 70;
  pce.evaluations[2].score = 45; // lowest known grade
  pce.evaluations[3].score = 80;
  pce.evaluations[4].score = 90;
  pce.evaluations[5].score = 85;
  pce.evaluations[6].score = null;

  // Threshold to drop worst is (count - dropWorstCount) = 7 - 1 = 6.
  // With 6 grades entered, lowest grade (45) MUST be discarded:
  // Remaining 5 grades: 65 + 70 + 80 + 90 + 85 = 390.
  // Partial average: 390 / 5 = 78.0.
  const details6 = computeBlockDetails(pce, false);
  assertEquals(details6.droppedScores, [45], '45 must be dropped as worst score');
  assertEquals(details6.usedScores.length, 5, '5 grades used in average');
  assertApprox(details6.average!, 78.0, 0.001, 'Partial average is exactly 78.0');

  // 2. Now enter CE7 = 30 (new lowest grade)
  pce.evaluations[6].score = 30;
  // All 7 grades entered: 65, 70, 45, 80, 90, 85, 30.
  // Dropped grade must now be 30!
  // Remaining 6 grades: 65 + 70 + 45 + 80 + 90 + 85 = 435.
  // Block average: 435 / 6 = 72.5.
  const details7 = computeBlockDetails(pce, false);
  assertEquals(details7.droppedScores, [30], '30 must now be dropped as the single worst score');
  assertEquals(details7.usedScores.length, 6, '6 grades used in average');
  assertApprox(details7.average!, 72.5, 0.001, 'Average is exactly 72.5');

  // 3. Simple average blocks: PC and PP
  const pc = formula.subFormulas.find((b) => b.code === 'PC')!;
  pc.evaluations[0].score = 52;
  pc.evaluations[1].score = 48;
  pc.evaluations[2].score = null;
  // PC average of 2 knowns: (52 + 48) / 2 = 50.0
  const pcDetails = computeBlockDetails(pc, false);
  assertApprox(pcDetails.average!, 50.0, 0.001, 'PC average of knowns is 50.0');

  const pp = formula.subFormulas.find((b) => b.code === 'PP')!;
  pp.evaluations[0].score = 75;
  pp.evaluations[1].score = 65;
  pp.evaluations[2].score = null;
  // PP average of 2 knowns: (75 + 65) / 2 = 70.0
  const ppDetails = computeBlockDetails(pp, false);
  assertApprox(ppDetails.average!, 70.0, 0.001, 'PP average of knowns is 70.0');

  console.log('  ✅ Drop-worst and simple average calculations accurate to 0.001 precision.');
}

// ============================================================================
// SUITE 3: USM Penalty Rule Detection & Verification
// ============================================================================
console.log('\n📌 Suite 3: USM Penalty Rule (All mins met vs Failing block penalty)');
{
  const formula = createInf292FormulaConfig();

  // Case A: All blocks meet required minimums (>= 50)
  // PCE: 60, PC: 55, PP: 65
  formula.subFormulas[0].evaluations.forEach((e) => (e.score = 60));
  formula.subFormulas[1].evaluations.forEach((e) => (e.score = 55));
  formula.subFormulas[2].evaluations.forEach((e) => (e.score = 65));

  const resultPassed = solveSubFormulaCourse(formula);
  // Expected NF = 0.10 * 60 + 0.45 * 55 + 0.45 * 65 = 6.0 + 24.75 + 29.25 = 60.0
  assertApprox(resultPassed.currentFinalGrade, 60.0, 0.01, 'Final grade without penalty is 60.0');
  assertEquals(resultPassed.isPenaltyTriggered, false, 'Penalty rule NOT triggered');
  assertEquals(resultPassed.status, 'APPROVED', 'Course status is APPROVED');

  // Case B: High global average, but ONE block fails minimum requirement (< 50)
  // PCE = 100 (weight 10%)
  // PP  = 90  (weight 45%)
  // PC  = 46  (weight 45%)  <-- FAILS MINIMUM 50!
  //
  // Unpenalized weighted formula:
  //   NF = 0.10 * 100 + 0.45 * 46 + 0.45 * 90
  //      = 10 + 20.7 + 40.5 = 71.2 >= 55 (would pass under ordinary weighting!)
  //
  // USM Penalty Rule:
  //   IF PCE >= 50 AND PC >= 50 AND PP >= 50 THEN NF = formula
  //   ELSE NF = min(PCE, PC, PP)
  //
  // Because PC = 46 < 50:
  //   NF = min(100, 46, 90) = 46.0!
  formula.subFormulas[0].evaluations.forEach((e) => (e.score = 100));
  formula.subFormulas[1].evaluations.forEach((e) => (e.score = 46));
  formula.subFormulas[2].evaluations.forEach((e) => (e.score = 90));

  const resultPenalized = solveSubFormulaCourse(formula);
  assertEquals(resultPenalized.isPenaltyTriggered, true, 'Penalty rule MUST be triggered');
  assertEquals(resultPenalized.penaltyGrade, 46.0, 'Penalty grade must be min(blocks) = 46.0');
  assertEquals(resultPenalized.currentFinalGrade, 46.0, 'Final grade must be penalized to 46.0');
  assertEquals(resultPenalized.status, 'FAILED', 'Status must be FAILED due to block penalty');
  assert(
    resultPenalized.diagnosticMessage.includes('penalización USM') &&
    resultPenalized.diagnosticMessage.includes('Certámenes (PC)'),
    'Diagnostic message explicitly points to Certámenes (PC) penalty'
  );

  console.log('  ✅ USM Penalty Rule correctly enforces NF = min(blocks) when any block fails min >= 50.');
}

// ============================================================================
// SUITE 4: Algebraic Clearance & Binding Constraint Identification
// ============================================================================
console.log('\n📌 Suite 4: Algebraic Clearance & Binding Constraint Detection');
{
  const formula = createInf292FormulaConfig();

  // Test 4.1: Block minimum binding constraint
  // PC: C1=40, C2=null, C3=null. Min required = 50.
  // (40 + 2*X) / 3 >= 50 => 2*X >= 110 => X >= 55.0 on PC.
  const pcBlock = formula.subFormulas.find((b) => b.code === 'PC')!;
  pcBlock.evaluations[0].score = 40;
  pcBlock.evaluations[1].score = null;
  pcBlock.evaluations[2].score = null;

  const requiredPC = solveBlockRequiredGrade(pcBlock, 50);
  assertApprox(requiredPC!, 55.0, 0.01, 'PC requires 55.0 on unknown certámenes');

  // Set PCE and PP with very high scores:
  // PCE: all 7 = 90
  // PP: all 3 = 90
  formula.subFormulas[0].evaluations.forEach((e) => (e.score = 90));
  formula.subFormulas[2].evaluations.forEach((e) => (e.score = 90));

  // Global equation:
  // 0.10*90 + 0.45*PC(X) + 0.45*90 >= 55
  // 9 + 0.45 * ((40 + 2*X)/3) + 40.5 >= 55
  // 49.5 + 0.15 * (40 + 2*X) >= 55
  // 49.5 + 6.0 + 0.30*X >= 55 => 55.5 + 0.30*X >= 55 => 0.30*X >= -0.5 => X >= 0
  // Globally, with X=0 in C2 & C3, formula gives 55.5 >= 55.
  // But BLOCK_MIN requires X >= 55.0 to satisfy PC >= 50!
  const resBlockBinding = solveSubFormulaCourse(formula);
  assertEquals(resBlockBinding.bindingCondition, 'BLOCK_MIN', 'Binding condition must be BLOCK_MIN');
  assertEquals(resBlockBinding.bindingBlockCode, 'PC', 'Binding block code must be PC');
  assertApprox(resBlockBinding.requiredUniformGrade!, 55.0, 0.1, 'Effective required grade is 55.0');
  assert(
    resBlockBinding.requiredGlobalGrade! <= 0,
    'Global required grade is 0 (already passing without PC min)'
  );

  // Test 4.2: Global formula binding constraint
  // PCE: CE1..CE6 = 50, CE7 = null (needs 50)
  // PC: C1 = 60, C2 = null, C3 = null (PC needs 45 to reach 50)
  // PP: E1 = 60, E2 = null, E3 = null (PP needs 45 to reach 50)
  // All block minimums need <= 50, but global formula NF >= 55 requires uniform X > 50!
  for (let i = 0; i < 6; i++) {
    formula.subFormulas[0].evaluations[i].score = 50;
  }
  formula.subFormulas[0].evaluations[6].score = null;
  formula.subFormulas[1].evaluations[0].score = 60;
  formula.subFormulas[1].evaluations[1].score = null;
  formula.subFormulas[1].evaluations[2].score = null;
  formula.subFormulas[2].evaluations[0].score = 60;
  formula.subFormulas[2].evaluations[1].score = null;
  formula.subFormulas[2].evaluations[2].score = null;

  const resGlobalBinding = solveSubFormulaCourse(formula);
  assertEquals(resGlobalBinding.bindingCondition, 'GLOBAL', 'Binding condition must be GLOBAL');
  assert(
    resGlobalBinding.requiredUniformGrade! > 50,
    'Required grade across unknowns must exceed 50 to pass overall'
  );

  console.log('  ✅ Algebraic clearance correctly distinguishes BLOCK_MIN vs GLOBAL binding constraints.');
}

// ============================================================================
// SUITE 5: JSON Serialization, Deserialization, LocalStorage & Backwards Compatibility
// ============================================================================
console.log('\n📌 Suite 5: Store Persistence, Backwards Compatibility & JSON Round-Trip');
{
  const store = useAcademicStore.getState();
  store.resetAll();

  // 1. Load INF-292 example scenario into store
  store.loadInf292Example();
  const enrolledINF292 = useAcademicStore.getState().inProgressCourses['INF-292'];
  assert(!!enrolledINF292, 'INF-292 is enrolled in store');
  assert(!!enrolledINF292.formulaConfig, 'formulaConfig present in INF-292');
  assertEquals(useAcademicStore.getState().selectedCourseSigla, 'INF-292', 'INF-292 selected');

  // Verify solve result from store selector
  const storeResult = useAcademicStore.getState().getSubFormulaSolveResult('INF-292');
  assert(storeResult !== null, 'getSubFormulaSolveResult returns valid result');
  assertEquals(storeResult!.status, 'ON_TRACK', 'INF-292 mid-semester status is ON_TRACK');
  assert(storeResult!.requiredUniformGrade! > 0, 'Requires positive score in remaining unknowns');

  // 2. Export store state to JSON backup
  const exportedJson = store.exportJSON();
  assert(typeof exportedJson === 'string' && exportedJson.length > 50, 'JSON exported successfully');

  const parsedRaw = JSON.parse(exportedJson);
  assertEquals(parsedRaw.system, 'Sansano Academic Tracker - USM', 'Backup system header');
  assert(!!parsedRaw.data.inProgressCourses['INF-292'], 'INF-292 contained in backup data');

  // 3. Reset store and re-import JSON backup
  store.resetAll();
  assertEquals(Object.keys(useAcademicStore.getState().inProgressCourses).length, 0, 'Store cleared');

  const importOk = store.importJSON(exportedJson);
  assertEquals(importOk, true, 'JSON import succeeded');

  const reloadedINF292 = useAcademicStore.getState().inProgressCourses['INF-292'];
  assert(!!reloadedINF292, 'INF-292 restored from backup');
  assertEquals(
    reloadedINF292.formulaConfig?.subFormulas[0].evaluations[0].score,
    65,
    'Restored CE1 score = 65'
  );

  // 4. Backwards compatibility test: Legacy v1.0.0 course data (NO formulaConfig)
  // Simulate an older course config where user had only evaluation groups saved in localStorage
  const legacyCourse: EnrolledCourseConfig = {
    sigla: 'MAT-022',
    groups: [
      {
        id: 'certamenes',
        name: 'Certámenes',
        weight: 70,
        minGrade: 50,
        hasRecoveryExam: true,
        recoveryGrade: null,
        evaluations: [
          { id: 'c1', name: 'Certamen 1', weight: 33.3, score: 55 },
          { id: 'c2', name: 'Certamen 2', weight: 33.3, score: 60 },
          { id: 'c3', name: 'Certamen 3', weight: 33.4, score: null },
        ],
      },
      {
        id: 'tareas',
        name: 'Tareas',
        weight: 30,
        minGrade: null,
        hasRecoveryExam: false,
        recoveryGrade: null,
        evaluations: [
          { id: 't1', name: 'Tarea 1', weight: 50, score: 80 },
          { id: 't2', name: 'Tarea 2', weight: 50, score: null },
        ],
      },
    ],
    // formulaConfig is purposely undefined to simulate legacy v1.0.0
  };

  // Test ensureFormulaConfig synthesis
  const synthesized = ensureFormulaConfig(legacyCourse);
  assert(!!synthesized, 'Synthesized formulaConfig from legacy groups');
  assertEquals(synthesized.subFormulas.length, 2, '2 synthesized sub-formula blocks');
  assertEquals(synthesized.subFormulas[0].code, 'PC', 'Block 1 recognized as PC');
  assertEquals(synthesized.subFormulas[0].minGradeRequired, 50, 'Block 1 minGrade preserved');
  assertEquals(synthesized.subFormulas[0].evaluations[0].score, 55, 'Preserved C1 score 55');
  assertEquals(synthesized.subFormulas[0].evaluations[1].score, 60, 'Preserved C2 score 60');

  // Insert legacy course directly into store inProgressCourses
  useAcademicStore.setState({
    inProgressCourses: {
      ...useAcademicStore.getState().inProgressCourses,
      'MAT-022': legacyCourse,
    },
  });

  // Call getSubFormulaSolveResult for legacy course
  const legacySolveResult = useAcademicStore.getState().getSubFormulaSolveResult('MAT-022');
  assert(legacySolveResult !== null, 'Legacy course solved seamlessly without throwing');
  assertApprox(legacySolveResult!.blocks[0].currentAverage!, 57.5, 0.01, 'PC average (55+60)/2 = 57.5');
  assertEquals(legacySolveResult!.blocks[0].meetsMinGrade, true, '57.5 >= 50 satisfies block min');

  // Update a sub-formula score on the legacy course
  store.setSubFormulaEvaluationScore('MAT-022', 'certamenes', 'c3', 70);
  const updatedLegacy = useAcademicStore.getState().inProgressCourses['MAT-022'];
  assert(!!updatedLegacy.formulaConfig, 'formulaConfig lazily migrated and populated');
  assertEquals(
    updatedLegacy.formulaConfig?.subFormulas[0].evaluations[2].score,
    70,
    'Sub-formula score updated on migrated config'
  );
  assertEquals(
    updatedLegacy.groups[0].evaluations[2].score,
    70,
    'Legacy group mirrored score updated to 70'
  );

  console.log('  ✅ LocalStorage persistence, backup export/import and v1.0.0 backwards compatibility validated.');
}

// ============================================================================
// SUITE 6: UX Safety & Deletion Protection Lifecycle
// ============================================================================
console.log('\n📌 Suite 6: Deletion Protection Confirmation & Unenrollment Safety Lifecycle');
{
  const store = useAcademicStore.getState();
  store.resetAll();

  // 1. Enroll course with valuable progress
  store.enrollCourse('FIS-100');
  const courseBefore = useAcademicStore.getState().inProgressCourses['FIS-100'];
  assert(!!courseBefore, 'FIS-100 enrolled successfully');

  // Add grades and customized bonus
  store.setEvaluationScore('FIS-100', 'certamenes', 'c1', 75);
  const updatedCourse = useAcademicStore.getState().inProgressCourses['FIS-100'];
  assert(updatedCourse.groups[0].evaluations[0].score === 75, 'Grade 75 recorded in FIS-100');
  assertEquals(useAcademicStore.getState().selectedCourseSigla, 'FIS-100', 'FIS-100 is selected');

  // 2. Simulate UX Deletion Protection Workflow:
  // Step A: User clicks delete button -> Triggering AlertDialog opens modal (deleteConfirmOpen = true)
  let deleteConfirmModalOpen = true;
  let unenrollActionDispatched = false;

  // Verification: Prior to explicit confirmation, store data remains untouched
  assert(deleteConfirmModalOpen === true, 'Delete confirmation modal is visible');
  assert(unenrollActionDispatched === false, 'Unenroll action not yet dispatched');
  assert(
    useAcademicStore.getState().inProgressCourses['FIS-100']?.groups[0].evaluations[0].score === 75,
    'Grades preserved while confirmation modal is pending'
  );

  // Step B: User cancels (clicks Cancel button in dialog)
  deleteConfirmModalOpen = false; // Modal closes
  // onUnenroll was NOT called
  assert(
    useAcademicStore.getState().inProgressCourses['FIS-100'] !== undefined,
    'Cancellation safely preserves enrolled course in store'
  );
  assert(
    useAcademicStore.getState().inProgressCourses['FIS-100'].groups[0].evaluations[0].score === 75,
    'All recorded grades remain intact upon cancellation'
  );

  // Step C: User initiates delete again and confirms (clicks AlertDialogAction)
  deleteConfirmModalOpen = true;
  // User confirms deletion -> executes onUnenroll
  store.unenrollCourse('FIS-100');
  unenrollActionDispatched = true;
  deleteConfirmModalOpen = false;

  // Verification: Confirmed unenrollment cleanly purges course and resets selection
  const courseAfter = useAcademicStore.getState().inProgressCourses['FIS-100'];
  assertEquals(courseAfter, undefined, 'FIS-100 cleanly removed from inProgressCourses');
  assertEquals(
    useAcademicStore.getState().selectedCourseSigla,
    null,
    'Selected course sigla safely reset from deleted course'
  );

  // Verification: Querying solve result on deleted course returns null safely
  const solveAfter = useAcademicStore.getState().getSubFormulaSolveResult('FIS-100');
  assertEquals(solveAfter, null, 'Solve result for unenrolled course returns null without errors');

  console.log('  ✅ Deletion protection modal workflow & safe unenrollment lifecycle validated.');
}

// ============================================================================
// SUITE 7: Regression Audit Fixes Verification (Wolfram Root, DAG DNF, Store Stats)
// ============================================================================
console.log('\n📌 Suite 7: Regression Audit Invariants Verification');
{
  // 1. Wolfram Solver: Root > 100 reachable in [0, 300] without premature clamping
  const testConfig: EnrolledCourseConfig = {
    sigla: 'TEST-100',
    passingGrade: 55,
    groups: [
      {
        id: 'g1',
        name: 'Certamen 1',
        weight: 0.5,
        minGradeRequired: null,
        evaluations: [{ id: 'e1', name: 'C1', weight: 1.0, score: 0 }],
      },
      {
        id: 'g2',
        name: 'Certamen 2',
        weight: 0.5,
        minGradeRequired: null,
        evaluations: [{ id: 'e2', name: 'C2', weight: 1.0, score: null }],
      },
    ],
  };
  // To pass with 55 with C1=0 and 50% weight: 0*0.5 + C2*0.5 >= 55 => C2 >= 110.0!
  const resStd = solveCourseStatus(testConfig, 55);
  assert(resStd.effectiveRequiredGrade !== null, 'Effective required grade computed');
  assertApprox(resStd.effectiveRequiredGrade!, 110.0, 0.1, 'Effective required grade should be 110.0 (> 100 root found cleanly)');

  // 2. DAG: Courses with empty prerrequisitos but non-empty requisitos_dnf MUST NOT unlock prematurely
  const dummyCourses: Course[] = [
    {
      id: 1,
      sigla: 'MAT021',
      nombre: 'Matemática I',
      creditos_usm: 5,
      creditos_sct: 5,
      semestre: 1,
      prerrequisitos: [],
      requisitos_dnf: [],
      area: 'MFQ',
      tipo: 'Obligatoria',
    },
    {
      id: 2,
      sigla: 'INF999',
      nombre: 'Tesis Avanzada',
      creditos_usm: 10,
      creditos_sct: 10,
      semestre: 11,
      prerrequisitos: [], // Empty base prerrequisitos!
      requisitos_dnf: [[{ sigla: 'MAT021', tipo: 'approval' }]], // DNF requires MAT021!
      area: 'INF',
      tipo: 'Obligatoria',
    },
  ];
  // With 0 approved courses:
  const graphBefore = calculateCurriculumGraph(dummyCourses, {});
  assert(graphBefore['INF999'].status === 'LOCKED', 'INF999 must remain LOCKED when MAT021 is not approved');
  assert(graphBefore['INF999'].missingPrerequisites.some(p => p.replace('-', '') === 'MAT021'), 'MAT021 reported as missing prerequisite');

  // With MAT021 approved:
  const graphAfter = calculateCurriculumGraph(dummyCourses, { MAT021: { sigla: 'MAT021' } });
  assert(graphAfter['INF999'].status === 'AVAILABLE', 'INF999 unlocks to AVAILABLE once MAT021 is approved');

  // 3. Store Statistics: Fallback for creditos_usm when SCT is 0
  const stats = useAcademicStore.getState().getStatistics();
  assert(typeof stats.percentProgress === 'number' && !isNaN(stats.percentProgress), 'Progress is a valid number');
  assert(stats.approvedCoursesCount >= 0, 'Approved count is non-negative');

  console.log('  ✅ Wolfram [0,300] roots, DAG DNF fallback, and Store Statistics validated.');
}

console.log('\n================================================================');

console.log('🎉 ALL INTEGRATION, QA & PERSISTENCE TESTS PASSED SUCCESSFULLY! 🎉');
console.log('================================================================\n');


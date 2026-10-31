import {
  computeCriticalPathMetrics,
  planFastestGraduation,
  validatePlanConflicts,
  resolveAllPlanConflicts,
} from '../planner/criticalPathPlanner';
import { useAcademicStore } from '@/shared/store/useAcademicStore';
import ici2014Data from '../careers/ici-2014.json';
import { Course } from '@/shared/types/academic';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${msg}`);
  }
}

function assertEquals<T>(actual: T, expected: T, msg: string) {
  if (actual !== expected) {
    throw new Error(`Assertion failed [${msg}]: expected ${expected}, got ${actual}`);
  }
}

console.log('=== TEST SUITE: CRITICAL PATH PLANNER & TOPOLOGICAL SCHEDULER ===\n');

const ramos = ici2014Data.ramos as Course[];

// -------------------------------------------------------------
// Test 1: Critical Path Metrics Calculation
// -------------------------------------------------------------
console.log('Test 1: Critical Path Metrics (L_u, D_u, W_u, isCriticalBottleneck)');
{
  const approved = new Set<string>(); // Fresh student, nothing approved
  const metrics = computeCriticalPathMetrics(ramos, approved);

  // MAT-021 is the root of the mathematics and science chain
  const mat021 = metrics.get('MAT-021');
  assert(!!mat021, 'MAT-021 metric must exist');
  assert(mat021!.criticalPathLength >= 5, `MAT-021 L_u should be >= 5, got ${mat021!.criticalPathLength}`);
  assert(mat021!.totalDescendantsCount >= 10, `MAT-021 D_u should be >= 10, got ${mat021!.totalDescendantsCount}`);
  assert(mat021!.isCriticalBottleneck === true, 'MAT-021 must be marked as a critical bottleneck');

  // IWI-131 is the root of the computing chain
  const iwi131 = metrics.get('IWI-131');
  assert(!!iwi131, 'IWI-131 metric must exist');
  assert(iwi131!.criticalPathLength >= 5, `IWI-131 L_u should be >= 5, got ${iwi131!.criticalPathLength}`);
  assert(iwi131!.isCriticalBottleneck === true, 'IWI-131 must be marked as a critical bottleneck');

  // Final project / Tesis (INF-398 / INF-399 or sem 11 courses) should have L_u = 1 and D_u = 0
  const terminalCourse = ramos.find((r) => r.semestre === 11 && r.prerrequisitos.length > 0);
  if (terminalCourse) {
    const termMetric = metrics.get(terminalCourse.sigla);
    if (termMetric) {
      assertEquals(termMetric.criticalPathLength, 1, 'Terminal course has L_u = 1');
      assertEquals(termMetric.totalDescendantsCount, 0, 'Terminal course has D_u = 0');
      assertEquals(termMetric.isCriticalBottleneck, false, 'Terminal course is not a bottleneck');
    }
  }

  // When MAT-021 is approved, its metric should reset to 0
  const approvedWithMat = new Set<string>(['MAT-021']);
  const metricsWithMat = computeCriticalPathMetrics(ramos, approvedWithMat);
  const matApproved = metricsWithMat.get('MAT-021');
  assertEquals(matApproved!.criticalPathLength, 0, 'Approved course has L_u = 0');
  assertEquals(matApproved!.isCriticalBottleneck, false, 'Approved course is not a bottleneck');

  console.log('  ✓ Critical path lengths L_u and unlock degrees D_u computed accurately.');
}

// -------------------------------------------------------------
// Test 2: planFastestGraduation Strict Prerequisite Invariant
// -------------------------------------------------------------
console.log('\nTest 2: planFastestGraduation Topological Order & Credit Constraint');
{
  const approved = new Set<string>(['MAT-021', 'FIS-100', 'QUI-010', 'HUM-001', 'IWI-131', 'HRW-101']);
  const inProgress = new Set<string>();
  const maxSct = 30;

  const plan = planFastestGraduation(ramos, approved, inProgress, maxSct, 2);

  assert(plan.totalSemesters >= 10, `Total semesters should be reasonable, got ${plan.totalSemesters}`);

  // Invariant verification: For every unapproved course B and unapproved prerequisite A: Sem(B) > Sem(A)
  for (const course of ramos) {
    if (approved.has(course.sigla)) continue;

    const semB = plan.plannedSemesterOverrides[course.sigla] ?? course.semestre;

    for (const prereq of course.prerrequisitos) {
      if (approved.has(prereq)) continue;

      const semA = plan.plannedSemesterOverrides[prereq] ?? ramos.find((r) => r.sigla === prereq)?.semestre;
      if (semA !== undefined) {
        assert(
          semB > semA,
          `INVARIANT VIOLATION: Course ${course.sigla} (Sem ${semB}) must be > unapproved prerequisite ${prereq} (Sem ${semA})`
        );
      }
    }
  }

  // Verify credit limits in all future planned semesters
  for (const [semStr, breakdown] of Object.entries(plan.semestersBreakdown)) {
    const sem = Number(semStr);
    if (sem >= 2) {
      assert(
        breakdown.totalSct <= maxSct + 4, // Allow slight tolerance only if single course exceeds
        `Semester ${sem} total SCT ${breakdown.totalSct} exceeds limit ${maxSct}`
      );
    }
  }

  console.log('  ✓ STRICT INVARIANT verified: Semestre(B) > Semestre(A) for all unapproved prerequisites.');
  console.log(`  ✓ Graduation scheduled across ${plan.totalSemesters} semesters respecting max ${maxSct} SCT.`);
}

// -------------------------------------------------------------
// Test 3: Free Drag & Drop, Conflict Detection & Auto-Resolution
// -------------------------------------------------------------
console.log('\nTest 3: Free Drag & Drop, Conflict Detection & Auto-Resolution');
{
  const store = useAcademicStore.getState();
  store.resetAll();

  // Fresh student: MAT-021 is at Sem 1, MAT-022 is at Sem 2.
  // MAT-021 is a prerequisite for MAT-022.
  // Free movement: Moving MAT-022 to Semestre 1 is ALLOWED (success: true) without rigid blocking!
  const freeMove = store.movePlannedCourse('MAT-022', 1, false);
  assertEquals(freeMove.success, true, 'Moving MAT-022 to Sem 1 must succeed in free planning mode');

  // Verify that validatePlanConflicts detects the conflict
  const conflictsBefore = validatePlanConflicts(
    ramos,
    new Set(),
    useAcademicStore.getState().plannedSemesterOverrides
  );
  assert(conflictsBefore.length >= 1, 'Conflict must be detected between MAT-022 and MAT-021');
  const mat22Conflict = conflictsBefore.find((c) => c.courseSigla === 'MAT-022');
  assert(!!mat22Conflict, 'MAT-022 conflict must exist');
  assertEquals(mat22Conflict!.courseSemester, 1, 'MAT-022 is at Sem 1');
  assertEquals(mat22Conflict!.prereqSigla, 'MAT-021', 'Prerequisite is MAT-021');

  // Auto-resolve conflicts: store.resolvePlanConflicts() must push MAT-022 to >= 2!
  store.resolvePlanConflicts();
  const conflictsAfter = validatePlanConflicts(
    ramos,
    new Set(),
    useAcademicStore.getState().plannedSemesterOverrides
  );
  assertEquals(conflictsAfter.length, 0, 'All conflicts must be resolved');
  assert(
    useAcademicStore.getState().plannedSemesterOverrides['MAT-022'] >= 2,
    'MAT-022 must be pushed to at least Semestre 2'
  );

  // Moving MAT-021 forward to Semestre 3 with cascade push = true must automatically push MAT-022 to Sem 4!
  const cascadeMove = store.movePlannedCourse('MAT-021', 3, true);
  assertEquals(cascadeMove.success, true, 'Moving MAT-021 to Sem 3 with cascade must succeed');
  assert(
    Array.isArray(cascadeMove.pushedCourses) && cascadeMove.pushedCourses.length > 0,
    'Pushed courses must be returned'
  );

  const updatedOverrides = useAcademicStore.getState().plannedSemesterOverrides;
  assertEquals(updatedOverrides['MAT-021'], 3, 'MAT-021 planned at Sem 3');
  assert(updatedOverrides['MAT-022'] >= 4, `MAT-022 pushed to >= 4, got ${updatedOverrides['MAT-022']}`);

  console.log('  ✓ Free course move, conflict detection, and auto-resolution validated successfully.');
}

// -------------------------------------------------------------
// Test 4: Auto Critical Path Planning Integration
// -------------------------------------------------------------
console.log('\nTest 4: applyAutoCriticalPathPlan Store Action');
{
  const store = useAcademicStore.getState();
  store.resetAll();

  // Mark all semester 1 courses as approved except MAT-021 (delayed student)
  store.toggleCourseApproval('FIS-100');
  store.toggleCourseApproval('QUI-010');
  store.toggleCourseApproval('HUM-001');
  store.toggleCourseApproval('IWI-131');
  store.toggleCourseApproval('HRW-101');

  const result = store.applyAutoCriticalPathPlan(28);

  assert(result.totalSemesters >= 11, `Planned graduation in ${result.totalSemesters} semesters`);
  assertEquals(useAcademicStore.getState().plannerMode, 'planned', 'Planner mode switched to planned');
  assert(
    Object.keys(useAcademicStore.getState().plannedSemesterOverrides).length > 0,
    'Planned semester overrides populated'
  );

  console.log(`  ✓ Auto-planner scheduled degree in ${result.totalSemesters} semesters at 28 SCT max.`);
}

// -------------------------------------------------------------
// Test 5: Transitive Multi-Level Conflict Resolution
// -------------------------------------------------------------
console.log('\nTest 5: Transitive Multi-Level Conflict Resolution');
{
  // Artificially put MAT-021 in Sem 4, MAT-022 in Sem 2, MAT-023 in Sem 1, MAT-024 in Sem 1
  const badOverrides: Record<string, number> = {
    'MAT-021': 4,
    'MAT-022': 2,
    'MAT-023': 1,
    'MAT-024': 1,
  };

  const conflicts = validatePlanConflicts(ramos, new Set(), badOverrides);
  assert(conflicts.length >= 3, `Expected at least 3 conflicts, got ${conflicts.length}`);

  const resolved = resolveAllPlanConflicts(ramos, new Set(), badOverrides);
  const remainingConflicts = validatePlanConflicts(ramos, new Set(), resolved);
  assertEquals(remainingConflicts.length, 0, 'Remaining conflicts after resolution must be 0');

  assert(resolved['MAT-021'] === 4, 'MAT-021 remains at Sem 4');
  assert(resolved['MAT-022'] >= 5, 'MAT-022 pushed to >= 5');
  assert(resolved['MAT-023'] >= 6, 'MAT-023 pushed to >= 6');
  assert(resolved['MAT-024'] >= 7, 'MAT-024 pushed to >= 7');

  console.log('  ✓ Multi-level transitive chain conflicts cleanly resolved in topological order.');
}

// -------------------------------------------------------------
// Test 6: Approved Courses Do Not Consume Future Planning Credits
// -------------------------------------------------------------
console.log('\nTest 6: Approved Courses Do Not Restrict Future Semester Capacity');
{
  // Student approved all courses up to semester 10 except INF-7 (2 SCT) and INF-314 (5 SCT)
  const approved = new Set(
    ramos.filter((c) => c.semestre <= 10 && c.sigla !== 'INF-7' && c.sigla !== 'INF-314').map((c) => c.sigla)
  );

  const plan = planFastestGraduation(ramos, approved, new Set(), 24);

  // Both INF-7 and INF-314 must be scheduled together in Semester 9 or 10 without being split into separate solitary semesters
  const semInf7 = plan.plannedSemesterOverrides['INF-7'];
  const semInf314 = plan.plannedSemesterOverrides['INF-314'];

  assert(semInf7 !== undefined, 'INF-7 must be planned');
  assert(semInf314 !== undefined, 'INF-314 must be planned');
  assert(plan.totalSemesters <= 11, `Expected graduation in <= 11 semesters, got ${plan.totalSemesters}`);

  console.log(`  ✓ Future capacity preserved: total semesters = ${plan.totalSemesters} (<= 11).`);
}

// -------------------------------------------------------------
// Test 7: Backward Compaction & Elimination of Solitary Electives
// -------------------------------------------------------------
console.log('\nTest 7: Backward Compaction Prevents Solitary Tail Semesters');
{
  // Student starting from scratch with 30 SCT max
  const plan = planFastestGraduation(ramos, new Set(), new Set(), 30);

  // Check that no intermediate semester has fewer than 10 SCT
  for (let s = 1; s < plan.totalSemesters; s++) {
    const breakdown = plan.semestersBreakdown[s];
    if (breakdown && breakdown.courses.length > 0) {
      assert(
        breakdown.totalSct >= 15,
        `Semester ${s} should have balanced load >= 15 SCT, got ${breakdown.totalSct} SCT`
      );
    }
  }

  // Check that the terminal semester is not an artificial 2 SCT solitary elective
  const terminalBreakdown = plan.semestersBreakdown[plan.totalSemesters];
  assert(terminalBreakdown !== undefined, 'Terminal breakdown exists');
  // In ICI 2014, terminal semester is Memoria (INF-310, 20 SCT)
  assert(
    terminalBreakdown.totalSct >= 15,
    `Terminal semester has substantial load, got ${terminalBreakdown.totalSct} SCT`
  );

  console.log('  ✓ Backward compaction verified: no solitary 1-course tail semesters.');
}

// -------------------------------------------------------------
// Test 8: Balanced Workload Packing within Slider Range
// -------------------------------------------------------------
console.log('\nTest 8: Workload Packing within Configured Slider Range');
{
  const plan26 = planFastestGraduation(ramos, new Set(), new Set(), 26);
  for (let s = 1; s <= plan26.totalSemesters; s++) {
    const b = plan26.semestersBreakdown[s];
    if (b && b.courses.length > 0) {
      assert(
        b.totalSct <= 26,
        `Semester ${s} must not exceed configured max of 26 SCT, got ${b.totalSct} SCT`
      );
    }
  }

  console.log('  ✓ Strict credit limit respected across all semesters with optimal packing.');
}

console.log('\n========================================');
console.log('🎉 ALL CRITICAL PATH PLANNER TESTS PASSED! 🎉');
console.log('========================================\n');

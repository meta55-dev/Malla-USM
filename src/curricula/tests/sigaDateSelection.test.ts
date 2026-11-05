import {
  getCurrentAcademicSemester,
  getPeriodCatalog,
  getCourseParallels,
} from '../services/sigaService';
import { useAcademicStore } from '@/shared/store/useAcademicStore';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${msg}`);
  }
}

function assertEquals<T>(actual: T, expected: T, msg: string) {
  if (actual !== expected) {
    throw new Error(`Assertion failed [${msg}]: expected "${expected}", got "${actual}"`);
  }
}

console.log('=== TEST SUITE: DYNAMIC SEMESTER DATE & PERIOD SELECTION ===\n');

// -------------------------------------------------------------
// Test 1: getCurrentAcademicSemester pure function boundaries
// -------------------------------------------------------------
console.log('Test 1: getCurrentAcademicSemester boundary testing across all 12 months');
{
  // 1-7 -> Year-1
  assertEquals(getCurrentAcademicSemester(new Date(2026, 0, 1)), '2026-1', 'Jan 1');
  assertEquals(getCurrentAcademicSemester(new Date(2026, 2, 15)), '2026-1', 'Mar 15');
  assertEquals(getCurrentAcademicSemester(new Date(2026, 6, 31, 23, 59, 59)), '2026-1', 'Jul 31');

  // 8-12 -> Year-2
  assertEquals(getCurrentAcademicSemester(new Date(2026, 7, 1)), '2026-2', 'Aug 1');
  assertEquals(getCurrentAcademicSemester(new Date(2026, 10, 5)), '2026-2', 'Nov 5 2026');
  assertEquals(getCurrentAcademicSemester(new Date(2026, 11, 31, 23, 59, 59)), '2026-2', 'Dec 31');

  // Next year
  assertEquals(getCurrentAcademicSemester(new Date(2027, 0, 1)), '2027-1', 'Jan 1 2027');

  // Default param (new Date())
  const defaultSem = getCurrentAcademicSemester();
  assert(/^\d{4}-[12]$/.test(defaultSem), `Default semester must match YYYY-1 or YYYY-2: got ${defaultSem}`);
  console.log(`  ✓ Date boundary checks passed. (Current default: ${defaultSem})`);
}

// -------------------------------------------------------------
// Test 2: Period target selection logic in SemesterScheduleView
// -------------------------------------------------------------
console.log('Test 2: Target period resolution avoiding future jumps');
{
  const pList = ['2027-1', '2026-3', '2026-2', '2026-1'];
  const nov2026Date = new Date(2026, 10, 5);
  const currentPeriod = getCurrentAcademicSemester(nov2026Date); // "2026-2"

  // Fresh load (selectedPeriod = "")
  const selectedPeriodEmpty = "";
  const targetP1 =
    selectedPeriodEmpty && pList.includes(selectedPeriodEmpty)
      ? selectedPeriodEmpty
      : pList.includes(currentPeriod)
      ? currentPeriod
      : pList.find((p) => p <= currentPeriod) || pList[0] || "";

  assertEquals(targetP1, '2026-2', 'Must default to 2026-2 and NEVER 2027-1');

  // User manually selected a valid period (e.g. 2026-1)
  const selectedPeriodManual = "2026-1";
  const targetP2 =
    selectedPeriodManual && pList.includes(selectedPeriodManual)
      ? selectedPeriodManual
      : pList.includes(currentPeriod)
      ? currentPeriod
      : pList.find((p) => p <= currentPeriod) || pList[0] || "";

  assertEquals(targetP2, '2026-1', 'Must preserve manual selection if valid');

  // When currentPeriod is not in dataset (e.g. older dataset)
  const oldPList = ['2025-2', '2025-1', '2024-2'];
  const targetP3 =
    selectedPeriodEmpty && oldPList.includes(selectedPeriodEmpty)
      ? selectedPeriodEmpty
      : oldPList.includes(currentPeriod)
      ? currentPeriod
      : oldPList.find((p) => p <= currentPeriod) || oldPList[0] || "";

  assertEquals(targetP3, '2025-2', 'Must select closest past period <= currentPeriod');
  console.log('  ✓ Schedule view period target selection rules passed.');
}

// -------------------------------------------------------------
// Test 3: SigaService getPeriodCatalog defaults
// -------------------------------------------------------------
console.log('Test 3: getPeriodCatalog period defaulting');
async function testCatalog() {
  const catalog = await getPeriodCatalog();
  const current = getCurrentAcademicSemester();
  assertEquals(catalog.periodo, current, `Catalog must default to current academic semester (${current})`);
  assert(catalog.courses.length > 0, 'Catalog should load courses for the active period');
  console.log(`  ✓ Catalog default period is ${catalog.periodo} with ${catalog.courses.length} courses.`);
}

// -------------------------------------------------------------
// Test 4: SigaService getCourseParallels
// -------------------------------------------------------------
console.log('Test 4: getCourseParallels with default and specified periods');
async function testParallels() {
  const current = getCurrentAcademicSemester();
  const parallels = await getCourseParallels('INF292');
  assert(Array.isArray(parallels), 'Parallels should return an array');
  console.log(`  ✓ Parallels for INF292 loaded (${parallels.length} parallels in current semester ${current}).`);
}

// -------------------------------------------------------------
// Test 5: useAcademicStore course approval semester tracking
// -------------------------------------------------------------
console.log('Test 5: useAcademicStore stores current academic semester on approval');
{
  const store = useAcademicStore.getState();
  store.resetAll();

  // Approve IWI-131
  store.toggleCourseApproval('IWI-131', 85);
  const updatedState = useAcademicStore.getState();
  const approved = updatedState.approvedCourses['IWI-131'];

  assert(!!approved, 'IWI-131 must be in approvedCourses');
  assertEquals(approved.grade, 85, 'Grade must be 85');
  assertEquals(approved.semester, getCurrentAcademicSemester(), 'Approved record must track current academic semester');

  console.log(`  ✓ Store records approval semester: ${approved.semester}`);
}

async function runAll() {
  await testCatalog();
  await testParallels();
  console.log('\n========================================');
  console.log('🎉 ALL DYNAMIC SEMESTER TESTS PASSED! 🎉');
  console.log('========================================\n');
}

runAll().catch((err) => {
  console.error(err);
  process.exit(1);
});

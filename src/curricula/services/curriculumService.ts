import {
  CurriculumPlan,
  Course,
  CareerPlanCatalogItem,
  AreaInfo,
} from '@/shared/types/academic';
import ici2014Data from '@/curricula/careers/ici-2014.json';
import {
  sigaService,
  RawSigaCareerEntry,
  formatUsmSigla,
} from '@/curricula/services/sigaService';

const DEFAULT_AREAS: Record<string, AreaInfo> = {
  MFQ: { nombre: 'Matemáticas, Físicas y Química', color: '#008B8B' },
  IC: { nombre: 'Industrial, Comercial y Gestión', color: '#4682B4' },
  HEFL: { nombre: 'Humanistas, Inglés, Deportes y Libres', color: '#9ACD32' },
  TI: { nombre: 'Transversal, Proyectos y Titulación', color: '#A52A2A' },
  FI: { nombre: 'Ciencias de la Ingeniería y Especialidad', color: '#1E5AA8' },
  SID: { nombre: 'Sistemas y Optimización', color: '#8B2635' },
  ISD: { nombre: 'Diseño y Desarrollo Aplicado', color: '#F4C430' },
  ITIC: { nombre: 'Infraestructura, Redes y Hardware', color: '#5D4777' },
  CCI: { nombre: 'Computación y Modelamiento', color: '#2E8B57' },
  ELEC: { nombre: 'Asignaturas Electivas y Optativos', color: '#F28C28' },
};

function inferAreaFromCourse(sigla: string, nombre: string, depto: string): string {
  const s = sigla.toUpperCase();
  const n = nombre.toUpperCase();
  const d = depto.toUpperCase();

  if (n.includes('ELECTIV') || n.includes('OPTATIV')) return 'ELEC';
  if (
    s.startsWith('MAT') ||
    s.startsWith('FIS') ||
    s.startsWith('QUI') ||
    d.includes('MATEM') ||
    d.includes('FÍSIC') ||
    d.includes('QUÍMIC')
  ) {
    return 'MFQ';
  }
  if (
    s.startsWith('DEW') ||
    s.startsWith('EFI') ||
    s.startsWith('HRW') ||
    s.startsWith('HCW') ||
    s.startsWith('HIW') ||
    s.startsWith('HFW') ||
    s.startsWith('HAA') ||
    s.startsWith('HAH') ||
    s.startsWith('HAF') ||
    d.includes('HUMAN') ||
    d.includes('DEFIDER') ||
    n.includes('LIBRE') ||
    n.includes('INGLÉS') ||
    n.includes('DEPORTE')
  ) {
    return 'HEFL';
  }
  if (
    s.startsWith('ICN') ||
    s.startsWith('IWN') ||
    s.startsWith('ILN') ||
    s.startsWith('ICS') ||
    d.includes('INDUSTRIA') ||
    d.includes('COMERCIAL') ||
    n.includes('ECONOM') ||
    n.includes('FINANC') ||
    n.includes('ADMINISTRAC')
  ) {
    return 'IC';
  }
  if (
    n.includes('TÍTULO') ||
    n.includes('TITULACIÓN') ||
    n.includes('MEMORIA') ||
    n.includes('INTRODUCCIÓN A LA INGENIERÍA') ||
    n.includes('PROYECTO') ||
    s.startsWith('IWG')
  ) {
    return 'TI';
  }
  if (
    s.startsWith('ELO') ||
    s.startsWith('TEL') ||
    s.startsWith('ELI') ||
    n.includes('REDES') ||
    n.includes('ARQUITECTURA') ||
    n.includes('SISTEMAS OPERATIVOS') ||
    n.includes('DISTRIBUIDOS')
  ) {
    return 'ITIC';
  }
  return 'FI';
}

/**
 * Convierte un plan crudo de `planes_carreras.json` en un `CurriculumPlan` compatible
 * con el motor de grafos DAG y la interfaz de Malla-USM.
 */
export function convertRawSigaPlanToCurriculum(
  career: RawSigaCareerEntry,
  mentionId: string,
  planInternalId: string
): CurriculumPlan | null {
  const mention = career['menciones/especialidades']?.[mentionId];
  if (!mention) return null;
  const planObj = mention.planes?.[planInternalId];
  if (!planObj || !Array.isArray(planObj.malla)) return null;

  // Primero recolectamos todas las siglas presentes en la malla para filtrar prerrequisitos externos
  const validSiglasInPlan = new Set<string>();
  const rawToFormattedMap = new Map<string, string>();

  for (const semObj of planObj.malla) {
    for (const rawSigla of Object.keys(semObj)) {
      const formatted = formatUsmSigla(rawSigla);
      validSiglasInPlan.add(formatted);
      rawToFormattedMap.set(rawSigla.replace(/[-_\s]+/g, '').toUpperCase(), formatted);
    }
  }

  const ramos: Course[] = [];
  let idCounter = 1;

  planObj.malla.forEach((semObj, semIdx) => {
    const semesterNumber = semIdx + 1;
    for (const [rawSigla, rawCourse] of Object.entries(semObj)) {
      const sigla = formatUsmSigla(rawSigla);
      const sct = Number(rawCourse.creditos) || 0;
      const usmCredits = Math.max(1, Math.round(sct * 0.6));

      // Extraer prerrequisitos del primer grupo DNF cuyos ramos existan dentro del mismo plan
      // para mantener el DAG limpio y navegable
      const prereqsSet = new Set<string>();
      if (Array.isArray(rawCourse.requisitos) && rawCourse.requisitos.length > 0) {
        const matchingGroup =
          rawCourse.requisitos.find((group) =>
            group.every((req) =>
              rawToFormattedMap.has(req.sigla.replace(/[-_\s]+/g, '').toUpperCase())
            )
          ) || rawCourse.requisitos[0];

        for (const req of matchingGroup) {
          const cleanKey = req.sigla.replace(/[-_\s]+/g, '').toUpperCase();
          const mappedSigla = rawToFormattedMap.get(cleanKey);
          if (mappedSigla && mappedSigla !== sigla) {
            prereqsSet.add(mappedSigla);
          }
        }
      }

      ramos.push({
        id: idCounter++,
        sigla,
        nombre: rawCourse.nombre,
        semestre: semesterNumber,
        creditos_usm: usmCredits,
        creditos_sct: sct,
        area: inferAreaFromCourse(sigla, rawCourse.nombre, rawCourse.departamento || ''),
        prerrequisitos: Array.from(prereqsSet),
        departamento: rawCourse.departamento,
        requisito_licenciatura: rawCourse.requisito_licenciatura,
        horas: rawCourse.horas,
        requisitos_dnf: rawCourse.requisitos,
        equivalencias_dnf: rawCourse.equivalencias,
      });
    }
  });

  const mentionSuffix =
    mention.nombre && mention.nombre.toLowerCase() !== 'sin mención'
      ? ` (${mention.nombre})`
      : '';

  const totalSct = ramos.reduce((acc, r) => acc + (r.creditos_sct || 0), 0);
  const totalUsm = ramos.reduce((acc, r) => acc + (r.creditos_usm || 0), 0);

  return {
    carrera: `${career.nombre}${mentionSuffix}`,
    codigo_plan: career.código,
    plan: planObj.plan,
    sede: career.sede,
    jornada: career.jornada,
    mencion: mention.nombre,
    universidad: 'Universidad Técnica Federico Santa María',
    semestres_totales: planObj.malla.length,
    creditos_totales_sct: totalSct,
    creditos_totales_usm: totalUsm,
    escala_notas: { minima: 0, maxima: 100, aprobacion: 55 },
    areas: DEFAULT_AREAS,
    ramos,
  };
}

class CurriculumService {
  private cache: Map<string, CurriculumPlan> = new Map();
  private catalogCache: CareerPlanCatalogItem[] | null = null;

  constructor() {
    this.cache.set('7313-2014', {
      ...(ici2014Data as CurriculumPlan),
      sede: 'Casa Central Valparaíso',
      jornada: 'Diurna',
      semestres_totales: 11,
    });
  }

  /**
   * Obtiene el catálogo completo de carreras, sedes y planes disponibles desde `planes_carreras.json`
   * incluyendo siempre el plan canónico ICI 2014 (`7313-2014`).
   */
  async getCatalogPlans(): Promise<CareerPlanCatalogItem[]> {
    if (this.catalogCache) return this.catalogCache;

    const canonicalItem: CareerPlanCatalogItem = {
      id: '7313-2014',
      sede: 'Casa Central Valparaíso',
      jornada: 'Diurna',
      careerCode: '73-1',
      careerName: 'Ingeniería Civil Informática (Malla Clásica 2014)',
      mentionId: '0',
      mentionName: 'Sin mención',
      planInternalId: '7313-2014',
      planCode: '7313 (2014)',
      semestersCount: 11,
      coursesCount: (ici2014Data as CurriculumPlan).ramos.length,
    };

    const rawCareers = await sigaService.getCarrerasDataset();
    if (!rawCareers || !Array.isArray(rawCareers)) {
      return [canonicalItem];
    }

    const items: CareerPlanCatalogItem[] = [canonicalItem];

    for (const career of rawCareers) {
      if (!career['menciones/especialidades']) continue;
      for (const [menId, menObj] of Object.entries(career['menciones/especialidades'])) {
        if (!menObj.planes) continue;
        for (const [planIntId, planObj] of Object.entries(menObj.planes)) {
          if (!planObj.malla || planObj.malla.length === 0) continue;
          const coursesCount = planObj.malla.reduce(
            (acc, sem) => acc + Object.keys(sem).length,
            0
          );
          if (coursesCount === 0) continue;

          const id = `${career.sede}|${career.jornada}|${career.código}|${menId}|${planIntId}`;
          const converted = convertRawSigaPlanToCurriculum(career, menId, planIntId);
          if (converted) {
            this.cache.set(id, converted);
          }

          items.push({
            id,
            sede: career.sede,
            jornada: career.jornada,
            careerCode: career.código,
            careerName: career.nombre,
            mentionId: menId,
            mentionName: menObj.nombre,
            planInternalId: planIntId,
            planCode: planObj.plan,
            semestersCount: planObj.malla.length,
            coursesCount,
          });
        }
      }
    }

    this.catalogCache = items;
    return items;
  }

  /**
   * Recupera un plan curricular por su ID compuesto o devuelve ICI-2014 por defecto.
   */
  async getCurriculum(planId: string = '7313-2014'): Promise<CurriculumPlan> {
    if (!this.cache.has(planId)) {
      await this.getCatalogPlans();
    }
    const plan = this.cache.get(planId);
    if (!plan) {
      if (planId === '7313-2014') {
        const canonical = this.cache.get('7313-2014');
        if (canonical) return JSON.parse(JSON.stringify(canonical));
      }
      throw new Error(`Plan curricular con id "${planId}" no encontrado en catálogo.`);
    }
    return JSON.parse(JSON.stringify(plan));
  }

  async getAvailablePlans(): Promise<
    Array<{ id: string; name: string; plan: string; university: string; sede?: string }>
  > {
    const catalog = await this.getCatalogPlans();
    return catalog.map((item) => ({
      id: item.id,
      name: item.careerName,
      plan: item.planCode,
      sede: item.sede,
      university: 'Universidad Técnica Federico Santa María',
    }));
  }

  async getCourseBySigla(sigla: string, planId: string = '7313-2014'): Promise<Course | null> {
    const plan = await this.getCurriculum(planId);
    const normalized = sigla.trim().toUpperCase();
    return plan.ramos.find((c) => c.sigla.toUpperCase() === normalized) || null;
  }

  async getTotalSctCredits(planId: string = '7313-2014'): Promise<number> {
    const plan = await this.getCurriculum(planId);
    return plan.ramos.reduce((sum, c) => sum + (c.creditos_sct || 0), 0);
  }

  async getTotalUsmCredits(planId: string = '7313-2014'): Promise<number> {
    const plan = await this.getCurriculum(planId);
    return plan.ramos.reduce((sum, c) => sum + (c.creditos_usm || 0), 0);
  }
}

export const curriculumService = new CurriculumService();

export async function getCatalogPlans(): Promise<CareerPlanCatalogItem[]> {
  return curriculumService.getCatalogPlans();
}

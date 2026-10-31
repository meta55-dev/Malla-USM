import { USM_BAR_DAYS, USM_BLOCK_PAIRS } from "@/curricula/services/sigaService";
import { Card, CardContent } from "@/frontend/components/ui/card";
import { Badge } from "@/frontend/components/ui/badge";
import { Calendar, Clock, Eye, MapPin } from "lucide-react";

export interface ScheduledCellEntry {
  sigla: string;
  nombre: string;
  paralelo: string;
  tipo: string;
  sala: string;
  profesor: string;
  color: string;
  isPreview?: boolean;
}

export interface ScheduleGridTableProps {
  visibleDays: number[];
  activeComboPreviewRank?: number | null;
  gridMap: Record<string, ScheduledCellEntry[]>;
}

export function ScheduleGridTable({
  visibleDays,
  activeComboPreviewRank,
  gridMap,
}: ScheduleGridTableProps) {
  return (
    <div className="lg:col-span-8 space-y-3">
      <div className="flex items-center justify-between h-5">
        <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <Calendar className="h-4 w-4 text-[#002B49] dark:text-[#D99B00]" />
          <span>Horario Semanal de Bloques</span>
        </h3>
        {activeComboPreviewRank !== undefined && activeComboPreviewRank !== null && (
          <Badge
            variant="outline"
            className="text-[10px] font-semibold border-[#D99B00] text-amber-700 dark:text-amber-300 bg-amber-500/10 gap-1 animate-in fade-in"
          >
            <Eye className="h-3 w-3 text-[#D99B00]" />
            <span>Previsualizando Opción {activeComboPreviewRank}</span>
          </Badge>
        )}
      </div>

      <Card className="overflow-hidden">
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full border-collapse text-xs min-w-[640px]">
            <thead>
              <tr className="bg-[#002B49] text-white">
                <th className="p-2.5 text-left font-semibold w-28 border-r border-white/15">
                  <div className="flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 text-[#D99B00]" />
                    <span>Bloque USM</span>
                  </div>
                </th>
                {visibleDays.map((diaIdx) => (
                  <th
                    key={diaIdx}
                    className="p-2.5 text-center font-semibold border-r border-white/15 last:border-r-0"
                  >
                    {USM_BAR_DAYS[diaIdx]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {USM_BLOCK_PAIRS.map((pairObj) => (
                <tr key={pairObj.pair} className="hover:bg-muted/20">
                  {/* Block Time Column */}
                  <td className="p-2 border-r bg-muted/30 align-middle">
                    <div className="font-bold text-foreground font-mono">
                      Bloque {pairObj.pair}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {pairObj.time}
                    </div>
                  </td>

                  {/* Day Cells */}
                  {visibleDays.map((diaIdx) => {
                    const cellKey = `${diaIdx}-${pairObj.pair}`;
                    const entries = gridMap[cellKey] || [];
                    const nonPreviewCount = entries.filter(
                      (e) => !e.isPreview
                    ).length;
                    const isConflict = entries.length > 1;

                    return (
                      <td
                        key={cellKey}
                        className={`p-1.5 border-r last:border-r-0 align-top h-20 w-[18%] transition-colors ${
                          isConflict ? "bg-destructive/10" : ""
                        }`}
                      >
                        <div className="space-y-1">
                          {entries.map((entry) => (
                            <div
                              key={`${entry.sigla}-${entry.paralelo}-${
                                entry.isPreview ? "prev" : "fixed"
                              }`}
                              className={`p-1.5 rounded border text-[11px] leading-tight shadow-2xs transition-all ${
                                entry.isPreview
                                  ? isConflict
                                    ? "border-dashed border-2 border-destructive bg-destructive/20 animate-pulse"
                                    : "border-dashed border-2 border-[#D99B00] bg-[#D99B00]/15"
                                  : nonPreviewCount > 1
                                  ? "border-destructive bg-destructive/15"
                                  : "bg-card"
                              }`}
                              style={
                                !entry.isPreview
                                  ? {
                                      borderLeftWidth: "4px",
                                      borderLeftColor:
                                        nonPreviewCount > 1
                                          ? "#EF4444"
                                          : entry.color,
                                    }
                                  : undefined
                              }
                            >
                              <div className="flex items-center justify-between gap-1 font-bold">
                                <span className="font-mono flex items-center gap-1">
                                  {entry.isPreview && (
                                    <Eye className="h-3 w-3 text-[#D99B00]" />
                                  )}
                                  {entry.sigla}
                                </span>
                                <span className="text-[10px] px-1 rounded bg-muted font-normal">
                                  {entry.tipo} • P{entry.paralelo}
                                </span>
                              </div>
                              <div className="text-[10px] text-muted-foreground truncate mt-0.5">
                                {entry.profesor || entry.nombre}
                              </div>
                              <div className="flex items-center justify-between gap-1 mt-0.5">
                                {entry.sala && (
                                  <span className="text-[10px] font-semibold text-foreground flex items-center gap-0.5">
                                    <MapPin className="h-2.5 w-2.5 text-[#D99B00]" />
                                    <span>{entry.sala}</span>
                                  </span>
                                )}
                                {entry.isPreview && isConflict && (
                                  <span className="text-[9px] font-bold text-destructive uppercase">
                                    ¡Tope!
                                  </span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

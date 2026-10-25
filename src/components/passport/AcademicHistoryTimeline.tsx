import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AcademicRecord } from "@/hooks/useStudentPassport";
import { Calendar, GraduationCap, Trophy, Star, Award, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";

interface AcademicHistoryTimelineProps {
  records: AcademicRecord[];
}

export function AcademicHistoryTimeline({ records }: AcademicHistoryTimelineProps) {
  if (records.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Calendar className="h-4 w-4 text-primary" />
          Academic History
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="relative">
          {/* Timeline line */}
          <div className="absolute left-4 top-0 bottom-0 w-px bg-border" />

          <div className="space-y-6">
            {records.map((record, idx) => (
              <motion.div
                key={record.id || idx}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.1 }}
                className="relative pl-10"
              >
                {/* Timeline dot */}
                <div className={cn(
                  "absolute left-2.5 top-1 w-3 h-3 rounded-full border-2",
                  idx === 0
                    ? "bg-primary border-primary"
                    : "bg-background border-muted-foreground/40"
                )} />

                <div className="p-4 rounded-lg border bg-card space-y-3">
                  {/* Year & Class */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <GraduationCap className="h-4 w-4 text-primary" />
                      <span className="font-semibold text-sm">{record.class_name}</span>
                      {record.section_name && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          {record.section_name}
                        </Badge>
                      )}
                    </div>
                    <Badge variant="secondary" className="text-xs">
                      {record.academic_year}
                    </Badge>
                  </div>

                  {/* Stats grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                    <MiniStat
                      icon={<Trophy className="h-3 w-3 text-green-500" />}
                      label="Exams"
                      value={`${record.exams_passed}/${record.total_exams}`}
                    />
                    <MiniStat
                      icon={<Star className="h-3 w-3 text-amber-500" />}
                      label="Avg Score"
                      value={`${record.average_percentage.toFixed(1)}%`}
                    />
                    <MiniStat
                      icon={<Award className="h-3 w-3 text-purple-500" />}
                      label="Points"
                      value={record.total_points_earned}
                    />
                    <MiniStat
                      icon={<Award className="h-3 w-3 text-blue-500" />}
                      label="Badges"
                      value={record.badges_earned}
                    />
                  </div>

                  {/* Ranks */}
                  {(record.rank_in_class || record.rank_in_institution) && (
                    <div className="flex gap-3 text-xs">
                      {record.rank_in_class && (
                        <span className="text-muted-foreground">
                          Class Rank: <strong className="text-foreground">#{record.rank_in_class}</strong>
                        </span>
                      )}
                      {record.rank_in_institution && (
                        <span className="text-muted-foreground">
                          School Rank: <strong className="text-foreground">#{record.rank_in_institution}</strong>
                        </span>
                      )}
                    </div>
                  )}

                  {/* Remarks */}
                  {record.remarks && (
                    <div className="flex items-start gap-2 p-2 bg-muted/50 rounded text-xs">
                      <MessageSquare className="h-3 w-3 text-muted-foreground mt-0.5 flex-shrink-0" />
                      <p className="text-muted-foreground italic">{record.remarks}</p>
                    </div>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function MiniStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | number }) {
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-center gap-1">
        {icon}
        <span className="font-bold text-sm">{value}</span>
      </div>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}

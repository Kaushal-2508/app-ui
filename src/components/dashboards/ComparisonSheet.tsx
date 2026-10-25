import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeftRight, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

interface ComparisonEntity {
  id: string;
  name: string;
  metrics: { label: string; value: number; format?: string }[];
}

interface ComparisonSheetProps {
  entityType: "class" | "teacher" | "subject";
  entities: ComparisonEntity[];
  trigger?: React.ReactNode;
}

export function ComparisonSheet({ entityType, entities, trigger }: ComparisonSheetProps) {
  const [entityA, setEntityA] = useState<string | null>(null);
  const [entityB, setEntityB] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const a = entities.find(e => e.id === entityA);
  const b = entities.find(e => e.id === entityB);

  const chartData = a && b ? a.metrics.map((m, i) => ({
    metric: m.label,
    [a.name]: m.value,
    [b.name]: b.metrics[i]?.value || 0,
  })) : [];

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm" className="rounded-xl">
            <ArrowLeftRight className="h-4 w-4 mr-2" /> Compare
          </Button>
        )}
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="capitalize">Compare {entityType}s</SheetTitle>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Selectors */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">First {entityType}</label>
              <Select value={entityA || ""} onValueChange={setEntityA}>
                <SelectTrigger className="rounded-xl"><SelectValue placeholder={`Select ${entityType}`} /></SelectTrigger>
                <SelectContent className="rounded-xl">
                  {entities.filter(e => e.id !== entityB).map(e => (
                    <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Second {entityType}</label>
              <Select value={entityB || ""} onValueChange={setEntityB}>
                <SelectTrigger className="rounded-xl"><SelectValue placeholder={`Select ${entityType}`} /></SelectTrigger>
                <SelectContent className="rounded-xl">
                  {entities.filter(e => e.id !== entityA).map(e => (
                    <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Comparison View */}
          {a && b && (
            <>
              {/* Side-by-side KPIs */}
              <div className="space-y-3">
                {a.metrics.map((m, i) => {
                  const bVal = b.metrics[i]?.value || 0;
                  const diff = m.value - bVal;
                  const DiffIcon = diff > 0 ? TrendingUp : diff < 0 ? TrendingDown : Minus;
                  const diffColor = diff > 0 ? "text-emerald-600" : diff < 0 ? "text-rose-600" : "text-muted-foreground";
                  return (
                    <div key={i} className="grid grid-cols-[1fr_auto_1fr] gap-3 items-center">
                      <Card className="rounded-xl border-0 bg-gradient-to-r from-blue-500 to-indigo-600 text-white">
                        <CardContent className="p-3 text-center">
                          <div className="text-xl font-bold">{m.format === "%" ? `${m.value.toFixed(1)}%` : m.value}</div>
                          <p className="text-[10px] text-white/70">{m.label}</p>
                        </CardContent>
                      </Card>
                      <div className={`text-center ${diffColor}`}>
                        <DiffIcon className="h-4 w-4 mx-auto" />
                        <span className="text-xs font-bold">{diff > 0 ? "+" : ""}{diff.toFixed(1)}</span>
                      </div>
                      <Card className="rounded-xl border-0 bg-gradient-to-r from-purple-500 to-fuchsia-600 text-white">
                        <CardContent className="p-3 text-center">
                          <div className="text-xl font-bold">{m.format === "%" ? `${bVal.toFixed(1)}%` : bVal}</div>
                          <p className="text-[10px] text-white/70">{m.label}</p>
                        </CardContent>
                      </Card>
                    </div>
                  );
                })}
              </div>

              {/* Overlay Chart */}
              <Card className="rounded-2xl">
                <CardContent className="p-4">
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="metric" tick={{ fontSize: 10 }} />
                        <YAxis />
                        <Tooltip contentStyle={{ borderRadius: "12px" }} />
                        <Legend />
                        <Bar dataKey={a.name} fill="#6366F1" radius={[8, 8, 0, 0]} />
                        <Bar dataKey={b.name} fill="#A855F7" radius={[8, 8, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </>
          )}

          {(!a || !b) && (
            <div className="text-center py-12 text-muted-foreground">
              <ArrowLeftRight className="h-12 w-12 mx-auto mb-4 opacity-30" />
              <p>Select two {entityType}s to compare</p>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

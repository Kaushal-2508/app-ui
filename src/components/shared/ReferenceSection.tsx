import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, ChevronUp, Info, Calculator, Database, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ReferenceData {
  metric: string;
  value: string | number;
  comparison?: string;
  threshold?: string;
  detail?: string;
  type?: "metric" | "calculation" | "threshold" | "context";
}

export interface CalculationStep {
  step: number;
  description: string;
  formula?: string;
  result?: string | number;
}

interface ReferenceSectionProps {
  title?: string;
  references: ReferenceData[];
  calculationSteps?: CalculationStep[];
  thresholdExplanation?: string;
  defaultOpen?: boolean;
  variant?: "inline" | "card" | "minimal";
  className?: string;
}

export function ReferenceSection({
  title = "Why this insight was generated",
  references,
  calculationSteps,
  thresholdExplanation,
  defaultOpen = false,
  variant = "inline",
  className,
}: ReferenceSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  const getTypeIcon = (type?: ReferenceData["type"]) => {
    switch (type) {
      case "calculation":
        return <Calculator className="h-3 w-3 text-blue-500" />;
      case "threshold":
        return <AlertCircle className="h-3 w-3 text-amber-500" />;
      case "context":
        return <Database className="h-3 w-3 text-muted-foreground" />;
      default:
        return <Info className="h-3 w-3 text-muted-foreground" />;
    }
  };

  const content = (
    <div className="space-y-4">
      {/* References Grid */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
          <Database className="h-3 w-3" />
          Data Points Used
        </p>
        <div className="grid gap-2">
          {references.map((ref, idx) => (
            <div
              key={idx}
              className="flex items-start justify-between gap-2 p-2 rounded-md bg-muted/30 text-xs"
            >
              <div className="flex items-start gap-1.5">
                {getTypeIcon(ref.type)}
                <span className="text-muted-foreground">{ref.metric}</span>
              </div>
              <div className="text-right shrink-0">
                <span className="font-medium">{ref.value}</span>
                {ref.comparison && (
                  <span className="text-muted-foreground ml-1">({ref.comparison})</span>
                )}
                {ref.threshold && (
                  <p className="text-[10px] text-muted-foreground">{ref.threshold}</p>
                )}
                {ref.detail && (
                  <p className="text-[10px] text-muted-foreground">{ref.detail}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Calculation Steps */}
      {calculationSteps && calculationSteps.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            <Calculator className="h-3 w-3" />
            Calculation Logic
          </p>
          <div className="space-y-2 pl-4 border-l-2 border-muted">
            {calculationSteps.map((step) => (
              <div key={step.step} className="text-xs">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="h-4 w-4 p-0 justify-center text-[10px]">
                    {step.step}
                  </Badge>
                  <span>{step.description}</span>
                </div>
                {step.formula && (
                  <code className="block mt-1 ml-6 px-2 py-1 bg-muted rounded text-[10px] font-mono">
                    {step.formula}
                  </code>
                )}
                {step.result && (
                  <p className="ml-6 mt-1 text-muted-foreground">
                    Result: <span className="font-medium text-foreground">{step.result}</span>
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Threshold Explanation */}
      {thresholdExplanation && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            <AlertCircle className="h-3 w-3" />
            Why Flagged
          </p>
          <p className="text-xs text-muted-foreground p-2 bg-amber-50 dark:bg-amber-950/20 rounded-md border border-amber-200 dark:border-amber-800">
            {thresholdExplanation}
          </p>
        </div>
      )}
    </div>
  );

  if (variant === "minimal") {
    return (
      <Collapsible open={isOpen} onOpenChange={setIsOpen} className={className}>
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-between text-xs text-muted-foreground hover:text-foreground p-0 h-auto"
          >
            <span className="flex items-center gap-1">
              <Info className="h-3 w-3" />
              {title}
            </span>
            {isOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2">{content}</CollapsibleContent>
      </Collapsible>
    );
  }

  if (variant === "card") {
    return (
      <Card className={className}>
        <Collapsible open={isOpen} onOpenChange={setIsOpen}>
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              className="w-full justify-between p-4 h-auto font-normal"
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                <Info className="h-4 w-4" />
                {title}
              </span>
              {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0">{content}</CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>
    );
  }

  // Inline variant (default)
  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className={className}>
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-between text-xs text-muted-foreground hover:text-foreground"
        >
          <span>{title}</span>
          {isOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 p-3 bg-background/50 rounded-lg">
        {content}
      </CollapsibleContent>
    </Collapsible>
  );
}

// Standalone reference display (non-collapsible)
export function ReferenceDisplay({
  references,
  columns = 2,
  className,
}: {
  references: ReferenceData[];
  columns?: 1 | 2 | 3;
  className?: string;
}) {
  const gridCols = {
    1: "grid-cols-1",
    2: "grid-cols-1 sm:grid-cols-2",
    3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
  };

  return (
    <div className={cn("grid gap-2", gridCols[columns], className)}>
      {references.map((ref, idx) => (
        <div
          key={idx}
          className="flex items-center justify-between p-2 rounded-md bg-muted/50 text-sm"
        >
          <span className="text-muted-foreground">{ref.metric}</span>
          <span className="font-medium">{ref.value}</span>
        </div>
      ))}
    </div>
  );
}

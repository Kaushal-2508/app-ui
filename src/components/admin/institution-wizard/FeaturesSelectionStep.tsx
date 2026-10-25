import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AVAILABLE_FEATURES, CATEGORY_LABELS } from "./featuresData";
import type { FeatureConfig } from "./featuresData";

// Re-export for backward compatibility
export { AVAILABLE_FEATURES, type FeatureConfig };

interface FeaturesSelectionStepProps {
  selectedFeatures: string[];
  onFeaturesChange: (features: string[]) => void;
  maxHeight?: string;
}

export function FeaturesSelectionStep({
  selectedFeatures,
  onFeaturesChange,
  maxHeight = "400px",
}: FeaturesSelectionStepProps) {
  const toggleFeature = (featureId: string) => {
    const feature = AVAILABLE_FEATURES.find((f) => f.id === featureId);
    if (feature?.isDefault && feature.category === "core") return;

    if (selectedFeatures.includes(featureId)) {
      onFeaturesChange(selectedFeatures.filter((id) => id !== featureId));
    } else {
      onFeaturesChange([...selectedFeatures, featureId]);
    }
  };

  const selectAllInCategory = (category: string) => {
    const categoryFeatures = AVAILABLE_FEATURES.filter((f) => f.category === category).map((f) => f.id);
    const allSelected = categoryFeatures.every((id) => selectedFeatures.includes(id));
    
    if (allSelected) {
      const coreIds = AVAILABLE_FEATURES.filter((f) => f.category === "core").map((f) => f.id);
      onFeaturesChange(selectedFeatures.filter((id) => !categoryFeatures.includes(id) || coreIds.includes(id)));
    } else {
      onFeaturesChange([...new Set([...selectedFeatures, ...categoryFeatures])]);
    }
  };

  const groupedFeatures = AVAILABLE_FEATURES.reduce((acc, feature) => {
    if (!acc[feature.category]) acc[feature.category] = [];
    acc[feature.category].push(feature);
    return acc;
  }, {} as Record<string, FeatureConfig[]>);

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h3 className="text-lg font-semibold">Select Features</h3>
        <p className="text-sm text-muted-foreground">
          Choose which modules and features this institution will have access to
        </p>
      </div>

      <ScrollArea className="pr-4" style={{ height: maxHeight }}>
        <div className="space-y-6">
          {(["core", "academic", "operations", "advanced"] as const).map((category) => (
            <Card key={category} className="border">
              <CardHeader className="py-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base">{CATEGORY_LABELS[category].label}</CardTitle>
                    <CardDescription className="text-xs">{CATEGORY_LABELS[category].description}</CardDescription>
                  </div>
                  {category !== "core" && (
                    <button
                      type="button"
                      onClick={() => selectAllInCategory(category)}
                      className="text-xs text-primary hover:underline"
                    >
                      {groupedFeatures[category]?.every((f) => selectedFeatures.includes(f.id)) ? "Deselect All" : "Select All"}
                    </button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="grid gap-3 sm:grid-cols-2">
                  {groupedFeatures[category]?.map((feature) => {
                    const Icon = feature.icon;
                    const isSelected = selectedFeatures.includes(feature.id);
                    const isCore = feature.category === "core";

                    return (
                      <div
                        key={feature.id}
                        className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                          isSelected ? "bg-primary/5 border-primary/30" : "hover:bg-muted/50"
                        } ${isCore ? "opacity-75 cursor-not-allowed" : ""}`}
                        onClick={() => toggleFeature(feature.id)}
                      >
                        <Checkbox checked={isSelected} disabled={isCore} onCheckedChange={() => toggleFeature(feature.id)} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <Icon className="h-4 w-4 text-muted-foreground" />
                            <span className="font-medium text-sm">{feature.name}</span>
                            {isCore && <Badge variant="secondary" className="text-xs">Required</Badge>}
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">{feature.description}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </ScrollArea>

      <div className="text-center text-sm text-muted-foreground">
        <span className="font-medium">{selectedFeatures.length}</span> features selected
      </div>
    </div>
  );
}

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2, Bot, Sparkles, ScanText } from "lucide-react";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";

interface ManageQuotasDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  institutionId: string | null;
  institutionName: string;
}

export function ManageQuotasDialog({ open, onOpenChange, institutionId, institutionName }: ManageQuotasDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [formData, setFormData] = useState({
    dailyQuestionLimit: 100,
    dailyTokenLimit: 100000,
    monthlyTokenLimit: 3000000,
    questionGenerationEnabled: true,
    ocrEnabled: true,
  });

  const { data: quota } = useQuery({
    queryKey: ["institution-quota", institutionId],
    queryFn: async () => {
      if (!institutionId) return null;
      const { data } = await supabase
        .from("ai_usage_quotas")
        .select("*")
        .eq("institution_id", institutionId)
        .maybeSingle();
      return data;
    },
    enabled: !!institutionId && open,
  });

  useEffect(() => {
    if (quota) {
      setFormData({
        dailyQuestionLimit: quota.daily_question_limit,
        dailyTokenLimit: quota.daily_token_limit,
        monthlyTokenLimit: quota.monthly_token_limit,
        questionGenerationEnabled: quota.question_generation_enabled,
        ocrEnabled: quota.ocr_enabled,
      });
    }
  }, [quota]);

  const updateQuota = useMutation({
    mutationFn: async () => {
      if (!institutionId) throw new Error("No institution selected");
      
      if (quota) {
        // Update existing
        const { error } = await supabase
          .from("ai_usage_quotas")
          .update({
            daily_question_limit: formData.dailyQuestionLimit,
            daily_token_limit: formData.dailyTokenLimit,
            monthly_token_limit: formData.monthlyTokenLimit,
            question_generation_enabled: formData.questionGenerationEnabled,
            ocr_enabled: formData.ocrEnabled,
          })
          .eq("institution_id", institutionId);
        
        if (error) throw error;
      } else {
        // Insert new
        const { error } = await supabase
          .from("ai_usage_quotas")
          .insert({
            institution_id: institutionId,
            daily_question_limit: formData.dailyQuestionLimit,
            daily_token_limit: formData.dailyTokenLimit,
            monthly_token_limit: formData.monthlyTokenLimit,
            question_generation_enabled: formData.questionGenerationEnabled,
            ocr_enabled: formData.ocrEnabled,
          });
        
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["institution-quota", institutionId] });
      toast({ title: "Quotas updated successfully" });
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update quotas", description: error.message, variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateQuota.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bot className="h-5 w-5" />
              AI Quotas
            </DialogTitle>
            <DialogDescription>
              Manage AI usage limits for {institutionName}
            </DialogDescription>
          </DialogHeader>

          <div className="py-4 space-y-4">
            {/* Feature Toggles */}
            <div className="grid gap-3">
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Sparkles className="h-5 w-5 text-primary" />
                      <div>
                        <Label>Question Generation</Label>
                        <p className="text-xs text-muted-foreground">AI-powered question creation</p>
                      </div>
                    </div>
                    <Switch
                      checked={formData.questionGenerationEnabled}
                      onCheckedChange={(checked) => 
                        setFormData({ ...formData, questionGenerationEnabled: checked })
                      }
                    />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <ScanText className="h-5 w-5 text-primary" />
                      <div>
                        <Label>OCR Processing</Label>
                        <p className="text-xs text-muted-foreground">Scan handwritten answers</p>
                      </div>
                    </div>
                    <Switch
                      checked={formData.ocrEnabled}
                      onCheckedChange={(checked) => 
                        setFormData({ ...formData, ocrEnabled: checked })
                      }
                    />
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Limits */}
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="dailyQuestionLimit">Daily Question Limit</Label>
                <Input
                  id="dailyQuestionLimit"
                  type="number"
                  min={0}
                  value={formData.dailyQuestionLimit}
                  onChange={(e) => setFormData({ ...formData, dailyQuestionLimit: parseInt(e.target.value) || 0 })}
                />
                <p className="text-xs text-muted-foreground">
                  Maximum questions that can be generated per day
                </p>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="dailyTokenLimit">Daily Token Limit</Label>
                <Input
                  id="dailyTokenLimit"
                  type="number"
                  min={0}
                  value={formData.dailyTokenLimit}
                  onChange={(e) => setFormData({ ...formData, dailyTokenLimit: parseInt(e.target.value) || 0 })}
                />
                <p className="text-xs text-muted-foreground">
                  Maximum tokens per day ({(formData.dailyTokenLimit / 1000).toFixed(0)}k tokens)
                </p>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="monthlyTokenLimit">Monthly Token Limit</Label>
                <Input
                  id="monthlyTokenLimit"
                  type="number"
                  min={0}
                  value={formData.monthlyTokenLimit}
                  onChange={(e) => setFormData({ ...formData, monthlyTokenLimit: parseInt(e.target.value) || 0 })}
                />
                <p className="text-xs text-muted-foreground">
                  Maximum tokens per month ({(formData.monthlyTokenLimit / 1000000).toFixed(1)}M tokens)
                </p>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={updateQuota.isPending}>
              {updateQuota.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save Quotas
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

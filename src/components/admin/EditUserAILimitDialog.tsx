import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { useUpdateUserAILimit, useResetUserUsage, UserAIUsage } from "@/hooks/useAIQuotaDashboard";

interface EditUserAILimitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: UserAIUsage | null;
  institutionId: string;
}

export function EditUserAILimitDialog({
  open,
  onOpenChange,
  user,
  institutionId,
}: EditUserAILimitDialogProps) {
  const [dailyLimit, setDailyLimit] = useState(0);
  const updateLimit = useUpdateUserAILimit();
  const resetUsage = useResetUserUsage();

  useEffect(() => {
    if (user) {
      setDailyLimit(user.daily_limit || 50);
    }
  }, [user]);

  if (!user) return null;

  const usagePercent = user.daily_limit > 0 
    ? Math.min((user.questions_used_today / user.daily_limit) * 100, 100) 
    : 0;

  const handleSave = () => {
    updateLimit.mutate(
      { userId: user.user_id, institutionId, dailyLimit },
      { onSuccess: () => onOpenChange(false) }
    );
  };

  const handleReset = () => {
    resetUsage.mutate(user.user_id);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit AI Limit for {user.full_name}</DialogTitle>
          <DialogDescription>
            Set the daily question generation limit for this user.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label className="text-sm text-muted-foreground">Current Usage</Label>
            <div className="flex items-center justify-between text-sm">
              <span>{user.questions_used_today} / {user.daily_limit || "No limit"}</span>
              <span className="text-muted-foreground">{usagePercent.toFixed(0)}%</span>
            </div>
            <Progress 
              value={usagePercent} 
              className={`h-2 ${usagePercent >= 90 ? "[&>div]:bg-destructive" : usagePercent >= 70 ? "[&>div]:bg-yellow-500" : ""}`}
            />
            <Button 
              variant="outline" 
              size="sm" 
              onClick={handleReset}
              disabled={resetUsage.isPending || user.questions_used_today === 0}
              className="mt-2"
            >
              Reset Today's Usage
            </Button>
          </div>

          <div className="space-y-2">
            <Label htmlFor="dailyLimit">Daily Question Limit</Label>
            <Input
              id="dailyLimit"
              type="number"
              min={0}
              max={1000}
              value={dailyLimit}
              onChange={(e) => setDailyLimit(parseInt(e.target.value) || 0)}
            />
            <p className="text-xs text-muted-foreground">
              Set to 0 to disable AI question generation for this user.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={updateLimit.isPending}>
            {updateLimit.isPending ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Smartphone, CheckCircle2 } from "lucide-react";
import { useValidateAndCheckIn } from "@/hooks/useAttendanceSessions";

export function MobileCheckinStudent() {
  const [code, setCode] = useState("");
  const [checkedIn, setCheckedIn] = useState(false);
  const checkIn = useValidateAndCheckIn();

  const handleSubmit = () => {
    if (!code.trim()) return;
    checkIn.mutate(
      { session_code: code.trim().toUpperCase(), class_id: "" },
      { onSuccess: () => setCheckedIn(true) }
    );
  };

  if (checkedIn) {
    return (
      <Card className="rounded-2xl max-w-md mx-auto">
        <CardContent className="py-12 text-center space-y-3">
          <CheckCircle2 className="h-16 w-16 mx-auto text-green-500" />
          <h3 className="text-xl font-semibold">Checked In!</h3>
          <p className="text-muted-foreground">Your attendance has been marked as present.</p>
          <Button variant="outline" onClick={() => { setCheckedIn(false); setCode(""); }}>
            Check in to another class
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-2xl max-w-md mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Smartphone className="h-5 w-5" /> Check In
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Enter the PIN code displayed by your teacher to mark your attendance.
        </p>
        <Input
          placeholder="Enter 6-digit PIN"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          className="text-center text-2xl font-mono tracking-[0.3em] h-14"
          maxLength={12}
        />
        <Button
          onClick={handleSubmit}
          disabled={!code.trim() || checkIn.isPending}
          className="w-full"
        >
          {checkIn.isPending ? "Checking in..." : "Check In"}
        </Button>
      </CardContent>
    </Card>
  );
}

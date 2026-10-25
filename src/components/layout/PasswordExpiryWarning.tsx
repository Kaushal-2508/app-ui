import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { 
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ShieldAlert, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

interface PasswordExpiryInfo {
  daysRemaining: number | null;
  expiresAt: Date | null;
  isExpiringSoon: boolean;
}

export function PasswordExpiryWarning() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [expiryInfo, setExpiryInfo] = useState<PasswordExpiryInfo>({
    daysRemaining: null,
    expiresAt: null,
    isExpiringSoon: false,
  });
  const [showDialog, setShowDialog] = useState(false);
  const [showBanner, setShowBanner] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (user) {
      checkPasswordExpiry(user.id);
    }
  }, [user]);

  const checkPasswordExpiry = async (userId: string) => {
    const { data: profile } = await supabase
      .from("profiles")
      .select("password_expires_at, last_password_change")
      .eq("id", userId)
      .single();

    if (profile?.password_expires_at) {
      const expiresAt = new Date(profile.password_expires_at);
      const now = new Date();
      const diffTime = expiresAt.getTime() - now.getTime();
      const daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      setExpiryInfo({
        daysRemaining,
        expiresAt,
        isExpiringSoon: daysRemaining <= 2 && daysRemaining > 0,
      });

      // Show warning if password expires in 2 days or less
      if (daysRemaining <= 2 && daysRemaining > 0 && !dismissed) {
        setShowDialog(true);
        setShowBanner(true);
      }
    }
  };

  const handleChangePassword = () => {
    setShowDialog(false);
    navigate("/reset-password");
  };

  const handleDismiss = () => {
    setShowDialog(false);
    setDismissed(true);
  };

  if (!expiryInfo.isExpiringSoon || dismissed) {
    return null;
  }

  return (
    <>
      {/* Banner Alert */}
      {showBanner && (
        <Alert className="border-amber-300 bg-amber-50 dark:bg-amber-950/20 rounded-none border-x-0 border-t-0">
          <ShieldAlert className="h-4 w-4 text-amber-600" />
          <AlertDescription className="flex items-center justify-between">
            <span className="text-amber-800 dark:text-amber-200">
              Your password expires in {expiryInfo.daysRemaining} day{expiryInfo.daysRemaining !== 1 ? 's' : ''}. 
              Please change it soon to avoid being locked out.
            </span>
            <div className="flex items-center gap-2">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={handleChangePassword}
                className="border-amber-600 text-amber-700 hover:bg-amber-100"
              >
                Change Password
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => setShowBanner(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Modal Dialog */}
      <AlertDialog open={showDialog} onOpenChange={setShowDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-amber-600">
              <ShieldAlert className="h-5 w-5" />
              Password Expiring Soon
            </AlertDialogTitle>
            <AlertDialogDescription>
              Your password will expire in <strong>{expiryInfo.daysRemaining} day{expiryInfo.daysRemaining !== 1 ? 's' : ''}</strong>
              {expiryInfo.expiresAt && (
                <> (on {expiryInfo.expiresAt.toLocaleDateString()})</>
              )}.
              <br /><br />
              For security reasons, please update your password now to avoid being locked out of your account.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleDismiss}>
              Remind Me Later
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleChangePassword} className="bg-amber-600 hover:bg-amber-700">
              Change Password Now
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
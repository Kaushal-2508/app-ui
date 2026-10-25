import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ShieldX, ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface AccessDeniedProps {
  message?: string;
  description?: string;
  redirectTo?: string;
  redirectLabel?: string;
}

/**
 * Access Denied component for displaying when a user tries to access unauthorized resources.
 * Use this when coordinators try to access classes outside their assigned wings.
 */
export function AccessDenied({
  message = "Access Denied",
  description = "You don't have permission to access this resource. This may be because it's outside your assigned classes or wings.",
  redirectTo = "/dashboard",
  redirectLabel = "Go to Dashboard",
}: AccessDeniedProps) {
  const navigate = useNavigate();

  return (
    <Card className="border-destructive/50 bg-destructive/5">
      <CardContent className="py-12 text-center">
        <ShieldX className="h-12 w-12 mx-auto text-destructive mb-4" />
        <h3 className="text-lg font-semibold mb-2">{message}</h3>
        <p className="text-muted-foreground max-w-md mx-auto mb-6">
          {description}
        </p>
        <Button onClick={() => navigate(redirectTo)} variant="outline">
          <ArrowLeft className="h-4 w-4 mr-2" />
          {redirectLabel}
        </Button>
      </CardContent>
    </Card>
  );
}

/**
 * Inline access restricted banner for showing within pages when some features are limited.
 */
export function AccessRestrictedBanner({
  message = "Access limited to your assigned classes",
}: {
  message?: string;
}) {
  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg text-sm text-blue-700 dark:text-blue-300">
      <ShieldX className="h-4 w-4 flex-shrink-0" />
      <span>{message}</span>
    </div>
  );
}

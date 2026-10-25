import { useState } from "react";
import { AlertTriangle, Loader2, Video } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { useInstitutionFeatures } from "@/hooks/useInstitutionFeatures";
import { useUserRole } from "@/hooks/useUserRole";
import { useMyGoogleEmail, usePTMSchemaReady } from "@/hooks/ptm";
import { PTM_FEATURE_ID } from "@/lib/ptm";
import { GoogleEmailSheet } from "./GoogleEmailSheet";

/**
 * The Settings card where a teacher (or any staff member who may run a
 * PTM) sets the Google account for their online PTMs. Renders nothing for
 * students, when PTMs are off for the school, or before the online
 * migration is live, so the Settings page is unchanged everywhere else.
 */
export function GoogleAccountCard() {
  const { user } = useAuth();
  const { data: roleInfo } = useUserRole();
  const { isFeatureEnabled, isLoading: featuresLoading } = useInstitutionFeatures();
  const probe = usePTMSchemaReady();
  const [open, setOpen] = useState(false);

  const isStaff = !!roleInfo && (roleInfo.isTeacher || roleInfo.isCoordinator || roleInfo.isSchoolAdmin);
  const show = isStaff && !featuresLoading && isFeatureEnabled(PTM_FEATURE_ID) && probe.onlineReady;
  const email = useMyGoogleEmail(user?.id ?? null, show);

  if (!show || !user) return null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Video className="h-5 w-5 text-primary" />
          <CardTitle>Online meetings: Google account</CardTitle>
        </div>
        <CardDescription>
          The Google account you join online PTMs with, shown with your name so families know who to expect.
          Rooms open to anyone with the link. Your login email is used unless you set another.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {email.isLoading ? (
          <p className="flex items-center gap-2 text-sm text-ink-500">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading…
          </p>
        ) : email.isError ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-sm text-ink-700">
              <AlertTriangle className="h-4 w-4 text-rose-500" aria-hidden="true" />
              Couldn't load your Google account.
            </p>
            <Button variant="outline" size="sm" onClick={() => email.refetch()}>
              Retry
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ink-900">{email.data ?? user.email ?? "Not set"}</p>
              {!email.data && (
                <p className="mt-0.5 text-xs text-ink-500">
                  {user.email ? "Your login email. Set another if you join Meet with a different Google account." : "No email on your account. Set the Google account you join Meet with."}
                </p>
              )}
            </div>
            <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
              {email.data ? "Change" : "Use another"}
            </Button>
          </div>
        )}
      </CardContent>

      <GoogleEmailSheet open={open} onOpenChange={setOpen} userId={user.id} displayName="you" self />
    </Card>
  );
}

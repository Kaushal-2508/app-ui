import { useState } from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useUserRole } from "@/hooks/useUserRole";
import { useActiveRole } from "@/contexts/ActiveRoleContext";

import { BulkMessageComposer } from "./BulkMessageComposer";
import { MessagingPanel } from "./MessagingPanel";

interface MessagesTabProps {
  institutionId: string;
}

/**
 * The Messages tab: conversations, plus one button to write to many people.
 *
 * Replaces the old "Bulk Send" tab, which showed a permanently-open compose
 * form and no conversations at all. School admins had no messaging surface
 * anywhere in the product — `canMessage` on CommunicationPage is
 * `isTeacher || isStudent` — so this is the first place they can read or answer
 * a thread.
 */
export function MessagesTab({ institutionId }: MessagesTabProps) {
  const { data: roleInfo } = useUserRole();
  const { activeViewRole, hasDualRole } = useActiveRole();
  const [composerOpen, setComposerOpen] = useState(false);

  const isAdmin = Boolean(roleInfo?.isSchoolAdmin) && (!hasDualRole || activeViewRole === "admin");
  const isCoordinator = hasDualRole
    ? activeViewRole === "coordinator"
    : Boolean(roleInfo?.isCoordinator) && !roleInfo?.isSchoolAdmin;
  const isTeacher = hasDualRole
    ? activeViewRole === "teacher"
    : Boolean(roleInfo?.isTeacher) && !roleInfo?.isSchoolAdmin && !roleInfo?.isCoordinator;

  const canBulkSend = isAdmin || isCoordinator || isTeacher;

  return (
    <div className="space-y-4">
      {canBulkSend && (
        <div className="flex justify-end">
          <Button
            onClick={() => setComposerOpen(true)}
            className="gap-1.5 bg-brand-primary text-white hover:bg-brand-primary/90"
          >
            <Plus className="h-4 w-4" aria-hidden />
            New message
          </Button>
        </div>
      )}

      <MessagingPanel institutionId={institutionId} />

      {canBulkSend && (
        <BulkMessageComposer
          open={composerOpen}
          onOpenChange={setComposerOpen}
          institutionId={institutionId}
          isTeacherOnly={isTeacher && !isAdmin && !isCoordinator}
        />
      )}
    </div>
  );
}

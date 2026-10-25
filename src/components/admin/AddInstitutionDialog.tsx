import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Plus, Copy, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { InstitutionWizard } from "./institution-wizard";

interface AddInstitutionDialogProps {
  trigger?: React.ReactNode;
}

export function AddInstitutionDialog({ trigger }: AddInstitutionDialogProps) {
  const [open, setOpen] = useState(false);
  const [createdCredentials, setCreatedCredentials] = useState<{ email: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const handleComplete = (credentials: { email: string; password: string }) => {
    setCreatedCredentials(credentials);
  };

  const handleCopy = () => {
    if (createdCredentials) {
      navigator.clipboard.writeText(
        `Email: ${createdCredentials.email}\nPassword: ${createdCredentials.password}`
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({
        title: "Copied",
        description: "Credentials copied to clipboard",
      });
    }
  };

  const handleClose = () => {
    setOpen(false);
    setCreatedCredentials(null);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            Add Institution
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-hidden">
        {!createdCredentials ? (
          <>
            <DialogHeader>
              <DialogTitle>Add New Institution</DialogTitle>
              <DialogDescription>
                Create a new institution with academic structure and admin account
              </DialogDescription>
            </DialogHeader>
            <InstitutionWizard
              onComplete={handleComplete}
              onCancel={handleClose}
            />
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-green-600">Institution Created!</DialogTitle>
              <DialogDescription>
                Save these credentials - the password cannot be recovered later
              </DialogDescription>
            </DialogHeader>

            <div className="py-4">
              <div className="bg-muted rounded-lg p-4 space-y-2">
                <div>
                  <span className="text-sm text-muted-foreground">Admin Email:</span>
                  <p className="font-mono">{createdCredentials.email}</p>
                </div>
                <div>
                  <span className="text-sm text-muted-foreground">Password:</span>
                  <p className="font-mono">{createdCredentials.password}</p>
                </div>
              </div>
              <Button variant="outline" className="mt-4 w-full" onClick={handleCopy}>
                {copied ? <Check className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
                {copied ? "Copied!" : "Copy Credentials"}
              </Button>
            </div>

            <DialogFooter>
              <Button onClick={handleClose}>Done</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

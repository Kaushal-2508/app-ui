import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

type Props = {
  label: string;
  value: string;
  /** Render the value in a monospace face (passwords, codes). */
  mono?: boolean;
};

/** Read-only labelled field with a copy-to-clipboard button. */
export function CopyField({ label, value, mono }: Props) {
  const onCopy = () => {
    navigator.clipboard
      .writeText(value)
      .then(() => toast.success(`${label} copied`))
      .catch(() => toast.error("Couldn't copy"));
  };

  return (
    <div className="grid gap-1.5">
      <Label className="text-xs font-medium text-ink-600">{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          readOnly
          value={value}
          className={mono ? "font-mono tracking-wide" : undefined}
          onFocus={(e) => e.currentTarget.select()}
        />
        <Button type="button" variant="outline" size="icon" aria-label={`Copy ${label}`} onClick={onCopy}>
          <Copy className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

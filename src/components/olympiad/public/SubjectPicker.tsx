import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

type Props = {
  subjects: Array<{ id: string; name: string }>;
  value: string[];
  onChange: (next: string[]) => void;
  max?: number;
};

export function SubjectPicker({ subjects, value, onChange, max = 3 }: Props) {
  const toggle = (id: string, checked: boolean) => {
    if (checked) {
      if (value.length >= max) return;
      onChange([...new Set([...value, id])]);
    } else {
      onChange(value.filter((v) => v !== id));
    }
  };

  return (
    <div className="grid gap-1.5">
      <Label className="text-xs font-medium text-ink-600">
        Pick exactly {max} subjects (Selected: {value.length}/{max})
      </Label>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {subjects.map((s) => {
          const isOn = value.includes(s.id);
          const disabled = !isOn && value.length >= max;
          return (
            <label
              key={s.id}
              className={`flex items-center gap-2 px-3 py-2 rounded-md border text-sm ${
                isOn ? "border-brand-primary bg-brand-primary/5" : "border-surface-stroke"
              } ${disabled ? "opacity-50" : ""}`}
            >
              <Checkbox
                checked={isOn}
                disabled={disabled}
                onCheckedChange={(v) => toggle(s.id, !!v)}
              />
              <span>{s.name}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

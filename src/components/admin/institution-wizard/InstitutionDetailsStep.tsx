import { useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Wand2, Crown, Shield } from "lucide-react";
import { InstitutionFormData } from "./types";

interface InstitutionDetailsStepProps {
  data: InstitutionFormData;
  onChange: (data: InstitutionFormData) => void;
}

// Generate a unique institute code from name
function generateInstituteCode(name: string): string {
  if (!name.trim()) return "";
  
  const stopWords = ["the", "of", "and", "a", "an", "school", "college", "university", "institute", "academy"];
  const words = name
    .split(/\s+/)
    .filter(word => !stopWords.includes(word.toLowerCase()));
  
  let initials = words
    .slice(0, 4)
    .map(word => word[0]?.toUpperCase() || "")
    .join("");
  
  if (initials.length < 2) {
    initials = name.replace(/[^a-zA-Z]/g, "").substring(0, 3).toUpperCase();
  }
  
  const randomSuffix = Math.random().toString(36).substring(2, 5).toUpperCase();
  return `${initials}${randomSuffix}`;
}

export function InstitutionDetailsStep({ data, onChange }: InstitutionDetailsStepProps) {
  // Auto-generate code when name changes
  useEffect(() => {
    if (data.name && !data.code) {
      onChange({ ...data, code: generateInstituteCode(data.name) });
    }
  }, [data.name]);

  const handleGenerateCode = () => {
    onChange({ ...data, code: generateInstituteCode(data.name) });
  };

  const updateField = (field: keyof InstitutionFormData, value: string) => {
    // Trim email fields to prevent validation errors
    const trimmedValue = field === 'adminEmail' || field === 'contactEmail' 
      ? value.trim() 
      : value;
    onChange({ ...data, [field]: trimmedValue });
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-2">
        <Label htmlFor="name">Institution Name *</Label>
        <Input
          id="name"
          value={data.name}
          onChange={(e) => updateField("name", e.target.value)}
          placeholder="Springfield High School"
          required
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="code">Institution Code *</Label>
        <div className="flex gap-2">
          <Input
            id="code"
            value={data.code}
            onChange={(e) => updateField("code", e.target.value.toUpperCase())}
            placeholder="SHS001"
            required
            className="flex-1"
          />
          <Button 
            type="button" 
            variant="outline" 
            size="icon"
            onClick={handleGenerateCode}
            title="Auto-generate code"
          >
            <Wand2 className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Code is auto-generated from name. Click the button to regenerate.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label htmlFor="contactEmail">Contact Email</Label>
          <Input
            id="contactEmail"
            type="email"
            value={data.contactEmail}
            onChange={(e) => updateField("contactEmail", e.target.value)}
            placeholder="info@school.edu"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="contactPhone">Contact Phone</Label>
          <Input
            id="contactPhone"
            value={data.contactPhone}
            onChange={(e) => updateField("contactPhone", e.target.value)}
            placeholder="+91 9876543210"
          />
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="address">Address</Label>
        <Textarea
          id="address"
          value={data.address}
          onChange={(e) => updateField("address", e.target.value)}
          placeholder="123 Education Lane, City"
          rows={2}
        />
      </div>

      <div className="border-t pt-4 mt-4">
        <p className="text-sm font-medium mb-3">School Admin Account</p>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>Admin Role *</Label>
            <RadioGroup
              value={data.adminRole}
              onValueChange={(value) => updateField("adminRole", value)}
              className="grid grid-cols-2 gap-3"
            >
              <label className={`flex items-center gap-2 border rounded-lg p-3 cursor-pointer transition-colors ${data.adminRole === "school_admin" ? "border-primary bg-primary/5" : "border-border"}`}>
                <RadioGroupItem value="school_admin" />
                <Shield className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">School Admin</p>
                  <p className="text-xs text-muted-foreground">Standard principal-level access</p>
                </div>
              </label>
              <label className={`flex items-center gap-2 border rounded-lg p-3 cursor-pointer transition-colors ${data.adminRole === "super_school_admin" ? "border-primary bg-primary/5" : "border-border"}`}>
                <RadioGroupItem value="super_school_admin" />
                <Crown className="h-4 w-4 text-amber-500" />
                <div>
                  <p className="text-sm font-medium">School Owner</p>
                  <p className="text-xs text-muted-foreground">Full ownership & oversight</p>
                </div>
              </label>
            </RadioGroup>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="adminName">Admin Name *</Label>
            <Input
              id="adminName"
              value={data.adminName}
              onChange={(e) => updateField("adminName", e.target.value)}
              placeholder="John Smith"
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="adminEmail">Admin Email *</Label>
            <Input
              id="adminEmail"
              type="email"
              value={data.adminEmail}
              onChange={(e) => updateField("adminEmail", e.target.value)}
              placeholder="admin@school.edu"
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="adminPassword">Admin Password *</Label>
            <Input
              id="adminPassword"
              type="password"
              value={data.adminPassword}
              onChange={(e) => updateField("adminPassword", e.target.value)}
              placeholder="Min 6 characters"
              required
              minLength={6}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

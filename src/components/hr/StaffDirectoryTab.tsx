import { useStaffDirectory } from "@/hooks/useStaffHR";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { Search, Users } from "lucide-react";
import { getDisplayName } from "@/lib/displayName";

export function StaffDirectoryTab() {
  const { data: staff, isLoading } = useStaffDirectory();
  const [search, setSearch] = useState("");

  const filtered = (staff || []).filter((s: any) => {
    const name = s.profile?.full_name || "";
    return name.toLowerCase().includes(search.toLowerCase());
  });

  const roleColors: Record<string, string> = {
    teacher: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    coordinator: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
    school_admin: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
    super_school_admin: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search staff..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Badge variant="outline" className="gap-1"><Users className="h-3 w-3" />{filtered.length} staff</Badge>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : filtered.length === 0 ? (
        <p className="text-muted-foreground">No staff found</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((s: any, i: number) => (
            <Card key={i} className="hover:shadow-md transition-shadow">
              <CardContent className="p-4 flex items-center gap-3">
                <Avatar className="h-10 w-10">
                  <AvatarFallback className="bg-primary/10 text-primary text-sm">
                    {(s.profile?.full_name || "?").charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{getDisplayName(s.profile)}</p>
                  <p className="text-xs text-muted-foreground truncate">{s.profile?.email}</p>
                  <div className="flex gap-1 mt-1">
                    <Badge className={`text-xs ${roleColors[s.role] || ""}`} variant="secondary">
                      {s.admin_title || s.role?.replace("_", " ")}
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

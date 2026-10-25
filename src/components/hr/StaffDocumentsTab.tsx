import { useState } from "react";
import { useStaffDocuments, useStaffDirectory } from "@/hooks/useStaffHR";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, FileText, Upload } from "lucide-react";
import { getDisplayName } from "@/lib/displayName";

const DOC_TYPES = [
  { value: "id_proof", label: "ID Proof" },
  { value: "certificate", label: "Certificate" },
  { value: "contract", label: "Contract" },
  { value: "pan_card", label: "PAN Card" },
  { value: "aadhar", label: "Aadhar Card" },
  { value: "other", label: "Other" },
];

export function StaffDocumentsTab() {
  const { data: documents, isLoading, upload } = useStaffDocuments();
  const { data: staff } = useStaffDirectory();
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState("");
  const [docType, setDocType] = useState("");
  const [docName, setDocName] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const handleUpload = () => {
    if (!file || !userId || !docType || !docName) return;
    upload.mutate({ userId, file, documentType: docType, documentName: docName }, {
      onSuccess: () => { setOpen(false); setFile(null); setDocName(""); },
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold">Staff Documents</h3>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Upload className="h-4 w-4 mr-1" />Upload Document</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Upload Staff Document</DialogTitle></DialogHeader>
            <div className="grid gap-3">
              <div>
                <Label>Staff Member</Label>
                <Select value={userId} onValueChange={setUserId}>
                  <SelectTrigger><SelectValue placeholder="Select staff" /></SelectTrigger>
                  <SelectContent>
                    {(staff || []).map((s: any) => (
                      <SelectItem key={s.user_id} value={s.user_id}>{getDisplayName(s.profile)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Document Type</Label>
                <Select value={docType} onValueChange={setDocType}>
                  <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                  <SelectContent>
                    {DOC_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Document Name</Label><Input value={docName} onChange={e => setDocName(e.target.value)} placeholder="e.g. Teaching Certificate 2024" /></div>
              <div><Label>File</Label><Input type="file" onChange={e => setFile(e.target.files?.[0] || null)} /></div>
              <Button onClick={handleUpload} disabled={!file || !userId || !docType || !docName || upload.isPending}>
                {upload.isPending ? "Uploading..." : "Upload"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? <p className="text-muted-foreground">Loading...</p> : (
        <div className="grid gap-2">
          {(documents || []).map((d: any) => (
            <Card key={d.id}>
              <CardContent className="p-3 flex items-center gap-3">
                <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{d.document_name}</p>
                  <p className="text-xs text-muted-foreground">{d.staff_name}</p>
                </div>
                <Badge variant="outline" className="text-xs shrink-0">
                  {DOC_TYPES.find(t => t.value === d.document_type)?.label || d.document_type}
                </Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useCommunicationTemplates, TEMPLATE_VARIABLES, interpolateTemplate } from "@/hooks/useCommunicationTemplates";
import { Plus, Trash2, Edit, Eye, Loader2, Mail, MessageSquare, Phone } from "lucide-react";

interface Props {
  institutionId: string;
}

const SAMPLE_DATA: Record<string, string> = {
  student_name: "John Doe",
  class_name: "Class 10-A",
  parent_name: "Jane Doe",
  teacher_name: "Mr. Smith",
  institution_name: "ABC School",
  date: "March 15, 2026",
  time: "10:00 AM",
};

const channelIcons: Record<string, any> = {
  email: Mail,
  sms: Phone,
  whatsapp: MessageSquare,
};

export function TemplatesPanel({ institutionId }: Props) {
  const { templates, isLoading, createTemplate, updateTemplate, deleteTemplate } = useCommunicationTemplates(institutionId);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [previewBody, setPreviewBody] = useState("");
  const [form, setForm] = useState({ name: "", channel: "email", subject: "", body: "", variables: [] as string[] });

  const openCreate = () => {
    setEditingId(null);
    setForm({ name: "", channel: "email", subject: "", body: "", variables: [] });
    setDialogOpen(true);
  };

  const openEdit = (t: any) => {
    setEditingId(t.id);
    setForm({ name: t.name, channel: t.channel, subject: t.subject || "", body: t.body, variables: t.variables || [] });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.body.trim()) return;
    if (editingId) {
      await updateTemplate.mutateAsync({ id: editingId, ...form });
    } else {
      await createTemplate.mutateAsync({ institution_id: institutionId, ...form });
    }
    setDialogOpen(false);
  };

  const insertVariable = (key: string) => {
    setForm(f => ({
      ...f,
      body: f.body + `{{${key}}}`,
      variables: f.variables.includes(key) ? f.variables : [...f.variables, key],
    }));
  };

  const handlePreview = (body: string) => {
    setPreviewBody(interpolateTemplate(body, SAMPLE_DATA));
    setPreviewOpen(true);
  };

  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={openCreate}><Plus className="h-4 w-4 mr-2" />New Template</Button>
      </div>

      {templates.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Mail className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No templates yet. Create one to get started.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {templates.map((t) => {
            const Icon = channelIcons[t.channel] || Mail;
            return (
              <Card key={t.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <CardTitle className="text-sm font-medium">{t.name}</CardTitle>
                    <Badge variant="outline" className="capitalize gap-1">
                      <Icon className="h-3 w-3" />{t.channel}
                    </Badge>
                  </div>
                  {t.subject && <p className="text-xs text-muted-foreground">Subject: {t.subject}</p>}
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-xs text-muted-foreground line-clamp-3">{t.body}</p>
                  {t.variables?.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {t.variables.map((v: string) => (
                        <Badge key={v} variant="secondary" className="text-xs">{`{{${v}}}`}</Badge>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={() => handlePreview(t.body)}><Eye className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="sm" onClick={() => openEdit(t)}><Edit className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="sm" onClick={() => deleteTemplate.mutate(t.id)} className="text-destructive hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Template" : "New Template"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Template name" />
              </div>
              <div className="space-y-2">
                <Label>Channel</Label>
                <Select value={form.channel} onValueChange={v => setForm(f => ({ ...f, channel: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="sms">SMS</SelectItem>
                    <SelectItem value="whatsapp">WhatsApp</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {form.channel === "email" && (
              <div className="space-y-2">
                <Label>Subject</Label>
                <Input value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} placeholder="Email subject" />
              </div>
            )}
            <div className="space-y-2">
              <Label>Body</Label>
              <Textarea value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))} placeholder="Message body..." rows={5} />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Insert Variable</Label>
              <div className="flex flex-wrap gap-1">
                {TEMPLATE_VARIABLES.map(v => (
                  <Button key={v.key} variant="outline" size="sm" className="text-xs h-7" onClick={() => insertVariable(v.key)}>
                    {`{{${v.key}}}`}
                  </Button>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleSave} className="flex-1" disabled={createTemplate.isPending || updateTemplate.isPending}>
                {(createTemplate.isPending || updateTemplate.isPending) && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                {editingId ? "Update" : "Create"}
              </Button>
              <Button variant="outline" onClick={() => handlePreview(form.body)}>Preview</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Preview Dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Template Preview</DialogTitle></DialogHeader>
          <div className="prose prose-sm max-w-none whitespace-pre-wrap border rounded-md p-4 bg-muted/30">{previewBody}</div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

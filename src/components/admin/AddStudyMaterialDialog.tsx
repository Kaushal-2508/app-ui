import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useAddStudyMaterial } from "@/hooks/useStudyMaterials";
import { useUserRole } from "@/hooks/useUserRole";
import { Upload, Link, FileText, Image, Video, FileSpreadsheet, Loader2, X, Globe, Building2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { uploadResumableAndGetPublicUrl } from "@/lib/storageUpload";
import { toast } from "sonner";

interface AddStudyMaterialDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  grades: { id: string; grade_name: string; grade_number: number }[];
  subjects: { id: string; name: string }[];
}

const STREAMS = [
  { value: "science", label: "Science" },
  { value: "commerce", label: "Commerce" },
  { value: "arts", label: "Arts/Humanities" },
];

const MATERIAL_TYPES = [
  { value: "book", label: "Book", icon: FileText },
  { value: "pdf", label: "PDF Document", icon: FileText },
  { value: "video", label: "Video", icon: Video },
  { value: "image", label: "Image", icon: Image },
  { value: "link", label: "External Link", icon: Link },
  { value: "presentation", label: "Presentation (PPT)", icon: FileSpreadsheet },
  { value: "word", label: "Word Document", icon: FileText },
];

export function AddStudyMaterialDialog({ 
  open, 
  onOpenChange, 
  grades, 
  subjects 
}: AddStudyMaterialDialogProps) {
  const [title, setTitle] = useState("");
  const [publisher, setPublisher] = useState("");
  const [materialType, setMaterialType] = useState("book");
  const [externalLink, setExternalLink] = useState("");
  const [description, setDescription] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [gradeId, setGradeId] = useState("");
  const [selectedStream, setSelectedStream] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isGlobal, setIsGlobal] = useState(false);
  const [selectedInstitutionId, setSelectedInstitutionId] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const addMaterial = useAddStudyMaterial();
  const { data: userRole } = useUserRole();

  // Fetch institutions list for super admin
  const { data: institutions } = useQuery({
    queryKey: ["institutions-for-material"],
    queryFn: async () => {
      const { data } = await supabase
        .from("institutions")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      return data || [];
    },
    enabled: userRole?.isSuperAdmin,
  });

  const selectedGrade = grades.find(g => g.id === gradeId);
  const isHigherSecondary = selectedGrade && selectedGrade.grade_number >= 11;
  const selectedInstitutionName = institutions?.find(i => i.id === selectedInstitutionId)?.name;

  useEffect(() => {
    if (!isHigherSecondary) {
      setSelectedStream("");
    }
  }, [gradeId, isHigherSecondary]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Check file size (max 50MB)
      if (file.size > 50 * 1024 * 1024) {
        toast.error("File size must be less than 50MB");
        return;
      }
      setSelectedFile(file);
      // Clear external link if file is selected
      setExternalLink("");
    }
  };

  const uploadFile = async (file: File): Promise<string | null> => {
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
      const filePath = `materials/${fileName}`;

      const publicUrl = await uploadResumableAndGetPublicUrl({
        bucket: "study-materials",
        path: filePath,
        file,
        contentType: file.type || undefined,
      });
      return publicUrl;
    } catch (error) {
      console.error("Upload error:", error);
      const msg = error instanceof Error ? error.message : "Unknown error";
      toast.error(`Failed to upload file: ${msg}`);
      return null;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subjectId || !gradeId) return;

    setIsUploading(true);
    let fileUrl: string | undefined;

    try {
      // Upload file if selected
      if (selectedFile) {
        const uploadedUrl = await uploadFile(selectedFile);
        if (!uploadedUrl) {
          setIsUploading(false);
          return;
        }
        fileUrl = uploadedUrl;
      }

      // Determine institution ID
      let institutionId: string | undefined;
      if (userRole?.isSuperAdmin) {
        institutionId = isGlobal ? undefined : selectedInstitutionId || undefined;
      } else {
        institutionId = userRole?.institutionId || undefined;
      }

      addMaterial.mutate(
        {
          title,
          publisher: publisher || undefined,
          material_type: materialType,
          file_url: fileUrl,
          external_link: externalLink || undefined,
          description: description || undefined,
          subject_id: subjectId,
          grade_level_id: gradeId,
          institution_id: institutionId,
        },
        {
          onSuccess: () => {
            resetForm();
            onOpenChange(false);
          },
          onSettled: () => {
            setIsUploading(false);
          },
        }
      );
    } catch (error) {
      setIsUploading(false);
      toast.error("Failed to add material");
    }
  };

  const resetForm = () => {
    setTitle("");
    setPublisher("");
    setMaterialType("book");
    setExternalLink("");
    setDescription("");
    setSubjectId("");
    setGradeId("");
    setSelectedStream("");
    setSelectedFile(null);
    setIsGlobal(false);
    setSelectedInstitutionId("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const getAcceptedFileTypes = () => {
    switch (materialType) {
      case "pdf":
        return ".pdf";
      case "image":
        return "image/*";
      case "video":
        return "video/*";
      case "presentation":
        return ".ppt,.pptx";
      case "word":
        return ".doc,.docx";
      default:
        return ".pdf,.doc,.docx,.ppt,.pptx,image/*,video/*";
    }
  };

  const getPlaceholderForType = () => {
    switch (materialType) {
      case "video":
        return "https://youtube.com/watch?v=...";
      case "pdf":
        return "https://example.com/document.pdf";
      case "link":
        return "https://example.com/resource";
      default:
        return "https://...";
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Study Material</DialogTitle>
          <DialogDescription>
            Upload or link study materials for students
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Institution Selection for Super Admin */}
          {userRole?.isSuperAdmin && (
            <div className="space-y-3 p-3 rounded-lg border bg-muted/30">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="global-material-admin"
                  checked={isGlobal}
                  onCheckedChange={(checked) => {
                    setIsGlobal(checked === true);
                    if (checked) setSelectedInstitutionId("");
                  }}
                />
                <Label htmlFor="global-material-admin" className="flex items-center gap-2 cursor-pointer">
                  <Globe className="h-4 w-4 text-primary" />
                  Make this a Global Material
                  <span className="text-xs text-muted-foreground">(available to all institutions)</span>
                </Label>
              </div>

              {!isGlobal && (
                <div className="space-y-2">
                  <Label>Institution</Label>
                  <SearchableSelect
                    value={selectedInstitutionId}
                    onValueChange={setSelectedInstitutionId}
                    placeholder="Select institution..."
                    searchPlaceholder="Search institutions..."
                    options={(institutions || []).map((inst) => ({
                      value: inst.id,
                      label: inst.name,
                    }))}
                  />
                </div>
              )}
            </div>
          )}

          {/* Grade and Subject Selection */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Grade *</Label>
              <SearchableSelect
                value={gradeId}
                onValueChange={setGradeId}
                placeholder="Select grade"
                searchPlaceholder="Search grades..."
                options={grades.map((grade) => ({
                  value: grade.id,
                  label: grade.grade_name,
                }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Subject *</Label>
              <SearchableSelect
                value={subjectId}
                onValueChange={setSubjectId}
                placeholder="Select subject"
                searchPlaceholder="Search subjects..."
                options={subjects.map((subject) => ({
                  value: subject.id,
                  label: subject.name,
                }))}
              />
            </div>
          </div>

          {/* Stream for Class 11-12 */}
          {isHigherSecondary && (
            <div className="space-y-2">
              <Label>Stream</Label>
              <SearchableSelect
                value={selectedStream}
                onValueChange={setSelectedStream}
                placeholder="Select stream (optional)"
                searchPlaceholder="Search streams..."
                options={[
                  { value: "", label: "All Streams" },
                  ...STREAMS.map((stream) => ({
                    value: stream.value,
                    label: stream.label,
                  })),
                ]}
              />
            </div>
          )}
          
          <div className="space-y-2">
            <Label htmlFor="title">Title *</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., NCERT Mathematics Textbook"
              required
            />
          </div>
          
          {/* Material Type Selection */}
          <div className="space-y-2">
            <Label>Material Type *</Label>
            <div className="grid grid-cols-4 gap-2">
              {MATERIAL_TYPES.slice(0, 4).map((type) => {
                const Icon = type.icon;
                return (
                  <Button
                    key={type.value}
                    type="button"
                    variant={materialType === type.value ? "default" : "outline"}
                    size="sm"
                    className="flex flex-col h-auto py-2 gap-1"
                    onClick={() => setMaterialType(type.value)}
                  >
                    <Icon className="h-4 w-4" />
                    <span className="text-xs">{type.label}</span>
                  </Button>
                );
              })}
            </div>
            <div className="grid grid-cols-3 gap-2 mt-2">
              {MATERIAL_TYPES.slice(4).map((type) => {
                const Icon = type.icon;
                return (
                  <Button
                    key={type.value}
                    type="button"
                    variant={materialType === type.value ? "default" : "outline"}
                    size="sm"
                    className="flex flex-col h-auto py-2 gap-1"
                    onClick={() => setMaterialType(type.value)}
                  >
                    <Icon className="h-4 w-4" />
                    <span className="text-xs">{type.label}</span>
                  </Button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="publisher">Publisher / Author</Label>
            <Input
              id="publisher"
              value={publisher}
              onChange={(e) => setPublisher(e.target.value)}
              placeholder="e.g., NCERT"
            />
          </div>

          {/* File Upload Section */}
          <div className="space-y-2">
            <Label>Upload File</Label>
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept={getAcceptedFileTypes()}
                onChange={handleFileChange}
                className="hidden"
                id="file-upload"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                className="flex-1"
                disabled={isUploading}
              >
                <Upload className="h-4 w-4 mr-2" />
                {selectedFile ? "Change File" : "Choose File"}
              </Button>
              {selectedFile && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    setSelectedFile(null);
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
            {selectedFile && (
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <FileText className="h-4 w-4" />
                {selectedFile.name} ({(selectedFile.size / 1024 / 1024).toFixed(2)} MB)
              </p>
            )}
          </div>

          {/* OR Separator */}
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">Or add link</span>
            </div>
          </div>

          {/* External Link */}
          <div className="space-y-2">
            <Label htmlFor="link">URL / Link</Label>
            <Input
              id="link"
              value={externalLink}
              onChange={(e) => {
                setExternalLink(e.target.value);
                // Clear file if link is entered
                if (e.target.value) {
                  setSelectedFile(null);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }
              }}
              placeholder={getPlaceholderForType()}
              disabled={!!selectedFile}
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of the material"
              rows={2}
            />
          </div>

          {/* Summary */}
          {(gradeId || subjectId || selectedStream || (userRole?.isSuperAdmin && (isGlobal || selectedInstitutionId))) && (
            <div className="flex flex-wrap gap-2 p-3 bg-muted rounded-lg">
              {userRole?.isSuperAdmin && (
                isGlobal ? (
                  <Badge variant="default" className="flex items-center gap-1 bg-primary">
                    <Globe className="h-3 w-3" />
                    Global
                  </Badge>
                ) : selectedInstitutionName && (
                  <Badge variant="secondary" className="flex items-center gap-1">
                    <Building2 className="h-3 w-3" />
                    {selectedInstitutionName}
                  </Badge>
                )
              )}
              {selectedGrade && (
                <Badge variant="outline">{selectedGrade.grade_name}</Badge>
              )}
              {subjectId && (
                <Badge variant="secondary">
                  {subjects.find(s => s.id === subjectId)?.name}
                </Badge>
              )}
              {selectedStream && (
                <Badge variant="default" className="capitalize">
                  {selectedStream}
                </Badge>
              )}
              <Badge variant="outline" className="capitalize">
                {materialType}
              </Badge>
            </div>
          )}
          
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={addMaterial.isPending || isUploading || !subjectId || !gradeId || !title}>
              {isUploading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Uploading...
                </>
              ) : addMaterial.isPending ? (
                "Adding..."
              ) : (
                "Add Material"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

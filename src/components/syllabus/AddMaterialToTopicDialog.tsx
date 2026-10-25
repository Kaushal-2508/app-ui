import { useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { FileText, GraduationCap, BookOpen, Layers, Video, Link as LinkIcon, File, Image, Headphones, Upload, X, Loader2, Globe, Building2 } from "lucide-react";
import { useAddMaterialToTopic } from "@/hooks/useSyllabusHierarchy";
import { useUserRole } from "@/hooks/useUserRole";
import { supabase } from "@/integrations/supabase/client";
import { uploadResumableAndGetPublicUrl } from "@/lib/storageUpload";
import { toast } from "sonner";

interface AddMaterialToTopicDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  topicId: string;
  topicName: string;
  gradeId: string;
  gradeName: string;
  subjectId: string;
  subjectName: string;
}

const MATERIAL_TYPES = [
  { value: "pdf", label: "PDF Document", icon: FileText },
  { value: "video", label: "Video", icon: Video },
  { value: "link", label: "External Link", icon: LinkIcon },
  { value: "document", label: "Document", icon: File },
  { value: "image", label: "Image", icon: Image },
  { value: "audio", label: "Audio", icon: Headphones },
];

export function AddMaterialToTopicDialog({
  open,
  onOpenChange,
  topicId,
  topicName,
  gradeId,
  gradeName,
  subjectId,
  subjectName,
}: AddMaterialToTopicDialogProps) {
  const [title, setTitle] = useState("");
  const [publisher, setPublisher] = useState("");
  const [materialType, setMaterialType] = useState("");
  const [externalLink, setExternalLink] = useState("");
  const [description, setDescription] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isGlobal, setIsGlobal] = useState(false);
  const [selectedInstitutionId, setSelectedInstitutionId] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addMaterial = useAddMaterialToTopic();
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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 50 * 1024 * 1024) {
        toast.error("File size must be less than 50MB");
        return;
      }
      setSelectedFile(file);
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

  const getAcceptedFileTypes = () => {
    switch (materialType) {
      case "pdf":
        return ".pdf";
      case "image":
        return "image/*";
      case "video":
        return "video/*";
      case "audio":
        return "audio/*";
      case "document":
        return ".doc,.docx,.ppt,.pptx";
      default:
        return ".pdf,.doc,.docx,.ppt,.pptx,image/*,video/*,audio/*";
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !materialType) return;

    setIsUploading(true);
    let fileUrl: string | undefined;

    try {
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
          topicId,
          gradeId,
          subjectId,
          institutionId,
          title: title.trim(),
          publisher: publisher.trim() || undefined,
          materialType,
          fileUrl,
          externalLink: externalLink.trim() || undefined,
          description: description.trim() || undefined,
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
    setMaterialType("");
    setExternalLink("");
    setDescription("");
    setSelectedFile(null);
    setIsGlobal(false);
    setSelectedInstitutionId("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // Get selected institution name for display
  const selectedInstitutionName = institutions?.find(i => i.id === selectedInstitutionId)?.name;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            Add Study Material
          </DialogTitle>
        </DialogHeader>

        {/* Context badges */}
        <div className="flex items-center gap-2 flex-wrap p-3 rounded-lg bg-muted/50">
          <Badge variant="outline" className="flex items-center gap-1">
            <GraduationCap className="h-3 w-3" />
            {gradeName}
          </Badge>
          <Badge variant="outline" className="flex items-center gap-1">
            <BookOpen className="h-3 w-3" />
            {subjectName}
          </Badge>
          <Badge variant="outline" className="flex items-center gap-1">
            <Layers className="h-3 w-3" />
            {topicName}
          </Badge>
          {userRole?.isSuperAdmin && (
            isGlobal ? (
              <Badge variant="default" className="flex items-center gap-1 bg-primary">
                <Globe className="h-3 w-3" />
                Global Material
              </Badge>
            ) : selectedInstitutionName && (
              <Badge variant="secondary" className="flex items-center gap-1">
                <Building2 className="h-3 w-3" />
                {selectedInstitutionName}
              </Badge>
            )
          )}
        </div>

        {/* Institution Selection for Super Admin */}
        {userRole?.isSuperAdmin && (
          <div className="space-y-3 p-3 rounded-lg border bg-muted/30">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="global-material"
                checked={isGlobal}
                onCheckedChange={(checked) => {
                  setIsGlobal(checked === true);
                  if (checked) setSelectedInstitutionId("");
                }}
              />
              <Label htmlFor="global-material" className="flex items-center gap-2 cursor-pointer">
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

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-4">
            <div>
              <Label htmlFor="title">Title *</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., Chapter 3 Notes"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="materialType">Material Type *</Label>
                <SearchableSelect
                  value={materialType}
                  onValueChange={setMaterialType}
                  placeholder="Select type"
                  searchPlaceholder="Search types..."
                  options={MATERIAL_TYPES.map((type) => ({
                    value: type.value,
                    label: type.label,
                    icon: type.icon,
                  }))}
                />
              </div>

              <div>
                <Label htmlFor="publisher">Publisher / Author</Label>
                <Input
                  id="publisher"
                  value={publisher}
                  onChange={(e) => setPublisher(e.target.value)}
                  placeholder="e.g., NCERT"
                />
              </div>
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
                  id="topic-file-upload"
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

            <div>
              <Label htmlFor="externalLink">External Link / URL</Label>
              <Input
                id="externalLink"
                type="url"
                value={externalLink}
                onChange={(e) => {
                  setExternalLink(e.target.value);
                  if (e.target.value) {
                    setSelectedFile(null);
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }
                }}
                placeholder="https://..."
                disabled={!!selectedFile}
              />
            </div>

            <div>
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief description of the material..."
                rows={2}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                resetForm();
                onOpenChange(false);
              }}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!title.trim() || !materialType || addMaterial.isPending || isUploading}
            >
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

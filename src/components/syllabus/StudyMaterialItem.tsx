import { cn } from "@/lib/utils";
import { openExternal } from "@/lib/native";
import {
  FileText,
  Video,
  Link as LinkIcon,
  File,
  ExternalLink,
  Trash2,
  Download,
  Image,
  Headphones,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SourceBadge, SourceType } from "@/components/shared/SourceBadge";

interface StudyMaterialItemProps {
  id: string;
  title: string;
  publisher?: string | null;
  material_type: string;
  file_url?: string | null;
  external_link?: string | null;
  description?: string | null;
  institution_id?: string | null;
  is_active?: boolean;
  onDelete?: () => void;
}

const getMaterialIcon = (type: string) => {
  switch (type?.toLowerCase()) {
    case "pdf":
    case "document":
      return FileText;
    case "video":
      return Video;
    case "link":
    case "url":
      return LinkIcon;
    case "image":
      return Image;
    case "audio":
      return Headphones;
    default:
      return File;
  }
};

const getMaterialColor = (type: string) => {
  switch (type?.toLowerCase()) {
    case "pdf":
    case "document":
      return "text-red-500 bg-red-500/10";
    case "video":
      return "text-purple-500 bg-purple-500/10";
    case "link":
    case "url":
      return "text-blue-500 bg-blue-500/10";
    case "image":
      return "text-green-500 bg-green-500/10";
    case "audio":
      return "text-orange-500 bg-orange-500/10";
    default:
      return "text-muted-foreground bg-muted";
  }
};

export function StudyMaterialItem({
  title,
  publisher,
  material_type,
  file_url,
  external_link,
  description,
  institution_id,
  is_active = true,
  onDelete,
}: StudyMaterialItemProps) {
  const Icon = getMaterialIcon(material_type);
  const url = file_url || external_link;
  
  // Determine source type for badge
  const sourceType: SourceType = !is_active ? "archived" : (institution_id ? "institute" : "global");

  const handleOpen = () => {
    if (url) {
      openExternal(url);
    } else {
      // Show a message if no URL is available
      console.warn("No URL available for this material");
    }
  };

  // Check if material has a valid URL
  const hasValidUrl = Boolean(url);

  return (
    <div className="group flex items-center gap-3 p-3 rounded-lg border bg-background hover:bg-accent/30 transition-colors">
      <div
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
          getMaterialColor(material_type)
        )}
      >
        <Icon className="h-4 w-4" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm text-foreground truncate">{title}</span>
          <Badge variant="secondary" className="text-xs shrink-0">
            {material_type}
          </Badge>
          <SourceBadge source={sourceType} size="sm" showIcon={false} />
        </div>
        {publisher && (
          <p className="text-xs text-muted-foreground mt-0.5">{publisher}</p>
        )}
        {description && (
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{description}</p>
        )}
      </div>

      <div className="flex items-center gap-1">
        {hasValidUrl ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-primary"
            onClick={handleOpen}
            title={file_url ? "Download file" : "Open link"}
          >
            {file_url ? (
              <Download className="h-4 w-4" />
            ) : (
              <ExternalLink className="h-4 w-4" />
            )}
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground italic px-2">No link</span>
        )}
        {onDelete && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
            onClick={onDelete}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

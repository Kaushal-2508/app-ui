import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  Edit2,
  RotateCcw,
  ZoomIn,
  FileImage,
} from "lucide-react";

interface OCRReviewPanelProps {
  extractionId: string;
  rawText: string;
  cleanedText: string;
  confidenceScore: number;
  questionText: string;
  imageUrl?: string;
  onApprove: (correctedText: string) => Promise<void>;
  onReject: (reason: string) => Promise<void>;
}

export function OCRReviewPanel({
  extractionId,
  rawText,
  cleanedText,
  confidenceScore,
  questionText,
  imageUrl,
  onApprove,
  onReject,
}: OCRReviewPanelProps) {
  const [correctedText, setCorrectedText] = useState(cleanedText);
  const [isEditing, setIsEditing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showImage, setShowImage] = useState(false);

  const confidencePercent = Math.round(confidenceScore * 100);
  const isLowConfidence = confidenceScore < 0.7;
  const isVeryLowConfidence = confidenceScore < 0.5;

  const handleApprove = async () => {
    setIsSubmitting(true);
    try {
      await onApprove(correctedText);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReject = async () => {
    setIsSubmitting(true);
    try {
      await onReject("OCR extraction rejected - text unreadable or incorrect");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card className={isVeryLowConfidence ? "border-red-200" : isLowConfidence ? "border-amber-200" : ""}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <FileImage className="h-4 w-4" />
            OCR Review Required
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge 
              variant={isVeryLowConfidence ? "destructive" : isLowConfidence ? "secondary" : "outline"}
            >
              {confidencePercent}% confidence
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Confidence Alert */}
        {isVeryLowConfidence && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Very Low Confidence</AlertTitle>
            <AlertDescription>
              The OCR extraction may contain significant errors. Please verify carefully against the original.
            </AlertDescription>
          </Alert>
        )}

        {/* Question Context */}
        <div className="p-3 bg-muted rounded-lg">
          <p className="text-sm font-medium mb-1">Question:</p>
          <p className="text-sm text-muted-foreground">{questionText}</p>
        </div>

        {/* Original Image (if available) */}
        {imageUrl && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Original Scan</p>
              <Button variant="outline" size="sm" onClick={() => setShowImage(!showImage)}>
                {showImage ? <Eye className="h-4 w-4 mr-1" /> : <ZoomIn className="h-4 w-4 mr-1" />}
                {showImage ? "Hide" : "Show"} Image
              </Button>
            </div>
            {showImage && (
              <div className="border rounded-lg overflow-hidden bg-muted">
                <img 
                  src={imageUrl} 
                  alt="Original answer scan" 
                  className="max-w-full h-auto"
                />
              </div>
            )}
          </div>
        )}

        {/* Raw OCR Text */}
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">Raw OCR Output:</p>
          <div className="p-3 border rounded-lg bg-muted/50 text-sm font-mono">
            {rawText || <span className="text-muted-foreground italic">No text extracted</span>}
          </div>
        </div>

        {/* Editable Cleaned Text */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Verified Answer Text:</p>
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={() => {
                if (isEditing) {
                  setCorrectedText(cleanedText);
                }
                setIsEditing(!isEditing);
              }}
            >
              {isEditing ? (
                <>
                  <RotateCcw className="h-4 w-4 mr-1" />
                  Reset
                </>
              ) : (
                <>
                  <Edit2 className="h-4 w-4 mr-1" />
                  Edit
                </>
              )}
            </Button>
          </div>
          {isEditing ? (
            <Textarea
              value={correctedText}
              onChange={(e) => setCorrectedText(e.target.value)}
              rows={4}
              placeholder="Enter the corrected answer text..."
            />
          ) : (
            <div className="p-3 border rounded-lg min-h-[100px]">
              {correctedText || <span className="text-muted-foreground italic">No text</span>}
            </div>
          )}
        </div>

        {/* Confidence Visualization */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">OCR Confidence</span>
            <span className={`font-medium ${
              isVeryLowConfidence ? "text-red-600" : 
              isLowConfidence ? "text-amber-600" : 
              "text-green-600"
            }`}>
              {confidencePercent}%
            </span>
          </div>
          <Progress 
            value={confidencePercent} 
            className={`h-2 ${
              isVeryLowConfidence ? "[&>div]:bg-red-500" : 
              isLowConfidence ? "[&>div]:bg-amber-500" : 
              ""
            }`}
          />
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2 pt-2">
          <Button 
            className="flex-1"
            onClick={handleApprove}
            disabled={isSubmitting}
          >
            <CheckCircle2 className="h-4 w-4 mr-2" />
            {correctedText !== cleanedText ? "Approve Corrected" : "Approve"}
          </Button>
          <Button 
            variant="destructive"
            onClick={handleReject}
            disabled={isSubmitting}
          >
            <AlertTriangle className="h-4 w-4 mr-2" />
            Reject
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

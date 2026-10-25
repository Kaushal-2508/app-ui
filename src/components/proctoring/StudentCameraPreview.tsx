import { useRef, useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  Camera, 
  CameraOff, 
  AlertTriangle, 
  CheckCircle2, 
  Users,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  RefreshCw,
  Eye,
  EyeOff,
  Loader2,
} from "lucide-react";
import { useFaceDetection } from "@/hooks/useFaceDetection";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

interface StudentCameraPreviewProps {
  cameraStream: MediaStream | null;
  isOnlineExam: boolean;
  sessionId: string | null;
  onFlag: (
    type: "face_not_detected" | "multiple_faces" | "head_movement_left" | "head_movement_right" | "head_movement_up" | "head_movement_down",
    severity: "low" | "medium" | "high",
    screenshotUrl?: string
  ) => void;
  showPreview?: boolean;
  onTogglePreview?: (show: boolean) => void;
  onRetryCamera?: () => void;
  floating?: boolean;
  className?: string;
}

export function StudentCameraPreview({
  cameraStream,
  isOnlineExam,
  sessionId,
  onFlag,
  showPreview = true,
  onTogglePreview,
  onRetryCamera,
  floating = false,
  className,
}: StudentCameraPreviewProps) {
  // Stable ref for face detection (useFaceDetection needs a RefObject)
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  const watchdogRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Check if stream tracks are actually alive
  const isStreamAlive = cameraStream && cameraStream.getVideoTracks().some(t => t.readyState === "live");

  // Keep streamRef in sync
  useEffect(() => {
    streamRef.current = cameraStream;
    console.log("[CameraPreview] cameraStream changed:", cameraStream ? `tracks=${cameraStream.getVideoTracks().length}, readyState=${cameraStream.getVideoTracks()[0]?.readyState}` : "null");
  }, [cameraStream]);

  // Upload screenshot to Supabase storage and return URL
  const uploadScreenshot = useCallback(async (dataUrl: string): Promise<string | undefined> => {
    if (!sessionId) return undefined;
    
    try {
      const response = await fetch(dataUrl);
      const blob = await response.blob();
      const filename = `${sessionId}/${Date.now()}.jpg`;
      
      const { data, error } = await supabase.storage
        .from("proctoring-screenshots")
        .upload(filename, blob, {
          contentType: "image/jpeg",
          upsert: false,
        });
      
      if (error) {
        console.error("[CameraPreview] Screenshot upload failed:", error);
        return undefined;
      }
      
      const { data: urlData } = supabase.storage
        .from("proctoring-screenshots")
        .getPublicUrl(data.path);
      
      return urlData.publicUrl;
    } catch (error) {
      console.error("[CameraPreview] Screenshot upload error:", error);
      return undefined;
    }
  }, [sessionId]);

  // Enhanced flag handler that uploads screenshot first
  const handleFlag = useCallback(async (
    type: "face_not_detected" | "multiple_faces" | "head_movement_left" | "head_movement_right" | "head_movement_up" | "head_movement_down",
    severity: "low" | "medium" | "high",
    screenshotDataUrl?: string
  ) => {
    let screenshotUrl: string | undefined;
    
    if (screenshotDataUrl) {
      screenshotUrl = await uploadScreenshot(screenshotDataUrl);
    }
    
    onFlag(type, severity, screenshotUrl);
  }, [onFlag, uploadScreenshot]);

  const {
    isModelLoaded,
    isDetecting,
    lastDetection,
    stats,
    loadModels,
    startDetection,
    stopDetection,
    resetBaseline,
  } = useFaceDetection(videoElRef, handleFlag, {}, true);

  // Attach stream to video element — called immediately when DOM element appears
  const attachStream = useCallback((video: HTMLVideoElement, stream: MediaStream) => {
    console.log("[CameraPreview] attachStream called, track readyState:", stream.getVideoTracks()[0]?.readyState);
    
    video.srcObject = stream;
    
    const onPlaying = () => {
      console.log("[CameraPreview] Video 'playing' event fired — camera is visible");
      setIsVideoPlaying(true);
      setVideoError(null);
    };
    
    const onError = (e: Event) => {
      console.error("[CameraPreview] Video error event:", e);
      setVideoError("Camera feed error");
      setIsVideoPlaying(false);
    };

    video.addEventListener("playing", onPlaying);
    video.addEventListener("error", onError);

    // Try to play immediately
    video.play().then(() => {
      console.log("[CameraPreview] video.play() resolved successfully");
      setIsVideoPlaying(true);
    }).catch((err) => {
      console.warn("[CameraPreview] video.play() rejected:", err.message);
      // Will retry via loadedmetadata or watchdog
    });

    // Also try on loadedmetadata
    const onMeta = () => {
      console.log("[CameraPreview] loadedmetadata fired, calling play()");
      video.play().catch(() => {});
    };
    video.addEventListener("loadedmetadata", onMeta);

    // Store cleanup data on the element for later removal
    (video as any).__cameraCleanup = () => {
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("error", onError);
      video.removeEventListener("loadedmetadata", onMeta);
    };
  }, []);

  // Callback ref: fires when video element enters/leaves DOM
  const videoRefCallback = useCallback((node: HTMLVideoElement | null) => {
    // Cleanup old element
    const oldEl = videoElRef.current;
    if (oldEl && (oldEl as any).__cameraCleanup) {
      (oldEl as any).__cameraCleanup();
      delete (oldEl as any).__cameraCleanup;
    }

    videoElRef.current = node;

    if (node && streamRef.current) {
      const track = streamRef.current.getVideoTracks()[0];
      if (track && track.readyState === "live") {
        console.log("[CameraPreview] Callback ref: video element appeared, attaching stream immediately");
        attachStream(node, streamRef.current);
      } else {
        console.warn("[CameraPreview] Callback ref: video element appeared but track not live:", track?.readyState);
      }
    } else if (node) {
      console.log("[CameraPreview] Callback ref: video element appeared but no stream yet");
    } else {
      console.log("[CameraPreview] Callback ref: video element removed from DOM");
      setIsVideoPlaying(false);
    }
  }, [attachStream]);

  // When cameraStream changes and video element already exists, re-attach
  useEffect(() => {
    const video = videoElRef.current;
    if (!video || !cameraStream) {
      setIsVideoPlaying(false);
      return;
    }

    const track = cameraStream.getVideoTracks()[0];
    if (!track || track.readyState !== "live") {
      console.warn("[CameraPreview] useEffect[cameraStream]: track not live");
      setIsVideoPlaying(false);
      return;
    }

    // Only re-attach if srcObject differs (callback ref may have already handled it)
    if (video.srcObject !== cameraStream) {
      console.log("[CameraPreview] useEffect[cameraStream]: re-attaching stream (srcObject changed)");
      attachStream(video, cameraStream);
    }
  }, [cameraStream, attachStream]);

  // Watchdog: ensure video keeps playing, re-attach if lost
  useEffect(() => {
    if (watchdogRef.current) {
      clearInterval(watchdogRef.current);
    }

    watchdogRef.current = setInterval(() => {
      const video = videoElRef.current;
      const stream = streamRef.current;
      if (!video || !stream) return;

      const track = stream.getVideoTracks()[0];
      if (!track || track.readyState !== "live") return;

      // Re-attach srcObject if lost
      if (video.srcObject !== stream) {
        console.log("[CameraPreview] Watchdog: re-attaching lost srcObject");
        video.srcObject = stream;
      }

      // Force play if paused
      if (video.paused && video.srcObject) {
        console.log("[CameraPreview] Watchdog: video paused, forcing play()");
        video.play().catch(() => {});
      }

      // Sync isVideoPlaying state
      if (!video.paused && video.readyState >= 2 && !isVideoPlaying) {
        console.log("[CameraPreview] Watchdog: video is playing but state is false, syncing");
        setIsVideoPlaying(true);
      }
    }, 1500);

    return () => {
      if (watchdogRef.current) {
        clearInterval(watchdogRef.current);
      }
    };
  }, [isVideoPlaying]);

  // Load face detection models when component mounts
  useEffect(() => {
    if (isOnlineExam && cameraStream) {
      loadModels();
    }
  }, [isOnlineExam, cameraStream, loadModels]);

  // Start detection when models loaded and video is playing
  useEffect(() => {
    if (isModelLoaded && isVideoPlaying && isOnlineExam) {
      console.log("[CameraPreview] Starting face detection");
      startDetection();
    }

    return () => {
      stopDetection();
    };
  }, [isModelLoaded, isVideoPlaying, isOnlineExam, startDetection, stopDetection]);

  // Get status indicator
  const getStatusIndicator = useCallback(() => {
    if (!isVideoPlaying) {
      return { icon: Loader2, label: "Initializing...", color: "text-muted-foreground", animate: true };
    }
    if (!isModelLoaded) {
      return { icon: Loader2, label: "Loading AI...", color: "text-blue-500", animate: true };
    }
    if (!lastDetection) {
      return { icon: Camera, label: "Calibrating...", color: "text-blue-500", animate: false };
    }
    if (!lastDetection.faceDetected) {
      return { icon: AlertTriangle, label: "Face not visible", color: "text-red-500", animate: false };
    }
    if (lastDetection.multipleFaces) {
      return { icon: Users, label: "Multiple faces", color: "text-red-500", animate: false };
    }
    return { icon: CheckCircle2, label: "Monitoring", color: "text-green-500", animate: false };
  }, [isVideoPlaying, isModelLoaded, lastDetection]);

  const status = getStatusIndicator();
  const StatusIcon = status.icon;

  if (!isOnlineExam) {
    return null;
  }

  return (
    <Card className={cn(
      "overflow-hidden",
      floating && "fixed bottom-4 right-4 z-50 w-64 shadow-lg border",
      className
    )}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Camera className="h-4 w-4 text-green-600" />
            Live Preview
          </CardTitle>
          <div className="flex items-center gap-2">
            {isDetecting && (
              <Badge variant="outline" className="text-xs gap-1">
                <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                AI Active
              </Badge>
            )}
            {onTogglePreview && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => onTogglePreview(!showPreview)}
              >
                {showPreview ? (
                  <EyeOff className="h-3 w-3" />
                ) : (
                  <Eye className="h-3 w-3" />
                )}
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      
      {showPreview && (
        <CardContent className="p-2 space-y-2">
          <div className="relative rounded-lg overflow-hidden bg-black aspect-video">
            {isStreamAlive ? (
              <>
                <video
                  ref={videoRefCallback}
                  autoPlay
                  muted
                  playsInline
                  className={cn(
                    "w-full h-full object-cover",
                    !isVideoPlaying && "opacity-0"
                  )}
                />
                
                {!isVideoPlaying && (
                  <div className="absolute inset-0 flex items-center justify-center bg-muted">
                    <div className="text-center text-muted-foreground">
                      <Loader2 className="h-8 w-8 mx-auto mb-2 animate-spin" />
                      <p className="text-sm">Starting camera...</p>
                    </div>
                  </div>
                )}

                {lastDetection?.headMovement && isVideoPlaying && (
                  <>
                    {lastDetection.headMovement.left && (
                      <div className="absolute left-2 top-1/2 -translate-y-1/2">
                        <ArrowLeft className="h-6 w-6 text-amber-500 animate-pulse" />
                      </div>
                    )}
                    {lastDetection.headMovement.right && (
                      <div className="absolute right-2 top-1/2 -translate-y-1/2">
                        <ArrowRight className="h-6 w-6 text-amber-500 animate-pulse" />
                      </div>
                    )}
                    {lastDetection.headMovement.up && (
                      <div className="absolute top-2 left-1/2 -translate-x-1/2">
                        <ArrowUp className="h-6 w-6 text-amber-500 animate-pulse" />
                      </div>
                    )}
                    {lastDetection.headMovement.down && (
                      <div className="absolute bottom-2 left-1/2 -translate-x-1/2">
                        <ArrowDown className="h-6 w-6 text-amber-500 animate-pulse" />
                      </div>
                    )}
                  </>
                )}

                <div className="absolute top-2 right-2">
                  <Badge 
                    variant={lastDetection?.faceDetected ? "secondary" : "destructive"}
                    className="gap-1 text-xs"
                  >
                    <StatusIcon className={cn("h-3 w-3", status.color, status.animate && "animate-spin")} />
                    {status.label}
                  </Badge>
                </div>

                {lastDetection && isVideoPlaying && (
                  <div className="absolute bottom-2 left-2">
                    <Badge 
                      variant={
                        lastDetection.faceDetected && !lastDetection.multipleFaces ? "secondary" : "destructive"
                      }
                      className={cn(
                        "gap-1 text-xs",
                        lastDetection.faceDetected && !lastDetection.multipleFaces && "bg-green-100 text-green-800 border-green-300",
                        !lastDetection.faceDetected && "bg-red-100 text-red-800 border-red-300",
                        lastDetection.multipleFaces && "bg-red-100 text-red-800 border-red-300 animate-pulse"
                      )}
                    >
                      <Users className="h-3 w-3" />
                      {!lastDetection.faceDetected && "No face"}
                      {lastDetection.faceDetected && !lastDetection.multipleFaces && "1 face"}
                      {lastDetection.multipleFaces && "Multiple faces!"}
                    </Badge>
                  </div>
                )}
              </>
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-muted">
                <div className="text-center text-muted-foreground">
                  <CameraOff className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm mb-2">Camera not available</p>
                  {onRetryCamera && (
                    <Button size="sm" variant="outline" onClick={onRetryCamera} className="gap-1">
                      <RefreshCw className="h-3 w-3" />
                      Retry Camera
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {isStreamAlive ? "Your camera is being monitored" : "Please enable camera access"}
            </p>
            {isDetecting && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs gap-1"
                onClick={resetBaseline}
                title="Recalibrate head position"
              >
                <RefreshCw className="h-3 w-3" />
                Recalibrate
              </Button>
            )}
          </div>

          {isDetecting && (stats.headMovementFlags.left > 0 || 
            stats.headMovementFlags.right > 0 || 
            stats.headMovementFlags.up > 0 || 
            stats.headMovementFlags.down > 0) && (
            <div className="flex gap-2 flex-wrap">
              {stats.headMovementFlags.left > 0 && (
                <Badge variant="outline" className="text-xs gap-1">
                  <ArrowLeft className="h-3 w-3" />
                  {stats.headMovementFlags.left}
                </Badge>
              )}
              {stats.headMovementFlags.right > 0 && (
                <Badge variant="outline" className="text-xs gap-1">
                  <ArrowRight className="h-3 w-3" />
                  {stats.headMovementFlags.right}
                </Badge>
              )}
              {stats.headMovementFlags.up > 0 && (
                <Badge variant="outline" className="text-xs gap-1">
                  <ArrowUp className="h-3 w-3" />
                  {stats.headMovementFlags.up}
                </Badge>
              )}
              {stats.headMovementFlags.down > 0 && (
                <Badge variant="outline" className="text-xs gap-1">
                  <ArrowDown className="h-3 w-3" />
                  {stats.headMovementFlags.down}
                </Badge>
              )}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

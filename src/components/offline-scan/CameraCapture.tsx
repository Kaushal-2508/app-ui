import { useRef, useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Camera, X, RotateCcw, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface CameraCaptureProps {
  onCapture: (file: File) => void;
  onClose: () => void;
  /** Which camera to open first. Defaults to the rear camera, which is what the
   *  answer-sheet consumers want. Pass "user" for a selfie. */
  facingMode?: "user" | "environment";
  /** Filename prefix for the produced File. Defaults to "sheet". */
  filePrefix?: string;
}

export function CameraCapture({
  onCapture,
  onClose,
  facingMode: initialFacingMode = "environment",
  filePrefix = "sheet",
}: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<"environment" | "user">(initialFacingMode);

  const startCamera = useCallback(async () => {
    setIsLoading(true);
    try {
      // Stop any existing stream
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }

      // getUserMedia is undefined on http:// hosts and throws an opaque error,
      // so name the real problem instead. HybridCameraGate.tsx guards the same way.
      const media = navigator.mediaDevices;
      if (!media?.getUserMedia) {
        setHasPermission(false);
        setIsLoading(false);
        toast.error("This browser can't open the camera here. Try uploading a picture instead.");
        return;
      }

      const stream = await media.getUserMedia({
        video: {
          facingMode,
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });

      streamRef.current = stream;
      setHasPermission(true);
    } catch (error) {
      console.error("Camera error:", error);
      setHasPermission(false);
      toast.error("Could not access camera. Please check permissions.");
    } finally {
      setIsLoading(false);
    }
  }, [facingMode]);

  // Attach stream to video element after it mounts (fixes race condition)
  useEffect(() => {
    const video = videoRef.current;
    const stream = streamRef.current;
    if (video && stream && !capturedImage) {
      video.srcObject = stream;
      video.onloadedmetadata = () => {
        video.play().catch(console.error);
      };
    }
  }, [isLoading, capturedImage]);

  useEffect(() => {
    startCamera();

    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, [startCamera]);

  const takePhoto = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
    setCapturedImage(dataUrl);
  }, []);

  const retake = useCallback(() => {
    setCapturedImage(null);
  }, []);

  const confirmPhoto = useCallback(() => {
    if (!capturedImage) return;

    // Convert data URL to File
    fetch(capturedImage)
      .then((res) => res.blob())
      .then((blob) => {
        const file = new File([blob], `${filePrefix}_${Date.now()}.jpg`, {
          type: "image/jpeg",
        });
        onCapture(file);
      });
  }, [capturedImage, onCapture, filePrefix]);

  const switchCamera = useCallback(() => {
    setFacingMode((prev) => (prev === "environment" ? "user" : "environment"));
    setCapturedImage(null);
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 bg-muted rounded-lg">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (hasPermission === false) {
    return (
      <div className="flex flex-col items-center justify-center h-64 bg-muted rounded-lg p-4 text-center">
        <Camera className="h-12 w-12 text-muted-foreground mb-4" />
        <p className="text-muted-foreground mb-4">
          Camera access was denied. Please enable camera permissions in your browser settings.
        </p>
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      </div>
    );
  }

  return (
    <div className="relative rounded-lg overflow-hidden bg-black">
      {/* Hidden canvas for capture */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Video preview or captured image */}
      {capturedImage ? (
        <img
          src={capturedImage}
          alt="Captured"
          className="w-full h-auto max-h-[400px] object-contain"
        />
      ) : (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-auto max-h-[400px] object-contain"
        />
      )}

      {/* Controls */}
      <div className="absolute bottom-4 left-0 right-0 flex items-center justify-center gap-4">
        {capturedImage ? (
          <>
            <Button
              variant="secondary"
              size="icon"
              className="h-12 w-12 rounded-full"
              onClick={retake}
            >
              <RotateCcw className="h-5 w-5" />
            </Button>
            <Button
              size="icon"
              className="h-14 w-14 rounded-full bg-green-600 hover:bg-green-700"
              onClick={confirmPhoto}
            >
              <Check className="h-6 w-6" />
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="secondary"
              size="icon"
              className="h-10 w-10 rounded-full"
              onClick={switchCamera}
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              className="h-14 w-14 rounded-full"
              onClick={takePhoto}
            >
              <Camera className="h-6 w-6" />
            </Button>
            <Button
              variant="secondary"
              size="icon"
              className="h-10 w-10 rounded-full"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

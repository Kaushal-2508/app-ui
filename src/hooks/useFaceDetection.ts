import { useRef, useCallback, useEffect, useState } from "react";
import * as faceapi from "face-api.js";

interface HeadPose {
  yaw: number; // left-right rotation
  pitch: number; // up-down rotation
  roll: number; // tilt
}

interface FaceDetectionConfig {
  enabled: boolean;
  headMovementThreshold: {
    left: number;
    right: number;
    up: number;
    down: number;
  };
  detectionInterval: number; // ms between detections
  faceNotDetectedThreshold: number; // consecutive frames without face
  multipleFacesThreshold: number; // consecutive frames with multiple faces
}

interface FaceDetectionResult {
  faceDetected: boolean;
  multipleFaces: boolean;
  headPose: HeadPose | null;
  headMovement: {
    left: boolean;
    right: boolean;
    up: boolean;
    down: boolean;
  };
}

type FlagCallback = (
  type: "face_not_detected" | "multiple_faces" | "head_movement_left" | "head_movement_right" | "head_movement_up" | "head_movement_down",
  severity: "low" | "medium" | "high",
  screenshotDataUrl?: string
) => void;

const DEFAULT_CONFIG: FaceDetectionConfig = {
  enabled: true,
  headMovementThreshold: {
    left: -25, // degrees
    right: 25,
    up: -20,
    down: 20,
  },
  detectionInterval: 500, // Check every 500ms
  faceNotDetectedThreshold: 5, // Flag after 5 consecutive misses (2.5 seconds)
  multipleFacesThreshold: 3, // Flag after 3 consecutive detections (1.5 seconds)
};

export function useFaceDetection(
  videoRef: React.RefObject<HTMLVideoElement>,
  onFlag: FlagCallback,
  config: Partial<FaceDetectionConfig> = {},
  captureScreenshots: boolean = true
) {
  const [isModelLoaded, setIsModelLoaded] = useState(false);
  const [isDetecting, setIsDetecting] = useState(false);
  const [lastDetection, setLastDetection] = useState<FaceDetectionResult | null>(null);
  const [stats, setStats] = useState({
    totalDetections: 0,
    faceNotDetectedCount: 0,
    multipleFacesCount: 0,
    headMovementFlags: {
      left: 0,
      right: 0,
      up: 0,
      down: 0,
    },
  });

  const mergedConfig = { ...DEFAULT_CONFIG, ...config };
  const detectionIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const consecutiveNoFaceRef = useRef(0);
  const consecutiveMultipleFacesRef = useRef(0);
  const baselineHeadPoseRef = useRef<HeadPose | null>(null);
  const lastFlagTimeRef = useRef<Record<string, number>>({});

  // Load face-api.js models
  const loadModels = useCallback(async () => {
    try {
      console.log("[FaceDetection] Loading face-api.js models...");
      
      // Models are loaded from CDN
      const MODEL_URL = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model";
      
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL),
      ]);

      console.log("[FaceDetection] Models loaded successfully");
      setIsModelLoaded(true);
      return true;
    } catch (error) {
      console.error("[FaceDetection] Failed to load models:", error);
      return false;
    }
  }, []);

  // Calculate head pose from face landmarks
  const calculateHeadPose = useCallback((landmarks: faceapi.FaceLandmarks68): HeadPose => {
    // Get key facial points
    const nose = landmarks.getNose();
    const leftEye = landmarks.getLeftEye();
    const rightEye = landmarks.getRightEye();
    const jaw = landmarks.getJawOutline();

    // Calculate center points
    const noseTip = nose[3]; // Tip of nose
    const leftEyeCenter = {
      x: leftEye.reduce((sum, p) => sum + p.x, 0) / leftEye.length,
      y: leftEye.reduce((sum, p) => sum + p.y, 0) / leftEye.length,
    };
    const rightEyeCenter = {
      x: rightEye.reduce((sum, p) => sum + p.x, 0) / rightEye.length,
      y: rightEye.reduce((sum, p) => sum + p.y, 0) / rightEye.length,
    };
    const eyeCenter = {
      x: (leftEyeCenter.x + rightEyeCenter.x) / 2,
      y: (leftEyeCenter.y + rightEyeCenter.y) / 2,
    };

    // Yaw (left-right): based on nose position relative to eye center
    const eyeDistance = Math.sqrt(
      Math.pow(rightEyeCenter.x - leftEyeCenter.x, 2) +
      Math.pow(rightEyeCenter.y - leftEyeCenter.y, 2)
    );
    const noseOffset = noseTip.x - eyeCenter.x;
    const yaw = (noseOffset / eyeDistance) * 90; // Approximate degrees

    // Pitch (up-down): based on nose tip relative to eye center vertically
    const noseToEyeVertical = noseTip.y - eyeCenter.y;
    const pitch = -(noseToEyeVertical / eyeDistance) * 45; // Approximate degrees

    // Roll (tilt): based on eye line angle
    const roll = Math.atan2(
      rightEyeCenter.y - leftEyeCenter.y,
      rightEyeCenter.x - leftEyeCenter.x
    ) * (180 / Math.PI);

    return { yaw, pitch, roll };
  }, []);

  // Capture screenshot from video
  const captureScreenshot = useCallback((): string | undefined => {
    if (!captureScreenshots || !videoRef.current) return undefined;
    
    const video = videoRef.current;
    if (video.readyState < 2) return undefined;
    
    try {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      const ctx = canvas.getContext("2d");
      if (!ctx) return undefined;
      
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/jpeg", 0.7); // Compress to 70% quality
    } catch (error) {
      console.error("[FaceDetection] Screenshot capture failed:", error);
      return undefined;
    }
  }, [captureScreenshots, videoRef]);

  // Check if we should flag an event (with cooldown)
  const shouldFlag = useCallback((type: string, cooldownMs: number = 5000): boolean => {
    const now = Date.now();
    const lastTime = lastFlagTimeRef.current[type] || 0;
    if (now - lastTime < cooldownMs) return false;
    lastFlagTimeRef.current[type] = now;
    return true;
  }, []);

  // Perform face detection
  const detectFace = useCallback(async () => {
    if (!videoRef.current || !isModelLoaded || !mergedConfig.enabled) return;

    const video = videoRef.current;
    if (video.paused || video.ended || video.readyState < 2) return;

    try {
      const detections = await faceapi
        .detectAllFaces(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.4 }))
        .withFaceLandmarks(true);

      const faceCount = detections.length;
      const result: FaceDetectionResult = {
        faceDetected: faceCount > 0,
        multipleFaces: faceCount > 1,
        headPose: null,
        headMovement: { left: false, right: false, up: false, down: false },
      };

      // Update consecutive counters
      if (faceCount === 0) {
        consecutiveNoFaceRef.current++;
        consecutiveMultipleFacesRef.current = 0;

        if (consecutiveNoFaceRef.current >= mergedConfig.faceNotDetectedThreshold) {
          if (shouldFlag("face_not_detected", 10000)) {
            console.log("[FaceDetection] Face not detected - flagging");
            const screenshot = captureScreenshot();
            onFlag("face_not_detected", "high", screenshot);
            setStats(prev => ({
              ...prev,
              faceNotDetectedCount: prev.faceNotDetectedCount + 1,
            }));
          }
        }
      } else if (faceCount > 1) {
        consecutiveNoFaceRef.current = 0;
        consecutiveMultipleFacesRef.current++;

        if (consecutiveMultipleFacesRef.current >= mergedConfig.multipleFacesThreshold) {
          if (shouldFlag("multiple_faces", 10000)) {
            console.log("[FaceDetection] Multiple faces detected - flagging");
            const screenshot = captureScreenshot();
            onFlag("multiple_faces", "high", screenshot);
            setStats(prev => ({
              ...prev,
              multipleFacesCount: prev.multipleFacesCount + 1,
            }));
          }
        }
      } else {
        consecutiveNoFaceRef.current = 0;
        consecutiveMultipleFacesRef.current = 0;

        // Calculate head pose for single face
        const landmarks = detections[0].landmarks;
        const headPose = calculateHeadPose(landmarks);
        result.headPose = headPose;

        // Establish baseline on first detection
        if (!baselineHeadPoseRef.current) {
          baselineHeadPoseRef.current = headPose;
          console.log("[FaceDetection] Baseline head pose established:", headPose);
        }

        // Check for head movements relative to baseline
        const baseline = baselineHeadPoseRef.current;
        const yawDiff = headPose.yaw - baseline.yaw;
        const pitchDiff = headPose.pitch - baseline.pitch;

        // Check left movement
        if (yawDiff < mergedConfig.headMovementThreshold.left) {
          result.headMovement.left = true;
          if (shouldFlag("head_movement_left", 3000)) {
            console.log("[FaceDetection] Head movement left detected:", yawDiff);
            const screenshot = captureScreenshot();
            onFlag("head_movement_left", "medium", screenshot);
            setStats(prev => ({
              ...prev,
              headMovementFlags: {
                ...prev.headMovementFlags,
                left: prev.headMovementFlags.left + 1,
              },
            }));
          }
        }

        // Check right movement
        if (yawDiff > mergedConfig.headMovementThreshold.right) {
          result.headMovement.right = true;
          if (shouldFlag("head_movement_right", 3000)) {
            console.log("[FaceDetection] Head movement right detected:", yawDiff);
            const screenshot = captureScreenshot();
            onFlag("head_movement_right", "medium", screenshot);
            setStats(prev => ({
              ...prev,
              headMovementFlags: {
                ...prev.headMovementFlags,
                right: prev.headMovementFlags.right + 1,
              },
            }));
          }
        }

        // Check up movement
        if (pitchDiff < mergedConfig.headMovementThreshold.up) {
          result.headMovement.up = true;
          if (shouldFlag("head_movement_up", 3000)) {
            console.log("[FaceDetection] Head movement up detected:", pitchDiff);
            const screenshot = captureScreenshot();
            onFlag("head_movement_up", "medium", screenshot);
            setStats(prev => ({
              ...prev,
              headMovementFlags: {
                ...prev.headMovementFlags,
                up: prev.headMovementFlags.up + 1,
              },
            }));
          }
        }

        // Check down movement
        if (pitchDiff > mergedConfig.headMovementThreshold.down) {
          result.headMovement.down = true;
          if (shouldFlag("head_movement_down", 3000)) {
            console.log("[FaceDetection] Head movement down detected:", pitchDiff);
            const screenshot = captureScreenshot();
            onFlag("head_movement_down", "medium", screenshot);
            setStats(prev => ({
              ...prev,
              headMovementFlags: {
                ...prev.headMovementFlags,
                down: prev.headMovementFlags.down + 1,
              },
            }));
          }
        }
      }

      setLastDetection(result);
      setStats(prev => ({
        ...prev,
        totalDetections: prev.totalDetections + 1,
      }));
    } catch (error) {
      console.error("[FaceDetection] Detection error:", error);
    }
  }, [
    videoRef,
    isModelLoaded,
    mergedConfig,
    calculateHeadPose,
    captureScreenshot,
    shouldFlag,
    onFlag,
  ]);

  // Start detection loop
  const startDetection = useCallback(() => {
    if (detectionIntervalRef.current || !isModelLoaded) return;

    console.log("[FaceDetection] Starting detection loop");
    setIsDetecting(true);
    
    // Reset baseline when starting
    baselineHeadPoseRef.current = null;
    
    detectionIntervalRef.current = setInterval(
      detectFace,
      mergedConfig.detectionInterval
    );
  }, [isModelLoaded, detectFace, mergedConfig.detectionInterval]);

  // Stop detection loop
  const stopDetection = useCallback(() => {
    if (detectionIntervalRef.current) {
      console.log("[FaceDetection] Stopping detection loop");
      clearInterval(detectionIntervalRef.current);
      detectionIntervalRef.current = null;
    }
    setIsDetecting(false);
  }, []);

  // Reset baseline (useful if student adjusts camera)
  const resetBaseline = useCallback(() => {
    baselineHeadPoseRef.current = null;
    console.log("[FaceDetection] Baseline reset - will recalibrate on next detection");
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopDetection();
    };
  }, [stopDetection]);

  return {
    isModelLoaded,
    isDetecting,
    lastDetection,
    stats,
    loadModels,
    startDetection,
    stopDetection,
    resetBaseline,
  };
}

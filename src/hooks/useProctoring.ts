import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { onAppStateChange } from "@/lib/native";
import { toast } from "sonner";

// GLOBAL KILL SWITCH: Set to true to disable all live proctoring functionality
const PROCTORING_GLOBALLY_DISABLED = false;

type ProctoringEventType = 
  | "face_not_detected"
  | "multiple_faces"
  | "head_movement_left"
  | "head_movement_right"
  | "head_movement_up"
  | "head_movement_down"
  | "tab_switch"
  | "window_blur"
  | "camera_blocked"
  | "camera_disconnected"
  | "audio_anomaly"
  | "screen_share_stopped"
  | "copy_paste_attempt"
  | "right_click_attempt"
  | "keyboard_shortcut_blocked"
  | "browser_devtools_opened"
  | "fullscreen_exited"
  // Back button / back gesture during a live attempt. Recorded rather than
  // folded into "other" so a marker can see the student tried to leave the
  // paper. proctoring_events.event_type is plain text, so no DB enum to widen.
  | "navigation_attempt"
  | "other";

interface ProctoringSession {
  id: string;
  isActive: boolean;
  cameraEnabled: boolean;
  microphoneEnabled: boolean;
}

export function useProctoring(attemptId: string | null, examMode: string) {
  const [session, setSession] = useState<ProctoringSession | null>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [permissionsGranted, setPermissionsGranted] = useState(false);
  const [consentGiven, setConsentGiven] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  
  const eventQueue = useRef<{ type: ProctoringEventType; severity: string; screenshotUrl?: string }[]>([]);
  const flushTimeout = useRef<NodeJS.Timeout | null>(null);
  const currentQuestionId = useRef<string | null>(null);
  const attemptIdRef = useRef<string | null>(attemptId);
  const examModeRef = useRef<string>(examMode);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const sessionRef = useRef<typeof session>(null);

  // Keep refs in sync
  useEffect(() => {
    cameraStreamRef.current = cameraStream;
  }, [cameraStream]);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);
  
  useEffect(() => {
    attemptIdRef.current = attemptId;
  }, [attemptId]);
  
  useEffect(() => {
    examModeRef.current = examMode;
    console.log("[Proctoring] examMode updated to:", examMode);
  }, [examMode]);

  const isOnlineExam = PROCTORING_GLOBALLY_DISABLED ? false : examMode === "online";

  // Capture screenshot from camera stream and upload to storage
  const captureScreenshot = useCallback(async (eventType: ProctoringEventType): Promise<string | undefined> => {
    const stream = cameraStreamRef.current;
    if (!stream) return undefined;

    try {
      const videoTrack = stream.getVideoTracks()[0];
      if (!videoTrack || videoTrack.readyState !== "live") return undefined;

      const video = document.createElement("video");
      video.srcObject = stream;
      video.muted = true;
      await video.play();

      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      const ctx = canvas.getContext("2d");
      if (!ctx) return undefined;
      ctx.drawImage(video, 0, 0);
      video.pause();
      video.srcObject = null;

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.7)
      );
      if (!blob) return undefined;

      const sessionId = session?.id;
      if (!sessionId) return undefined;

      const fileName = `${sessionId}/${eventType}_${Date.now()}.jpg`;
      const { data, error } = await supabase.storage
        .from("proctoring-screenshots")
        .upload(fileName, blob, { contentType: "image/jpeg", upsert: false });

      if (error) {
        console.error("[Proctoring] Screenshot upload failed:", error);
        return undefined;
      }

      const { data: urlData } = await supabase.storage
        .from("proctoring-screenshots")
        .createSignedUrl(data.path, 86400);

      return urlData?.signedUrl;
    } catch (err) {
      console.error("[Proctoring] Screenshot capture failed:", err);
      return undefined;
    }
  }, [session?.id]);

  // Create proctoring session
  const initSession = useCallback(async () => {
    if (PROCTORING_GLOBALLY_DISABLED) {
      console.log("[Proctoring] Globally disabled - skipping init");
      return;
    }
    
    const currentExamMode = examModeRef.current;
    if (currentExamMode !== "online") {
      console.log("[Proctoring] Skipping init - exam mode is:", currentExamMode);
      return;
    }

    const currentAttemptId = attemptIdRef.current;
    
    if (!currentAttemptId) {
      console.warn("[Proctoring] Init called but no attemptId yet");
      return;
    }

    if (isInitializing) {
      console.log("[Proctoring] Already initializing - skipping");
      return;
    }

    setIsInitializing(true);
    console.log("[Proctoring] Initializing session for attempt:", currentAttemptId);

    try {
      const { data: existingSession } = await supabase
        .from("proctoring_sessions")
        .select("id")
        .eq("attempt_id", currentAttemptId)
        .maybeSingle();
      
      if (existingSession) {
        console.log("[Proctoring] Session already exists:", existingSession.id);
        setSession({
          id: existingSession.id,
          isActive: true,
          cameraEnabled: permissionsGranted,
          microphoneEnabled: false,
        });
        setIsInitializing(false);
        return existingSession.id;
      }

      const { data, error } = await supabase
        .from("proctoring_sessions")
        .insert({
          attempt_id: currentAttemptId,
          camera_enabled: permissionsGranted,
          browser_info: {
            userAgent: navigator.userAgent,
            platform: navigator.platform,
            language: navigator.language,
            screenWidth: window.screen.width,
            screenHeight: window.screen.height,
          },
        })
        .select()
        .single();

      if (error) {
        console.error("[Proctoring] Failed to create session:", error);
        throw error;
      }

      console.log("[Proctoring] Session created:", data.id);
      
      setSession({
        id: data.id,
        isActive: true,
        cameraEnabled: permissionsGranted,
        microphoneEnabled: false,
      });

      return data.id;
    } catch (error) {
      console.error("[Proctoring] Failed to create session:", error);
    } finally {
      setIsInitializing(false);
    }
  }, [permissionsGranted, isInitializing]);

  // Auto-initialize when attemptId becomes available for online exams
  useEffect(() => {
    const shouldInit = attemptId && examMode === "online" && !session && !isInitializing;
    console.log("[Proctoring] Auto-init check:", { attemptId: !!attemptId, examMode, hasSession: !!session, isInitializing, shouldInit });
    
    if (shouldInit) {
      console.log("[Proctoring] Auto-initializing for online exam");
      initSession();
    }
  }, [attemptId, examMode, session, isInitializing, initSession]);

  // Request camera permissions
  const requestPermissions = useCallback(async () => {
    if (PROCTORING_GLOBALLY_DISABLED) {
      console.log("Proctoring is globally disabled - skipping camera request");
      setPermissionsGranted(true);
      return true;
    }
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });
      console.log("[Proctoring] getUserMedia succeeded — tracks:", stream.getVideoTracks().length, "readyState:", stream.getVideoTracks()[0]?.readyState);
      setCameraStream(stream);
      cameraStreamRef.current = stream;
      setPermissionsGranted(true);
      return true;
    } catch (error) {
      console.error("Camera permission denied:", error);
      toast.error("Camera access is required for online exams");
      return false;
    }
  }, []);

  // Retry camera
  const retryCamera = useCallback(async () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach(t => t.stop());
      setCameraStream(null);
    }
    setPermissionsGranted(false);
    return requestPermissions();
  }, [cameraStream, requestPermissions]);

  // Monitor stream health
  useEffect(() => {
    if (!cameraStream) return;
    const track = cameraStream.getVideoTracks()[0];
    if (!track) return;
    const handleEnded = () => {
      console.warn("[Proctoring] Camera track ended unexpectedly");
      setCameraStream(null);
      setPermissionsGranted(false);
      toast.error("Camera disconnected. Please click 'Retry Camera' to reconnect.");
    };
    track.addEventListener("ended", handleEnded);

    // Poll track readyState as some browsers don't fire 'ended' reliably
    const healthCheck = setInterval(() => {
      if (track.readyState === "ended") {
        console.warn("[Proctoring] Camera track ended (detected by poll)");
        setCameraStream(null);
        setPermissionsGranted(false);
        toast.error("Camera disconnected. Please click 'Retry Camera' to reconnect.");
        clearInterval(healthCheck);
      }
    }, 3000);

    return () => {
      track.removeEventListener("ended", handleEnded);
      clearInterval(healthCheck);
    };
  }, [cameraStream]);

  // Flush events to database
  const flushEvents = useCallback(async () => {
    if (!session?.id || eventQueue.current.length === 0) return;

    const events = [...eventQueue.current];
    eventQueue.current = [];

    console.log("[Proctoring] Flushing", events.length, "events to database");

    try {
      const eventsToInsert = events.map((e) => ({
        session_id: session.id,
        event_type: e.type,
        severity: e.severity,
        question_id: currentQuestionId.current,
        event_metadata: {},
        description: getEventDescription(e.type),
        screenshot_url: e.screenshotUrl || null,
      }));

      const { error } = await supabase.from("proctoring_events").insert(eventsToInsert);
      
      if (error) {
        console.error("[Proctoring] Failed to insert events:", error);
        throw error;
      }
      
      console.log("[Proctoring] Successfully saved", events.length, "events");

      // The session's counters (total / high / medium / low) and its
      // requires_review flag are maintained by the AFTER INSERT trigger
      // trigger_update_proctoring_metrics on proctoring_events, one increment
      // per row. This hook used to add the same counts again from the browser,
      // so every counter read double (40,330 high-severity events shown at
      // Alliance against 20,275 logged, audit R13). Do not re-add a client
      // update here.
    } catch (error) {
      console.error("[Proctoring] Failed to save events:", error);
      eventQueue.current = [...events, ...eventQueue.current];
    }
  }, [session?.id]);

  // Schedule flush
  const scheduleFlush = useCallback(() => {
    if (flushTimeout.current) {
      clearTimeout(flushTimeout.current);
    }
    flushTimeout.current = setTimeout(flushEvents, 3000);
  }, [flushEvents]);

  // Record event - works even before session is created by queuing
  const recordEvent = useCallback(
    (type: ProctoringEventType, severity: "low" | "medium" | "high", screenshotUrl?: string) => {
      if (PROCTORING_GLOBALLY_DISABLED) return;
      
      const currentExamMode = examModeRef.current;
      // Allow recording even without active session - events will be queued
      // and flushed once session is available. But skip if not online exam.
      if (currentExamMode !== "online") {
        return;
      }

      console.log("[Proctoring] Recording event:", type, "severity:", severity);
      eventQueue.current.push({ type, severity, screenshotUrl });
      
      // Only flush if session is active
      if (session?.isActive) {
        scheduleFlush();
      }
    },
    [session?.isActive, scheduleFlush]
  );

  // Set current question for context
  const setCurrentQuestion = useCallback((questionId: string | null) => {
    currentQuestionId.current = questionId;
  }, []);

  // Proctoring event listeners for recording (visibilitychange & fullscreenchange only)
  // Right-click and keyboard listeners are consolidated in ExamAttemptPage to avoid duplicates
  useEffect(() => {
    if (!session?.isActive || examMode !== "online") return;

    const handleHidden = async () => {
      let url: string | undefined;
      try { url = await captureScreenshot("tab_switch"); } catch (e) { console.error("[Proctoring] Screenshot failed:", e); }
      recordEvent("tab_switch", "high", url);
    };

    const handleFullscreenChange = async () => {
      if (!document.fullscreenElement) {
        let url: string | undefined;
        try { url = await captureScreenshot("fullscreen_exited"); } catch (e) { console.error("[Proctoring] Screenshot failed:", e); }
        recordEvent("fullscreen_exited", "medium", url);
      }
    };

    console.log("[Proctoring] Setting up event listeners (visibility + fullscreen)");
    // Visibility through the native adapter (the app shell substitutes the OS
    // app-state event); focus changes are ignored here as before.
    const offAppState = onAppStateChange((active, source) => {
      if (source === "focus" || active) return;
      void handleHidden();
    });
    document.addEventListener("fullscreenchange", handleFullscreenChange);

    return () => {
      console.log("[Proctoring] Cleaning up event listeners");
      offAppState();
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, [session?.isActive, examMode, recordEvent, captureScreenshot]);

  // Cleanup on unmount only - use refs to avoid killing camera on dep changes
  useEffect(() => {
    return () => {
      if (flushTimeout.current) {
        clearTimeout(flushTimeout.current);
        flushTimeout.current = null;
      }
      
      if (sessionRef.current?.id && eventQueue.current.length > 0) {
        const events = [...eventQueue.current];
        eventQueue.current = [];
        
        const eventsToInsert = events.map((e) => ({
          session_id: sessionRef.current!.id,
          event_type: e.type,
          severity: e.severity,
          question_id: currentQuestionId.current,
          event_metadata: {},
          description: getEventDescription(e.type),
          screenshot_url: e.screenshotUrl || null,
        }));
        
        supabase.from("proctoring_events").insert(eventsToInsert);
      }

      if (cameraStreamRef.current) {
        cameraStreamRef.current.getTracks().forEach((track) => {
          track.stop();
        });
        cameraStreamRef.current = null;
      }

      if (sessionRef.current?.id) {
        // Fire-and-forget on unmount, but never silently: this exact write was
        // rejected by RLS for months (the policy's implicit WITH CHECK required
        // is_active = true, so setting it false could never pass — fixed in
        // migration 20260825140000) and nobody knew, because the error went
        // nowhere. Keep a log line so a regression is visible in console/Sentry.
        supabase
          .from("proctoring_sessions")
          .update({ is_active: false, ended_at: new Date().toISOString() })
          .eq("id", sessionRef.current.id)
          .then(({ error }) => {
            if (error) console.error("[proctoring] failed to end session:", error);
          });
      }
    };
   
  }, []);

  return {
    session,
    cameraStream,
    permissionsGranted,
    consentGiven,
    isOnlineExam,
    requestPermissions,
    retryCamera,
    giveConsent: () => setConsentGiven(true),
    initSession,
    recordEvent,
    setCurrentQuestion,
    endSession: async () => {
      if (!session?.id) return;
      
      await flushEvents();
      
      if (cameraStream) {
        cameraStream.getTracks().forEach((track) => {
          track.stop();
        });
        setCameraStream(null);
      }
      
      await supabase
        .from("proctoring_sessions")
        .update({ is_active: false, ended_at: new Date().toISOString() })
        .eq("id", session.id);
      
      setSession(null);
      setPermissionsGranted(false);
      
      console.log("Proctoring session ended and cleaned up");
    },
  };
}

function getEventDescription(type: ProctoringEventType): string {
  const descriptions: Record<ProctoringEventType, string> = {
    face_not_detected: "Face was not detected in camera frame",
    multiple_faces: "Multiple faces detected in camera frame",
    head_movement_left: "Significant head movement to the left",
    head_movement_right: "Significant head movement to the right",
    head_movement_up: "Significant head movement upward",
    head_movement_down: "Significant head movement downward",
    tab_switch: "Browser tab was switched or minimized",
    window_blur: "Browser window lost focus",
    camera_blocked: "Camera feed was blocked or covered",
    camera_disconnected: "Camera was disconnected",
    audio_anomaly: "Unusual audio detected",
    screen_share_stopped: "Screen sharing was stopped",
    copy_paste_attempt: "Attempted to copy or paste content",
    right_click_attempt: "Right-click context menu was blocked",
    keyboard_shortcut_blocked: "Keyboard shortcut was blocked",
    browser_devtools_opened: "Developer tools were opened",
    fullscreen_exited: "Fullscreen mode was exited",
    navigation_attempt: "Tried to leave the exam using the back button",
    other: "Other suspicious activity",
  };

  return descriptions[type] || "Unknown event";
}

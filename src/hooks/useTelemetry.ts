import { useRef, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

interface TelemetryState {
  questionStartTime: number | null;
  currentQuestionId: string | null;
  sectionStartTime: number | null;
  currentSectionId: string | null;
}

export function useTelemetry(attemptId: string | null) {
  const stateRef = useRef<TelemetryState>({
    questionStartTime: null,
    currentQuestionId: null,
    sectionStartTime: null,
    currentSectionId: null,
  });

  const pendingUpdates = useRef<Map<string, any>>(new Map());
  const flushTimeout = useRef<NodeJS.Timeout | null>(null);

  // Flush pending telemetry updates to database
  const flushTelemetry = useCallback(async () => {
    if (!attemptId || pendingUpdates.current.size === 0) return;

    const updates = Array.from(pendingUpdates.current.entries());
    pendingUpdates.current.clear();

    // Rows carry heterogeneous columns (view vs answer vs flag deltas), so
    // PostgREST bulk upsert (which requires identical keys per row) can't
    // batch them into one request. Bound the concurrency instead of awaiting
    // one-by-one — this runs every ~2s per active exam taker (§23).
    // PERF-DEBT: a record_question_telemetry(jsonb) RPC doing server-side
    // increments would make this one request AND fix the lost-increment race.
    const CHUNK = 5;
    for (let i = 0; i < updates.length; i += CHUNK) {
      const chunk = updates.slice(i, i + CHUNK);
      await Promise.all(
        chunk.map(async ([questionId, data]) => {
          try {
            await supabase.from("attempt_question_telemetry").upsert(
              {
                attempt_id: attemptId,
                question_id: questionId,
                ...data,
                updated_at: new Date().toISOString(),
              },
              { onConflict: "attempt_id,question_id" }
            );
          } catch (error) {
            console.error("Failed to save telemetry:", error);
          }
        })
      );
    }
  }, [attemptId]);

  // Debounced flush
  const schedulFlush = useCallback(() => {
    if (flushTimeout.current) {
      clearTimeout(flushTimeout.current);
    }
    flushTimeout.current = setTimeout(flushTelemetry, 2000);
  }, [flushTelemetry]);

  // Track question view
  const trackQuestionView = useCallback(
    (questionId: string) => {
      const now = Date.now();
      const state = stateRef.current;

      // Save time spent on previous question
      if (state.currentQuestionId && state.questionStartTime) {
        const timeSpent = Math.floor((now - state.questionStartTime) / 1000);
        const existing = pendingUpdates.current.get(state.currentQuestionId) || {};
        
        pendingUpdates.current.set(state.currentQuestionId, {
          ...existing,
          total_time_seconds: (existing.total_time_seconds || 0) + timeSpent,
          last_viewed_at: new Date().toISOString(),
        });
      }

      // Start tracking new question
      stateRef.current = {
        ...state,
        questionStartTime: now,
        currentQuestionId: questionId,
      };

      // Record first view if not seen before
      const existingData = pendingUpdates.current.get(questionId);
      if (!existingData?.first_viewed_at) {
        pendingUpdates.current.set(questionId, {
          ...existingData,
          first_viewed_at: new Date().toISOString(),
          view_count: 1,
          is_skipped: true,
        });
      } else {
        pendingUpdates.current.set(questionId, {
          ...existingData,
          view_count: (existingData.view_count || 0) + 1,
        });
      }

      schedulFlush();
    },
    [schedulFlush]
  );

  // Track section change
  const trackSectionView = useCallback(
    async (sectionId: string) => {
      if (!attemptId) return;
      
      const now = Date.now();
      const state = stateRef.current;

      // Save time spent on previous section
      if (state.currentSectionId && state.sectionStartTime) {
        const timeSpent = Math.floor((now - state.sectionStartTime) / 1000);
        
        try {
          const { data: existing } = await supabase
            .from("attempt_section_telemetry")
            .select("total_time_seconds")
            .eq("attempt_id", attemptId)
            .eq("section_id", state.currentSectionId)
            .single();

          await supabase.from("attempt_section_telemetry").upsert(
            {
              attempt_id: attemptId,
              section_id: state.currentSectionId,
              total_time_seconds: (existing?.total_time_seconds || 0) + timeSpent,
              last_exited_at: new Date().toISOString(),
            },
            { onConflict: "attempt_id,section_id" }
          );
        } catch (error) {
          console.error("Failed to save section telemetry:", error);
        }
      }

      // Start tracking new section
      stateRef.current = {
        ...state,
        sectionStartTime: now,
        currentSectionId: sectionId,
      };

      // Record first entry if not seen before
      try {
        const { data: existing } = await supabase
          .from("attempt_section_telemetry")
          .select("first_entered_at")
          .eq("attempt_id", attemptId)
          .eq("section_id", sectionId)
          .single();

        if (!existing) {
          await supabase.from("attempt_section_telemetry").insert({
            attempt_id: attemptId,
            section_id: sectionId,
            first_entered_at: new Date().toISOString(),
          });
        }
      } catch (error) {
        // Insert if doesn't exist
        await supabase.from("attempt_section_telemetry").insert({
          attempt_id: attemptId,
          section_id: sectionId,
          first_entered_at: new Date().toISOString(),
        });
      }
    },
    [attemptId]
  );

  // Track answer change
  const trackAnswerChange = useCallback(
    (questionId: string, isFirstAnswer: boolean) => {
      const existing = pendingUpdates.current.get(questionId) || {};
      
      pendingUpdates.current.set(questionId, {
        ...existing,
        is_answered: true,
        is_skipped: false,
        answer_change_count: (existing.answer_change_count || 0) + (isFirstAnswer ? 0 : 1),
        final_answer_at: new Date().toISOString(),
        time_to_first_answer_seconds: isFirstAnswer && stateRef.current.questionStartTime
          ? Math.floor((Date.now() - stateRef.current.questionStartTime) / 1000)
          : existing.time_to_first_answer_seconds,
      });

      schedulFlush();
    },
    [schedulFlush]
  );

  // Track question flag
  const trackQuestionFlag = useCallback(
    (questionId: string, isFlagged: boolean) => {
      const existing = pendingUpdates.current.get(questionId) || {};
      
      pendingUpdates.current.set(questionId, {
        ...existing,
        is_flagged_for_review: isFlagged,
      });

      schedulFlush();
    },
    [schedulFlush]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (flushTimeout.current) {
        clearTimeout(flushTimeout.current);
      }
      // Final flush
      flushTelemetry();
    };
  }, [flushTelemetry]);

  return {
    trackQuestionView,
    trackSectionView,
    trackAnswerChange,
    trackQuestionFlag,
    flushTelemetry,
  };
}

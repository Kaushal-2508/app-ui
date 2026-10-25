export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ai_config_changes: {
        Row: {
          change_type: string
          changed_by: string | null
          config_key: string | null
          created_at: string
          id: string
          new_value: string | null
          old_value: string | null
        }
        Insert: {
          change_type: string
          changed_by?: string | null
          config_key?: string | null
          created_at?: string
          id?: string
          new_value?: string | null
          old_value?: string | null
        }
        Update: {
          change_type?: string
          changed_by?: string | null
          config_key?: string | null
          created_at?: string
          id?: string
          new_value?: string | null
          old_value?: string | null
        }
        Relationships: []
      }
      ai_daily_usage: {
        Row: {
          id: string
          institution_id: string | null
          questions_generated: number
          tokens_used: number
          usage_date: string
          user_id: string
        }
        Insert: {
          id?: string
          institution_id?: string | null
          questions_generated?: number
          tokens_used?: number
          usage_date?: string
          user_id: string
        }
        Update: {
          id?: string
          institution_id?: string | null
          questions_generated?: number
          tokens_used?: number
          usage_date?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_daily_usage_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_evaluations: {
        Row: {
          answer_id: string
          confidence_score: number
          created_at: string
          evaluation_metadata: Json | null
          evaluation_reasoning: string | null
          feedback_suggestion: string | null
          id: string
          is_accepted: boolean | null
          matched_keywords: string[] | null
          max_marks: number
          model_used: string | null
          requires_teacher_review: boolean
          suggested_marks: number
        }
        Insert: {
          answer_id: string
          confidence_score: number
          created_at?: string
          evaluation_metadata?: Json | null
          evaluation_reasoning?: string | null
          feedback_suggestion?: string | null
          id?: string
          is_accepted?: boolean | null
          matched_keywords?: string[] | null
          max_marks: number
          model_used?: string | null
          requires_teacher_review?: boolean
          suggested_marks: number
        }
        Update: {
          answer_id?: string
          confidence_score?: number
          created_at?: string
          evaluation_metadata?: Json | null
          evaluation_reasoning?: string | null
          feedback_suggestion?: string | null
          id?: string
          is_accepted?: boolean | null
          matched_keywords?: string[] | null
          max_marks?: number
          model_used?: string | null
          requires_teacher_review?: boolean
          suggested_marks?: number
        }
        Relationships: [
          {
            foreignKeyName: "ai_evaluations_answer_id_fkey"
            columns: ["answer_id"]
            isOneToOne: true
            referencedRelation: "student_answers"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_monthly_usage: {
        Row: {
          id: string
          institution_id: string | null
          tokens_used: number
          usage_month: string
        }
        Insert: {
          id?: string
          institution_id?: string | null
          tokens_used?: number
          usage_month: string
        }
        Update: {
          id?: string
          institution_id?: string | null
          tokens_used?: number
          usage_month?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_monthly_usage_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_suggested_tasks: {
        Row: {
          actioned_at: string | null
          actioned_by: string | null
          created_at: string | null
          description: string | null
          id: string
          institution_id: string
          priority: number | null
          source_data: Json | null
          source_type: string
          status: string | null
          suggested_assignee: string | null
          suggested_for: string | null
          task_type: Database["public"]["Enums"]["task_type"] | null
          title: string
          wing_id: string | null
        }
        Insert: {
          actioned_at?: string | null
          actioned_by?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          institution_id: string
          priority?: number | null
          source_data?: Json | null
          source_type: string
          status?: string | null
          suggested_assignee?: string | null
          suggested_for?: string | null
          task_type?: Database["public"]["Enums"]["task_type"] | null
          title: string
          wing_id?: string | null
        }
        Update: {
          actioned_at?: string | null
          actioned_by?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          institution_id?: string
          priority?: number | null
          source_data?: Json | null
          source_type?: string
          status?: string | null
          suggested_assignee?: string | null
          suggested_for?: string | null
          task_type?: Database["public"]["Enums"]["task_type"] | null
          title?: string
          wing_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_suggested_tasks_actioned_by_fkey"
            columns: ["actioned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_suggested_tasks_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_suggested_tasks_suggested_assignee_fkey"
            columns: ["suggested_assignee"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_suggested_tasks_suggested_for_fkey"
            columns: ["suggested_for"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_suggested_tasks_wing_id_fkey"
            columns: ["wing_id"]
            isOneToOne: false
            referencedRelation: "wings"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_usage_logs: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          institution_id: string | null
          questions_generated: number
          request_metadata: Json | null
          request_status: string
          service_type: string
          tokens_used: number
          user_id: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          institution_id?: string | null
          questions_generated?: number
          request_metadata?: Json | null
          request_status: string
          service_type: string
          tokens_used?: number
          user_id: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          institution_id?: string | null
          questions_generated?: number
          request_metadata?: Json | null
          request_status?: string
          service_type?: string
          tokens_used?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_logs_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_usage_quotas: {
        Row: {
          created_at: string
          daily_question_limit: number
          daily_token_limit: number
          id: string
          institution_id: string | null
          monthly_token_limit: number
          ocr_enabled: boolean
          question_generation_enabled: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          daily_question_limit?: number
          daily_token_limit?: number
          id?: string
          institution_id?: string | null
          monthly_token_limit?: number
          ocr_enabled?: boolean
          question_generation_enabled?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          daily_question_limit?: number
          daily_token_limit?: number
          id?: string
          institution_id?: string | null
          monthly_token_limit?: number
          ocr_enabled?: boolean
          question_generation_enabled?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_quotas_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: true
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
        ]
      }
      appointments: {
        Row: {
          appointment_date: string
          created_at: string
          end_time: string
          id: string
          institution_id: string
          purpose: string
          start_time: string
          status: string
          student_id: string
          teacher_id: string
          teacher_notes: string | null
          updated_at: string
        }
        Insert: {
          appointment_date: string
          created_at?: string
          end_time: string
          id?: string
          institution_id: string
          purpose: string
          start_time: string
          status?: string
          student_id: string
          teacher_id: string
          teacher_notes?: string | null
          updated_at?: string
        }
        Update: {
          appointment_date?: string
          created_at?: string
          end_time?: string
          id?: string
          institution_id?: string
          purpose?: string
          start_time?: string
          status?: string
          student_id?: string
          teacher_id?: string
          teacher_notes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      attempt_question_telemetry: {
        Row: {
          answer_change_count: number | null
          attempt_id: string
          created_at: string
          final_answer_at: string | null
          first_viewed_at: string | null
          id: string
          is_answered: boolean | null
          is_flagged_for_review: boolean | null
          is_skipped: boolean | null
          last_viewed_at: string | null
          question_id: string
          time_to_first_answer_seconds: number | null
          total_time_seconds: number | null
          updated_at: string
          view_count: number | null
        }
        Insert: {
          answer_change_count?: number | null
          attempt_id: string
          created_at?: string
          final_answer_at?: string | null
          first_viewed_at?: string | null
          id?: string
          is_answered?: boolean | null
          is_flagged_for_review?: boolean | null
          is_skipped?: boolean | null
          last_viewed_at?: string | null
          question_id: string
          time_to_first_answer_seconds?: number | null
          total_time_seconds?: number | null
          updated_at?: string
          view_count?: number | null
        }
        Update: {
          answer_change_count?: number | null
          attempt_id?: string
          created_at?: string
          final_answer_at?: string | null
          first_viewed_at?: string | null
          id?: string
          is_answered?: boolean | null
          is_flagged_for_review?: boolean | null
          is_skipped?: boolean | null
          last_viewed_at?: string | null
          question_id?: string
          time_to_first_answer_seconds?: number | null
          total_time_seconds?: number | null
          updated_at?: string
          view_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "attempt_question_telemetry_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "student_eligible_exams"
            referencedColumns: ["attempt_id"]
          },
          {
            foreignKeyName: "attempt_question_telemetry_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "student_exam_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attempt_question_telemetry_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "exam_questions"
            referencedColumns: ["id"]
          },
        ]
      }
      attempt_section_telemetry: {
        Row: {
          attempt_id: string
          created_at: string
          first_entered_at: string | null
          id: string
          last_exited_at: string | null
          questions_attempted: number | null
          questions_flagged: number | null
          questions_skipped: number | null
          section_id: string
          total_time_seconds: number | null
          updated_at: string
        }
        Insert: {
          attempt_id: string
          created_at?: string
          first_entered_at?: string | null
          id?: string
          last_exited_at?: string | null
          questions_attempted?: number | null
          questions_flagged?: number | null
          questions_skipped?: number | null
          section_id: string
          total_time_seconds?: number | null
          updated_at?: string
        }
        Update: {
          attempt_id?: string
          created_at?: string
          first_entered_at?: string | null
          id?: string
          last_exited_at?: string | null
          questions_attempted?: number | null
          questions_flagged?: number | null
          questions_skipped?: number | null
          section_id?: string
          total_time_seconds?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "attempt_section_telemetry_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "student_eligible_exams"
            referencedColumns: ["attempt_id"]
          },
          {
            foreignKeyName: "attempt_section_telemetry_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "student_exam_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attempt_section_telemetry_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "exam_sections"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_pins: {
        Row: {
          class_id: string
          pinned_at: string
          user_id: string
        }
        Insert: {
          class_id: string
          pinned_at?: string
          user_id: string
        }
        Update: {
          class_id?: string
          pinned_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_pins_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_pins_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_records: {
        Row: {
          class_id: string
          created_at: string
          date: string
          id: string
          institution_id: string
          marked_by: string | null
          method: string
          remarks: string | null
          status: string
          student_id: string
          substitution_id: string | null
          updated_at: string
        }
        Insert: {
          class_id: string
          created_at?: string
          date: string
          id?: string
          institution_id: string
          marked_by?: string | null
          method?: string
          remarks?: string | null
          status: string
          student_id: string
          substitution_id?: string | null
          updated_at?: string
        }
        Update: {
          class_id?: string
          created_at?: string
          date?: string
          id?: string
          institution_id?: string
          marked_by?: string | null
          method?: string
          remarks?: string | null
          status?: string
          student_id?: string
          substitution_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_records_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_records_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_records_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_records_substitution_id_fkey"
            columns: ["substitution_id"]
            isOneToOne: false
            referencedRelation: "tt_substitutions"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_sessions: {
        Row: {
          class_id: string
          created_at: string
          created_by: string | null
          date: string
          expires_at: string
          id: string
          institution_id: string
          is_active: boolean
          max_check_ins: number | null
          session_code: string
          session_type: string
          updated_at: string
        }
        Insert: {
          class_id: string
          created_at?: string
          created_by?: string | null
          date?: string
          expires_at: string
          id?: string
          institution_id: string
          is_active?: boolean
          max_check_ins?: number | null
          session_code: string
          session_type?: string
          updated_at?: string
        }
        Update: {
          class_id?: string
          created_at?: string
          created_by?: string | null
          date?: string
          expires_at?: string
          id?: string
          institution_id?: string
          is_active?: boolean
          max_check_ins?: number | null
          session_code?: string
          session_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_sessions_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_sessions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_sessions_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_settings: {
        Row: {
          absent_threshold_days: number
          coordinators_in_sub_pool: boolean
          created_at: string
          id: string
          institution_id: string
          max_subs_per_teacher_per_day: number
          notify_parents_on_absent: boolean
          staff_check_in_time: string
          staff_check_out_time: string
          staff_late_check_in_allowed: boolean
          staff_late_grace_minutes: number
          staff_substitution_enabled: boolean
          student_attendance_edit_window_days: number
          student_attendance_edit_window_hours: number
          tracking_methods: Json
          updated_at: string
        }
        Insert: {
          absent_threshold_days?: number
          coordinators_in_sub_pool?: boolean
          created_at?: string
          id?: string
          institution_id: string
          max_subs_per_teacher_per_day?: number
          notify_parents_on_absent?: boolean
          staff_check_in_time?: string
          staff_check_out_time?: string
          staff_late_check_in_allowed?: boolean
          staff_late_grace_minutes?: number
          staff_substitution_enabled?: boolean
          student_attendance_edit_window_days?: number
          student_attendance_edit_window_hours?: number
          tracking_methods?: Json
          updated_at?: string
        }
        Update: {
          absent_threshold_days?: number
          coordinators_in_sub_pool?: boolean
          created_at?: string
          id?: string
          institution_id?: string
          max_subs_per_teacher_per_day?: number
          notify_parents_on_absent?: boolean
          staff_check_in_time?: string
          staff_check_out_time?: string
          staff_late_check_in_allowed?: boolean
          staff_late_grace_minutes?: number
          staff_substitution_enabled?: boolean
          student_attendance_edit_window_days?: number
          student_attendance_edit_window_hours?: number
          tracking_methods?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_settings_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: true
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
        ]
      }
      badge_definitions: {
        Row: {
          badge_type: string
          category: string
          created_at: string
          criteria_metric: string
          criteria_type: string
          criteria_value: number
          description: string | null
          display_order: number | null
          icon_name: string
          id: string
          is_active: boolean
          name: string
          points: number
          tier: string
          updated_at: string
        }
        Insert: {
          badge_type: string
          category: string
          created_at?: string
          criteria_metric: string
          criteria_type: string
          criteria_value?: number
          description?: string | null
          display_order?: number | null
          icon_name?: string
          id?: string
          is_active?: boolean
          name: string
          points?: number
          tier?: string
          updated_at?: string
        }
        Update: {
          badge_type?: string
          category?: string
          created_at?: string
          criteria_metric?: string
          criteria_type?: string
          criteria_value?: number
          description?: string | null
          display_order?: number | null
          icon_name?: string
          id?: string
          is_active?: boolean
          name?: string
          points?: number
          tier?: string
          updated_at?: string
        }
        Relationships: []
      }
      badge_progress: {
        Row: {
          badge_id: string
          created_at: string
          current_value: number
          id: string
          institution_id: string | null
          last_updated: string
          target_value: number
          user_id: string
        }
        Insert: {
          badge_id: string
          created_at?: string
          current_value?: number
          id?: string
          institution_id?: string | null
          last_updated?: string
          target_value: number
          user_id: string
        }
        Update: {
          badge_id?: string
          created_at?: string
          current_value?: number
          id?: string
          institution_id?: string | null
          last_updated?: string
          target_value?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "badge_progress_badge_id_fkey"
            columns: ["badge_id"]
            isOneToOne: false
            referencedRelation: "badge_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "badge_progress_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "badge_progress_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      biometric_enrollments: {
        Row: {
          created_at: string
          device_id: string | null
          enrolled_by: string | null
          fingerprint_template: string
          id: string
          institution_id: string
          is_active: boolean
          student_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          device_id?: string | null
          enrolled_by?: string | null
          fingerprint_template: string
          id?: string
          institution_id: string
          is_active?: boolean
          student_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          device_id?: string | null
          enrolled_by?: string | null
          fingerprint_template?: string
          id?: string
          institution_id?: string
          is_active?: boolean
          student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "biometric_enrollments_enrolled_by_fkey"
            columns: ["enrolled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "biometric_enrollments_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "biometric_enrollments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      cal_academic_years: {
        Row: {
          code: string
          created_at: string
          ends_on: string
          id: string
          institution_id: string
          is_active: boolean
          starts_on: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          ends_on: string
          id?: string
          institution_id: string
          is_active?: boolean
          starts_on: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          ends_on?: string
          id?: string
          institution_id?: string
          is_active?: boolean
          starts_on?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cal_academic_years_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
        ]
      }
      cal_events: {
        Row: {
          academic_year: string
          color: string | null
          created_at: string
          created_by: string | null
          ends_on: string
          id: string
          institution_id: string
          kind: string
          notes: string | null
          starts_on: string
          title: string
          updated_at: string
        }
        Insert: {
          academic_year: string
          color?: string | null
          created_at?: string
          created_by?: string | null
          ends_on: string
          id?: string
          institution_id: string
          kind: string
          notes?: string | null
          starts_on: string
          title: string
          updated_at?: string
        }
        Update: {
          academic_year?: string
          color?: string | null
          created_at?: string
          created_by?: string | null
          ends_on?: string
          id?: string
          institution_id?: string
          kind?: string
          notes?: string | null
          starts_on?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cal_events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cal_events_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
        ]
      }
      chapter_topics: {
        Row: {
          chapter_id: string
          class_group_id: string | null
          created_at: string
          id: string
          institution_id: string
          name: string
          subject_id: string
        }
        Insert: {
          chapter_id: string
          class_group_id?: string | null
          created_at?: string
          id?: string
          institution_id: string
          name: string
          subject_id: string
        }
        Update: {
          chapter_id?: string
          class_group_id?: string | null
          created_at?: string
          id?: string
          institution_id?: string
          name?: string
          subject_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chapter_topics_chapter_id_fkey"
            columns: ["chapter_id"]
            isOneToOne: false
            referencedRelation: "syllabus_topics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chapter_topics_class_group_id_fkey"
            columns: ["class_group_id"]
            isOneToOne: false
            referencedRelation: "class_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chapter_topics_class_group_id_fkey"
            columns: ["class_group_id"]
            isOneToOne: false
            referencedRelation: "v_class_groups_with_sections"
            referencedColumns: ["class_group_id"]
          },
          {
            foreignKeyName: "chapter_topics_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chapter_topics_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "universal_subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      class_aggregates: {
        Row: {
          avg_accuracy_percent: number
          avg_efficiency_score: number
          avg_score_percent: number
          avg_time_per_question_seconds: number
          class_id: string
          computed_at: string
          created_at: string
          exam_id: string
          id: string
          score_distribution: Json | null
          students_attempted: number
          students_passed: number
          subject_averages: Json | null
          subject_id: string | null
          subject_name: string | null
          topper_accuracy_percent: number | null
          topper_name: string | null
          topper_student_id: string | null
          topper_time_per_question_seconds: number | null
          total_students: number
          updated_at: string
        }
        Insert: {
          avg_accuracy_percent?: number
          avg_efficiency_score?: number
          avg_score_percent?: number
          avg_time_per_question_seconds?: number
          class_id: string
          computed_at?: string
          created_at?: string
          exam_id: string
          id?: string
          score_distribution?: Json | null
          students_attempted?: number
          students_passed?: number
          subject_averages?: Json | null
          subject_id?: string | null
          subject_name?: string | null
          topper_accuracy_percent?: number | null
          topper_name?: string | null
          topper_student_id?: string | null
          topper_time_per_question_seconds?: number | null
          total_students?: number
          updated_at?: string
        }
        Update: {
          avg_accuracy_percent?: number
          avg_efficiency_score?: number
          avg_score_percent?: number
          avg_time_per_question_seconds?: number
          class_id?: string
          computed_at?: string
          created_at?: string
          exam_id?: string
          id?: string
          score_distribution?: Json | null
          students_attempted?: number
          students_passed?: number
          subject_averages?: Json | null
          subject_id?: string | null
          subject_name?: string | null
          topper_accuracy_percent?: number | null
          topper_name?: string | null
          topper_student_id?: string | null
          topper_time_per_question_seconds?: number | null
          total_students?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "class_aggregates_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_aggregates_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_aggregates_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "student_eligible_exams"
            referencedColumns: ["exam_id"]
          },
          {
            foreignKeyName: "class_aggregates_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_aggregates_topper_student_id_fkey"
            columns: ["topper_student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      class_assignment_deletions: {
        Row: {
          assigned_at: string | null
          assigned_by: string | null
          assignment_id: string
          class_id: string
          deleted_at: string
          deleted_by: string | null
          id: string
          institution_id: string | null
          role: Database["public"]["Enums"]["app_role"]
          subject_id: string | null
          teaching_type: string | null
          user_id: string
        }
        Insert: {
          assigned_at?: string | null
          assigned_by?: string | null
          assignment_id: string
          class_id: string
          deleted_at?: string
          deleted_by?: string | null
          id?: string
          institution_id?: string | null
          role: Database["public"]["Enums"]["app_role"]
          subject_id?: string | null
          teaching_type?: string | null
          user_id: string
        }
        Update: {
          assigned_at?: string | null
          assigned_by?: string | null
          assignment_id?: string
          class_id?: string
          deleted_at?: string
          deleted_by?: string | null
          id?: string
          institution_id?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          subject_id?: string | null
          teaching_type?: string | null
          user_id?: string
        }
        Relationships: []
      }
      class_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          class_id: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          subject_id: string | null
          teaching_type: string | null
          user_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          class_id: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          subject_id?: string | null
          teaching_type?: string | null
          user_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          class_id?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          subject_id?: string | null
          teaching_type?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "class_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_assignments_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_assignments_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "universal_subjects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_assignments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      class_groups: {
        Row: {
          academic_year: string
          created_at: string
          grade_level_id: string | null
          id: string
          institution_id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          academic_year: string
          created_at?: string
          grade_level_id?: string | null
          id?: string
          institution_id: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          academic_year?: string
          created_at?: string
          grade_level_id?: string | null
          id?: string
          institution_id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "class_groups_grade_level_id_fkey"
            columns: ["grade_level_id"]
            isOneToOne: false
            referencedRelation: "grade_levels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_groups_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
        ]
      }
      classes: {
        Row: {
          academic_year: string
          class_group_id: string
          created_at: string
          id: string
          institution_id: string
          is_active: boolean | null
          name: string
          section: string | null
          updated_at: string
        }
        Insert: {
          academic_year: string
          class_group_id: string
          created_at?: string
          id?: string
          institution_id: string
          is_active?: boolean | null
          name: string
          section?: string | null
          updated_at?: string
        }
        Update: {
          academic_year?: string
          class_group_id?: string
          created_at?: string
          id?: string
          institution_id?: string
          is_active?: boolean | null
          name?: string
          section?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "classes_class_group_id_fkey"
            columns: ["class_group_id"]
            isOneToOne: false
            referencedRelation: "class_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classes_class_group_id_fkey"
            columns: ["class_group_id"]
            isOneToOne: false
            referencedRelation: "v_class_groups_with_sections"
            referencedColumns: ["class_group_id"]
          },
          {
            foreignKeyName: "classes_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
        ]
      }
      communication_templates: {
        Row: {
          body: string
          channel: string
          created_at: string
          created_by: string | null
          id: string
          institution_id: string
          is_active: boolean
          name: string
          subject: string | null
          updated_at: string
          variables: Json | null
        }
        Insert: {
          body: string
          channel?: string
          created_at?: string
          created_by?: string | null
          id?: string
          institution_id: string
          is_active?: boolean
          name: string
          subject?: string | null
          updated_at?: string
          variables?: Json | null
        }
        Update: {
          body?: string
          channel?: string
          created_at?: string
          created_by?: string | null
          id?: string
          institution_id?: string
          is_active?: boolean
          name?: string
          subject?: string | null
          updated_at?: string
          variables?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "communication_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_templates_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
        ]
      }
      concept_mastery: {
        Row: {
          avg_time_per_question_seconds: number | null
          created_at: string | null
          id: string
          institution_id: string
          last_exam_id: string | null
          last_updated: string | null
          mastery_level: number | null
          student_id: string
          subject_id: string
          topic_id: string
          total_questions_attempted: number | null
          total_questions_correct: number | null
          trend: string | null
        }
        Insert: {
          avg_time_per_question_seconds?: number | null
          created_at?: string | null
          id?: string
          institution_id: string
          last_exam_id?: string | null
          last_updated?: string | null
          mastery_level?: number | null
          student_id: string
          subject_id: string
          topic_id: string
          total_questions_attempted?: number | null
          total_questions_correct?: number | null
          trend?: string | null
        }
        Update: {
          avg_time_per_question_seconds?: number | null
          created_at?: string | null
          id?: string
          institution_id?: string
          last_exam_id?: string | null
          last_updated?: string | null
          mastery_level?: number | null
          student_id?: string
          subject_id?: string
          topic_id?: string
          total_questions_attempted?: number | null
          total_questions_correct?: number | null
          trend?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "concept_mastery_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "concept_mastery_last_exam_id_fkey"
            columns: ["last_exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "concept_mastery_last_exam_id_fkey"
            columns: ["last_exam_id"]
            isOneToOne: false
            referencedRelation: "student_eligible_exams"
            referencedColumns: ["exam_id"]
          },
          {
            foreignKeyName: "concept_mastery_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "concept_mastery_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "concept_mastery_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "syllabus_topics"
            referencedColumns: ["id"]
          },
        ]
      }
      concept_mastery_history: {
        Row: {
          exam_id: string
          id: string
          mastery_id: string
          mastery_level: number
          questions_attempted: number | null
          questions_correct: number | null
          snapshot_at: string | null
        }
        Insert: {
          exam_id: string
          id?: string
          mastery_id: string
          mastery_level: number
          questions_attempted?: number | null
          questions_correct?: number | null
          snapshot_at?: string | null
        }
        Update: {
          exam_id?: string
          id?: string
          mastery_id?: string
          mastery_level?: number
          questions_attempted?: number | null
          questions_correct?: number | null
          snapshot_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "concept_mastery_history_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "concept_mastery_history_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "student_eligible_exams"
            referencedColumns: ["exam_id"]
          },
          {
            foreignKeyName: "concept_mastery_history_mastery_id_fkey"
            columns: ["mastery_id"]
            isOneToOne: false
            referencedRelation: "concept_mastery"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_submissions: {
        Row: {
          created_at: string
          email: string
          id: string
          message: string
          name: string
          responded_at: string | null
          response_notes: string | null
          status: string | null
          subject: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          message: string
          name: string
          responded_at?: string | null
          response_notes?: string | null
          status?: string | null
          subject: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          message?: string
          name?: string
          responded_at?: string | null
          response_notes?: string | null
          status?: string | null
          subject?: string
        }
        Relationships: []
      }
      conversation_messages: {
        Row: {
          attachment_name: string | null
          attachment_url: string | null
          batch_id: string | null
          content: string
          conversation_id: string
          created_at: string
          id: string
          is_edited: boolean
          message_type: string
          sender_id: string | null
          updated_at: string
        }
        Insert: {
          attachment_name?: string | null
          attachment_url?: string | null
          batch_id?: string | null
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          is_edited?: boolean
          message_type?: string
          sender_id?: string | null
          updated_at?: string
        }
        Update: {
          attachment_name?: string | null
          attachment_url?: string | null
          batch_id?: string | null
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          is_edited?: boolean
          message_type?: string
          sender_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_participants: {
        Row: {
          conversation_id: string
          id: string
          is_muted: boolean
          joined_at: string
          last_read_at: string | null
          role: string
          user_id: string
        }
        Insert: {
          conversation_id: string
          id?: string
          is_muted?: boolean
          joined_at?: string
          last_read_at?: string | null
          role?: string
          user_id: string
        }
        Update: {
          conversation_id?: string
          id?: string
          is_muted?: boolean
          joined_at?: string
          last_read_at?: string | null
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_participants_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          class_id: string | null
          created_at: string
          created_by: string | null
          id: string
          institution_id: string
          title: string | null
          type: string
          updated_at: string
        }
        Insert: {
          class_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          institution_id: string
          title?: string | null
          type?: string
          updated_at?: string
        }
        Update: {
          class_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          institution_id?: string
          title?: string | null
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
        ]
      }
      dashboard_flags: {
        Row: {
          assignee_id: string | null
          auto_created: boolean
          category: string
          context: Json
          created_at: string
          description: string
          first_detected_at: string
          flag_code: string
          id: string
          institution_id: string
          last_evaluated_at: string
          link_url: string | null
          metric_value: number | null
          resolved_at: string | null
          severity: string
          status: string
          subject_key: string
          subject_type: string
          task_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          assignee_id?: string | null
          auto_created?: boolean
          category: string
          context?: Json
          created_at?: string
          description: string
          first_detected_at?: string
          flag_code: string
          id?: string
          institution_id: string
          last_evaluated_at?: string
          link_url?: string | null
          metric_value?: number | null
          resolved_at?: string | null
          severity: string
          status?: string
          subject_key: string
          subject_type: string
          task_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          assignee_id?: string | null
          auto_created?: boolean
          category?: string
          context?: Json
          created_at?: string
          description?: string
          first_detected_at?: string
          flag_code?: string
          id?: string
          institution_id?: string
          last_evaluated_at?: string
          link_url?: string | null
          metric_value?: number | null
          resolved_at?: string | null
          severity?: string
          status?: string
          subject_key?: string
          subject_type?: string
          task_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dashboard_flags_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dashboard_flags_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dashboard_flags_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      demo_requests: {
        Row: {
          contact_person: string
          created_at: string
          email: string
          id: string
          notes: string | null
          phone: string
          preferred_date: string | null
          processed_at: string | null
          role: string
          school_name: string
          status: string | null
          student_count: string | null
        }
        Insert: {
          contact_person: string
          created_at?: string
          email: string
          id?: string
          notes?: string | null
          phone: string
          preferred_date?: string | null
          processed_at?: string | null
          role: string
          school_name: string
          status?: string | null
          student_count?: string | null
        }
        Update: {
          contact_person?: string
          created_at?: string
          email?: string
          id?: string
          notes?: string | null
          phone?: string
          preferred_date?: string | null
          processed_at?: string | null
          role?: string
          school_name?: string
          status?: string | null
          student_count?: string | null
        }
        Relationships: []
      }
      diary_entries: {
        Row: {
          body: string
          class_id: string
          created_at: string
          created_by: string | null
          due_date: string | null
          entry_date: string
          id: string
          institution_id: string
          kind: string
          student_id: string | null
          title: string
        }
        Insert: {
          body: string
          class_id: string
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          entry_date: string
          id: string
          institution_id: string
          kind: string
          student_id?: string | null
          title: string
        }
        Update: {
          body?: string
          class_id?: string
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          entry_date?: string
          id?: string
          institution_id?: string
          kind?: string
          student_id?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "diary_entries_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "diary_entries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "diary_entries_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "diary_entries_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_levels: {
        Row: {
          can_manage_billing: boolean | null
          can_manage_institutions: boolean | null
          created_at: string
          description: string | null
          id: string
          level_name: string
          level_number: number
          permissions: Json | null
          super_admin_access: boolean | null
          updated_at: string
        }
        Insert: {
          can_manage_billing?: boolean | null
          can_manage_institutions?: boolean | null
          created_at?: string
          description?: string | null
          id?: string
          level_name: string
          level_number: number
          permissions?: Json | null
          super_admin_access?: boolean | null
          updated_at?: string
        }
        Update: {
          can_manage_billing?: boolean | null
          can_manage_institutions?: boolean | null
          created_at?: string
          description?: string | null
          id?: string
          level_name?: string
          level_number?: number
          permissions?: Json | null
          super_admin_access?: boolean | null
          updated_at?: string
        }
        Relationships: []
      }
      evaluation_blueprints: {
        Row: {
          ai_confidence_threshold: number | null
          ai_evaluation_enabled: boolean
          created_at: string
          created_by: string | null
          exam_id: string
          id: string
          keywords: string[] | null
          marking_scheme: string | null
          max_marks: number
          negative_marking: number | null
          partial_marking_allowed: boolean
          question_id: string | null
          section_id: string | null
          updated_at: string
        }
        Insert: {
          ai_confidence_threshold?: number | null
          ai_evaluation_enabled?: boolean
          created_at?: string
          created_by?: string | null
          exam_id: string
          id?: string
          keywords?: string[] | null
          marking_scheme?: string | null
          max_marks: number
          negative_marking?: number | null
          partial_marking_allowed?: boolean
          question_id?: string | null
          section_id?: string | null
          updated_at?: string
        }
        Update: {
          ai_confidence_threshold?: number | null
          ai_evaluation_enabled?: boolean
          created_at?: string
          created_by?: string | null
          exam_id?: string
          id?: string
          keywords?: string[] | null
          marking_scheme?: string | null
          max_marks?: number
          negative_marking?: number | null
          partial_marking_allowed?: boolean
          question_id?: string | null
          section_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "evaluation_blueprints_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evaluation_blueprints_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evaluation_blueprints_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "student_eligible_exams"
            referencedColumns: ["exam_id"]
          },
          {
            foreignKeyName: "evaluation_blueprints_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "exam_questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evaluation_blueprints_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "exam_sections"
            referencedColumns: ["id"]
          },
        ]
      }
      exam_attempt_logs: {
        Row: {
          action: Database["public"]["Enums"]["attempt_action"]
          action_data: Json | null
          attempt_id: string
          created_at: string
          id: string
          ip_address: string | null
          question_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: Database["public"]["Enums"]["attempt_action"]
          action_data?: Json | null
          attempt_id: string
          created_at?: string
          id?: string
          ip_address?: string | null
          question_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: Database["public"]["Enums"]["attempt_action"]
          action_data?: Json | null
          attempt_id?: string
          created_at?: string
          id?: string
          ip_address?: string | null
          question_id?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exam_attempt_logs_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "student_eligible_exams"
            referencedColumns: ["attempt_id"]
          },
          {
            foreignKeyName: "exam_attempt_logs_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "student_exam_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_attempt_logs_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "exam_questions"
            referencedColumns: ["id"]
          },
        ]
      }
      exam_classes: {
        Row: {
          class_id: string
          created_at: string
          exam_id: string
          id: string
        }
        Insert: {
          class_id: string
          created_at?: string
          exam_id: string
          id?: string
        }
        Update: {
          class_id?: string
          created_at?: string
          exam_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "exam_classes_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_classes_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_classes_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "student_eligible_exams"
            referencedColumns: ["exam_id"]
          },
        ]
      }
      exam_insights: {
        Row: {
          action_plan: Json
          attempt_id: string | null
          created_at: string | null
          exam_id: string | null
          focus_areas: Json
          generated_at: string | null
          id: string
          motivational_message: string | null
          overall_performance: string | null
          performance_level: string | null
          strengths: Json
          student_id: string | null
          study_tips: Json
          subject_breakdown: Json
        }
        Insert: {
          action_plan?: Json
          attempt_id?: string | null
          created_at?: string | null
          exam_id?: string | null
          focus_areas?: Json
          generated_at?: string | null
          id?: string
          motivational_message?: string | null
          overall_performance?: string | null
          performance_level?: string | null
          strengths?: Json
          student_id?: string | null
          study_tips?: Json
          subject_breakdown?: Json
        }
        Update: {
          action_plan?: Json
          attempt_id?: string | null
          created_at?: string | null
          exam_id?: string | null
          focus_areas?: Json
          generated_at?: string | null
          id?: string
          motivational_message?: string | null
          overall_performance?: string | null
          performance_level?: string | null
          strengths?: Json
          student_id?: string | null
          study_tips?: Json
          subject_breakdown?: Json
        }
        Relationships: [
          {
            foreignKeyName: "exam_insights_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: true
            referencedRelation: "student_eligible_exams"
            referencedColumns: ["attempt_id"]
          },
          {
            foreignKeyName: "exam_insights_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: true
            referencedRelation: "student_exam_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_insights_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_insights_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "student_eligible_exams"
            referencedColumns: ["exam_id"]
          },
          {
            foreignKeyName: "exam_insights_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      exam_publication_logs: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          exam_id: string
          id: string
          metadata: Json | null
          new_status: Database["public"]["Enums"]["exam_status"]
          previous_status: Database["public"]["Enums"]["exam_status"] | null
          reason: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          exam_id: string
          id?: string
          metadata?: Json | null
          new_status: Database["public"]["Enums"]["exam_status"]
          previous_status?: Database["public"]["Enums"]["exam_status"] | null
          reason?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          exam_id?: string
          id?: string
          metadata?: Json | null
          new_status?: Database["public"]["Enums"]["exam_status"]
          previous_status?: Database["public"]["Enums"]["exam_status"] | null
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exam_publication_logs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_publication_logs_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_publication_logs_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "student_eligible_exams"
            referencedColumns: ["exam_id"]
          },
        ]
      }
      exam_questions: {
        Row: {
          correct_answer: string | null
          created_at: string
          difficulty_level: number | null
          explanation: string | null
          id: string
          image_url: string | null
          marks: number
          negative_marks: number | null
          options: Json | null
          parent_question_id: string | null
          question_order: number
          question_text: string
          question_type: Database["public"]["Enums"]["question_type"]
          section_id: string
          tags: string[] | null
          updated_at: string
        }
        Insert: {
          correct_answer?: string | null
          created_at?: string
          difficulty_level?: number | null
          explanation?: string | null
          id?: string
          image_url?: string | null
          marks?: number
          negative_marks?: number | null
          options?: Json | null
          parent_question_id?: string | null
          question_order?: number
          question_text: string
          question_type?: Database["public"]["Enums"]["question_type"]
          section_id: string
          tags?: string[] | null
          updated_at?: string
        }
        Update: {
          correct_answer?: string | null
          created_at?: string
          difficulty_level?: number | null
          explanation?: string | null
          id?: string
          image_url?: string | null
          marks?: number
          negative_marks?: number | null
          options?: Json | null
          parent_question_id?: string | null
          question_order?: number
          question_text?: string
          question_type?: Database["public"]["Enums"]["question_type"]
          section_id?: string
          tags?: string[] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "exam_questions_parent_question_id_fkey"
            columns: ["parent_question_id"]
            isOneToOne: false
            referencedRelation: "exam_questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_questions_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "exam_sections"
            referencedColumns: ["id"]
          },
        ]
      }
      exam_sections: {
        Row: {
          created_at: string
          default_marks: number | null
          description: string | null
          exam_id: string
          id: string
          instructions: string | null
          negative_marking: number | null
          negative_marking_enabled: boolean
          partial_marks_allowed: boolean
          randomize_order: boolean
          section_order: number
          section_type: Database["public"]["Enums"]["section_type"] | null
          title: string
          total_marks: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_marks?: number | null
          description?: string | null
          exam_id: string
          id?: string
          instructions?: string | null
          negative_marking?: number | null
          negative_marking_enabled?: boolean
          partial_marks_allowed?: boolean
          randomize_order?: boolean
          section_order?: number
          section_type?: Database["public"]["Enums"]["section_type"] | null
          title: string
          total_marks?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_marks?: number | null
          description?: string | null
          exam_id?: string
          id?: string
          instructions?: string | null
          negative_marking?: number | null
          negative_marking_enabled?: boolean
          partial_marks_allowed?: boolean
          randomize_order?: boolean
          section_order?: number
          section_type?: Database["public"]["Enums"]["section_type"] | null
          title?: string
          total_marks?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "exam_sections_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_sections_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "student_eligible_exams"
            referencedColumns: ["exam_id"]
          },
        ]
      }
      exam_subjects: {
        Row: {
          created_at: string
          exam_id: string
          id: string
          subject_id: string
          weightage: number | null
        }
        Insert: {
          created_at?: string
          exam_id: string
          id?: string
          subject_id: string
          weightage?: number | null
        }
        Update: {
          created_at?: string
          exam_id?: string
          id?: string
          subject_id?: string
          weightage?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "exam_subjects_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_subjects_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "student_eligible_exams"
            referencedColumns: ["exam_id"]
          },
          {
            foreignKeyName: "exam_subjects_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "universal_subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      exam_templates: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          institution_id: string
          is_shared: boolean
          name: string
          subject_id: string | null
          template_data: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          institution_id: string
          is_shared?: boolean
          name: string
          subject_id?: string | null
          template_data: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          institution_id?: string
          is_shared?: boolean
          name?: string
          subject_id?: string | null
          template_data?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "exam_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_templates_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_templates_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "universal_subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      exam_topics: {
        Row: {
          created_at: string | null
          custom_topic_id: string | null
          exam_id: string
          id: string
          topic_id: string | null
        }
        Insert: {
          created_at?: string | null
          custom_topic_id?: string | null
          exam_id: string
          id?: string
          topic_id?: string | null
        }
        Update: {
          created_at?: string | null
          custom_topic_id?: string | null
          exam_id?: string
          id?: string
          topic_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exam_topics_custom_topic_id_fkey"
            columns: ["custom_topic_id"]
            isOneToOne: false
            referencedRelation: "school_custom_topics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_topics_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_topics_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "student_eligible_exams"
            referencedColumns: ["exam_id"]
          },
          {
            foreignKeyName: "exam_topics_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "syllabus_topics"
            referencedColumns: ["id"]
          },
        ]
      }
      exams: {
        Row: {
          availability_end: string | null
          availability_start: string | null
          created_at: string
          created_by: string | null
          current_version: number
          description: string | null
          duration_minutes: number | null
          end_time: string | null
          exam_mode: Database["public"]["Enums"]["exam_mode"]
          exam_type: string
          id: string
          institution_id: string
          instructions: string | null
          is_blueprint_ready: boolean
          is_locked_for_edits: boolean
          is_offline: boolean | null
          is_results_only: boolean
          late_entry_minutes: number | null
          locked_at: string | null
          ocr_confidence_threshold: number | null
          pass_marks: number | null
          proctoring_config: Json
          published_at: string | null
          published_by: string | null
          result_visibility: string
          scheduled_date: string | null
          source_paper_files: Json | null
          start_time: string | null
          status: Database["public"]["Enums"]["exam_status"]
          template_id: string | null
          title: string
          total_marks: number | null
          updated_at: string
          visible_to_students: boolean
        }
        Insert: {
          availability_end?: string | null
          availability_start?: string | null
          created_at?: string
          created_by?: string | null
          current_version?: number
          description?: string | null
          duration_minutes?: number | null
          end_time?: string | null
          exam_mode?: Database["public"]["Enums"]["exam_mode"]
          exam_type?: string
          id?: string
          institution_id: string
          instructions?: string | null
          is_blueprint_ready?: boolean
          is_locked_for_edits?: boolean
          is_offline?: boolean | null
          is_results_only?: boolean
          late_entry_minutes?: number | null
          locked_at?: string | null
          ocr_confidence_threshold?: number | null
          pass_marks?: number | null
          proctoring_config?: Json
          published_at?: string | null
          published_by?: string | null
          result_visibility?: string
          scheduled_date?: string | null
          source_paper_files?: Json | null
          start_time?: string | null
          status?: Database["public"]["Enums"]["exam_status"]
          template_id?: string | null
          title: string
          total_marks?: number | null
          updated_at?: string
          visible_to_students?: boolean
        }
        Update: {
          availability_end?: string | null
          availability_start?: string | null
          created_at?: string
          created_by?: string | null
          current_version?: number
          description?: string | null
          duration_minutes?: number | null
          end_time?: string | null
          exam_mode?: Database["public"]["Enums"]["exam_mode"]
          exam_type?: string
          id?: string
          institution_id?: string
          instructions?: string | null
          is_blueprint_ready?: boolean
          is_locked_for_edits?: boolean
          is_offline?: boolean | null
          is_results_only?: boolean
          late_entry_minutes?: number | null
          locked_at?: string | null
          ocr_confidence_threshold?: number | null
          pass_marks?: number | null
          proctoring_config?: Json
          published_at?: string | null
          published_by?: string | null
          result_visibility?: string
          scheduled_date?: string | null
          source_paper_files?: Json | null
          start_time?: string | null
          status?: Database["public"]["Enums"]["exam_status"]
          template_id?: string | null
          title?: string
          total_marks?: number | null
          updated_at?: string
          visible_to_students?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "exams_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exams_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exams_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exams_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "exam_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      face_enrollments: {
        Row: {
          created_at: string
          enrolled_by: string | null
          face_descriptor: Json
          id: string
          institution_id: string
          is_active: boolean
          photo_url: string | null
          student_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          enrolled_by?: string | null
          face_descriptor: Json
          id?: string
          institution_id: string
          is_active?: boolean
          photo_url?: string | null
          student_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          enrolled_by?: string | null
          face_descriptor?: Json
          id?: string
          institution_id?: string
          is_active?: boolean
          photo_url?: string | null
          student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "face_enrollments_enrolled_by_fkey"
            columns: ["enrolled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "face_enrollments_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "face_enrollments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      fee_categories: {
        Row: {
          created_at: string
          description: string | null
          id: string
          institution_id: string
          is_active: boolean
          is_recurring: boolean
          name: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          institution_id: string
          is_active?: boolean
          is_recurring?: boolean
          name: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          institution_id?: string
          is_active?: boolean
          is_recurring?: boolean
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "fee_categories_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
        ]
      }
      fee_concessions: {
        Row: {
          approved_by: string | null
          concession_type: string
          created_at: string
          fixed_amount: number | null
          id: string
          institution_id: string
          is_active: boolean
          percentage: number | null
          reason: string | null
          student_id: string
          valid_from: string
          valid_to: string | null
        }
        Insert: {
          approved_by?: string | null
          concession_type: string
          created_at?: string
          fixed_amount?: number | null
          id?: string
          institution_id: string
          is_active?: boolean
          percentage?: number | null
          reason?: string | null
          student_id: string
          valid_from?: string
          valid_to?: string | null
        }
        Update: {
          approved_by?: string | null
          concession_type?: string
          created_at?: string
          fixed_amount?: number | null
          id?: string
          institution_id?: string
          is_active?: boolean
          percentage?: number | null
          reason?: string | null
          student_id?: string
          valid_from?: string
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fee_concessions_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_concessions_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_concessions_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      fee_installments: {
        Row: {
          amount: number
          assignment_id: string
          created_at: string
          due_date: string
          id: string
          installment_number: number
          institution_id: string
          late_fee_applied: number
          notes: string | null
          paid_amount: number
          paid_date: string | null
          payment_method: string | null
          status: string
          student_id: string
          transaction_reference: string | null
          updated_at: string
        }
        Insert: {
          amount?: number
          assignment_id: string
          created_at?: string
          due_date: string
          id?: string
          installment_number: number
          institution_id: string
          late_fee_applied?: number
          notes?: string | null
          paid_amount?: number
          paid_date?: string | null
          payment_method?: string | null
          status?: string
          student_id: string
          transaction_reference?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          assignment_id?: string
          created_at?: string
          due_date?: string
          id?: string
          installment_number?: number
          institution_id?: string
          late_fee_applied?: number
          notes?: string | null
          paid_amount?: number
          paid_date?: string | null
          payment_method?: string | null
          status?: string
          student_id?: string
          transaction_reference?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fee_installments_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "student_fee_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_installments_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_installments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      fee_receipts: {
        Row: {
          amount: number
          created_at: string
          id: string
          installment_id: string | null
          institution_id: string
          payment_date: string
          payment_method: string | null
          receipt_data: Json | null
          receipt_number: string
          received_by: string | null
          student_id: string
        }
        Insert: {
          amount?: number
          created_at?: string
          id?: string
          installment_id?: string | null
          institution_id: string
          payment_date?: string
          payment_method?: string | null
          receipt_data?: Json | null
          receipt_number: string
          received_by?: string | null
          student_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          installment_id?: string | null
          institution_id?: string
          payment_date?: string
          payment_method?: string | null
          receipt_data?: Json | null
          receipt_number?: string
          received_by?: string | null
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fee_receipts_installment_id_fkey"
            columns: ["installment_id"]
            isOneToOne: false
            referencedRelation: "fee_installments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_receipts_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_receipts_received_by_fkey"
            columns: ["received_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_receipts_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      fee_structures: {
        Row: {
          academic_year: string
          amount: number
          class_id: string | null
          created_at: string
          due_day: number | null
          fee_category_id: string
          frequency: string
          grace_period_days: number
          id: string
          institution_id: string
          is_active: boolean
          late_fee_amount: number
          late_fee_type: string
          updated_at: string
        }
        Insert: {
          academic_year: string
          amount?: number
          class_id?: string | null
          created_at?: string
          due_day?: number | null
          fee_category_id: string
          frequency?: string
          grace_period_days?: number
          id?: string
          institution_id: string
          is_active?: boolean
          late_fee_amount?: number
          late_fee_type?: string
          updated_at?: string
        }
        Update: {
          academic_year?: string
          amount?: number
          class_id?: string | null
          created_at?: string
          due_day?: number | null
          fee_category_id?: string
          frequency?: string
          grace_period_days?: number
          id?: string
          institution_id?: string
          is_active?: boolean
          late_fee_amount?: number
          late_fee_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fee_structures_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_structures_fee_category_id_fkey"
            columns: ["fee_category_id"]
            isOneToOne: false
            referencedRelation: "fee_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_structures_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
        ]
      }
      final_results: {
        Row: {
          attempt_id: string
          created_at: string
          finalization_notes: string | null
          finalized_at: string
          finalized_by: string | null
          grade: string | null
          id: string
          is_absent: boolean
          is_pass: boolean | null
          is_published: boolean
          percentage: number | null
          published_at: string | null
          published_by: string | null
          rank_in_class: number | null
          section_scores: Json | null
          total_marks_obtained: number
          total_max_marks: number
        }
        Insert: {
          attempt_id: string
          created_at?: string
          finalization_notes?: string | null
          finalized_at?: string
          finalized_by?: string | null
          grade?: string | null
          id?: string
          is_absent?: boolean
          is_pass?: boolean | null
          is_published?: boolean
          percentage?: number | null
          published_at?: string | null
          published_by?: string | null
          rank_in_class?: number | null
          section_scores?: Json | null
          total_marks_obtained: number
          total_max_marks: number
        }
        Update: {
          attempt_id?: string
          created_at?: string
          finalization_notes?: string | null
          finalized_at?: string
          finalized_by?: string | null
          grade?: string | null
          id?: string
          is_absent?: boolean
          is_pass?: boolean | null
          is_published?: boolean
          percentage?: number | null
          published_at?: string | null
          published_by?: string | null
          rank_in_class?: number | null
          section_scores?: Json | null
          total_marks_obtained?: number
          total_max_marks?: number
        }
        Relationships: [
          {
            foreignKeyName: "final_results_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: true
            referencedRelation: "student_eligible_exams"
            referencedColumns: ["attempt_id"]
          },
          {
            foreignKeyName: "final_results_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: true
            referencedRelation: "student_exam_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "final_results_finalized_by_fkey"
            columns: ["finalized_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "final_results_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      global_ai_config: {
        Row: {
          config_key: string
          config_value: string | null
          created_at: string
          description: string | null
          id: string
          is_enabled: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          config_key: string
          config_value?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_enabled?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          config_key?: string
          config_value?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_enabled?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      grade_levels: {
        Row: {
          created_at: string
          display_order: number | null
          grade_name: string
          grade_number: number
          id: string
          is_active: boolean
        }
        Insert: {
          created_at?: string
          display_order?: number | null
          grade_name: string
          grade_number: number
          id?: string
          is_active?: boolean
        }
        Update: {
          created_at?: string
          display_order?: number | null
          grade_name?: string
          grade_number?: number
          id?: string
          is_active?: boolean
        }
        Relationships: []
      }
      grade_subject_assignments: {
        Row: {
          created_at: string | null
          grade_level_id: string
          id: string
          is_active: boolean | null
          subject_id: string
        }
        Insert: {
          created_at?: string | null
          grade_level_id: string
          id?: string
          is_active?: boolean | null
          subject_id: string
        }
        Update: {
          created_at?: string | null
          grade_level_id?: string
          id?: string
          is_active?: boolean | null
          subject_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "grade_subject_assignments_grade_level_id_fkey"
            columns: ["grade_level_id"]
            isOneToOne: false
            referencedRelation: "grade_levels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grade_subject_assignments_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "universal_subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      holiday_calendar: {
        Row: {
          created_at: string
          holiday_date: string
          id: string
          institution_id: string
          is_active: boolean
          name: string
          type: string
        }
        Insert: {
          created_at?: string
          holiday_date: string
          id?: string
          institution_id: string
          is_active?: boolean
          name: string
          type?: string
        }
        Update: {
          created_at?: string
          holiday_date?: string
          id?: string
          institution_id?: string
          is_active?: boolean
          name?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "holiday_calendar_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
        ]
      }
      homework_assignment_classes: {
        Row: {
          class_id: string
          created_at: string
          homework_assignment_id: string
          id: string
        }
        Insert: {
          class_id: string
          created_at?: string
          homework_assignment_id: string
          id?: string
        }
        Update: {
          class_id?: string
          created_at?: string
          homework_assignment_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "homework_assignment_classes_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_assignment_classes_homework_assignment_id_fkey"
            columns: ["homework_assignment_id"]
            isOneToOne: false
            referencedRelation: "homework_assignments"
            referencedColumns: ["id"]
          },
        ]
      }
      homework_assignment_subjects: {
        Row: {
          created_at: string
          homework_assignment_id: string
          id: string
          subject_id: string
        }
        Insert: {
          created_at?: string
          homework_assignment_id: string
          id?: string
          subject_id: string
        }
        Update: {
          created_at?: string
          homework_assignment_id?: string
          id?: string
          subject_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "homework_assignment_subjects_homework_assignment_id_fkey"
            columns: ["homework_assignment_id"]
            isOneToOne: false
            referencedRelation: "homework_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_assignment_subjects_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "universal_subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      homework_assignments: {
        Row: {
          academic_year: string
          attachment_mime: string | null
          attachment_name: string | null
          attachment_path: string | null
          carries_marks: boolean
          checked_at: string | null
          created_at: string
          created_by: string | null
          description: string | null
          due_at: string
          evaluated_by: string | null
          id: string
          institution_id: string
          max_marks: number | null
          offline_marks: boolean
          published_at: string | null
          status: string
          subject_id: string
          title: string
          updated_at: string
          visible_from: string
        }
        Insert: {
          academic_year: string
          attachment_mime?: string | null
          attachment_name?: string | null
          attachment_path?: string | null
          carries_marks?: boolean
          checked_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_at: string
          evaluated_by?: string | null
          id?: string
          institution_id: string
          max_marks?: number | null
          offline_marks?: boolean
          published_at?: string | null
          status?: string
          subject_id: string
          title: string
          updated_at?: string
          visible_from?: string
        }
        Update: {
          academic_year?: string
          attachment_mime?: string | null
          attachment_name?: string | null
          attachment_path?: string | null
          carries_marks?: boolean
          checked_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_at?: string
          evaluated_by?: string | null
          id?: string
          institution_id?: string
          max_marks?: number | null
          offline_marks?: boolean
          published_at?: string | null
          status?: string
          subject_id?: string
          title?: string
          updated_at?: string
          visible_from?: string
        }
        Relationships: [
          {
            foreignKeyName: "homework_assignments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_assignments_evaluated_by_fkey"
            columns: ["evaluated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_assignments_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_assignments_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "universal_subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      homework_mark_audit: {
        Row: {
          action: string
          changed_by: string | null
          created_at: string
          homework_assignment_id: string
          homework_result_id: string
          id: string
          new_feedback: string | null
          new_marks: number | null
          new_status: string | null
          old_feedback: string | null
          old_marks: number | null
          old_status: string | null
          student_id: string
        }
        Insert: {
          action: string
          changed_by?: string | null
          created_at?: string
          homework_assignment_id: string
          homework_result_id: string
          id?: string
          new_feedback?: string | null
          new_marks?: number | null
          new_status?: string | null
          old_feedback?: string | null
          old_marks?: number | null
          old_status?: string | null
          student_id: string
        }
        Update: {
          action?: string
          changed_by?: string | null
          created_at?: string
          homework_assignment_id?: string
          homework_result_id?: string
          id?: string
          new_feedback?: string | null
          new_marks?: number | null
          new_status?: string | null
          old_feedback?: string | null
          old_marks?: number | null
          old_status?: string | null
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "homework_mark_audit_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_mark_audit_homework_assignment_id_fkey"
            columns: ["homework_assignment_id"]
            isOneToOne: false
            referencedRelation: "homework_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_mark_audit_homework_result_id_fkey"
            columns: ["homework_result_id"]
            isOneToOne: false
            referencedRelation: "homework_results"
            referencedColumns: ["id"]
          },
        ]
      }
      homework_notifications_sent: {
        Row: {
          homework_assignment_id: string
          id: string
          notification_type: string
          recipient_id: string
          sent_at: string
        }
        Insert: {
          homework_assignment_id: string
          id?: string
          notification_type: string
          recipient_id: string
          sent_at?: string
        }
        Update: {
          homework_assignment_id?: string
          id?: string
          notification_type?: string
          recipient_id?: string
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "homework_notifications_sent_homework_assignment_id_fkey"
            columns: ["homework_assignment_id"]
            isOneToOne: false
            referencedRelation: "homework_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_notifications_sent_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      homework_results: {
        Row: {
          created_at: string
          evaluated_at: string | null
          evaluated_by: string | null
          feedback: string | null
          homework_assignment_id: string
          id: string
          marks_awarded: number | null
          status: string
          student_id: string
          submission_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          evaluated_at?: string | null
          evaluated_by?: string | null
          feedback?: string | null
          homework_assignment_id: string
          id?: string
          marks_awarded?: number | null
          status?: string
          student_id: string
          submission_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          evaluated_at?: string | null
          evaluated_by?: string | null
          feedback?: string | null
          homework_assignment_id?: string
          id?: string
          marks_awarded?: number | null
          status?: string
          student_id?: string
          submission_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "homework_results_evaluated_by_fkey"
            columns: ["evaluated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_results_homework_assignment_id_fkey"
            columns: ["homework_assignment_id"]
            isOneToOne: false
            referencedRelation: "homework_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_results_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_results_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: true
            referencedRelation: "homework_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      homework_submission_files: {
        Row: {
          created_at: string
          file_mime: string
          file_name: string
          file_size_bytes: number
          id: string
          storage_path: string
          submission_id: string
        }
        Insert: {
          created_at?: string
          file_mime: string
          file_name: string
          file_size_bytes: number
          id?: string
          storage_path: string
          submission_id: string
        }
        Update: {
          created_at?: string
          file_mime?: string
          file_name?: string
          file_size_bytes?: number
          id?: string
          storage_path?: string
          submission_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "homework_submission_files_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "homework_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      homework_submissions: {
        Row: {
          created_at: string
          homework_assignment_id: string
          id: string
          is_late: boolean
          student_id: string
          submitted_at: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          homework_assignment_id: string
          id?: string
          is_late?: boolean
          student_id: string
          submitted_at?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          homework_assignment_id?: string
          id?: string
          is_late?: boolean
          student_id?: string
          submitted_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "homework_submissions_homework_assignment_id_fkey"
            columns: ["homework_assignment_id"]
            isOneToOne: false
            referencedRelation: "homework_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_submissions_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      hybrid_answer_sheet_pages: {
        Row: {
          attempt_id: string
          device_fingerprint: string | null
          file_size_bytes: number | null
          id: string
          institution_id: string
          page_number: number
          rotation_degrees: number
          storage_path: string
          uploaded_at: string
        }
        Insert: {
          attempt_id: string
          device_fingerprint?: string | null
          file_size_bytes?: number | null
          id?: string
          institution_id: string
          page_number: number
          rotation_degrees?: number
          storage_path: string
          uploaded_at?: string
        }
        Update: {
          attempt_id?: string
          device_fingerprint?: string | null
          file_size_bytes?: number | null
          id?: string
          institution_id?: string
          page_number?: number
          rotation_degrees?: number
          storage_path?: string
          uploaded_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hybrid_answer_sheet_pages_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "hybrid_exam_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hybrid_answer_sheet_pages_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
        ]
      }
      hybrid_exam_attempt_logs: {
        Row: {
          actor_id: string | null
          attempt_id: string
          created_at: string
          event_payload: Json | null
          event_type: string
          id: string
          institution_id: string
        }
        Insert: {
          actor_id?: string | null
          attempt_id: string
          created_at?: string
          event_payload?: Json | null
          event_type: string
          id?: string
          institution_id: string
        }
        Update: {
          actor_id?: string | null
          attempt_id?: string
          created_at?: string
          event_payload?: Json | null
          event_type?: string
          id?: string
          institution_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "hybrid_exam_attempt_logs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hybrid_exam_attempt_logs_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "hybrid_exam_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hybrid_exam_attempt_logs_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
        ]
      }
      hybrid_exam_attempts: {
        Row: {
          class_id: string
          created_at: string
          device_info: Json | null
          evaluated_at: string | null
          evaluated_by: string | null
          exam_id: string
          id: string
          institution_id: string
          started_at: string
          status: string
          student_id: string
          submitted_at: string | null
          teacher_general_comment: string | null
          total_marks_awarded: number | null
          total_max_marks: number | null
          updated_at: string
          upload_completed_at: string | null
        }
        Insert: {
          class_id: string
          created_at?: string
          device_info?: Json | null
          evaluated_at?: string | null
          evaluated_by?: string | null
          exam_id: string
          id?: string
          institution_id: string
          started_at?: string
          status?: string
          student_id: string
          submitted_at?: string | null
          teacher_general_comment?: string | null
          total_marks_awarded?: number | null
          total_max_marks?: number | null
          updated_at?: string
          upload_completed_at?: string | null
        }
        Update: {
          class_id?: string
          created_at?: string
          device_info?: Json | null
          evaluated_at?: string | null
          evaluated_by?: string | null
          exam_id?: string
          id?: string
          institution_id?: string
          started_at?: string
          status?: string
          student_id?: string
          submitted_at?: string | null
          teacher_general_comment?: string | null
          total_marks_awarded?: number | null
          total_max_marks?: number | null
          updated_at?: string
          upload_completed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hybrid_exam_attempts_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hybrid_exam_attempts_evaluated_by_fkey"
            columns: ["evaluated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hybrid_exam_attempts_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hybrid_exam_attempts_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "student_eligible_exams"
            referencedColumns: ["exam_id"]
          },
          {
            foreignKeyName: "hybrid_exam_attempts_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hybrid_exam_attempts_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      hybrid_exam_settings: {
        Row: {
          created_at: string
          exam_id: string
          grace_window_minutes: number
          institution_id: string
          max_pages: number
          require_camera: boolean
          require_face_check: boolean
          sheet_numbering_instruction: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          exam_id: string
          grace_window_minutes?: number
          institution_id: string
          max_pages?: number
          require_camera?: boolean
          require_face_check?: boolean
          sheet_numbering_instruction?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          exam_id?: string
          grace_window_minutes?: number
          institution_id?: string
          max_pages?: number
          require_camera?: boolean
          require_face_check?: boolean
          sheet_numbering_instruction?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hybrid_exam_settings_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: true
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hybrid_exam_settings_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: true
            referencedRelation: "student_eligible_exams"
            referencedColumns: ["exam_id"]
          },
          {
            foreignKeyName: "hybrid_exam_settings_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
        ]
      }
      hybrid_pairing_tokens: {
        Row: {
          attempt_id: string
          created_at: string
          device_fingerprint: string | null
          expires_at: string
          institution_id: string
          short_code: string
          token: string
          used_at: string | null
        }
        Insert: {
          attempt_id: string
          created_at?: string
          device_fingerprint?: string | null
          expires_at: string
          institution_id: string
          short_code: string
          token: string
          used_at?: string | null
        }
        Update: {
          attempt_id?: string
          created_at?: string
          device_fingerprint?: string | null
          expires_at?: string
          institution_id?: string
          short_code?: string
          token?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hybrid_pairing_tokens_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "hybrid_exam_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hybrid_pairing_tokens_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
        ]
      }
      hybrid_proctoring_snapshots: {
        Row: {
          attempt_id: string
          captured_at: string
          flagged: boolean
          id: string
          institution_id: string
          storage_path: string
        }
        Insert: {
          attempt_id: string
          captured_at?: string
          flagged?: boolean
          id?: string
          institution_id: string
          storage_path: string
        }
        Update: {
          attempt_id?: string
          captured_at?: string
          flagged?: boolean
          id?: string
          institution_id?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "hybrid_proctoring_snapshots_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "hybrid_exam_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hybrid_proctoring_snapshots_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
        ]
      }
      hybrid_question_marks: {
        Row: {
          attempt_id: string
          created_at: string
          id: string
          institution_id: string
          is_flagged: boolean
          marked_at: string | null
          marked_by: string | null
          marks_awarded: number | null
          max_marks: number
          question_id: string
          teacher_comment: string | null
          updated_at: string
        }
        Insert: {
          attempt_id: string
          created_at?: string
          id?: string
          institution_id: string
          is_flagged?: boolean
          marked_at?: string | null
          marked_by?: string | null
          marks_awarded?: number | null
          max_marks: number
          question_id: string
          teacher_comment?: string | null
          updated_at?: string
        }
        Update: {
          attempt_id?: string
          created_at?: string
          id?: string
          institution_id?: string
          is_flagged?: boolean
          marked_at?: string | null
          marked_by?: string | null
          marks_awarded?: number | null
          max_marks?: number
          question_id?: string
          teacher_comment?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hybrid_question_marks_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "hybrid_exam_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hybrid_question_marks_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hybrid_question_marks_marked_by_fkey"
            columns: ["marked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hybrid_question_marks_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "exam_questions"
            referencedColumns: ["id"]
          },
        ]
      }
      hybrid_sheet_annotations: {
        Row: {
          annotation_type: string
          attempt_id: string
          color: string
          coordinates: Json
          created_at: string
          created_by: string | null
          id: string
          institution_id: string
          page_id: string | null
          page_number: number
          question_id: string | null
          text_content: string | null
        }
        Insert: {
          annotation_type: string
          attempt_id: string
          color?: string
          coordinates: Json
          created_at?: string
          created_by?: string | null
          id?: string
          institution_id: string
          page_id?: string | null
          page_number: number
          question_id?: string | null
          text_content?: string | null
        }
        Update: {
          annotation_type?: string
          attempt_id?: string
          color?: string
          coordinates?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          institution_id?: string
          page_id?: string | null
          page_number?: number
          question_id?: string | null
          text_content?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hybrid_sheet_annotations_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "hybrid_exam_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hybrid_sheet_annotations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hybrid_sheet_annotations_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hybrid_sheet_annotations_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "hybrid_answer_sheet_pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hybrid_sheet_annotations_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "exam_questions"
            referencedColumns: ["id"]
          },
        ]
      }
      institution_communication_settings: {
        Row: {
          bulk_messaging_enabled: boolean
          created_at: string
          email_api_key: string | null
          email_enabled: boolean
          email_from_address: string | null
          email_provider: string | null
          id: string
          institution_id: string
          sms_api_key: string | null
          sms_enabled: boolean
          sms_provider: string | null
          sms_sender_id: string | null
          updated_at: string
          whatsapp_api_key: string | null
          whatsapp_enabled: boolean
          whatsapp_phone_number: string | null
          whatsapp_provider: string | null
        }
        Insert: {
          bulk_messaging_enabled?: boolean
          created_at?: string
          email_api_key?: string | null
          email_enabled?: boolean
          email_from_address?: string | null
          email_provider?: string | null
          id?: string
          institution_id: string
          sms_api_key?: string | null
          sms_enabled?: boolean
          sms_provider?: string | null
          sms_sender_id?: string | null
          updated_at?: string
          whatsapp_api_key?: string | null
          whatsapp_enabled?: boolean
          whatsapp_phone_number?: string | null
          whatsapp_provider?: string | null
        }
        Update: {
          bulk_messaging_enabled?: boolean
          created_at?: string
          email_api_key?: string | null
          email_enabled?: boolean
          email_from_address?: string | null
          email_provider?: string | null
          id?: string
          institution_id?: string
          sms_api_key?: string | null
          sms_enabled?: boolean
          sms_provider?: string | null
          sms_sender_id?: string | null
          updated_at?: string
          whatsapp_api_key?: string | null
          whatsapp_enabled?: boolean
          whatsapp_phone_number?: string | null
          whatsapp_provider?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "institution_communication_settings_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: true
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
        ]
      }
      institution_features: {
        Row: {
          created_at: string
          enabled_at: string | null
          enabled_by: string | null
          feature_id: string
          id: string
          institution_id: string
          is_enabled: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          enabled_at?: string | null
          enabled_by?: string | null
          feature_id: string
          id?: string
          institution_id: string
          is_enabled?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          enabled_at?: string | null
          enabled_by?: string | null
          feature_id?: string
          id?: string
          institution_id?: string
          is_enabled?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "institution_features_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
        ]
      }
      institution_hidden_topics: {
        Row: {
          hidden_at: string
          hidden_by: string | null
          institution_id: string
          topic_id: string
        }
        Insert: {
          hidden_at?: string
          hidden_by?: string | null
          institution_id: string
          topic_id: string
        }
        Update: {
          hidden_at?: string
          hidden_by?: string | null
          institution_id?: string
          topic_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "institution_hidden_topics_hidden_by_fkey"
            columns: ["hidden_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "institution_hidden_topics_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "institution_hidden_topics_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "syllabus_topics"
            referencedColumns: ["id"]
          },
        ]
      }
      institution_subscriptions: {
        Row: {
          billing_cycle_start: string | null
          cancelled_at: string | null
          created_at: string
          id: string
          institution_id: string
          monthly_amount: number
          next_billing_date: string | null
          plan_name: string
          plan_type: string
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          billing_cycle_start?: string | null
          cancelled_at?: string | null
          created_at?: string
          id?: string
          institution_id: string
          monthly_amount?: number
          next_billing_date?: string | null
          plan_name?: string
          plan_type?: string
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          billing_cycle_start?: string | null
          cancelled_at?: string | null
          created_at?: string
          id?: string
          institution_id?: string
          monthly_amount?: number
          next_billing_date?: string | null
          plan_name?: string
          plan_type?: string
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "institution_subscriptions_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: true
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
        ]
      }
      institution_symbol_usage: {
        Row: {
          institution_id: string
          last_used_at: string
          symbol: string
          usage_count: number
        }
        Insert: {
          institution_id: string
          last_used_at?: string
          symbol: string
          usage_count?: number
        }
        Update: {
          institution_id?: string
          last_used_at?: string
          symbol?: string
          usage_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "institution_symbol_usage_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
        ]
      }
      institutions: {
        Row: {
          address: string | null
          code: string
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          dashboard_adoption_flags_enabled: boolean
          id: string
          is_active: boolean | null
          is_demo: boolean
          is_system: boolean
          logo_url: string | null
          max_admins: number | null
          name: string
          timezone: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          code: string
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          dashboard_adoption_flags_enabled?: boolean
          id?: string
          is_active?: boolean | null
          is_demo?: boolean
          is_system?: boolean
          logo_url?: string | null
          max_admins?: number | null
          name: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          code?: string
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          dashboard_adoption_flags_enabled?: boolean
          id?: string
          is_active?: boolean | null
          is_demo?: boolean
          is_system?: boolean
          logo_url?: string | null
          max_admins?: number | null
          name?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      learning_actions: {
        Row: {
          action_type: string
          approved_at: string | null
          approved_by: string | null
          assigned_at: string | null
          class_id: string | null
          completed_at: string | null
          created_at: string | null
          description: string | null
          due_date: string | null
          id: string
          institution_id: string
          metadata: Json | null
          priority: number | null
          source: string | null
          source_exam_id: string | null
          status: string | null
          student_id: string
          subject_id: string | null
          title: string
          topic_id: string | null
          updated_at: string | null
        }
        Insert: {
          action_type: string
          approved_at?: string | null
          approved_by?: string | null
          assigned_at?: string | null
          class_id?: string | null
          completed_at?: string | null
          created_at?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          institution_id: string
          metadata?: Json | null
          priority?: number | null
          source?: string | null
          source_exam_id?: string | null
          status?: string | null
          student_id: string
          subject_id?: string | null
          title: string
          topic_id?: string | null
          updated_at?: string | null
        }
        Update: {
          action_type?: string
          approved_at?: string | null
          approved_by?: string | null
          assigned_at?: string | null
          class_id?: string | null
          completed_at?: string | null
          created_at?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          institution_id?: string
          metadata?: Json | null
          priority?: number | null
          source?: string | null
          source_exam_id?: string | null
          status?: string | null
          student_id?: string
          subject_id?: string | null
          title?: string
          topic_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "learning_actions_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "learning_actions_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "learning_actions_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "learning_actions_source_exam_id_fkey"
            columns: ["source_exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "learning_actions_source_exam_id_fkey"
            columns: ["source_exam_id"]
            isOneToOne: false
            referencedRelation: "student_eligible_exams"
            referencedColumns: ["exam_id"]
          },
          {
            foreignKeyName: "learning_actions_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "learning_actions_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "learning_actions_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "syllabus_topics"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_requests: {
        Row: {
          class_id: string
          created_at: string
          end_date: string
          id: string
          institution_id: string
          leave_type: string
          reason: string
          reviewed_at: string | null
          reviewed_by: string | null
          reviewer_notes: string | null
          source: string
          start_date: string
          status: string
          student_id: string
          updated_at: string
        }
        Insert: {
          class_id: string
          created_at?: string
          end_date: string
          id?: string
          institution_id: string
          leave_type?: string
          reason: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_notes?: string | null
          source?: string
          start_date: string
          status?: string
          student_id: string
          updated_at?: string
        }
        Update: {
          class_id?: string
          created_at?: string
          end_date?: string
          id?: string
          institution_id?: string
          leave_type?: string
          reason?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_notes?: string | null
          source?: string
          start_date?: string
          status?: string
          student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "leave_requests_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_requests_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_requests_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notice_recipients: {
        Row: {
          acknowledged_at: string | null
          added_reason: string
          created_at: string
          id: string
          notice_id: string
          read_at: string | null
          recipient_role: string
          user_id: string
        }
        Insert: {
          acknowledged_at?: string | null
          added_reason: string
          created_at?: string
          id?: string
          notice_id: string
          read_at?: string | null
          recipient_role: string
          user_id: string
        }
        Update: {
          acknowledged_at?: string | null
          added_reason?: string
          created_at?: string
          id?: string
          notice_id?: string
          read_at?: string | null
          recipient_role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notice_recipients_notice_id_fkey"
            columns: ["notice_id"]
            isOneToOne: false
            referencedRelation: "notices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notice_recipients_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notice_target_classes: {
        Row: {
          class_id: string
          notice_id: string
        }
        Insert: {
          class_id: string
          notice_id: string
        }
        Update: {
          class_id?: string
          notice_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notice_target_classes_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notice_target_classes_notice_id_fkey"
            columns: ["notice_id"]
            isOneToOne: false
            referencedRelation: "notices"
            referencedColumns: ["id"]
          },
        ]
      }
      notice_target_wings: {
        Row: {
          notice_id: string
          wing_id: string
        }
        Insert: {
          notice_id: string
          wing_id: string
        }
        Update: {
          notice_id?: string
          wing_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notice_target_wings_notice_id_fkey"
            columns: ["notice_id"]
            isOneToOne: false
            referencedRelation: "notices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notice_target_wings_wing_id_fkey"
            columns: ["wing_id"]
            isOneToOne: false
            referencedRelation: "wings"
            referencedColumns: ["id"]
          },
        ]
      }
      notices: {
        Row: {
          attachments: Json
          audience_roles: string[]
          content: string
          created_at: string
          expires_at: string | null
          id: string
          institution_id: string
          priority: string
          published_at: string
          published_by: string | null
          recipient_count: number
          requires_acknowledgement: boolean
          scope: string
          title: string
          type: string
          updated_at: string
        }
        Insert: {
          attachments?: Json
          audience_roles?: string[]
          content: string
          created_at?: string
          expires_at?: string | null
          id?: string
          institution_id: string
          priority?: string
          published_at?: string
          published_by?: string | null
          recipient_count?: number
          requires_acknowledgement?: boolean
          scope?: string
          title: string
          type?: string
          updated_at?: string
        }
        Update: {
          attachments?: Json
          audience_roles?: string[]
          content?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          institution_id?: string
          priority?: string
          published_at?: string
          published_by?: string | null
          recipient_count?: number
          requires_acknowledgement?: boolean
          scope?: string
          title?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notices_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notices_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_queue: {
        Row: {
          attempts: number | null
          body_html: string
          body_text: string | null
          created_at: string | null
          error_message: string | null
          id: string
          last_attempt_at: string | null
          metadata: Json | null
          notification_type: string
          priority: number | null
          recipient_email: string
          recipient_id: string | null
          scheduled_for: string | null
          sent_at: string | null
          status: string | null
          subject: string
          updated_at: string | null
        }
        Insert: {
          attempts?: number | null
          body_html: string
          body_text?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          last_attempt_at?: string | null
          metadata?: Json | null
          notification_type: string
          priority?: number | null
          recipient_email: string
          recipient_id?: string | null
          scheduled_for?: string | null
          sent_at?: string | null
          status?: string | null
          subject: string
          updated_at?: string | null
        }
        Update: {
          attempts?: number | null
          body_html?: string
          body_text?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          last_attempt_at?: string | null
          metadata?: Json | null
          notification_type?: string
          priority?: number | null
          recipient_email?: string
          recipient_id?: string | null
          scheduled_for?: string | null
          sent_at?: string | null
          status?: string | null
          subject?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_queue_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string | null
          id: string
          is_read: boolean | null
          link: string | null
          message: string
          metadata: Json | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          link?: string | null
          message: string
          metadata?: Json | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          link?: string | null
          message?: string
          metadata?: Json | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ocr_extractions: {
        Row: {
          answer_id: string | null
          attempt_id: string
          bounding_box: Json | null
          cleaned_text: string | null
          confidence_score: number | null
          created_at: string
          extraction_metadata: Json | null
          id: string
          page_number: number | null
          question_id: string
          raw_extracted_text: string | null
          status: string
          updated_at: string
          upload_id: string
        }
        Insert: {
          answer_id?: string | null
          attempt_id: string
          bounding_box?: Json | null
          cleaned_text?: string | null
          confidence_score?: number | null
          created_at?: string
          extraction_metadata?: Json | null
          id?: string
          page_number?: number | null
          question_id: string
          raw_extracted_text?: string | null
          status?: string
          updated_at?: string
          upload_id: string
        }
        Update: {
          answer_id?: string | null
          attempt_id?: string
          bounding_box?: Json | null
          cleaned_text?: string | null
          confidence_score?: number | null
          created_at?: string
          extraction_metadata?: Json | null
          id?: string
          page_number?: number | null
          question_id?: string
          raw_extracted_text?: string | null
          status?: string
          updated_at?: string
          upload_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ocr_extractions_answer_id_fkey"
            columns: ["answer_id"]
            isOneToOne: false
            referencedRelation: "student_answers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ocr_extractions_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "student_eligible_exams"
            referencedColumns: ["attempt_id"]
          },
          {
            foreignKeyName: "ocr_extractions_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "student_exam_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ocr_extractions_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "exam_questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ocr_extractions_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "ocr_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      ocr_review_logs: {
        Row: {
          action: string
          corrected_text: string | null
          created_at: string
          extraction_id: string
          id: string
          new_status: string
          previous_status: string | null
          previous_text: string | null
          review_notes: string | null
          reviewed_by: string | null
        }
        Insert: {
          action: string
          corrected_text?: string | null
          created_at?: string
          extraction_id: string
          id?: string
          new_status: string
          previous_status?: string | null
          previous_text?: string | null
          review_notes?: string | null
          reviewed_by?: string | null
        }
        Update: {
          action?: string
          corrected_text?: string | null
          created_at?: string
          extraction_id?: string
          id?: string
          new_status?: string
          previous_status?: string | null
          previous_text?: string | null
          review_notes?: string | null
          reviewed_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ocr_review_logs_extraction_id_fkey"
            columns: ["extraction_id"]
            isOneToOne: false
            referencedRelation: "ocr_extractions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ocr_review_logs_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ocr_uploads: {
        Row: {
          attempt_id: string | null
          class_id: string
          created_at: string
          error_message: string | null
          exam_id: string
          file_name: string
          file_size_bytes: number | null
          file_url: string
          id: string
          match_method: string | null
          metadata: Json | null
          page_count: number | null
          processing_completed_at: string | null
          processing_started_at: string | null
          roll_number: string | null
          status: string
          student_id: string | null
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          attempt_id?: string | null
          class_id: string
          created_at?: string
          error_message?: string | null
          exam_id: string
          file_name: string
          file_size_bytes?: number | null
          file_url: string
          id?: string
          match_method?: string | null
          metadata?: Json | null
          page_count?: number | null
          processing_completed_at?: string | null
          processing_started_at?: string | null
          roll_number?: string | null
          status?: string
          student_id?: string | null
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          attempt_id?: string | null
          class_id?: string
          created_at?: string
          error_message?: string | null
          exam_id?: string
          file_name?: string
          file_size_bytes?: number | null
          file_url?: string
          id?: string
          match_method?: string | null
          metadata?: Json | null
          page_count?: number | null
          processing_completed_at?: string | null
          processing_started_at?: string | null
          roll_number?: string | null
          status?: string
          student_id?: string | null
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ocr_uploads_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "student_eligible_exams"
            referencedColumns: ["attempt_id"]
          },
          {
            foreignKeyName: "ocr_uploads_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "student_exam_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ocr_uploads_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ocr_uploads_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ocr_uploads_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "student_eligible_exams"
            referencedColumns: ["exam_id"]
          },
          {
            foreignKeyName: "ocr_uploads_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ocr_uploads_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      offline_section_marks: {
        Row: {
          attempt_id: string
          created_at: string
          entered_by: string | null
          id: string
          is_absent: boolean
          marks_obtained: number
          section_id: string
          updated_at: string
        }
        Insert: {
          attempt_id: string
          created_at?: string
          entered_by?: string | null
          id?: string
          is_absent?: boolean
          marks_obtained?: number
          section_id: string
          updated_at?: string
        }
        Update: {
          attempt_id?: string
          created_at?: string
          entered_by?: string | null
          id?: string
          is_absent?: boolean
          marks_obtained?: number
          section_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "offline_section_marks_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "student_eligible_exams"
            referencedColumns: ["attempt_id"]
          },
          {
            foreignKeyName: "offline_section_marks_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "student_exam_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offline_section_marks_entered_by_fkey"
            columns: ["entered_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offline_section_marks_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "exam_sections"
            referencedColumns: ["id"]
          },
        ]
      }
      offline_student_marks: {
        Row: {
          created_at: string | null
          created_by: string | null
          exam_id: string
          id: string
          is_absent: boolean
          is_published: boolean | null
          marks_obtained: number | null
          student_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          exam_id: string
          id?: string
          is_absent?: boolean
          is_published?: boolean | null
          marks_obtained?: number | null
          student_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          exam_id?: string
          id?: string
          is_absent?: boolean
          is_published?: boolean | null
          marks_obtained?: number | null
          student_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "offline_student_marks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offline_student_marks_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offline_student_marks_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "student_eligible_exams"
            referencedColumns: ["exam_id"]
          },
          {
            foreignKeyName: "offline_student_marks_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      oly_answers: {
        Row: {
          answered_at: string | null
          id: string
          marked_for_review: boolean
          oly_attempt_id: string
          oly_question_snapshot_id: string
          selected_answer: string | null
          time_spent_seconds: number
          updated_at: string
        }
        Insert: {
          answered_at?: string | null
          id?: string
          marked_for_review?: boolean
          oly_attempt_id: string
          oly_question_snapshot_id: string
          selected_answer?: string | null
          time_spent_seconds?: number
          updated_at?: string
        }
        Update: {
          answered_at?: string | null
          id?: string
          marked_for_review?: boolean
          oly_attempt_id?: string
          oly_question_snapshot_id?: string
          selected_answer?: string | null
          time_spent_seconds?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "oly_answers_oly_attempt_id_fkey"
            columns: ["oly_attempt_id"]
            isOneToOne: false
            referencedRelation: "oly_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oly_answers_oly_question_snapshot_id_fkey"
            columns: ["oly_question_snapshot_id"]
            isOneToOne: true
            referencedRelation: "oly_questions_snapshot"
            referencedColumns: ["id"]
          },
        ]
      }
      oly_attempt_events: {
        Row: {
          event_at: string
          event_type: string
          id: string
          oly_attempt_id: string
          payload: Json | null
        }
        Insert: {
          event_at?: string
          event_type: string
          id?: string
          oly_attempt_id: string
          payload?: Json | null
        }
        Update: {
          event_at?: string
          event_type?: string
          id?: string
          oly_attempt_id?: string
          payload?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "oly_attempt_events_oly_attempt_id_fkey"
            columns: ["oly_attempt_id"]
            isOneToOne: false
            referencedRelation: "oly_attempts"
            referencedColumns: ["id"]
          },
        ]
      }
      oly_attempts: {
        Row: {
          campaign_id: string
          created_at: string
          exam_duration_seconds: number
          id: string
          oly_batch_id: string
          oly_student_id: string
          percentage: number | null
          proctoring_violations: number
          section_switches: number
          started_at: string
          status: string
          subject_scores: Json | null
          submit_reason: string | null
          submitted_at: string | null
          total_marks_obtained: number | null
          total_max_marks: number | null
          updated_at: string
        }
        Insert: {
          campaign_id: string
          created_at?: string
          exam_duration_seconds: number
          id?: string
          oly_batch_id: string
          oly_student_id: string
          percentage?: number | null
          proctoring_violations?: number
          section_switches?: number
          started_at?: string
          status?: string
          subject_scores?: Json | null
          submit_reason?: string | null
          submitted_at?: string | null
          total_marks_obtained?: number | null
          total_max_marks?: number | null
          updated_at?: string
        }
        Update: {
          campaign_id?: string
          created_at?: string
          exam_duration_seconds?: number
          id?: string
          oly_batch_id?: string
          oly_student_id?: string
          percentage?: number | null
          proctoring_violations?: number
          section_switches?: number
          started_at?: string
          status?: string
          subject_scores?: Json | null
          submit_reason?: string | null
          submitted_at?: string | null
          total_marks_obtained?: number | null
          total_max_marks?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "oly_attempts_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "oly_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oly_attempts_oly_batch_id_fkey"
            columns: ["oly_batch_id"]
            isOneToOne: false
            referencedRelation: "oly_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oly_attempts_oly_batch_id_fkey"
            columns: ["oly_batch_id"]
            isOneToOne: false
            referencedRelation: "oly_batches_no_pin"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oly_attempts_oly_student_id_fkey"
            columns: ["oly_student_id"]
            isOneToOne: true
            referencedRelation: "oly_students"
            referencedColumns: ["id"]
          },
        ]
      }
      oly_audit_log: {
        Row: {
          action: string
          actor_id: string | null
          actor_role: string
          after_json: Json | null
          before_json: Json | null
          campaign_id: string
          created_at: string
          id: string
          oly_school_id: string | null
          oly_student_id: string | null
          reason: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_role: string
          after_json?: Json | null
          before_json?: Json | null
          campaign_id: string
          created_at?: string
          id?: string
          oly_school_id?: string | null
          oly_student_id?: string | null
          reason?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_role?: string
          after_json?: Json | null
          before_json?: Json | null
          campaign_id?: string
          created_at?: string
          id?: string
          oly_school_id?: string | null
          oly_student_id?: string | null
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "oly_audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oly_audit_log_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "oly_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oly_audit_log_oly_school_id_fkey"
            columns: ["oly_school_id"]
            isOneToOne: false
            referencedRelation: "oly_schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oly_audit_log_oly_student_id_fkey"
            columns: ["oly_student_id"]
            isOneToOne: false
            referencedRelation: "oly_students"
            referencedColumns: ["id"]
          },
        ]
      }
      oly_batch_assignments: {
        Row: {
          assigned_at: string
          id: string
          oly_batch_id: string
          oly_student_id: string
        }
        Insert: {
          assigned_at?: string
          id?: string
          oly_batch_id: string
          oly_student_id: string
        }
        Update: {
          assigned_at?: string
          id?: string
          oly_batch_id?: string
          oly_student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "oly_batch_assignments_oly_batch_id_fkey"
            columns: ["oly_batch_id"]
            isOneToOne: false
            referencedRelation: "oly_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oly_batch_assignments_oly_batch_id_fkey"
            columns: ["oly_batch_id"]
            isOneToOne: false
            referencedRelation: "oly_batches_no_pin"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oly_batch_assignments_oly_student_id_fkey"
            columns: ["oly_student_id"]
            isOneToOne: true
            referencedRelation: "oly_students"
            referencedColumns: ["id"]
          },
        ]
      }
      oly_batches: {
        Row: {
          batch_label: string
          campaign_id: string
          created_at: string
          created_by: string | null
          grade_level_id: string | null
          id: string
          is_absentees: boolean
          locked_at: string | null
          oly_school_id: string
          pc_count: number
          pin: string | null
          pin_expiry_minutes: number
          pin_first_used_at: string | null
          scheduled_at: string
          status: string
          updated_at: string
        }
        Insert: {
          batch_label: string
          campaign_id: string
          created_at?: string
          created_by?: string | null
          grade_level_id?: string | null
          id?: string
          is_absentees?: boolean
          locked_at?: string | null
          oly_school_id: string
          pc_count: number
          pin?: string | null
          pin_expiry_minutes?: number
          pin_first_used_at?: string | null
          scheduled_at: string
          status?: string
          updated_at?: string
        }
        Update: {
          batch_label?: string
          campaign_id?: string
          created_at?: string
          created_by?: string | null
          grade_level_id?: string | null
          id?: string
          is_absentees?: boolean
          locked_at?: string | null
          oly_school_id?: string
          pc_count?: number
          pin?: string | null
          pin_expiry_minutes?: number
          pin_first_used_at?: string | null
          scheduled_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "oly_batches_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "oly_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oly_batches_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oly_batches_grade_level_id_fkey"
            columns: ["grade_level_id"]
            isOneToOne: false
            referencedRelation: "grade_levels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oly_batches_oly_school_id_fkey"
            columns: ["oly_school_id"]
            isOneToOne: false
            referencedRelation: "oly_schools"
            referencedColumns: ["id"]
          },
        ]
      }
      oly_campaigns: {
        Row: {
          bronze_threshold_percent: number
          campaign_year: number
          created_at: string
          created_by: string | null
          default_price_rupees: number
          description: string | null
          exam_duration_minutes: number
          gold_threshold_percent: number
          gst_percent: number
          gstin: string | null
          id: string
          pin_expiry_minutes: number
          questions_per_subject: number
          silver_threshold_percent: number
          status: string
          updated_at: string
        }
        Insert: {
          bronze_threshold_percent?: number
          campaign_year: number
          created_at?: string
          created_by?: string | null
          default_price_rupees: number
          description?: string | null
          exam_duration_minutes?: number
          gold_threshold_percent?: number
          gst_percent?: number
          gstin?: string | null
          id?: string
          pin_expiry_minutes?: number
          questions_per_subject?: number
          silver_threshold_percent?: number
          status?: string
          updated_at?: string
        }
        Update: {
          bronze_threshold_percent?: number
          campaign_year?: number
          created_at?: string
          created_by?: string | null
          default_price_rupees?: number
          description?: string | null
          exam_duration_minutes?: number
          gold_threshold_percent?: number
          gst_percent?: number
          gstin?: string | null
          id?: string
          pin_expiry_minutes?: number
          questions_per_subject?: number
          silver_threshold_percent?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "oly_campaigns_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      oly_enrollment_pending: {
        Row: {
          admission_number: string | null
          amount_rupees: number
          campaign_id: string
          class_label: string
          created_at: string
          date_of_birth: string
          failure_reason: string | null
          full_name: string
          gateway_order_id: string | null
          gateway_payment_id: string | null
          gateway_signature: string | null
          grade_level_id: string | null
          gst_rupees: number
          id: string
          oly_school_id: string
          parent_email: string | null
          parent_name: string
          parent_phone: string
          promoted_student_id: string | null
          section_label: string | null
          status: string
          subject_ids: string[]
          total_rupees: number
          updated_at: string
        }
        Insert: {
          admission_number?: string | null
          amount_rupees: number
          campaign_id: string
          class_label: string
          created_at?: string
          date_of_birth: string
          failure_reason?: string | null
          full_name: string
          gateway_order_id?: string | null
          gateway_payment_id?: string | null
          gateway_signature?: string | null
          grade_level_id?: string | null
          gst_rupees: number
          id?: string
          oly_school_id: string
          parent_email?: string | null
          parent_name: string
          parent_phone: string
          promoted_student_id?: string | null
          section_label?: string | null
          status?: string
          subject_ids: string[]
          total_rupees: number
          updated_at?: string
        }
        Update: {
          admission_number?: string | null
          amount_rupees?: number
          campaign_id?: string
          class_label?: string
          created_at?: string
          date_of_birth?: string
          failure_reason?: string | null
          full_name?: string
          gateway_order_id?: string | null
          gateway_payment_id?: string | null
          gateway_signature?: string | null
          grade_level_id?: string | null
          gst_rupees?: number
          id?: string
          oly_school_id?: string
          parent_email?: string | null
          parent_name?: string
          parent_phone?: string
          promoted_student_id?: string | null
          section_label?: string | null
          status?: string
          subject_ids?: string[]
          total_rupees?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "oly_enrollment_pending_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "oly_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oly_enrollment_pending_grade_level_id_fkey"
            columns: ["grade_level_id"]
            isOneToOne: false
            referencedRelation: "grade_levels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oly_enrollment_pending_oly_school_id_fkey"
            columns: ["oly_school_id"]
            isOneToOne: false
            referencedRelation: "oly_schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oly_enrollment_pending_promoted_student_id_fkey"
            columns: ["promoted_student_id"]
            isOneToOne: false
            referencedRelation: "oly_students"
            referencedColumns: ["id"]
          },
        ]
      }
      oly_impersonation_log: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          impersonated_user_id: string | null
          oly_school_id: string | null
          reason: string | null
          super_admin_id: string | null
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          impersonated_user_id?: string | null
          oly_school_id?: string | null
          reason?: string | null
          super_admin_id?: string | null
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          impersonated_user_id?: string | null
          oly_school_id?: string | null
          reason?: string | null
          super_admin_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "oly_impersonation_log_impersonated_user_id_fkey"
            columns: ["impersonated_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oly_impersonation_log_oly_school_id_fkey"
            columns: ["oly_school_id"]
            isOneToOne: false
            referencedRelation: "oly_schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oly_impersonation_log_super_admin_id_fkey"
            columns: ["super_admin_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      oly_pin_attempt_log: {
        Row: {
          attempted_at: string
          attempted_pin: string
          id: string
          ip_address: string | null
          oly_school_id: string | null
          oly_student_id: string | null
          outcome: string
          resolved_batch_id: string | null
          user_agent: string | null
        }
        Insert: {
          attempted_at?: string
          attempted_pin: string
          id?: string
          ip_address?: string | null
          oly_school_id?: string | null
          oly_student_id?: string | null
          outcome: string
          resolved_batch_id?: string | null
          user_agent?: string | null
        }
        Update: {
          attempted_at?: string
          attempted_pin?: string
          id?: string
          ip_address?: string | null
          oly_school_id?: string | null
          oly_student_id?: string | null
          outcome?: string
          resolved_batch_id?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "oly_pin_attempt_log_oly_school_id_fkey"
            columns: ["oly_school_id"]
            isOneToOne: false
            referencedRelation: "oly_schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oly_pin_attempt_log_oly_student_id_fkey"
            columns: ["oly_student_id"]
            isOneToOne: false
            referencedRelation: "oly_students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oly_pin_attempt_log_resolved_batch_id_fkey"
            columns: ["resolved_batch_id"]
            isOneToOne: false
            referencedRelation: "oly_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oly_pin_attempt_log_resolved_batch_id_fkey"
            columns: ["resolved_batch_id"]
            isOneToOne: false
            referencedRelation: "oly_batches_no_pin"
            referencedColumns: ["id"]
          },
        ]
      }
      oly_publish_jobs: {
        Row: {
          campaign_id: string
          completed_at: string | null
          created_at: string
          error: string | null
          failed_students: number
          failure_details: Json | null
          id: string
          initiated_by: string | null
          oly_school_id: string
          processed_students: number
          scope_batch_ids: string[] | null
          scope_grade_level_ids: string[] | null
          started_at: string | null
          status: string
          total_students: number
          updated_at: string
        }
        Insert: {
          campaign_id: string
          completed_at?: string | null
          created_at?: string
          error?: string | null
          failed_students?: number
          failure_details?: Json | null
          id?: string
          initiated_by?: string | null
          oly_school_id: string
          processed_students?: number
          scope_batch_ids?: string[] | null
          scope_grade_level_ids?: string[] | null
          started_at?: string | null
          status?: string
          total_students?: number
          updated_at?: string
        }
        Update: {
          campaign_id?: string
          completed_at?: string | null
          created_at?: string
          error?: string | null
          failed_students?: number
          failure_details?: Json | null
          id?: string
          initiated_by?: string | null
          oly_school_id?: string
          processed_students?: number
          scope_batch_ids?: string[] | null
          scope_grade_level_ids?: string[] | null
          started_at?: string | null
          status?: string
          total_students?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "oly_publish_jobs_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "oly_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oly_publish_jobs_initiated_by_fkey"
            columns: ["initiated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oly_publish_jobs_oly_school_id_fkey"
            columns: ["oly_school_id"]
            isOneToOne: true
            referencedRelation: "oly_schools"
            referencedColumns: ["id"]
          },
        ]
      }
      oly_questions: {
        Row: {
          correct_answer: string
          created_at: string
          created_by: string | null
          grade_level_id: string
          id: string
          image_url: string | null
          internal_notes: string | null
          last_used_at: string | null
          option_a: string
          option_b: string
          option_c: string
          option_d: string
          question_text: string
          status: string
          subject_id: string
          times_used: number
          topic_id: string | null
          total_attempts: number
          total_correct: number
          total_time_seconds: number
          updated_at: string
        }
        Insert: {
          correct_answer: string
          created_at?: string
          created_by?: string | null
          grade_level_id: string
          id?: string
          image_url?: string | null
          internal_notes?: string | null
          last_used_at?: string | null
          option_a: string
          option_b: string
          option_c: string
          option_d: string
          question_text: string
          status?: string
          subject_id: string
          times_used?: number
          topic_id?: string | null
          total_attempts?: number
          total_correct?: number
          total_time_seconds?: number
          updated_at?: string
        }
        Update: {
          correct_answer?: string
          created_at?: string
          created_by?: string | null
          grade_level_id?: string
          id?: string
          image_url?: string | null
          internal_notes?: string | null
          last_used_at?: string | null
          option_a?: string
          option_b?: string
          option_c?: string
          option_d?: string
          question_text?: string
          status?: string
          subject_id?: string
          times_used?: number
          topic_id?: string | null
          total_attempts?: number
          total_correct?: number
          total_time_seconds?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "oly_questions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oly_questions_grade_level_id_fkey"
            columns: ["grade_level_id"]
            isOneToOne: false
            referencedRelation: "grade_levels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oly_questions_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "oly_subjects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oly_questions_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "oly_topics"
            referencedColumns: ["id"]
          },
        ]
      }
      oly_questions_snapshot: {
        Row: {
          correct_answer: string
          id: string
          marks: number
          oly_attempt_id: string
          option_a: string
          option_b: string
          option_c: string
          option_d: string
          position_in_subject: number
          question_id: string
          question_text: string
          subject_id: string
          topic_id: string | null
        }
        Insert: {
          correct_answer: string
          id?: string
          marks?: number
          oly_attempt_id: string
          option_a: string
          option_b: string
          option_c: string
          option_d: string
          position_in_subject: number
          question_id: string
          question_text: string
          subject_id: string
          topic_id?: string | null
        }
        Update: {
          correct_answer?: string
          id?: string
          marks?: number
          oly_attempt_id?: string
          option_a?: string
          option_b?: string
          option_c?: string
          option_d?: string
          position_in_subject?: number
          question_id?: string
          question_text?: string
          subject_id?: string
          topic_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "oly_questions_snapshot_oly_attempt_id_fkey"
            columns: ["oly_attempt_id"]
            isOneToOne: false
            referencedRelation: "oly_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oly_questions_snapshot_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "oly_questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oly_questions_snapshot_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "oly_subjects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oly_questions_snapshot_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "oly_topics"
            referencedColumns: ["id"]
          },
        ]
      }
      oly_receipts: {
        Row: {
          amount_rupees: number
          emailed_at: string | null
          emailed_to: string | null
          gateway_payment_id: string | null
          gateway_reference: string | null
          gst_rupees: number
          id: string
          issued_at: string
          oly_student_id: string
          payment_method: string
          receipt_number: string
          storage_path: string
          total_rupees: number
        }
        Insert: {
          amount_rupees: number
          emailed_at?: string | null
          emailed_to?: string | null
          gateway_payment_id?: string | null
          gateway_reference?: string | null
          gst_rupees: number
          id?: string
          issued_at?: string
          oly_student_id: string
          payment_method: string
          receipt_number: string
          storage_path: string
          total_rupees: number
        }
        Update: {
          amount_rupees?: number
          emailed_at?: string | null
          emailed_to?: string | null
          gateway_payment_id?: string | null
          gateway_reference?: string | null
          gst_rupees?: number
          id?: string
          issued_at?: string
          oly_student_id?: string
          payment_method?: string
          receipt_number?: string
          storage_path?: string
          total_rupees?: number
        }
        Relationships: [
          {
            foreignKeyName: "oly_receipts_oly_student_id_fkey"
            columns: ["oly_student_id"]
            isOneToOne: false
            referencedRelation: "oly_students"
            referencedColumns: ["id"]
          },
        ]
      }
      oly_refunds: {
        Row: {
          amount_rupees: number
          completed_at: string | null
          failure_reason: string | null
          gateway_refund_id: string | null
          id: string
          initiated_at: string
          initiated_by: string | null
          oly_student_id: string
          reason: string
          scope: string
          status: string
        }
        Insert: {
          amount_rupees: number
          completed_at?: string | null
          failure_reason?: string | null
          gateway_refund_id?: string | null
          id?: string
          initiated_at?: string
          initiated_by?: string | null
          oly_student_id: string
          reason: string
          scope: string
          status?: string
        }
        Update: {
          amount_rupees?: number
          completed_at?: string | null
          failure_reason?: string | null
          gateway_refund_id?: string | null
          id?: string
          initiated_at?: string
          initiated_by?: string | null
          oly_student_id?: string
          reason?: string
          scope?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "oly_refunds_initiated_by_fkey"
            columns: ["initiated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oly_refunds_oly_student_id_fkey"
            columns: ["oly_student_id"]
            isOneToOne: false
            referencedRelation: "oly_students"
            referencedColumns: ["id"]
          },
        ]
      }
      oly_reminder_log: {
        Row: {
          id: string
          oly_batch_id: string
          oly_student_id: string
          reminder_type: string
          sent_at: string
          sent_to_email: string | null
        }
        Insert: {
          id?: string
          oly_batch_id: string
          oly_student_id: string
          reminder_type: string
          sent_at?: string
          sent_to_email?: string | null
        }
        Update: {
          id?: string
          oly_batch_id?: string
          oly_student_id?: string
          reminder_type?: string
          sent_at?: string
          sent_to_email?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "oly_reminder_log_oly_batch_id_fkey"
            columns: ["oly_batch_id"]
            isOneToOne: false
            referencedRelation: "oly_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oly_reminder_log_oly_batch_id_fkey"
            columns: ["oly_batch_id"]
            isOneToOne: false
            referencedRelation: "oly_batches_no_pin"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oly_reminder_log_oly_student_id_fkey"
            columns: ["oly_student_id"]
            isOneToOne: false
            referencedRelation: "oly_students"
            referencedColumns: ["id"]
          },
        ]
      }
      oly_results: {
        Row: {
          campaign_id: string
          certificate_id: string
          certificate_pdf_generated_at: string | null
          certificate_pdf_path: string | null
          certificate_tier: string
          class_rank: number | null
          class_total: number | null
          emailed_at: string | null
          emailed_to: string | null
          id: string
          oly_attempt_id: string | null
          oly_school_id: string
          oly_student_id: string
          percentage: number
          published_at: string
          result_pdf_generated_at: string | null
          result_pdf_path: string | null
          school_rank: number | null
          school_total: number | null
          subject_scores: Json
          total_marks_obtained: number
          total_max_marks: number
          total_time_seconds: number | null
        }
        Insert: {
          campaign_id: string
          certificate_id: string
          certificate_pdf_generated_at?: string | null
          certificate_pdf_path?: string | null
          certificate_tier: string
          class_rank?: number | null
          class_total?: number | null
          emailed_at?: string | null
          emailed_to?: string | null
          id?: string
          oly_attempt_id?: string | null
          oly_school_id: string
          oly_student_id: string
          percentage?: number
          published_at?: string
          result_pdf_generated_at?: string | null
          result_pdf_path?: string | null
          school_rank?: number | null
          school_total?: number | null
          subject_scores?: Json
          total_marks_obtained?: number
          total_max_marks?: number
          total_time_seconds?: number | null
        }
        Update: {
          campaign_id?: string
          certificate_id?: string
          certificate_pdf_generated_at?: string | null
          certificate_pdf_path?: string | null
          certificate_tier?: string
          class_rank?: number | null
          class_total?: number | null
          emailed_at?: string | null
          emailed_to?: string | null
          id?: string
          oly_attempt_id?: string | null
          oly_school_id?: string
          oly_student_id?: string
          percentage?: number
          published_at?: string
          result_pdf_generated_at?: string | null
          result_pdf_path?: string | null
          school_rank?: number | null
          school_total?: number | null
          subject_scores?: Json
          total_marks_obtained?: number
          total_max_marks?: number
          total_time_seconds?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "oly_results_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "oly_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oly_results_oly_attempt_id_fkey"
            columns: ["oly_attempt_id"]
            isOneToOne: false
            referencedRelation: "oly_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oly_results_oly_school_id_fkey"
            columns: ["oly_school_id"]
            isOneToOne: false
            referencedRelation: "oly_schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oly_results_oly_student_id_fkey"
            columns: ["oly_student_id"]
            isOneToOne: true
            referencedRelation: "oly_students"
            referencedColumns: ["id"]
          },
        ]
      }
      oly_results_archive: {
        Row: {
          archived_at: string
          campaign_year: number
          certificate_id: string
          certificate_tier: string
          class_label: string
          class_rank: number | null
          id: string
          percentage: number
          roll_number: string
          school_rank: number | null
          school_short_code: string
          subject_ids: string[]
          subject_scores: Json
          total_marks_obtained: number
          total_max_marks: number
          total_time_seconds: number | null
        }
        Insert: {
          archived_at?: string
          campaign_year: number
          certificate_id: string
          certificate_tier: string
          class_label: string
          class_rank?: number | null
          id?: string
          percentage: number
          roll_number: string
          school_rank?: number | null
          school_short_code: string
          subject_ids: string[]
          subject_scores: Json
          total_marks_obtained: number
          total_max_marks: number
          total_time_seconds?: number | null
        }
        Update: {
          archived_at?: string
          campaign_year?: number
          certificate_id?: string
          certificate_tier?: string
          class_label?: string
          class_rank?: number | null
          id?: string
          percentage?: number
          roll_number?: string
          school_rank?: number | null
          school_short_code?: string
          subject_ids?: string[]
          subject_scores?: Json
          total_marks_obtained?: number
          total_max_marks?: number
          total_time_seconds?: number | null
        }
        Relationships: []
      }
      oly_schools: {
        Row: {
          campaign_id: string
          city: string | null
          created_at: string
          created_by: string | null
          enrollment_closes_at: string | null
          id: string
          institution_id: string
          internal_notes: string | null
          is_existing_salci_school: boolean
          lab_pc_counts: Json | null
          participating_grade_level_ids: string[]
          pc_count: number | null
          price_override_rupees: number | null
          primary_contact_email: string
          primary_contact_name: string
          primary_contact_phone: string
          school_short_code: string
          state: string | null
          status: string
          updated_at: string
        }
        Insert: {
          campaign_id: string
          city?: string | null
          created_at?: string
          created_by?: string | null
          enrollment_closes_at?: string | null
          id?: string
          institution_id: string
          internal_notes?: string | null
          is_existing_salci_school?: boolean
          lab_pc_counts?: Json | null
          participating_grade_level_ids?: string[]
          pc_count?: number | null
          price_override_rupees?: number | null
          primary_contact_email: string
          primary_contact_name: string
          primary_contact_phone: string
          school_short_code: string
          state?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          campaign_id?: string
          city?: string | null
          created_at?: string
          created_by?: string | null
          enrollment_closes_at?: string | null
          id?: string
          institution_id?: string
          internal_notes?: string | null
          is_existing_salci_school?: boolean
          lab_pc_counts?: Json | null
          participating_grade_level_ids?: string[]
          pc_count?: number | null
          price_override_rupees?: number | null
          primary_contact_email?: string
          primary_contact_name?: string
          primary_contact_phone?: string
          school_short_code?: string
          state?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "oly_schools_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "oly_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oly_schools_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oly_schools_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
        ]
      }
      oly_students: {
        Row: {
          admission_number: string | null
          auth_user_id: string | null
          campaign_id: string
          class_label: string
          created_by: string | null
          date_of_birth: string
          enrolled_at: string
          enrollment_channel: string
          full_name: string
          grade_level_id: string | null
          id: string
          oly_school_id: string
          parent_email: string | null
          parent_name: string
          parent_phone: string
          profile_id: string | null
          removed_at: string | null
          removed_by: string | null
          removed_reason: string | null
          roll_number: string
          section_label: string | null
          status: string
          subject_ids: string[]
          updated_at: string
        }
        Insert: {
          admission_number?: string | null
          auth_user_id?: string | null
          campaign_id: string
          class_label: string
          created_by?: string | null
          date_of_birth: string
          enrolled_at?: string
          enrollment_channel: string
          full_name: string
          grade_level_id?: string | null
          id?: string
          oly_school_id: string
          parent_email?: string | null
          parent_name: string
          parent_phone: string
          profile_id?: string | null
          removed_at?: string | null
          removed_by?: string | null
          removed_reason?: string | null
          roll_number: string
          section_label?: string | null
          status?: string
          subject_ids: string[]
          updated_at?: string
        }
        Update: {
          admission_number?: string | null
          auth_user_id?: string | null
          campaign_id?: string
          class_label?: string
          created_by?: string | null
          date_of_birth?: string
          enrolled_at?: string
          enrollment_channel?: string
          full_name?: string
          grade_level_id?: string | null
          id?: string
          oly_school_id?: string
          parent_email?: string | null
          parent_name?: string
          parent_phone?: string
          profile_id?: string | null
          removed_at?: string | null
          removed_by?: string | null
          removed_reason?: string | null
          roll_number?: string
          section_label?: string | null
          status?: string
          subject_ids?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "oly_students_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "oly_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oly_students_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oly_students_grade_level_id_fkey"
            columns: ["grade_level_id"]
            isOneToOne: false
            referencedRelation: "grade_levels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oly_students_oly_school_id_fkey"
            columns: ["oly_school_id"]
            isOneToOne: false
            referencedRelation: "oly_schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oly_students_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oly_students_removed_by_fkey"
            columns: ["removed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      oly_study_materials: {
        Row: {
          created_at: string
          description: string | null
          display_order: number
          file_size_bytes: number
          grade_level_id: string
          id: string
          storage_path: string
          subject_id: string
          title: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          display_order?: number
          file_size_bytes: number
          grade_level_id: string
          id?: string
          storage_path: string
          subject_id: string
          title: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          display_order?: number
          file_size_bytes?: number
          grade_level_id?: string
          id?: string
          storage_path?: string
          subject_id?: string
          title?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "oly_study_materials_grade_level_id_fkey"
            columns: ["grade_level_id"]
            isOneToOne: false
            referencedRelation: "grade_levels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oly_study_materials_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "oly_subjects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oly_study_materials_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      oly_subject_classes: {
        Row: {
          created_at: string
          grade_level_id: string
          id: string
          subject_id: string
        }
        Insert: {
          created_at?: string
          grade_level_id: string
          id?: string
          subject_id: string
        }
        Update: {
          created_at?: string
          grade_level_id?: string
          id?: string
          subject_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "oly_subject_classes_grade_level_id_fkey"
            columns: ["grade_level_id"]
            isOneToOne: false
            referencedRelation: "grade_levels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oly_subject_classes_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "oly_subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      oly_subjects: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      oly_teacher_class_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          campaign_id: string
          grade_level_id: string
          id: string
          oly_school_id: string
          teacher_profile_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          campaign_id: string
          grade_level_id: string
          id?: string
          oly_school_id: string
          teacher_profile_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          campaign_id?: string
          grade_level_id?: string
          id?: string
          oly_school_id?: string
          teacher_profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "oly_teacher_class_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oly_teacher_class_assignments_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "oly_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oly_teacher_class_assignments_grade_level_id_fkey"
            columns: ["grade_level_id"]
            isOneToOne: false
            referencedRelation: "grade_levels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oly_teacher_class_assignments_oly_school_id_fkey"
            columns: ["oly_school_id"]
            isOneToOne: false
            referencedRelation: "oly_schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oly_teacher_class_assignments_teacher_profile_id_fkey"
            columns: ["teacher_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      oly_topics: {
        Row: {
          created_at: string
          display_order: number
          grade_level_id: string
          id: string
          name: string
          status: string
          subject_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_order?: number
          grade_level_id: string
          id?: string
          name: string
          status?: string
          subject_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_order?: number
          grade_level_id?: string
          id?: string
          name?: string
          status?: string
          subject_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "oly_topics_grade_level_id_fkey"
            columns: ["grade_level_id"]
            isOneToOne: false
            referencedRelation: "grade_levels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oly_topics_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "oly_subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_snapshots: {
        Row: {
          avg_completion_percent: number
          created_at: string
          created_by: string | null
          fully_complete_count: number
          id: string
          institution_id: string
          milestone_counts: Json
          per_user_data: Json
          snapshot_date: string
          total_users: number
        }
        Insert: {
          avg_completion_percent: number
          created_at?: string
          created_by?: string | null
          fully_complete_count: number
          id?: string
          institution_id: string
          milestone_counts: Json
          per_user_data: Json
          snapshot_date: string
          total_users: number
        }
        Update: {
          avg_completion_percent?: number
          created_at?: string
          created_by?: string | null
          fully_complete_count?: number
          id?: string
          institution_id?: string
          milestone_counts?: Json
          per_user_data?: Json
          snapshot_date?: string
          total_users?: number
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_snapshots_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "onboarding_snapshots_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
        ]
      }
      optional_band_slots: {
        Row: {
          band_slot_id: string
          batch_id: string
          created_at: string
          id: string
        }
        Insert: {
          band_slot_id: string
          batch_id: string
          created_at?: string
          id?: string
        }
        Update: {
          band_slot_id?: string
          batch_id?: string
          created_at?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "optional_band_slots_band_slot_id_fkey"
            columns: ["band_slot_id"]
            isOneToOne: false
            referencedRelation: "tt_slots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "optional_band_slots_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "optional_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      optional_batch_students: {
        Row: {
          batch_id: string
          created_at: string
          id: string
          student_id: string
        }
        Insert: {
          batch_id: string
          created_at?: string
          id?: string
          student_id: string
        }
        Update: {
          batch_id?: string
          created_at?: string
          id?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "optional_batch_students_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "optional_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "optional_batch_students_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      optional_batches: {
        Row: {
          academic_year: string
          created_at: string
          created_by: string | null
          id: string
          institution_id: string
          label: string
          status: string
          subject_id: string
          teacher_id: string | null
          updated_at: string
        }
        Insert: {
          academic_year: string
          created_at?: string
          created_by?: string | null
          id?: string
          institution_id: string
          label: string
          status?: string
          subject_id: string
          teacher_id?: string | null
          updated_at?: string
        }
        Update: {
          academic_year?: string
          created_at?: string
          created_by?: string | null
          id?: string
          institution_id?: string
          label?: string
          status?: string
          subject_id?: string
          teacher_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "optional_batches_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "optional_batches_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "optional_batches_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "universal_subjects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "optional_batches_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      optional_group_subjects: {
        Row: {
          created_at: string
          group_id: string
          id: string
          subject_id: string
        }
        Insert: {
          created_at?: string
          group_id: string
          id?: string
          subject_id: string
        }
        Update: {
          created_at?: string
          group_id?: string
          id?: string
          subject_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "optional_group_subjects_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "optional_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "optional_group_subjects_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "universal_subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      optional_groups: {
        Row: {
          class_group_id: string
          created_at: string
          created_by: string | null
          id: string
          institution_id: string
          name: string
          position: number
          updated_at: string
        }
        Insert: {
          class_group_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          institution_id: string
          name: string
          position?: number
          updated_at?: string
        }
        Update: {
          class_group_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          institution_id?: string
          name?: string
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "optional_groups_class_group_id_fkey"
            columns: ["class_group_id"]
            isOneToOne: false
            referencedRelation: "class_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "optional_groups_class_group_id_fkey"
            columns: ["class_group_id"]
            isOneToOne: false
            referencedRelation: "v_class_groups_with_sections"
            referencedColumns: ["class_group_id"]
          },
          {
            foreignKeyName: "optional_groups_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "optional_groups_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
        ]
      }
      parent_student_links: {
        Row: {
          created_at: string | null
          id: string
          parent_id: string
          relationship: string | null
          student_id: string
          updated_at: string | null
          verified: boolean | null
          verified_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          parent_id: string
          relationship?: string | null
          student_id: string
          updated_at?: string | null
          verified?: boolean | null
          verified_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          parent_id?: string
          relationship?: string | null
          student_id?: string
          updated_at?: string | null
          verified?: boolean | null
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "parent_student_links_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parent_student_links_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      passport_academic_records: {
        Row: {
          academic_year: string
          average_percentage: number
          badges_earned: number
          class_id: string | null
          class_name: string
          created_at: string
          exams_passed: number
          highest_percentage: number
          id: string
          institution_id: string
          rank_in_class: number | null
          rank_in_institution: number | null
          remarks: string | null
          section_name: string | null
          student_id: string
          total_exams: number
          total_points_earned: number
          updated_at: string
        }
        Insert: {
          academic_year: string
          average_percentage?: number
          badges_earned?: number
          class_id?: string | null
          class_name: string
          created_at?: string
          exams_passed?: number
          highest_percentage?: number
          id?: string
          institution_id: string
          rank_in_class?: number | null
          rank_in_institution?: number | null
          remarks?: string | null
          section_name?: string | null
          student_id: string
          total_exams?: number
          total_points_earned?: number
          updated_at?: string
        }
        Update: {
          academic_year?: string
          average_percentage?: number
          badges_earned?: number
          class_id?: string | null
          class_name?: string
          created_at?: string
          exams_passed?: number
          highest_percentage?: number
          id?: string
          institution_id?: string
          rank_in_class?: number | null
          rank_in_institution?: number | null
          remarks?: string | null
          section_name?: string | null
          student_id?: string
          total_exams?: number
          total_points_earned?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "passport_academic_records_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "passport_academic_records_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "passport_academic_records_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      passport_olympiad_entries: {
        Row: {
          campaign_year: number
          certificate_id: string
          certificate_pdf_path: string | null
          certificate_tier: string
          class_rank: number | null
          created_at: string
          id: string
          oly_result_id: string
          percentage: number
          result_pdf_path: string | null
          school_rank: number | null
          student_id: string
          total_marks_obtained: number
          total_max_marks: number
        }
        Insert: {
          campaign_year: number
          certificate_id: string
          certificate_pdf_path?: string | null
          certificate_tier: string
          class_rank?: number | null
          created_at?: string
          id?: string
          oly_result_id: string
          percentage: number
          result_pdf_path?: string | null
          school_rank?: number | null
          student_id: string
          total_marks_obtained: number
          total_max_marks: number
        }
        Update: {
          campaign_year?: number
          certificate_id?: string
          certificate_pdf_path?: string | null
          certificate_tier?: string
          class_rank?: number | null
          created_at?: string
          id?: string
          oly_result_id?: string
          percentage?: number
          result_pdf_path?: string | null
          school_rank?: number | null
          student_id?: string
          total_marks_obtained?: number
          total_max_marks?: number
        }
        Relationships: [
          {
            foreignKeyName: "passport_olympiad_entries_oly_result_id_fkey"
            columns: ["oly_result_id"]
            isOneToOne: false
            referencedRelation: "oly_results"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "passport_olympiad_entries_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      passport_subject_capabilities: {
        Row: {
          accuracy_percent: number
          capability_tier: string
          correct_answers: number
          created_at: string
          id: string
          institution_id: string
          last_exam_date: string | null
          mastery_level: number
          strongest_topics: string[] | null
          student_id: string
          subject_id: string
          subject_name: string
          total_exams: number
          total_questions: number
          updated_at: string
          weakest_topics: string[] | null
          year_wise_data: Json
        }
        Insert: {
          accuracy_percent?: number
          capability_tier?: string
          correct_answers?: number
          created_at?: string
          id?: string
          institution_id: string
          last_exam_date?: string | null
          mastery_level?: number
          strongest_topics?: string[] | null
          student_id: string
          subject_id: string
          subject_name: string
          total_exams?: number
          total_questions?: number
          updated_at?: string
          weakest_topics?: string[] | null
          year_wise_data?: Json
        }
        Update: {
          accuracy_percent?: number
          capability_tier?: string
          correct_answers?: number
          created_at?: string
          id?: string
          institution_id?: string
          last_exam_date?: string | null
          mastery_level?: number
          strongest_topics?: string[] | null
          student_id?: string
          subject_id?: string
          subject_name?: string
          total_exams?: number
          total_questions?: number
          updated_at?: string
          weakest_topics?: string[] | null
          year_wise_data?: Json
        }
        Relationships: [
          {
            foreignKeyName: "passport_subject_capabilities_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "passport_subject_capabilities_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "passport_subject_capabilities_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "universal_subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_receipts: {
        Row: {
          amount: number
          created_at: string | null
          generated_by: string | null
          id: string
          institution_id: string
          payment_date: string
          payment_id: string | null
          payment_method: string | null
          receipt_data: Json | null
          receipt_file_url: string | null
          receipt_number: string
        }
        Insert: {
          amount: number
          created_at?: string | null
          generated_by?: string | null
          id?: string
          institution_id: string
          payment_date: string
          payment_id?: string | null
          payment_method?: string | null
          receipt_data?: Json | null
          receipt_file_url?: string | null
          receipt_number: string
        }
        Update: {
          amount?: number
          created_at?: string | null
          generated_by?: string | null
          id?: string
          institution_id?: string
          payment_date?: string
          payment_id?: string | null
          payment_method?: string | null
          receipt_data?: Json | null
          receipt_file_url?: string | null
          receipt_number?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_receipts_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_receipts_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payment_records"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_records: {
        Row: {
          amount: number
          created_at: string
          currency: string
          description: string | null
          due_date: string | null
          id: string
          institution_id: string | null
          invoice_number: string | null
          metadata: Json | null
          payment_date: string | null
          payment_method: string | null
          payment_type: string
          status: string
          transaction_id: string | null
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          currency?: string
          description?: string | null
          due_date?: string | null
          id?: string
          institution_id?: string | null
          invoice_number?: string | null
          metadata?: Json | null
          payment_date?: string | null
          payment_method?: string | null
          payment_type?: string
          status?: string
          transaction_id?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          description?: string | null
          due_date?: string | null
          id?: string
          institution_id?: string | null
          invoice_number?: string | null
          metadata?: Json | null
          payment_date?: string | null
          payment_method?: string | null
          payment_type?: string
          status?: string
          transaction_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_records_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_entries: {
        Row: {
          attendance_adjustment: number
          attendance_days: number
          basic_salary: number
          da: number
          esi_deduction: number
          gross_salary: number
          hra: number
          id: string
          medical_allowance: number
          net_salary: number
          other_allowances: Json | null
          other_deductions: Json | null
          paid_at: string | null
          payroll_run_id: string
          pf_deduction: number
          professional_tax: number
          special_allowance: number
          status: string
          ta: number
          tds_deduction: number
          user_id: string
          working_days: number
        }
        Insert: {
          attendance_adjustment?: number
          attendance_days?: number
          basic_salary?: number
          da?: number
          esi_deduction?: number
          gross_salary?: number
          hra?: number
          id?: string
          medical_allowance?: number
          net_salary?: number
          other_allowances?: Json | null
          other_deductions?: Json | null
          paid_at?: string | null
          payroll_run_id: string
          pf_deduction?: number
          professional_tax?: number
          special_allowance?: number
          status?: string
          ta?: number
          tds_deduction?: number
          user_id: string
          working_days?: number
        }
        Update: {
          attendance_adjustment?: number
          attendance_days?: number
          basic_salary?: number
          da?: number
          esi_deduction?: number
          gross_salary?: number
          hra?: number
          id?: string
          medical_allowance?: number
          net_salary?: number
          other_allowances?: Json | null
          other_deductions?: Json | null
          paid_at?: string | null
          payroll_run_id?: string
          pf_deduction?: number
          professional_tax?: number
          special_allowance?: number
          status?: string
          ta?: number
          tds_deduction?: number
          user_id?: string
          working_days?: number
        }
        Relationships: [
          {
            foreignKeyName: "payroll_entries_payroll_run_id_fkey"
            columns: ["payroll_run_id"]
            isOneToOne: false
            referencedRelation: "payroll_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_entries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_runs: {
        Row: {
          created_at: string
          id: string
          institution_id: string
          month: number
          run_at: string | null
          run_by: string | null
          status: string
          total_deductions: number
          total_gross: number
          total_net: number
          year: number
        }
        Insert: {
          created_at?: string
          id?: string
          institution_id: string
          month: number
          run_at?: string | null
          run_by?: string | null
          status?: string
          total_deductions?: number
          total_gross?: number
          total_net?: number
          year: number
        }
        Update: {
          created_at?: string
          id?: string
          institution_id?: string
          month?: number
          run_at?: string | null
          run_by?: string | null
          status?: string
          total_deductions?: number
          total_gross?: number
          total_net?: number
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "payroll_runs_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_runs_run_by_fkey"
            columns: ["run_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      proctoring_events: {
        Row: {
          created_at: string
          description: string | null
          duration_seconds: number | null
          event_metadata: Json | null
          event_type: string
          id: string
          occurred_at: string
          question_id: string | null
          screenshot_url: string | null
          session_id: string
          severity: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          duration_seconds?: number | null
          event_metadata?: Json | null
          event_type: string
          id?: string
          occurred_at?: string
          question_id?: string | null
          screenshot_url?: string | null
          session_id: string
          severity?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          duration_seconds?: number | null
          event_metadata?: Json | null
          event_type?: string
          id?: string
          occurred_at?: string
          question_id?: string | null
          screenshot_url?: string | null
          session_id?: string
          severity?: string
        }
        Relationships: [
          {
            foreignKeyName: "proctoring_events_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "exam_questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proctoring_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "proctoring_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      proctoring_review_logs: {
        Row: {
          created_at: string
          decision: string | null
          decision_reason: string | null
          id: string
          marks_deducted: number | null
          new_status: string
          previous_status: string | null
          reviewed_at: string
          reviewed_by: string | null
          session_id: string
        }
        Insert: {
          created_at?: string
          decision?: string | null
          decision_reason?: string | null
          id?: string
          marks_deducted?: number | null
          new_status: string
          previous_status?: string | null
          reviewed_at?: string
          reviewed_by?: string | null
          session_id: string
        }
        Update: {
          created_at?: string
          decision?: string | null
          decision_reason?: string | null
          id?: string
          marks_deducted?: number | null
          new_status?: string
          previous_status?: string | null
          reviewed_at?: string
          reviewed_by?: string | null
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "proctoring_review_logs_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proctoring_review_logs_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "proctoring_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      proctoring_sessions: {
        Row: {
          attempt_id: string
          audio_recording_url: string | null
          browser_info: Json | null
          camera_enabled: boolean | null
          created_at: string
          ended_at: string | null
          high_severity_events: number | null
          id: string
          is_active: boolean | null
          low_severity_events: number | null
          medium_severity_events: number | null
          microphone_enabled: boolean | null
          requires_review: boolean | null
          review_notes: string | null
          review_status: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          screen_share_enabled: boolean | null
          started_at: string
          total_events: number | null
          updated_at: string
          video_recording_url: string | null
        }
        Insert: {
          attempt_id: string
          audio_recording_url?: string | null
          browser_info?: Json | null
          camera_enabled?: boolean | null
          created_at?: string
          ended_at?: string | null
          high_severity_events?: number | null
          id?: string
          is_active?: boolean | null
          low_severity_events?: number | null
          medium_severity_events?: number | null
          microphone_enabled?: boolean | null
          requires_review?: boolean | null
          review_notes?: string | null
          review_status?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          screen_share_enabled?: boolean | null
          started_at?: string
          total_events?: number | null
          updated_at?: string
          video_recording_url?: string | null
        }
        Update: {
          attempt_id?: string
          audio_recording_url?: string | null
          browser_info?: Json | null
          camera_enabled?: boolean | null
          created_at?: string
          ended_at?: string | null
          high_severity_events?: number | null
          id?: string
          is_active?: boolean | null
          low_severity_events?: number | null
          medium_severity_events?: number | null
          microphone_enabled?: boolean | null
          requires_review?: boolean | null
          review_notes?: string | null
          review_status?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          screen_share_enabled?: boolean | null
          started_at?: string
          total_events?: number | null
          updated_at?: string
          video_recording_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "proctoring_sessions_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: true
            referencedRelation: "student_eligible_exams"
            referencedColumns: ["attempt_id"]
          },
          {
            foreignKeyName: "proctoring_sessions_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: true
            referencedRelation: "student_exam_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proctoring_sessions_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          admission_number: string | null
          avatar_path: string | null
          avatar_url: string | null
          created_at: string
          email: string
          full_name: string
          id: string
          institution_id: string | null
          is_active: boolean | null
          last_password_change: string | null
          mascot_dismissed: boolean | null
          mascot_gender: string | null
          mascot_name: string | null
          must_reset_password: boolean | null
          onboarding_completed: boolean | null
          password_expires_at: string | null
          password_set_at: string | null
          phone: string | null
          roll_number: string | null
          tour_steps_completed: Json | null
          updated_at: string
        }
        Insert: {
          admission_number?: string | null
          avatar_path?: string | null
          avatar_url?: string | null
          created_at?: string
          email: string
          full_name: string
          id: string
          institution_id?: string | null
          is_active?: boolean | null
          last_password_change?: string | null
          mascot_dismissed?: boolean | null
          mascot_gender?: string | null
          mascot_name?: string | null
          must_reset_password?: boolean | null
          onboarding_completed?: boolean | null
          password_expires_at?: string | null
          password_set_at?: string | null
          phone?: string | null
          roll_number?: string | null
          tour_steps_completed?: Json | null
          updated_at?: string
        }
        Update: {
          admission_number?: string | null
          avatar_path?: string | null
          avatar_url?: string | null
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          institution_id?: string | null
          is_active?: boolean | null
          last_password_change?: string | null
          mascot_dismissed?: boolean | null
          mascot_gender?: string | null
          mascot_name?: string | null
          must_reset_password?: boolean | null
          onboarding_completed?: boolean | null
          password_expires_at?: string | null
          password_set_at?: string | null
          phone?: string | null
          roll_number?: string | null
          tour_steps_completed?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
        ]
      }
      ptm_bookings: {
        Row: {
          created_at: string
          feedback: string | null
          id: string
          notes: string | null
          parent_id: string
          ptm_id: string
          rating: number | null
          slot_time: string
          status: string
          teacher_id: string | null
        }
        Insert: {
          created_at?: string
          feedback?: string | null
          id?: string
          notes?: string | null
          parent_id: string
          ptm_id: string
          rating?: number | null
          slot_time: string
          status?: string
          teacher_id?: string | null
        }
        Update: {
          created_at?: string
          feedback?: string | null
          id?: string
          notes?: string | null
          parent_id?: string
          ptm_id?: string
          rating?: number | null
          slot_time?: string
          status?: string
          teacher_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ptm_bookings_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ptm_bookings_ptm_id_fkey"
            columns: ["ptm_id"]
            isOneToOne: false
            referencedRelation: "ptm_schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ptm_bookings_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ptm_notifications_sent: {
        Row: {
          id: string
          notification_type: string
          ptm_id: string
          recipient_id: string
          sent_at: string
        }
        Insert: {
          id?: string
          notification_type: string
          ptm_id: string
          recipient_id: string
          sent_at?: string
        }
        Update: {
          id?: string
          notification_type?: string
          ptm_id?: string
          recipient_id?: string
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ptm_notifications_sent_ptm_id_fkey"
            columns: ["ptm_id"]
            isOneToOne: false
            referencedRelation: "ptm_schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ptm_notifications_sent_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ptm_schedule_classes: {
        Row: {
          class_id: string
          id: string
          ptm_id: string
        }
        Insert: {
          class_id: string
          id?: string
          ptm_id: string
        }
        Update: {
          class_id?: string
          id?: string
          ptm_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ptm_schedule_classes_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ptm_schedule_classes_ptm_id_fkey"
            columns: ["ptm_id"]
            isOneToOne: false
            referencedRelation: "ptm_schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      ptm_schedules: {
        Row: {
          class_id: string | null
          created_at: string
          created_by: string | null
          description: string | null
          end_time: string
          id: string
          institution_id: string
          scheduled_date: string
          slot_duration_minutes: number
          start_time: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          class_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          end_time: string
          id?: string
          institution_id: string
          scheduled_date: string
          slot_duration_minutes?: number
          start_time: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          class_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          end_time?: string
          id?: string
          institution_id?: string
          scheduled_date?: string
          slot_duration_minutes?: number
          start_time?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ptm_schedules_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ptm_schedules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ptm_schedules_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth_key: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          user_id: string
        }
        Insert: {
          auth_key: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          user_id: string
        }
        Update: {
          auth_key?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          user_id?: string
        }
        Relationships: []
      }
      question_bank: {
        Row: {
          chapter_topic_id: string | null
          class_group_id: string | null
          correct_answer: string | null
          created_at: string | null
          created_by: string | null
          difficulty_level: number | null
          explanation: string | null
          grade_level_id: string | null
          id: string
          image_url: string | null
          institution_id: string | null
          is_approved: boolean | null
          marks: number | null
          options: Json | null
          parent_question_id: string | null
          question_text: string
          question_type: Database["public"]["Enums"]["question_type"]
          sequence_order: number | null
          source: string
          sub_question_count: number | null
          subject_id: string | null
          tags: string[] | null
          topic_id: string | null
          updated_at: string | null
        }
        Insert: {
          chapter_topic_id?: string | null
          class_group_id?: string | null
          correct_answer?: string | null
          created_at?: string | null
          created_by?: string | null
          difficulty_level?: number | null
          explanation?: string | null
          grade_level_id?: string | null
          id?: string
          image_url?: string | null
          institution_id?: string | null
          is_approved?: boolean | null
          marks?: number | null
          options?: Json | null
          parent_question_id?: string | null
          question_text: string
          question_type?: Database["public"]["Enums"]["question_type"]
          sequence_order?: number | null
          source?: string
          sub_question_count?: number | null
          subject_id?: string | null
          tags?: string[] | null
          topic_id?: string | null
          updated_at?: string | null
        }
        Update: {
          chapter_topic_id?: string | null
          class_group_id?: string | null
          correct_answer?: string | null
          created_at?: string | null
          created_by?: string | null
          difficulty_level?: number | null
          explanation?: string | null
          grade_level_id?: string | null
          id?: string
          image_url?: string | null
          institution_id?: string | null
          is_approved?: boolean | null
          marks?: number | null
          options?: Json | null
          parent_question_id?: string | null
          question_text?: string
          question_type?: Database["public"]["Enums"]["question_type"]
          sequence_order?: number | null
          source?: string
          sub_question_count?: number | null
          subject_id?: string | null
          tags?: string[] | null
          topic_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "question_bank_chapter_topic_id_fkey"
            columns: ["chapter_topic_id"]
            isOneToOne: false
            referencedRelation: "chapter_topics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "question_bank_class_group_id_fkey"
            columns: ["class_group_id"]
            isOneToOne: false
            referencedRelation: "class_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "question_bank_class_group_id_fkey"
            columns: ["class_group_id"]
            isOneToOne: false
            referencedRelation: "v_class_groups_with_sections"
            referencedColumns: ["class_group_id"]
          },
          {
            foreignKeyName: "question_bank_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "question_bank_grade_level_id_fkey"
            columns: ["grade_level_id"]
            isOneToOne: false
            referencedRelation: "grade_levels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "question_bank_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "question_bank_parent_question_id_fkey"
            columns: ["parent_question_id"]
            isOneToOne: false
            referencedRelation: "question_bank"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "question_bank_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "universal_subjects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "question_bank_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "syllabus_topics"
            referencedColumns: ["id"]
          },
        ]
      }
      question_bank_section_scope: {
        Row: {
          class_id: string
          created_at: string
          id: string
          question_id: string
        }
        Insert: {
          class_id: string
          created_at?: string
          id?: string
          question_id: string
        }
        Update: {
          class_id?: string
          created_at?: string
          id?: string
          question_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "question_bank_section_scope_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "question_bank_section_scope_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "question_bank"
            referencedColumns: ["id"]
          },
        ]
      }
      recheck_requests: {
        Row: {
          id: string
          marks_changed: boolean | null
          new_marks: number | null
          previous_marks: number | null
          question_id: string | null
          request_reason: string
          requested_at: string
          requested_by: string | null
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          result_id: string
          status: string
        }
        Insert: {
          id?: string
          marks_changed?: boolean | null
          new_marks?: number | null
          previous_marks?: number | null
          question_id?: string | null
          request_reason: string
          requested_at?: string
          requested_by?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          result_id: string
          status?: string
        }
        Update: {
          id?: string
          marks_changed?: boolean | null
          new_marks?: number | null
          previous_marks?: number | null
          question_id?: string | null
          request_reason?: string
          requested_at?: string
          requested_by?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          result_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "recheck_requests_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "exam_questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recheck_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recheck_requests_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recheck_requests_result_id_fkey"
            columns: ["result_id"]
            isOneToOne: false
            referencedRelation: "final_results"
            referencedColumns: ["id"]
          },
        ]
      }
      reported_issues: {
        Row: {
          admin_notes: string | null
          category: string | null
          classes_assigned: string | null
          created_at: string
          description: string
          first_response_at: string | null
          id: string
          institution_id: string | null
          institution_name: string | null
          last_message_at: string | null
          pinned_to_inbox: boolean
          priority: number | null
          reporter_email: string | null
          reporter_id: string | null
          reporter_last_read_at: string | null
          reporter_name: string | null
          reporter_role: string | null
          resolved_at: string | null
          salci_last_read_at: string | null
          status: string
          subject: string
          task_id: string | null
          updated_at: string
        }
        Insert: {
          admin_notes?: string | null
          category?: string | null
          classes_assigned?: string | null
          created_at?: string
          description: string
          first_response_at?: string | null
          id?: string
          institution_id?: string | null
          institution_name?: string | null
          last_message_at?: string | null
          pinned_to_inbox?: boolean
          priority?: number | null
          reporter_email?: string | null
          reporter_id?: string | null
          reporter_last_read_at?: string | null
          reporter_name?: string | null
          reporter_role?: string | null
          resolved_at?: string | null
          salci_last_read_at?: string | null
          status?: string
          subject: string
          task_id?: string | null
          updated_at?: string
        }
        Update: {
          admin_notes?: string | null
          category?: string | null
          classes_assigned?: string | null
          created_at?: string
          description?: string
          first_response_at?: string | null
          id?: string
          institution_id?: string | null
          institution_name?: string | null
          last_message_at?: string | null
          pinned_to_inbox?: boolean
          priority?: number | null
          reporter_email?: string | null
          reporter_id?: string | null
          reporter_last_read_at?: string | null
          reporter_name?: string | null
          reporter_role?: string | null
          resolved_at?: string | null
          salci_last_read_at?: string | null
          status?: string
          subject?: string
          task_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reported_issues_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      school_aggregates: {
        Row: {
          avg_school_accuracy: number
          avg_school_efficiency: number
          avg_school_pass_rate: number
          computed_at: string
          created_at: string
          grade_section_heatmap: Json | null
          grade_section_performance: Json | null
          id: string
          institution_id: string
          period_end: string
          period_start: string
          subject_overview: Json | null
          subject_performance: Json | null
          teacher_effectiveness: Json | null
          top_performing_classes: Json | null
          total_attempts: number
          total_exams: number
          total_students_active: number
          total_teachers_active: number
          underperforming_classes: Json | null
        }
        Insert: {
          avg_school_accuracy?: number
          avg_school_efficiency?: number
          avg_school_pass_rate?: number
          computed_at?: string
          created_at?: string
          grade_section_heatmap?: Json | null
          grade_section_performance?: Json | null
          id?: string
          institution_id: string
          period_end: string
          period_start: string
          subject_overview?: Json | null
          subject_performance?: Json | null
          teacher_effectiveness?: Json | null
          top_performing_classes?: Json | null
          total_attempts?: number
          total_exams?: number
          total_students_active?: number
          total_teachers_active?: number
          underperforming_classes?: Json | null
        }
        Update: {
          avg_school_accuracy?: number
          avg_school_efficiency?: number
          avg_school_pass_rate?: number
          computed_at?: string
          created_at?: string
          grade_section_heatmap?: Json | null
          grade_section_performance?: Json | null
          id?: string
          institution_id?: string
          period_end?: string
          period_start?: string
          subject_overview?: Json | null
          subject_performance?: Json | null
          teacher_effectiveness?: Json | null
          top_performing_classes?: Json | null
          total_attempts?: number
          total_exams?: number
          total_students_active?: number
          total_teachers_active?: number
          underperforming_classes?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "school_aggregates_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
        ]
      }
      school_custom_topics: {
        Row: {
          created_at: string | null
          created_by: string | null
          description: string | null
          grade_level_id: string
          id: string
          institution_id: string
          is_active: boolean | null
          merged_into: string | null
          source: string | null
          status: string | null
          subject_id: string
          topic_name: string
          topic_name_local: string | null
          updated_at: string | null
          usage_count: number | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          grade_level_id: string
          id?: string
          institution_id: string
          is_active?: boolean | null
          merged_into?: string | null
          source?: string | null
          status?: string | null
          subject_id: string
          topic_name: string
          topic_name_local?: string | null
          updated_at?: string | null
          usage_count?: number | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          grade_level_id?: string
          id?: string
          institution_id?: string
          is_active?: boolean | null
          merged_into?: string | null
          source?: string | null
          status?: string | null
          subject_id?: string
          topic_name?: string
          topic_name_local?: string | null
          updated_at?: string | null
          usage_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "school_custom_topics_grade_level_id_fkey"
            columns: ["grade_level_id"]
            isOneToOne: false
            referencedRelation: "grade_levels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "school_custom_topics_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "school_custom_topics_merged_into_fkey"
            columns: ["merged_into"]
            isOneToOne: false
            referencedRelation: "school_custom_topics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "school_custom_topics_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "universal_subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_attendance_records: {
        Row: {
          auto_marked_absent: boolean
          check_in_at: string | null
          check_out_at: string | null
          created_at: string
          date: string
          id: string
          institution_id: string
          remarks: string | null
          staff_id: string
          status: string
          updated_at: string
        }
        Insert: {
          auto_marked_absent?: boolean
          check_in_at?: string | null
          check_out_at?: string | null
          created_at?: string
          date: string
          id?: string
          institution_id: string
          remarks?: string | null
          staff_id: string
          status: string
          updated_at?: string
        }
        Update: {
          auto_marked_absent?: boolean
          check_in_at?: string | null
          check_out_at?: string | null
          created_at?: string
          date?: string
          id?: string
          institution_id?: string
          remarks?: string | null
          staff_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_attendance_records_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_attendance_records_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_documents: {
        Row: {
          document_name: string
          document_type: string
          file_path: string
          id: string
          institution_id: string
          uploaded_at: string
          uploaded_by: string | null
          user_id: string
        }
        Insert: {
          document_name: string
          document_type: string
          file_path: string
          id?: string
          institution_id: string
          uploaded_at?: string
          uploaded_by?: string | null
          user_id: string
        }
        Update: {
          document_name?: string
          document_type?: string
          file_path?: string
          id?: string
          institution_id?: string
          uploaded_at?: string
          uploaded_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_documents_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_documents_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_leave_balances: {
        Row: {
          academic_year: string
          annual_total: number
          annual_used: number
          casual_total: number
          casual_used: number
          created_at: string
          id: string
          institution_id: string
          sick_total: number
          sick_used: number
          updated_at: string
          user_id: string
        }
        Insert: {
          academic_year: string
          annual_total?: number
          annual_used?: number
          casual_total?: number
          casual_used?: number
          created_at?: string
          id?: string
          institution_id: string
          sick_total?: number
          sick_used?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          academic_year?: string
          annual_total?: number
          annual_used?: number
          casual_total?: number
          casual_used?: number
          created_at?: string
          id?: string
          institution_id?: string
          sick_total?: number
          sick_used?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_leave_balances_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_leave_balances_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_leave_requests: {
        Row: {
          created_at: string
          end_date: string
          id: string
          institution_id: string
          leave_type: string
          reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          reviewer_notes: string | null
          start_date: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          end_date: string
          id?: string
          institution_id: string
          leave_type: string
          reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_notes?: string | null
          start_date: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          end_date?: string
          id?: string
          institution_id?: string
          leave_type?: string
          reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_notes?: string | null
          start_date?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_leave_requests_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_leave_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_leave_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_manager_overrides: {
        Row: {
          created_at: string
          institution_id: string
          note: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          institution_id: string
          note?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          institution_id?: string
          note?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_manager_overrides_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_manager_overrides_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_salary_assignments: {
        Row: {
          bank_account_number: string | null
          bank_name: string | null
          created_at: string
          effective_from: string
          effective_to: string | null
          id: string
          ifsc_code: string | null
          institution_id: string
          override_basic: number | null
          override_hra: number | null
          pan_number: string | null
          salary_structure_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          bank_account_number?: string | null
          bank_name?: string | null
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          ifsc_code?: string | null
          institution_id: string
          override_basic?: number | null
          override_hra?: number | null
          pan_number?: string | null
          salary_structure_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          bank_account_number?: string | null
          bank_name?: string | null
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          ifsc_code?: string | null
          institution_id?: string
          override_basic?: number | null
          override_hra?: number | null
          pan_number?: string | null
          salary_structure_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_salary_assignments_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_salary_assignments_salary_structure_id_fkey"
            columns: ["salary_structure_id"]
            isOneToOne: false
            referencedRelation: "staff_salary_structures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_salary_assignments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_salary_structures: {
        Row: {
          basic_salary: number
          created_at: string
          da: number
          esi_percentage: number
          hra: number
          id: string
          institution_id: string
          is_active: boolean
          medical_allowance: number
          name: string
          other_allowances: Json | null
          other_deductions: Json | null
          pf_percentage: number
          professional_tax: number
          special_allowance: number
          ta: number
          tds_percentage: number
          updated_at: string
        }
        Insert: {
          basic_salary?: number
          created_at?: string
          da?: number
          esi_percentage?: number
          hra?: number
          id?: string
          institution_id: string
          is_active?: boolean
          medical_allowance?: number
          name: string
          other_allowances?: Json | null
          other_deductions?: Json | null
          pf_percentage?: number
          professional_tax?: number
          special_allowance?: number
          ta?: number
          tds_percentage?: number
          updated_at?: string
        }
        Update: {
          basic_salary?: number
          created_at?: string
          da?: number
          esi_percentage?: number
          hra?: number
          id?: string
          institution_id?: string
          is_active?: boolean
          medical_allowance?: number
          name?: string
          other_allowances?: Json | null
          other_deductions?: Json | null
          pf_percentage?: number
          professional_tax?: number
          special_allowance?: number
          ta?: number
          tds_percentage?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_salary_structures_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
        ]
      }
      student_activity_daily: {
        Row: {
          activity_date: string
          created_at: string
          institution_id: string | null
          source: string
          student_id: string
        }
        Insert: {
          activity_date: string
          created_at?: string
          institution_id?: string | null
          source?: string
          student_id: string
        }
        Update: {
          activity_date?: string
          created_at?: string
          institution_id?: string | null
          source?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_activity_daily_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_activity_daily_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      student_answers: {
        Row: {
          answer_file_url: string | null
          answer_options: Json | null
          answer_source: Database["public"]["Enums"]["answer_source"]
          answer_text: string | null
          answered_at: string | null
          attempt_id: string
          id: string
          ocr_confidence: number | null
          ocr_extracted_text: string | null
          ocr_needs_review: boolean | null
          question_id: string
          updated_at: string | null
        }
        Insert: {
          answer_file_url?: string | null
          answer_options?: Json | null
          answer_source?: Database["public"]["Enums"]["answer_source"]
          answer_text?: string | null
          answered_at?: string | null
          attempt_id: string
          id?: string
          ocr_confidence?: number | null
          ocr_extracted_text?: string | null
          ocr_needs_review?: boolean | null
          question_id: string
          updated_at?: string | null
        }
        Update: {
          answer_file_url?: string | null
          answer_options?: Json | null
          answer_source?: Database["public"]["Enums"]["answer_source"]
          answer_text?: string | null
          answered_at?: string | null
          attempt_id?: string
          id?: string
          ocr_confidence?: number | null
          ocr_extracted_text?: string | null
          ocr_needs_review?: boolean | null
          question_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "student_answers_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "student_eligible_exams"
            referencedColumns: ["attempt_id"]
          },
          {
            foreignKeyName: "student_answers_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "student_exam_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_answers_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "exam_questions"
            referencedColumns: ["id"]
          },
        ]
      }
      student_exam_attempts: {
        Row: {
          answer_sheet_url: string | null
          auto_submitted: boolean | null
          class_id: string
          created_at: string
          device_info: Json | null
          evaluation_status: Database["public"]["Enums"]["evaluation_status"]
          exam_id: string
          finalized_at: string | null
          finalized_by: string | null
          id: string
          is_finalized: boolean
          is_locked: boolean | null
          is_offline: boolean | null
          is_submitted: boolean
          last_activity_at: string | null
          lock_reason: string | null
          locked_at: string | null
          ocr_confidence_overall: number | null
          ocr_processed: boolean | null
          started_at: string | null
          student_id: string
          submission_ip: string | null
          submitted_at: string | null
          time_spent_seconds: number | null
          updated_at: string
        }
        Insert: {
          answer_sheet_url?: string | null
          auto_submitted?: boolean | null
          class_id: string
          created_at?: string
          device_info?: Json | null
          evaluation_status?: Database["public"]["Enums"]["evaluation_status"]
          exam_id: string
          finalized_at?: string | null
          finalized_by?: string | null
          id?: string
          is_finalized?: boolean
          is_locked?: boolean | null
          is_offline?: boolean | null
          is_submitted?: boolean
          last_activity_at?: string | null
          lock_reason?: string | null
          locked_at?: string | null
          ocr_confidence_overall?: number | null
          ocr_processed?: boolean | null
          started_at?: string | null
          student_id: string
          submission_ip?: string | null
          submitted_at?: string | null
          time_spent_seconds?: number | null
          updated_at?: string
        }
        Update: {
          answer_sheet_url?: string | null
          auto_submitted?: boolean | null
          class_id?: string
          created_at?: string
          device_info?: Json | null
          evaluation_status?: Database["public"]["Enums"]["evaluation_status"]
          exam_id?: string
          finalized_at?: string | null
          finalized_by?: string | null
          id?: string
          is_finalized?: boolean
          is_locked?: boolean | null
          is_offline?: boolean | null
          is_submitted?: boolean
          last_activity_at?: string | null
          lock_reason?: string | null
          locked_at?: string | null
          ocr_confidence_overall?: number | null
          ocr_processed?: boolean | null
          started_at?: string | null
          student_id?: string
          submission_ip?: string | null
          submitted_at?: string | null
          time_spent_seconds?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_exam_attempts_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_exam_attempts_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_exam_attempts_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "student_eligible_exams"
            referencedColumns: ["exam_id"]
          },
          {
            foreignKeyName: "student_exam_attempts_finalized_by_fkey"
            columns: ["finalized_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_exam_attempts_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      student_fee_assignments: {
        Row: {
          assigned_by: string | null
          created_at: string
          discount_amount: number
          discount_reason: string | null
          fee_structure_id: string
          id: string
          institution_id: string
          status: string
          student_id: string
          total_amount: number
        }
        Insert: {
          assigned_by?: string | null
          created_at?: string
          discount_amount?: number
          discount_reason?: string | null
          fee_structure_id: string
          id?: string
          institution_id: string
          status?: string
          student_id: string
          total_amount?: number
        }
        Update: {
          assigned_by?: string | null
          created_at?: string
          discount_amount?: number
          discount_reason?: string | null
          fee_structure_id?: string
          id?: string
          institution_id?: string
          status?: string
          student_id?: string
          total_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "student_fee_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_fee_assignments_fee_structure_id_fkey"
            columns: ["fee_structure_id"]
            isOneToOne: false
            referencedRelation: "fee_structures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_fee_assignments_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_fee_assignments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      student_groups: {
        Row: {
          class_id: string
          created_at: string
          description: string | null
          id: string
          name: string
        }
        Insert: {
          class_id: string
          created_at?: string
          description?: string | null
          id?: string
          name: string
        }
        Update: {
          class_id?: string
          created_at?: string
          description?: string | null
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_groups_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
        ]
      }
      student_manager_overrides: {
        Row: {
          created_at: string
          institution_id: string
          note: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          institution_id: string
          note?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          institution_id?: string
          note?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_manager_overrides_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_manager_overrides_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      student_optional_enrollments: {
        Row: {
          academic_year: string | null
          assigned_by: string | null
          class_id: string | null
          classification: string
          created_at: string
          id: string
          institution_id: string
          is_active: boolean
          student_id: string
          subject_id: string
          updated_at: string
        }
        Insert: {
          academic_year?: string | null
          assigned_by?: string | null
          class_id?: string | null
          classification?: string
          created_at?: string
          id?: string
          institution_id: string
          is_active?: boolean
          student_id: string
          subject_id: string
          updated_at?: string
        }
        Update: {
          academic_year?: string | null
          assigned_by?: string | null
          class_id?: string | null
          classification?: string
          created_at?: string
          id?: string
          institution_id?: string
          is_active?: boolean
          student_id?: string
          subject_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_optional_enrollments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_optional_enrollments_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_optional_enrollments_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_optional_enrollments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_optional_enrollments_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "universal_subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      student_passport: {
        Row: {
          average_percentage: number | null
          created_at: string
          highest_percentage: number | null
          id: string
          improvement_rate: number | null
          institution_id: string
          last_active_at: string | null
          login_streak_current: number | null
          login_streak_max: number | null
          passport_level: string | null
          rank_in_class: number | null
          rank_in_institution: number | null
          student_id: string
          subjects_mastered: string[] | null
          total_badges_earned: number | null
          total_exams_passed: number
          total_exams_taken: number
          total_points: number | null
          total_study_hours: number | null
          updated_at: string
        }
        Insert: {
          average_percentage?: number | null
          created_at?: string
          highest_percentage?: number | null
          id?: string
          improvement_rate?: number | null
          institution_id: string
          last_active_at?: string | null
          login_streak_current?: number | null
          login_streak_max?: number | null
          passport_level?: string | null
          rank_in_class?: number | null
          rank_in_institution?: number | null
          student_id: string
          subjects_mastered?: string[] | null
          total_badges_earned?: number | null
          total_exams_passed?: number
          total_exams_taken?: number
          total_points?: number | null
          total_study_hours?: number | null
          updated_at?: string
        }
        Update: {
          average_percentage?: number | null
          created_at?: string
          highest_percentage?: number | null
          id?: string
          improvement_rate?: number | null
          institution_id?: string
          last_active_at?: string | null
          login_streak_current?: number | null
          login_streak_max?: number | null
          passport_level?: string | null
          rank_in_class?: number | null
          rank_in_institution?: number | null
          student_id?: string
          subjects_mastered?: string[] | null
          total_badges_earned?: number | null
          total_exams_passed?: number
          total_exams_taken?: number
          total_points?: number | null
          total_study_hours?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_passport_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_passport_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      student_performance_snapshots: {
        Row: {
          accuracy_percent: number
          attempt_id: string
          avg_time_per_question_seconds: number
          class_avg_accuracy: number | null
          class_id: string
          created_at: string
          deviation_from_class: number | null
          deviation_from_topper: number | null
          efficiency_score: number
          exam_id: string
          id: string
          questions_attempted: number
          questions_correct: number
          questions_skipped: number
          snapshot_at: string
          student_id: string
          subject_breakdown: Json | null
          topper_accuracy: number | null
          total_questions: number
          total_time_seconds: number
        }
        Insert: {
          accuracy_percent?: number
          attempt_id: string
          avg_time_per_question_seconds?: number
          class_avg_accuracy?: number | null
          class_id: string
          created_at?: string
          deviation_from_class?: number | null
          deviation_from_topper?: number | null
          efficiency_score?: number
          exam_id: string
          id?: string
          questions_attempted?: number
          questions_correct?: number
          questions_skipped?: number
          snapshot_at?: string
          student_id: string
          subject_breakdown?: Json | null
          topper_accuracy?: number | null
          total_questions?: number
          total_time_seconds?: number
        }
        Update: {
          accuracy_percent?: number
          attempt_id?: string
          avg_time_per_question_seconds?: number
          class_avg_accuracy?: number | null
          class_id?: string
          created_at?: string
          deviation_from_class?: number | null
          deviation_from_topper?: number | null
          efficiency_score?: number
          exam_id?: string
          id?: string
          questions_attempted?: number
          questions_correct?: number
          questions_skipped?: number
          snapshot_at?: string
          student_id?: string
          subject_breakdown?: Json | null
          topper_accuracy?: number | null
          total_questions?: number
          total_time_seconds?: number
        }
        Relationships: [
          {
            foreignKeyName: "student_performance_snapshots_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: true
            referencedRelation: "student_eligible_exams"
            referencedColumns: ["attempt_id"]
          },
          {
            foreignKeyName: "student_performance_snapshots_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: true
            referencedRelation: "student_exam_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_performance_snapshots_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_performance_snapshots_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_performance_snapshots_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "student_eligible_exams"
            referencedColumns: ["exam_id"]
          },
          {
            foreignKeyName: "student_performance_snapshots_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      student_personal_details: {
        Row: {
          date_of_birth: string | null
          guardian_email: string | null
          guardian_name: string | null
          guardian_phone: string | null
          profile_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          date_of_birth?: string | null
          guardian_email?: string | null
          guardian_name?: string | null
          guardian_phone?: string | null
          profile_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          date_of_birth?: string | null
          guardian_email?: string | null
          guardian_name?: string | null
          guardian_phone?: string | null
          profile_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "student_personal_details_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_personal_details_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      student_remarks: {
        Row: {
          category: string
          created_at: string | null
          exam_id: string | null
          id: string
          institution_id: string
          remark_text: string
          student_id: string
          subject_id: string | null
          teacher_id: string
          updated_at: string | null
        }
        Insert: {
          category?: string
          created_at?: string | null
          exam_id?: string | null
          id?: string
          institution_id: string
          remark_text: string
          student_id: string
          subject_id?: string | null
          teacher_id: string
          updated_at?: string | null
        }
        Update: {
          category?: string
          created_at?: string | null
          exam_id?: string | null
          id?: string
          institution_id?: string
          remark_text?: string
          student_id?: string
          subject_id?: string | null
          teacher_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "student_remarks_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_remarks_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "student_eligible_exams"
            referencedColumns: ["exam_id"]
          },
          {
            foreignKeyName: "student_remarks_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_remarks_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_remarks_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "universal_subjects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_remarks_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      student_topic_performance: {
        Row: {
          accuracy_percentage: number | null
          avg_time_per_question_seconds: number | null
          created_at: string
          exam_id: string
          id: string
          questions_attempted: number | null
          questions_correct: number | null
          student_id: string
          topic_tag: string
          total_marks_obtained: number | null
          total_marks_possible: number | null
        }
        Insert: {
          accuracy_percentage?: number | null
          avg_time_per_question_seconds?: number | null
          created_at?: string
          exam_id: string
          id?: string
          questions_attempted?: number | null
          questions_correct?: number | null
          student_id: string
          topic_tag: string
          total_marks_obtained?: number | null
          total_marks_possible?: number | null
        }
        Update: {
          accuracy_percentage?: number | null
          avg_time_per_question_seconds?: number | null
          created_at?: string
          exam_id?: string
          id?: string
          questions_attempted?: number | null
          questions_correct?: number | null
          student_id?: string
          topic_tag?: string
          total_marks_obtained?: number | null
          total_marks_possible?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "student_topic_performance_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_topic_performance_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "student_eligible_exams"
            referencedColumns: ["exam_id"]
          },
          {
            foreignKeyName: "student_topic_performance_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      study_materials: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          external_link: string | null
          file_url: string | null
          grade_level_id: string | null
          id: string
          institution_id: string | null
          is_active: boolean | null
          material_type: string | null
          publisher: string | null
          subject_id: string | null
          title: string
          topic_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          external_link?: string | null
          file_url?: string | null
          grade_level_id?: string | null
          id?: string
          institution_id?: string | null
          is_active?: boolean | null
          material_type?: string | null
          publisher?: string | null
          subject_id?: string | null
          title: string
          topic_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          external_link?: string | null
          file_url?: string | null
          grade_level_id?: string | null
          id?: string
          institution_id?: string | null
          is_active?: boolean | null
          material_type?: string | null
          publisher?: string | null
          subject_id?: string | null
          title?: string
          topic_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "study_materials_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "study_materials_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "study_materials_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "universal_subjects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "study_materials_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "syllabus_topics"
            referencedColumns: ["id"]
          },
        ]
      }
      subject_class_group_mappings: {
        Row: {
          class_group_id: string
          created_at: string
          id: string
          institution_id: string
          is_optional: boolean
          subject_id: string
        }
        Insert: {
          class_group_id: string
          created_at?: string
          id?: string
          institution_id: string
          is_optional?: boolean
          subject_id: string
        }
        Update: {
          class_group_id?: string
          created_at?: string
          id?: string
          institution_id?: string
          is_optional?: boolean
          subject_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subject_class_group_mappings_class_group_id_fkey"
            columns: ["class_group_id"]
            isOneToOne: false
            referencedRelation: "class_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subject_class_group_mappings_class_group_id_fkey"
            columns: ["class_group_id"]
            isOneToOne: false
            referencedRelation: "v_class_groups_with_sections"
            referencedColumns: ["class_group_id"]
          },
          {
            foreignKeyName: "subject_class_group_mappings_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subject_class_group_mappings_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "universal_subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      subject_class_mappings: {
        Row: {
          class_id: string
          created_at: string | null
          id: string
          institution_id: string
          is_optional: boolean
          subject_id: string
        }
        Insert: {
          class_id: string
          created_at?: string | null
          id?: string
          institution_id: string
          is_optional?: boolean
          subject_id: string
        }
        Update: {
          class_id?: string
          created_at?: string | null
          id?: string
          institution_id?: string
          is_optional?: boolean
          subject_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subject_class_mappings_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subject_class_mappings_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subject_class_mappings_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "universal_subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      subjects: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          institution_id: string
          is_active: boolean | null
          is_universal: boolean
          name: string
          universal_subject_id: string | null
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          institution_id: string
          is_active?: boolean | null
          is_universal?: boolean
          name: string
          universal_subject_id?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          institution_id?: string
          is_active?: boolean | null
          is_universal?: boolean
          name?: string
          universal_subject_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subjects_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subjects_universal_subject_id_fkey"
            columns: ["universal_subject_id"]
            isOneToOne: false
            referencedRelation: "universal_subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_alerts: {
        Row: {
          alert_type: string
          created_at: string | null
          due_date: string | null
          id: string
          institution_id: string
          is_dismissed: boolean | null
          is_read: boolean | null
          message: string
          metadata: Json | null
        }
        Insert: {
          alert_type: string
          created_at?: string | null
          due_date?: string | null
          id?: string
          institution_id: string
          is_dismissed?: boolean | null
          is_read?: boolean | null
          message: string
          metadata?: Json | null
        }
        Update: {
          alert_type?: string
          created_at?: string | null
          due_date?: string | null
          id?: string
          institution_id?: string
          is_dismissed?: boolean | null
          is_read?: boolean | null
          message?: string
          metadata?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "subscription_alerts_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
        ]
      }
      support_health_events: {
        Row: {
          actor_id: string | null
          created_at: string
          detail: string | null
          id: string
          kind: string
          page_url: string | null
          ticket_id: string | null
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          detail?: string | null
          id?: string
          kind: string
          page_url?: string | null
          ticket_id?: string | null
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          detail?: string | null
          id?: string
          kind?: string
          page_url?: string | null
          ticket_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "support_health_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_health_events_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "reported_issues"
            referencedColumns: ["id"]
          },
        ]
      }
      support_messages: {
        Row: {
          attachments: Json
          author_id: string | null
          author_name: string | null
          author_side: string
          body: string
          client_token: string | null
          created_at: string
          id: string
          is_internal: boolean
          kind: string
          ticket_id: string
        }
        Insert: {
          attachments?: Json
          author_id?: string | null
          author_name?: string | null
          author_side: string
          body: string
          client_token?: string | null
          created_at?: string
          id?: string
          is_internal?: boolean
          kind?: string
          ticket_id: string
        }
        Update: {
          attachments?: Json
          author_id?: string | null
          author_name?: string | null
          author_side?: string
          body?: string
          client_token?: string | null
          created_at?: string
          id?: string
          is_internal?: boolean
          kind?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_messages_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_messages_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "reported_issues"
            referencedColumns: ["id"]
          },
        ]
      }
      support_settings: {
        Row: {
          id: boolean
          owner_id: string
          stats_since: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          id?: boolean
          owner_id: string
          stats_since?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          id?: boolean
          owner_id?: string
          stats_since?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "support_settings_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      syllabus_manager_overrides: {
        Row: {
          created_at: string
          institution_id: string
          note: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          institution_id: string
          note?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          institution_id?: string
          note?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "syllabus_manager_overrides_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "syllabus_manager_overrides_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      syllabus_progress_events: {
        Row: {
          action: string
          class_id: string
          created_at: string
          date: string
          id: string
          institution_id: string
          recorded_by: string | null
          source: string
          subject_id: string
          topic_id: string
          updated_at: string
        }
        Insert: {
          action: string
          class_id: string
          created_at?: string
          date: string
          id?: string
          institution_id: string
          recorded_by?: string | null
          source: string
          subject_id: string
          topic_id: string
          updated_at?: string
        }
        Update: {
          action?: string
          class_id?: string
          created_at?: string
          date?: string
          id?: string
          institution_id?: string
          recorded_by?: string | null
          source?: string
          subject_id?: string
          topic_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "syllabus_progress_events_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "syllabus_progress_events_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "syllabus_progress_events_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "syllabus_progress_events_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "universal_subjects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "syllabus_progress_events_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "syllabus_topics"
            referencedColumns: ["id"]
          },
        ]
      }
      syllabus_segment_chapters: {
        Row: {
          chapter_id: string
          created_at: string
          id: string
          segment_id: string
        }
        Insert: {
          chapter_id: string
          created_at?: string
          id?: string
          segment_id: string
        }
        Update: {
          chapter_id?: string
          created_at?: string
          id?: string
          segment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "syllabus_segment_chapters_chapter_id_fkey"
            columns: ["chapter_id"]
            isOneToOne: false
            referencedRelation: "syllabus_topics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "syllabus_segment_chapters_segment_id_fkey"
            columns: ["segment_id"]
            isOneToOne: false
            referencedRelation: "syllabus_segments"
            referencedColumns: ["id"]
          },
        ]
      }
      syllabus_segments: {
        Row: {
          class_group_id: string
          created_at: string
          created_by: string | null
          display_order: number
          id: string
          institution_id: string
          name: string
          subject_id: string
          updated_at: string
        }
        Insert: {
          class_group_id: string
          created_at?: string
          created_by?: string | null
          display_order?: number
          id?: string
          institution_id: string
          name: string
          subject_id: string
          updated_at?: string
        }
        Update: {
          class_group_id?: string
          created_at?: string
          created_by?: string | null
          display_order?: number
          id?: string
          institution_id?: string
          name?: string
          subject_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "syllabus_segments_class_group_id_fkey"
            columns: ["class_group_id"]
            isOneToOne: false
            referencedRelation: "class_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "syllabus_segments_class_group_id_fkey"
            columns: ["class_group_id"]
            isOneToOne: false
            referencedRelation: "v_class_groups_with_sections"
            referencedColumns: ["class_group_id"]
          },
          {
            foreignKeyName: "syllabus_segments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "syllabus_segments_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "syllabus_segments_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "universal_subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      syllabus_sequence: {
        Row: {
          class_id: string
          created_at: string
          id: string
          institution_id: string
          position: number
          subject_id: string
          topic_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          class_id: string
          created_at?: string
          id?: string
          institution_id: string
          position: number
          subject_id: string
          topic_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          class_id?: string
          created_at?: string
          id?: string
          institution_id?: string
          position?: number
          subject_id?: string
          topic_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "syllabus_sequence_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "syllabus_sequence_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "syllabus_sequence_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "universal_subjects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "syllabus_sequence_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "syllabus_topics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "syllabus_sequence_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      syllabus_topics: {
        Row: {
          cbse_aligned: boolean | null
          chapter_number: number | null
          created_at: string
          created_by: string | null
          difficulty_level: string | null
          display_order: number | null
          expected_hours: number | null
          grade_level_id: string
          id: string
          institution_id: string | null
          is_active: boolean
          learning_outcomes: Json | null
          nep_aligned: boolean | null
          sub_topics: Json | null
          subject_id: string
          topic_name: string
          topic_name_hindi: string | null
          updated_at: string
        }
        Insert: {
          cbse_aligned?: boolean | null
          chapter_number?: number | null
          created_at?: string
          created_by?: string | null
          difficulty_level?: string | null
          display_order?: number | null
          expected_hours?: number | null
          grade_level_id: string
          id?: string
          institution_id?: string | null
          is_active?: boolean
          learning_outcomes?: Json | null
          nep_aligned?: boolean | null
          sub_topics?: Json | null
          subject_id: string
          topic_name: string
          topic_name_hindi?: string | null
          updated_at?: string
        }
        Update: {
          cbse_aligned?: boolean | null
          chapter_number?: number | null
          created_at?: string
          created_by?: string | null
          difficulty_level?: string | null
          display_order?: number | null
          expected_hours?: number | null
          grade_level_id?: string
          id?: string
          institution_id?: string | null
          is_active?: boolean
          learning_outcomes?: Json | null
          nep_aligned?: boolean | null
          sub_topics?: Json | null
          subject_id?: string
          topic_name?: string
          topic_name_hindi?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "syllabus_topics_grade_level_id_fkey"
            columns: ["grade_level_id"]
            isOneToOne: false
            referencedRelation: "grade_levels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "syllabus_topics_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "syllabus_topics_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "universal_subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      system_audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          entity_id: string | null
          entity_name: string | null
          entity_type: string
          id: string
          ip_address: string | null
          metadata: Json | null
          new_values: Json | null
          old_values: Json | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_name?: string | null
          entity_type: string
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          new_values?: Json | null
          old_values?: Json | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_name?: string | null
          entity_type?: string
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          new_values?: Json | null
          old_values?: Json | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "system_audit_logs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      task_assignments: {
        Row: {
          assigned_at: string
          assignee_id: string
          assigner_id: string | null
          id: string
          supervisor_id: string | null
          task_id: string
        }
        Insert: {
          assigned_at?: string
          assignee_id: string
          assigner_id?: string | null
          id?: string
          supervisor_id?: string | null
          task_id: string
        }
        Update: {
          assigned_at?: string
          assignee_id?: string
          assigner_id?: string | null
          id?: string
          supervisor_id?: string | null
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_assignments_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_assignments_assigner_id_fkey"
            columns: ["assigner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_assignments_supervisor_id_fkey"
            columns: ["supervisor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_assignments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: true
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          from_status: Database["public"]["Enums"]["task_status"] | null
          id: string
          metadata: Json | null
          reason: string | null
          task_id: string
          to_status: Database["public"]["Enums"]["task_status"]
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          from_status?: Database["public"]["Enums"]["task_status"] | null
          id?: string
          metadata?: Json | null
          reason?: string | null
          task_id: string
          to_status: Database["public"]["Enums"]["task_status"]
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          from_status?: Database["public"]["Enums"]["task_status"] | null
          id?: string
          metadata?: Json | null
          reason?: string | null
          task_id?: string
          to_status?: Database["public"]["Enums"]["task_status"]
        }
        Relationships: [
          {
            foreignKeyName: "task_audit_logs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_audit_logs_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_comments: {
        Row: {
          audio_url: string | null
          content: string
          created_at: string | null
          id: string
          task_id: string
          user_id: string
        }
        Insert: {
          audio_url?: string | null
          content: string
          created_at?: string | null
          id?: string
          task_id: string
          user_id: string
        }
        Update: {
          audio_url?: string | null
          content?: string
          created_at?: string | null
          id?: string
          task_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_comments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_comments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      task_evidence: {
        Row: {
          evidence_type: string
          exam_reference_id: string | null
          file_name: string | null
          file_url: string | null
          id: string
          notes: string | null
          task_id: string
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          evidence_type: string
          exam_reference_id?: string | null
          file_name?: string | null
          file_url?: string | null
          id?: string
          notes?: string | null
          task_id: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          evidence_type?: string
          exam_reference_id?: string | null
          file_name?: string | null
          file_url?: string | null
          id?: string
          notes?: string | null
          task_id?: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_evidence_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_evidence_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      task_links: {
        Row: {
          class_id: string | null
          exam_id: string | null
          id: string
          student_group_id: string | null
          subject_id: string | null
          task_id: string
        }
        Insert: {
          class_id?: string | null
          exam_id?: string | null
          id?: string
          student_group_id?: string | null
          subject_id?: string | null
          task_id: string
        }
        Update: {
          class_id?: string | null
          exam_id?: string | null
          id?: string
          student_group_id?: string | null
          subject_id?: string | null
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_links_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_links_student_group_id_fkey"
            columns: ["student_group_id"]
            isOneToOne: false
            referencedRelation: "student_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_links_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_links_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: true
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_supervisors: {
        Row: {
          added_at: string
          id: string
          supervisor_id: string
          task_id: string
        }
        Insert: {
          added_at?: string
          id?: string
          supervisor_id: string
          task_id: string
        }
        Update: {
          added_at?: string
          id?: string
          supervisor_id?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_supervisors_supervisor_id_fkey"
            columns: ["supervisor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_supervisors_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          auto_created: boolean
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          description: string | null
          due_date: string | null
          id: string
          institution_id: string
          priority: number | null
          status: Database["public"]["Enums"]["task_status"]
          task_group_id: string | null
          task_type: Database["public"]["Enums"]["task_type"]
          title: string
          updated_at: string
          wing_id: string | null
        }
        Insert: {
          auto_created?: boolean
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          institution_id: string
          priority?: number | null
          status?: Database["public"]["Enums"]["task_status"]
          task_group_id?: string | null
          task_type: Database["public"]["Enums"]["task_type"]
          title: string
          updated_at?: string
          wing_id?: string | null
        }
        Update: {
          auto_created?: boolean
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          institution_id?: string
          priority?: number | null
          status?: Database["public"]["Enums"]["task_status"]
          task_group_id?: string | null
          task_type?: Database["public"]["Enums"]["task_type"]
          title?: string
          updated_at?: string
          wing_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tasks_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_wing_id_fkey"
            columns: ["wing_id"]
            isOneToOne: false
            referencedRelation: "wings"
            referencedColumns: ["id"]
          },
        ]
      }
      teacher_aggregates: {
        Row: {
          avg_class_accuracy: number
          avg_class_pass_rate: number
          avg_evaluation_turnaround_hours: number
          class_performance: Json | null
          classes_taught: number | null
          computed_at: string
          created_at: string
          evaluations_completed: number
          exams_completed: number
          exams_published: number
          id: string
          institution_id: string
          performance_gap: number | null
          period_end: string
          period_start: string
          remark: string | null
          school_avg_accuracy: number | null
          teacher_id: string
          total_exams_created: number
          total_students_taught: number
        }
        Insert: {
          avg_class_accuracy?: number
          avg_class_pass_rate?: number
          avg_evaluation_turnaround_hours?: number
          class_performance?: Json | null
          classes_taught?: number | null
          computed_at?: string
          created_at?: string
          evaluations_completed?: number
          exams_completed?: number
          exams_published?: number
          id?: string
          institution_id: string
          performance_gap?: number | null
          period_end: string
          period_start: string
          remark?: string | null
          school_avg_accuracy?: number | null
          teacher_id: string
          total_exams_created?: number
          total_students_taught?: number
        }
        Update: {
          avg_class_accuracy?: number
          avg_class_pass_rate?: number
          avg_evaluation_turnaround_hours?: number
          class_performance?: Json | null
          classes_taught?: number | null
          computed_at?: string
          created_at?: string
          evaluations_completed?: number
          exams_completed?: number
          exams_published?: number
          id?: string
          institution_id?: string
          performance_gap?: number | null
          period_end?: string
          period_start?: string
          remark?: string | null
          school_avg_accuracy?: number | null
          teacher_id?: string
          total_exams_created?: number
          total_students_taught?: number
        }
        Relationships: [
          {
            foreignKeyName: "teacher_aggregates_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_aggregates_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      teacher_ai_quotas: {
        Row: {
          created_at: string
          daily_question_limit: number | null
          daily_token_limit: number | null
          id: string
          question_generation_enabled: boolean | null
          teacher_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          daily_question_limit?: number | null
          daily_token_limit?: number | null
          id?: string
          question_generation_enabled?: boolean | null
          teacher_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          daily_question_limit?: number | null
          daily_token_limit?: number | null
          id?: string
          question_generation_enabled?: boolean | null
          teacher_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "teacher_ai_quotas_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      teacher_effectiveness: {
        Row: {
          avg_evaluation_time_hours: number | null
          avg_student_improvement: number | null
          calculated_at: string | null
          class_avg_vs_school: number | null
          created_at: string | null
          effectiveness_score: number | null
          evaluations_completed: number | null
          exams_conducted: number | null
          id: string
          institution_id: string | null
          pass_rate: number | null
          period_end: string
          period_start: string
          teacher_id: string | null
          total_students: number | null
        }
        Insert: {
          avg_evaluation_time_hours?: number | null
          avg_student_improvement?: number | null
          calculated_at?: string | null
          class_avg_vs_school?: number | null
          created_at?: string | null
          effectiveness_score?: number | null
          evaluations_completed?: number | null
          exams_conducted?: number | null
          id?: string
          institution_id?: string | null
          pass_rate?: number | null
          period_end: string
          period_start: string
          teacher_id?: string | null
          total_students?: number | null
        }
        Update: {
          avg_evaluation_time_hours?: number | null
          avg_student_improvement?: number | null
          calculated_at?: string | null
          class_avg_vs_school?: number | null
          created_at?: string | null
          effectiveness_score?: number | null
          evaluations_completed?: number | null
          exams_conducted?: number | null
          id?: string
          institution_id?: string | null
          pass_rate?: number | null
          period_end?: string
          period_start?: string
          teacher_id?: string | null
          total_students?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "teacher_effectiveness_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_effectiveness_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      teacher_engagement_monthly: {
        Row: {
          badge_label: string | null
          c_attendance: number | null
          c_grading: number | null
          c_homework: number | null
          c_syllabus: number | null
          cohort_size: number
          computed_at: string
          inputs_present: number
          institution_id: string
          period_key: string
          rank: number | null
          score: number | null
          teacher_id: string
        }
        Insert: {
          badge_label?: string | null
          c_attendance?: number | null
          c_grading?: number | null
          c_homework?: number | null
          c_syllabus?: number | null
          cohort_size: number
          computed_at?: string
          inputs_present?: number
          institution_id: string
          period_key: string
          rank?: number | null
          score?: number | null
          teacher_id: string
        }
        Update: {
          badge_label?: string | null
          c_attendance?: number | null
          c_grading?: number | null
          c_homework?: number | null
          c_syllabus?: number | null
          cohort_size?: number
          computed_at?: string
          inputs_present?: number
          institution_id?: string
          period_key?: string
          rank?: number | null
          score?: number | null
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "teacher_engagement_monthly_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_engagement_monthly_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      teacher_overrides: {
        Row: {
          accepted_ai_suggestion: boolean | null
          ai_evaluation_id: string | null
          answer_id: string
          evaluated_at: string
          evaluated_by: string | null
          final_marks: number
          id: string
          internal_notes: string | null
          is_auto_graded: boolean | null
          is_verified: boolean
          max_marks: number
          override_reason: string | null
          teacher_feedback: string | null
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          accepted_ai_suggestion?: boolean | null
          ai_evaluation_id?: string | null
          answer_id: string
          evaluated_at?: string
          evaluated_by?: string | null
          final_marks: number
          id?: string
          internal_notes?: string | null
          is_auto_graded?: boolean | null
          is_verified?: boolean
          max_marks: number
          override_reason?: string | null
          teacher_feedback?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          accepted_ai_suggestion?: boolean | null
          ai_evaluation_id?: string | null
          answer_id?: string
          evaluated_at?: string
          evaluated_by?: string | null
          final_marks?: number
          id?: string
          internal_notes?: string | null
          is_auto_graded?: boolean | null
          is_verified?: boolean
          max_marks?: number
          override_reason?: string | null
          teacher_feedback?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "teacher_overrides_ai_evaluation_id_fkey"
            columns: ["ai_evaluation_id"]
            isOneToOne: false
            referencedRelation: "ai_evaluations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_overrides_answer_id_fkey"
            columns: ["answer_id"]
            isOneToOne: true
            referencedRelation: "student_answers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_overrides_evaluated_by_fkey"
            columns: ["evaluated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_overrides_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      teacher_target_periods: {
        Row: {
          achieved_value: number
          closed_at: string | null
          created_at: string
          id: string
          institution_id: string
          notified_at: string | null
          period_end: string
          period_index: number
          period_start: string
          status: string
          target_id: string
          target_value: number
          teacher_id: string
          updated_at: string
        }
        Insert: {
          achieved_value?: number
          closed_at?: string | null
          created_at?: string
          id?: string
          institution_id: string
          notified_at?: string | null
          period_end: string
          period_index: number
          period_start: string
          status?: string
          target_id: string
          target_value: number
          teacher_id: string
          updated_at?: string
        }
        Update: {
          achieved_value?: number
          closed_at?: string | null
          created_at?: string
          id?: string
          institution_id?: string
          notified_at?: string | null
          period_end?: string
          period_index?: number
          period_start?: string
          status?: string
          target_id?: string
          target_value?: number
          teacher_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "teacher_target_periods_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_target_periods_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "teacher_targets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_target_periods_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      teacher_targets: {
        Row: {
          assigned_by: string | null
          cadence_n: number | null
          cadence_unit: string | null
          created_at: string
          ends_on: string
          id: string
          institution_id: string
          metric: string
          note: string | null
          owner_id: string
          parent_target_id: string | null
          scope: string
          starts_on: string
          status: string
          target_value: number
          updated_at: string
          wing_id: string | null
        }
        Insert: {
          assigned_by?: string | null
          cadence_n?: number | null
          cadence_unit?: string | null
          created_at?: string
          ends_on: string
          id?: string
          institution_id: string
          metric: string
          note?: string | null
          owner_id: string
          parent_target_id?: string | null
          scope: string
          starts_on: string
          status?: string
          target_value: number
          updated_at?: string
          wing_id?: string | null
        }
        Update: {
          assigned_by?: string | null
          cadence_n?: number | null
          cadence_unit?: string | null
          created_at?: string
          ends_on?: string
          id?: string
          institution_id?: string
          metric?: string
          note?: string | null
          owner_id?: string
          parent_target_id?: string | null
          scope?: string
          starts_on?: string
          status?: string
          target_value?: number
          updated_at?: string
          wing_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "teacher_targets_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_targets_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_targets_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_targets_parent_target_id_fkey"
            columns: ["parent_target_id"]
            isOneToOne: false
            referencedRelation: "teacher_targets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_targets_wing_id_fkey"
            columns: ["wing_id"]
            isOneToOne: false
            referencedRelation: "wings"
            referencedColumns: ["id"]
          },
        ]
      }
      topic_class_mappings: {
        Row: {
          class_group_id: string | null
          created_at: string | null
          id: string
          topic_id: string
        }
        Insert: {
          class_group_id?: string | null
          created_at?: string | null
          id?: string
          topic_id: string
        }
        Update: {
          class_group_id?: string | null
          created_at?: string | null
          id?: string
          topic_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "topic_class_mappings_class_group_id_fkey"
            columns: ["class_group_id"]
            isOneToOne: false
            referencedRelation: "class_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "topic_class_mappings_class_group_id_fkey"
            columns: ["class_group_id"]
            isOneToOne: false
            referencedRelation: "v_class_groups_with_sections"
            referencedColumns: ["class_group_id"]
          },
          {
            foreignKeyName: "topic_class_mappings_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "syllabus_topics"
            referencedColumns: ["id"]
          },
        ]
      }
      tt_class_structure: {
        Row: {
          academic_year: string
          class_id: string
          created_at: string
          created_by: string | null
          id: string
          institution_id: string
          publish_status: string
          published_at: string | null
          published_by: string | null
          structure_id: string
          updated_at: string
        }
        Insert: {
          academic_year: string
          class_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          institution_id: string
          publish_status?: string
          published_at?: string | null
          published_by?: string | null
          structure_id: string
          updated_at?: string
        }
        Update: {
          academic_year?: string
          class_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          institution_id?: string
          publish_status?: string
          published_at?: string | null
          published_by?: string | null
          structure_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tt_class_structure_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tt_class_structure_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tt_class_structure_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tt_class_structure_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tt_class_structure_structure_id_fkey"
            columns: ["structure_id"]
            isOneToOne: false
            referencedRelation: "tt_period_structures"
            referencedColumns: ["id"]
          },
        ]
      }
      tt_lesson_plans: {
        Row: {
          addressed_topic_ids: string[] | null
          chapter_topic_id: string | null
          class_id: string
          completion_pct: number | null
          created_at: string
          created_by: string | null
          date: string
          done_at: string | null
          id: string
          institution_id: string
          is_note_only: boolean
          note: string | null
          owner_teacher_id: string | null
          planned_at: string | null
          session_type: string
          slot_id: string
          status: string
          subject_id: string | null
          topic_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          addressed_topic_ids?: string[] | null
          chapter_topic_id?: string | null
          class_id: string
          completion_pct?: number | null
          created_at?: string
          created_by?: string | null
          date: string
          done_at?: string | null
          id?: string
          institution_id: string
          is_note_only?: boolean
          note?: string | null
          owner_teacher_id?: string | null
          planned_at?: string | null
          session_type: string
          slot_id: string
          status?: string
          subject_id?: string | null
          topic_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          addressed_topic_ids?: string[] | null
          chapter_topic_id?: string | null
          class_id?: string
          completion_pct?: number | null
          created_at?: string
          created_by?: string | null
          date?: string
          done_at?: string | null
          id?: string
          institution_id?: string
          is_note_only?: boolean
          note?: string | null
          owner_teacher_id?: string | null
          planned_at?: string | null
          session_type?: string
          slot_id?: string
          status?: string
          subject_id?: string | null
          topic_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tt_lesson_plans_chapter_topic_id_fkey"
            columns: ["chapter_topic_id"]
            isOneToOne: false
            referencedRelation: "chapter_topics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tt_lesson_plans_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tt_lesson_plans_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tt_lesson_plans_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tt_lesson_plans_owner_teacher_id_fkey"
            columns: ["owner_teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tt_lesson_plans_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "tt_slots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tt_lesson_plans_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "universal_subjects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tt_lesson_plans_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "syllabus_topics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tt_lesson_plans_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      tt_manager_overrides: {
        Row: {
          created_at: string
          institution_id: string
          note: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          institution_id: string
          note?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          institution_id?: string
          note?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tt_manager_overrides_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tt_manager_overrides_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      tt_period_slots: {
        Row: {
          created_at: string
          days: string[] | null
          end_time: string
          id: string
          kind: string
          label: string
          period_number: number
          start_time: string
          structure_id: string
        }
        Insert: {
          created_at?: string
          days?: string[] | null
          end_time: string
          id?: string
          kind: string
          label: string
          period_number: number
          start_time: string
          structure_id: string
        }
        Update: {
          created_at?: string
          days?: string[] | null
          end_time?: string
          id?: string
          kind?: string
          label?: string
          period_number?: number
          start_time?: string
          structure_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tt_period_slots_structure_id_fkey"
            columns: ["structure_id"]
            isOneToOne: false
            referencedRelation: "tt_period_structures"
            referencedColumns: ["id"]
          },
        ]
      }
      tt_period_structures: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          institution_id: string
          name: string
          updated_at: string
          working_days: string[]
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          institution_id: string
          name: string
          updated_at?: string
          working_days: string[]
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          institution_id?: string
          name?: string
          updated_at?: string
          working_days?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "tt_period_structures_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tt_period_structures_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
        ]
      }
      tt_resources: {
        Row: {
          capacity: number
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          institution_id: string
          kind: string
          name: string
          updated_at: string
        }
        Insert: {
          capacity?: number
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          institution_id: string
          kind: string
          name: string
          updated_at?: string
        }
        Update: {
          capacity?: number
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          institution_id?: string
          kind?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tt_resources_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tt_resources_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
        ]
      }
      tt_slots: {
        Row: {
          academic_year: string
          class_id: string
          created_at: string
          created_by: string | null
          custom_label: string | null
          day: string
          id: string
          institution_id: string
          is_optional_band: boolean
          notes: string | null
          optional_group_id: string | null
          period_slot_id: string
          resource_id: string | null
          slot_type: string
          subject_id: string | null
          teacher_id: string | null
          updated_at: string
        }
        Insert: {
          academic_year: string
          class_id: string
          created_at?: string
          created_by?: string | null
          custom_label?: string | null
          day: string
          id?: string
          institution_id: string
          is_optional_band?: boolean
          notes?: string | null
          optional_group_id?: string | null
          period_slot_id: string
          resource_id?: string | null
          slot_type: string
          subject_id?: string | null
          teacher_id?: string | null
          updated_at?: string
        }
        Update: {
          academic_year?: string
          class_id?: string
          created_at?: string
          created_by?: string | null
          custom_label?: string | null
          day?: string
          id?: string
          institution_id?: string
          is_optional_band?: boolean
          notes?: string | null
          optional_group_id?: string | null
          period_slot_id?: string
          resource_id?: string | null
          slot_type?: string
          subject_id?: string | null
          teacher_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tt_slots_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tt_slots_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tt_slots_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tt_slots_optional_group_id_fkey"
            columns: ["optional_group_id"]
            isOneToOne: false
            referencedRelation: "optional_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tt_slots_period_slot_id_fkey"
            columns: ["period_slot_id"]
            isOneToOne: false
            referencedRelation: "tt_period_slots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tt_slots_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "tt_resources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tt_slots_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "universal_subjects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tt_slots_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      tt_substitutions: {
        Row: {
          assigned_at: string | null
          assigned_by: string | null
          cancelled_reason: string | null
          created_at: string
          created_by: string | null
          date: string
          id: string
          original_teacher_id: string | null
          reason: string | null
          slot_id: string
          source: string
          status: string
          substitute_teacher_id: string | null
          updated_at: string
        }
        Insert: {
          assigned_at?: string | null
          assigned_by?: string | null
          cancelled_reason?: string | null
          created_at?: string
          created_by?: string | null
          date: string
          id?: string
          original_teacher_id?: string | null
          reason?: string | null
          slot_id: string
          source?: string
          status?: string
          substitute_teacher_id?: string | null
          updated_at?: string
        }
        Update: {
          assigned_at?: string | null
          assigned_by?: string | null
          cancelled_reason?: string | null
          created_at?: string
          created_by?: string | null
          date?: string
          id?: string
          original_teacher_id?: string | null
          reason?: string | null
          slot_id?: string
          source?: string
          status?: string
          substitute_teacher_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tt_substitutions_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tt_substitutions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tt_substitutions_original_teacher_id_fkey"
            columns: ["original_teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tt_substitutions_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "tt_slots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tt_substitutions_substitute_teacher_id_fkey"
            columns: ["substitute_teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      universal_subjects: {
        Row: {
          category: string | null
          code: string | null
          created_at: string
          created_by: string | null
          display_order: number | null
          grade_level_id: string | null
          id: string
          institution_id: string | null
          is_active: boolean
          name: string
          name_hindi: string | null
          updated_at: string
        }
        Insert: {
          category?: string | null
          code?: string | null
          created_at?: string
          created_by?: string | null
          display_order?: number | null
          grade_level_id?: string | null
          id?: string
          institution_id?: string | null
          is_active?: boolean
          name: string
          name_hindi?: string | null
          updated_at?: string
        }
        Update: {
          category?: string | null
          code?: string | null
          created_at?: string
          created_by?: string | null
          display_order?: number | null
          grade_level_id?: string | null
          id?: string
          institution_id?: string | null
          is_active?: boolean
          name?: string
          name_hindi?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "universal_subjects_grade_level_id_fkey"
            columns: ["grade_level_id"]
            isOneToOne: false
            referencedRelation: "grade_levels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "universal_subjects_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
        ]
      }
      user_activity_log: {
        Row: {
          activity_date: string
          activity_type: string
          count: number
          created_at: string
          id: string
          institution_id: string | null
          metadata: Json | null
          user_id: string
        }
        Insert: {
          activity_date?: string
          activity_type: string
          count?: number
          created_at?: string
          id?: string
          institution_id?: string | null
          metadata?: Json | null
          user_id: string
        }
        Update: {
          activity_date?: string
          activity_type?: string
          count?: number
          created_at?: string
          id?: string
          institution_id?: string | null
          metadata?: Json | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_activity_log_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_activity_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_badges: {
        Row: {
          badge_id: string
          created_at: string
          earned_at: string
          id: string
          institution_id: string | null
          is_featured: boolean | null
          metadata: Json | null
          period_key: string | null
          source_entity_id: string | null
          source_entity_type: string | null
          user_id: string
        }
        Insert: {
          badge_id: string
          created_at?: string
          earned_at?: string
          id?: string
          institution_id?: string | null
          is_featured?: boolean | null
          metadata?: Json | null
          period_key?: string | null
          source_entity_id?: string | null
          source_entity_type?: string | null
          user_id: string
        }
        Update: {
          badge_id?: string
          created_at?: string
          earned_at?: string
          id?: string
          institution_id?: string | null
          is_featured?: boolean | null
          metadata?: Json | null
          period_key?: string | null
          source_entity_id?: string | null
          source_entity_type?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_badges_badge_id_fkey"
            columns: ["badge_id"]
            isOneToOne: false
            referencedRelation: "badge_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_badges_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_badges_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_preferences: {
        Row: {
          created_at: string
          email_notifications: boolean | null
          id: string
          onboarding_completed: boolean | null
          onboarding_completed_at: string | null
          push_notifications: boolean | null
          sound_notifications: boolean | null
          theme: string | null
          tour_steps_completed: Json | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email_notifications?: boolean | null
          id?: string
          onboarding_completed?: boolean | null
          onboarding_completed_at?: string | null
          push_notifications?: boolean | null
          sound_notifications?: boolean | null
          theme?: string | null
          tour_steps_completed?: Json | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email_notifications?: boolean | null
          id?: string
          onboarding_completed?: boolean | null
          onboarding_completed_at?: string | null
          push_notifications?: boolean | null
          sound_notifications?: boolean | null
          theme?: string | null
          tour_steps_completed?: Json | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_question_limits: {
        Row: {
          created_at: string | null
          daily_limit: number | null
          id: string
          institution_id: string | null
          last_reset_date: string | null
          questions_used_today: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          daily_limit?: number | null
          id?: string
          institution_id?: string | null
          last_reset_date?: string | null
          questions_used_today?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          daily_limit?: number | null
          id?: string
          institution_id?: string | null
          last_reset_date?: string | null
          questions_used_today?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_question_limits_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_question_limits_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          admin_title: string | null
          employee_level_id: string | null
          granted_at: string
          granted_by: string | null
          id: string
          institution_id: string | null
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          admin_title?: string | null
          employee_level_id?: string | null
          granted_at?: string
          granted_by?: string | null
          id?: string
          institution_id?: string | null
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          admin_title?: string | null
          employee_level_id?: string | null
          granted_at?: string
          granted_by?: string | null
          id?: string
          institution_id?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_employee_level_id_fkey"
            columns: ["employee_level_id"]
            isOneToOne: false
            referencedRelation: "employee_levels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_topic_orders: {
        Row: {
          display_order: number
          topic_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          display_order: number
          topic_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          display_order?: number
          topic_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_topic_orders_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "syllabus_topics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_topic_orders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      wing_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          id: string
          user_id: string
          wing_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          id?: string
          user_id: string
          wing_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          id?: string
          user_id?: string
          wing_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wing_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wing_assignments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wing_assignments_wing_id_fkey"
            columns: ["wing_id"]
            isOneToOne: false
            referencedRelation: "wings"
            referencedColumns: ["id"]
          },
        ]
      }
      wing_class_mappings: {
        Row: {
          class_id: string
          created_at: string | null
          id: string
          wing_id: string
        }
        Insert: {
          class_id: string
          created_at?: string | null
          id?: string
          wing_id: string
        }
        Update: {
          class_id?: string
          created_at?: string | null
          id?: string
          wing_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wing_class_mappings_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wing_class_mappings_wing_id_fkey"
            columns: ["wing_id"]
            isOneToOne: false
            referencedRelation: "wings"
            referencedColumns: ["id"]
          },
        ]
      }
      wings: {
        Row: {
          created_at: string
          description: string | null
          display_order: number | null
          id: string
          institution_id: string
          is_active: boolean | null
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          display_order?: number | null
          id?: string
          institution_id: string
          is_active?: boolean | null
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          display_order?: number | null
          id?: string
          institution_id?: string
          is_active?: boolean | null
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wings_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      oly_batches_no_pin: {
        Row: {
          batch_label: string | null
          campaign_id: string | null
          created_at: string | null
          grade_level_id: string | null
          id: string | null
          is_absentees: boolean | null
          locked_at: string | null
          oly_school_id: string | null
          pc_count: number | null
          pin_expiry_minutes: number | null
          pin_first_used_at: string | null
          scheduled_at: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          batch_label?: string | null
          campaign_id?: string | null
          created_at?: string | null
          grade_level_id?: string | null
          id?: string | null
          is_absentees?: boolean | null
          locked_at?: string | null
          oly_school_id?: string | null
          pc_count?: number | null
          pin_expiry_minutes?: number | null
          pin_first_used_at?: string | null
          scheduled_at?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          batch_label?: string | null
          campaign_id?: string | null
          created_at?: string | null
          grade_level_id?: string | null
          id?: string | null
          is_absentees?: boolean | null
          locked_at?: string | null
          oly_school_id?: string | null
          pc_count?: number | null
          pin_expiry_minutes?: number | null
          pin_first_used_at?: string | null
          scheduled_at?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "oly_batches_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "oly_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oly_batches_grade_level_id_fkey"
            columns: ["grade_level_id"]
            isOneToOne: false
            referencedRelation: "grade_levels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oly_batches_oly_school_id_fkey"
            columns: ["oly_school_id"]
            isOneToOne: false
            referencedRelation: "oly_schools"
            referencedColumns: ["id"]
          },
        ]
      }
      student_eligible_exams: {
        Row: {
          attempt_id: string | null
          attempt_started_at: string | null
          attempt_status: string | null
          attempt_submitted_at: string | null
          class_id: string | null
          class_name: string | null
          description: string | null
          duration_minutes: number | null
          end_time: string | null
          entry_deadline: string | null
          exam_id: string | null
          exam_mode: Database["public"]["Enums"]["exam_mode"] | null
          instructions: string | null
          is_locked: boolean | null
          is_submitted: boolean | null
          late_entry_minutes: number | null
          scheduled_date: string | null
          start_time: string | null
          status: Database["public"]["Enums"]["exam_status"] | null
          student_id: string | null
          subject_visible: boolean | null
          title: string | null
          total_marks: number | null
        }
        Relationships: [
          {
            foreignKeyName: "class_assignments_user_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_classes_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
        ]
      }
      tt_effective_periods: {
        Row: {
          academic_year: string | null
          class_id: string | null
          day: string | null
          from_optional_group: boolean | null
          id: string | null
          institution_id: string | null
          optional_group_id: string | null
          period_slot_id: string | null
          resource_id: string | null
          slot_id: string | null
          slot_type: string | null
          subject_id: string | null
          teacher_id: string | null
        }
        Relationships: []
      }
      v_class_groups_with_sections: {
        Row: {
          academic_year: string | null
          class_group_id: string | null
          created_at: string | null
          grade_level_id: string | null
          group_is_active: boolean | null
          institution_id: string | null
          name: string | null
          section_count: number | null
          section_ids: string[] | null
          section_labels: string[] | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "class_groups_grade_level_id_fkey"
            columns: ["grade_level_id"]
            isOneToOne: false
            referencedRelation: "grade_levels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_groups_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
        ]
      }
      v_subject_class_mappings_unified: {
        Row: {
          class_group_id: string | null
          class_id: string | null
          created_at: string | null
          institution_id: string | null
          origin: string | null
          source_id: string | null
          subject_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      _homework_student_feed_impl: { Args: { p_uid: string }; Returns: Json }
      _ptm_fanout: {
        Args: {
          _message: string
          _ptm_id: string
          _recipients: string[]
          _title: string
          _type: string
        }
        Returns: number
      }
      _student_achievements_impl: { Args: { p_uid: string }; Returns: Json }
      _student_attendance_summary_impl: {
        Args: { p_range: string; p_uid: string }
        Returns: Json
      }
      _student_chapter_performance_impl: {
        Args: { p_uid: string }
        Returns: Json
      }
      _student_overall_class_standing_impl: {
        Args: { p_uid: string }
        Returns: Json
      }
      _student_performance_trend_impl: {
        Args: { p_range: string; p_subject: string; p_uid: string }
        Returns: Json
      }
      _student_resolve_classes_impl: {
        Args: { p_uid: string }
        Returns: string[]
      }
      _student_score_trend_impl: {
        Args: { p_limit: number; p_uid: string }
        Returns: Json
      }
      _student_streak_impl: { Args: { p_uid: string }; Returns: Json }
      _student_subject_class_comparison_impl: {
        Args: { p_uid: string }
        Returns: Json
      }
      _student_year_report_impl: { Args: { p_uid: string }; Returns: Json }
      _support_apply_status: {
        Args: {
          p_client_token?: string
          p_note: string
          p_status: string
          p_ticket_id: string
        }
        Returns: Json
      }
      _support_record_health: {
        Args: {
          p_actor_id?: string
          p_detail: string
          p_kind: string
          p_page_url?: string
          p_ticket_id?: string
        }
        Returns: undefined
      }
      admin_institution_counts: {
        Args: never
        Returns: {
          exams: number
          institution_id: string
          students: number
          teachers: number
        }[]
      }
      admin_user_roster: { Args: never; Returns: Json }
      apply_late_fees: { Args: { _institution_id: string }; Returns: number }
      attempt_evaluation_queue: {
        Args: { _limit?: number }
        Returns: {
          ai_evaluated_count: number
          attempt_id: string
          class_name: string
          class_section: string
          exam_id: string
          exam_title: string
          exam_total_marks: number
          is_finalized: boolean
          pending_review_count: number
          student_admission_number: string
          student_full_name: string
          student_id: string
          student_roll_number: string
          submitted_at: string
          teacher_reviewed_count: number
          total_questions: number
        }[]
      }
      attendance_class_markers: {
        Args: { _class_ids: string[]; _date: string }
        Returns: {
          class_id: string
          marked_by: string
          marker_name: string
          record_count: number
        }[]
      }
      avatar_owner_from_path: { Args: { _name: string }; Returns: string }
      award_player_of_the_month: {
        Args: { _institution_id?: string; _period_key?: string }
        Returns: Json
      }
      award_year_end_aggregates: {
        Args: { _academic_year_id?: string; _institution_id?: string }
        Returns: Json
      }
      award_year_end_badges: {
        Args: { _academic_year_id?: string; _institution_id?: string }
        Returns: Json
      }
      award_year_end_badges_due: { Args: never; Returns: Json }
      badge_leaderboard: {
        Args: { _limit?: number }
        Returns: {
          avatar_url: string
          bronze: number
          diamond: number
          email: string
          full_name: string
          gold: number
          latest_badge_at: string
          platinum: number
          role: string
          silver: number
          total_badges: number
          total_points: number
          user_id: string
        }[]
      }
      badge_next_rank_at: { Args: { _points: number }; Returns: number }
      badge_rank_for_points: { Args: { _points: number }; Returns: string }
      badge_rarity: { Args: never; Returns: Json }
      band_slot_batches: {
        Args: { _band_slot: string }
        Returns: {
          batch_id: string
          label: string
          roster_count: number
          subject_name: string
          teacher_name: string
        }[]
      }
      bump_exam_version: { Args: { _exam_id: string }; Returns: number }
      can_access_support_ticket: {
        Args: { p_ticket: string }
        Returns: boolean
      }
      can_add_topics_to_class: {
        Args: { _class_id: string; _user_id: string }
        Returns: boolean
      }
      can_assign_task_to: {
        Args: { _assignee: string; _assigner: string }
        Returns: boolean
      }
      can_create_tasks: { Args: { _user_id: string }; Returns: boolean }
      can_edit_student_details: {
        Args: { _actor: string; _student: string }
        Returns: boolean
      }
      can_evaluate_attempt: {
        Args: { _attempt_id: string; _user_id: string }
        Returns: boolean
      }
      can_i_set_user_photo: { Args: { _target: string }; Returns: boolean }
      can_manage_band_slot: {
        Args: { _actor: string; _band_slot: string }
        Returns: boolean
      }
      can_manage_homework: {
        Args: { _homework_id: string; _user_id: string }
        Returns: boolean
      }
      can_manage_offline_marks: {
        Args: { _exam_id: string; _user_id: string }
        Returns: boolean
      }
      can_manage_optional_batch: {
        Args: { _actor: string; _batch: string }
        Returns: boolean
      }
      can_manage_optional_batches: {
        Args: { _actor: string; _institution: string }
        Returns: boolean
      }
      can_manage_optional_group: {
        Args: { _actor: string; _group: string }
        Returns: boolean
      }
      can_manage_optional_groups: {
        Args: { _actor: string; _institution: string }
        Returns: boolean
      }
      can_manage_segment: {
        Args: { _segment_id: string; _user_id: string }
        Returns: boolean
      }
      can_manage_student_optional_choices: {
        Args: { _actor: string; _student: string }
        Returns: boolean
      }
      can_manage_student_subjects: {
        Args: { _actor: string; _student: string }
        Returns: boolean
      }
      can_manage_subjects: {
        Args: { _inst_id: string; _user_id: string }
        Returns: boolean
      }
      can_manage_syllabus_segment: {
        Args: { _class_group_id: string; _subject_id: string; _user_id: string }
        Returns: boolean
      }
      can_manage_task: { Args: { _task_id: string }; Returns: boolean }
      can_message_user: {
        Args: { _author: string; _target: string }
        Returns: boolean
      }
      can_publish_notices: { Args: { _user_id: string }; Returns: boolean }
      can_read_segment: {
        Args: { _segment_id: string; _user_id: string }
        Returns: boolean
      }
      can_read_syllabus_segment: {
        Args: { _class_group_id: string; _user_id: string }
        Returns: boolean
      }
      can_review_student_leave: {
        Args: { _class: string; _institution: string; _user: string }
        Returns: boolean
      }
      can_set_user_photo: {
        Args: { _actor: string; _target: string }
        Returns: boolean
      }
      can_upload_ocr: {
        Args: { _class_id: string; _exam_id: string; _user_id: string }
        Returns: boolean
      }
      can_view_band_slot: {
        Args: { _actor: string; _band_slot: string }
        Returns: boolean
      }
      can_view_notice: {
        Args: { _notice_id: string; _user_id: string }
        Returns: boolean
      }
      can_view_optional_group: {
        Args: { _actor: string; _group: string }
        Returns: boolean
      }
      can_view_student_details: {
        Args: { _profile_id: string; _viewer: string }
        Returns: boolean
      }
      can_view_student_optional_choices: {
        Args: { _actor: string; _student: string }
        Returns: boolean
      }
      can_view_student_subjects: {
        Args: { _actor: string; _student: string }
        Returns: boolean
      }
      can_view_user_photo: {
        Args: { _target: string; _viewer: string }
        Returns: boolean
      }
      can_write_student_details: {
        Args: { _profile_id: string; _writer: string }
        Returns: boolean
      }
      cancel_task: {
        Args: {
          p_apply_to_group?: boolean
          p_reason?: string
          p_task_id: string
        }
        Returns: Json
      }
      check_password_expiry: {
        Args: { _user_id: string }
        Returns: {
          days_remaining: number
          expires_at: string
          is_expired: boolean
        }[]
      }
      class_projection_for_range: {
        Args: { p_class_id: string; p_from: string; p_to: string }
        Returns: Json
      }
      clear_password_reset_flag: { Args: never; Returns: undefined }
      clear_user_avatar: { Args: { _target: string }; Returns: string }
      close_stale_exam_attempts: {
        Args: { p_exam_id: string }
        Returns: number
      }
      close_stale_exam_attempts_sweep: { Args: never; Returns: number }
      communication_overview: {
        Args: { _institution_id: string }
        Returns: {
          conv_announcement: number
          conv_direct: number
          conv_group: number
          notices_academic: number
          notices_event: number
          notices_general: number
          notices_ptm: number
          total_acknowledgements: number
          total_bookings: number
          total_conversations: number
          total_messages: number
          total_notices: number
          total_ptms: number
          total_reads: number
        }[]
      }
      compute_student_performance_snapshot: {
        Args: { _attempt_id: string }
        Returns: string
      }
      compute_teacher_engagement_monthly: {
        Args: { _period_key?: string }
        Returns: number
      }
      coordinator_covers_task: {
        Args: { _task_id: string; _user_id: string }
        Returns: boolean
      }
      create_ptm_schedule: {
        Args: {
          _class_ids: string[]
          _description: string
          _end_time: string
          _institution_id: string
          _scheduled_date: string
          _slot_duration_minutes: number
          _start_time: string
          _title: string
        }
        Returns: string
      }
      create_support_task: {
        Args: {
          p_category?: string
          p_description: string
          p_page_url?: string
          p_priority?: number
          p_subject: string
        }
        Returns: Json
      }
      create_syllabus_segment: {
        Args: { _class_group_id: string; _name: string; _subject_id: string }
        Returns: string
      }
      create_task_group: {
        Args: {
          p_assignees: Json
          p_description: string
          p_due_date: string
          p_institution_id: string
          p_priority: number
          p_supervisor_id?: string
          p_supervisor_ids?: string[]
          p_task_type: Database["public"]["Enums"]["task_type"]
          p_title: string
        }
        Returns: Json
      }
      dash_admin_digest: {
        Args: { p_institution_id?: string }
        Returns: {
          code: string
          detail: string
          headline: string
          link_url: string
          severity: string
        }[]
      }
      dash_admin_portal_adoption: {
        Args: { p_class_id?: string; p_institution_id?: string }
        Returns: Json
      }
      dash_admin_roster_counts: {
        Args: { p_institution_id?: string }
        Returns: Json
      }
      dash_attendance_compliance: {
        Args: { p_days?: number; p_institution_id?: string }
        Returns: {
          class_id: string
          class_name: string
          days_expected: number
          days_marked: number
          last_marked: string
          pct: number
        }[]
      }
      dash_attendance_trend: {
        Args: {
          p_class_id?: string
          p_days?: number
          p_institution_id?: string
        }
        Returns: Json
      }
      dash_cancel_flag_task: { Args: { p_flag_id: string }; Returns: undefined }
      dash_class_performance: {
        Args: { p_institution_id?: string; p_wing_id?: string }
        Returns: {
          attendance_30d: number
          avg_pct: number
          class_id: string
          class_name: string
          exams: number
          results: number
          students: number
        }[]
      }
      dash_classes_table: {
        Args: {
          p_filters?: Json
          p_institution_id?: string
          p_limit?: number
          p_offset?: number
        }
        Returns: Json
      }
      dash_create_task_from_flag: {
        Args: { p_assignee_id?: string; p_flag_id: string }
        Returns: string
      }
      dash_current_academic_year: {
        Args: { p_institution_id: string }
        Returns: {
          end_date: string
          start_date: string
        }[]
      }
      dash_evaluate_flags: {
        Args: { p_institution_id?: string }
        Returns: Json
      }
      dash_evaluate_syllabus_flags: {
        Args: { p_institution_id?: string }
        Returns: Json
      }
      dash_exam_trend: {
        Args: {
          p_class_id?: string
          p_institution_id?: string
          p_limit?: number
          p_range?: string
        }
        Returns: Json
      }
      dash_get_flags: { Args: { p_institution_id?: string }; Returns: Json }
      dash_kpi_summary: { Args: { p_institution_id?: string }; Returns: Json }
      dash_range_window: {
        Args: { p_institution_id: string; p_range: string }
        Returns: {
          from_date: string
          to_date: string
        }[]
      }
      dash_reassign_flag_task: {
        Args: { p_assignee_id: string; p_flag_id: string }
        Returns: undefined
      }
      dash_recent_events: {
        Args: { p_institution_id?: string; p_limit?: number }
        Returns: {
          ends_on: string
          event_id: string
          is_upcoming: boolean
          kind: string
          starts_on: string
          title: string
        }[]
      }
      dash_recent_exams: {
        Args: {
          p_filters?: Json
          p_institution_id?: string
          p_limit?: number
          p_offset?: number
        }
        Returns: Json
      }
      dash_resolve_institution: {
        Args: { p_institution_id?: string }
        Returns: string
      }
      dash_resolve_scoped_classes: { Args: never; Returns: string[] }
      dash_resolve_scoped_pairs: {
        Args: never
        Returns: {
          class_id: string
          subject_id: string
        }[]
      }
      dash_resolve_teacher_pairs: {
        Args: never
        Returns: {
          class_id: string
          subject_id: string
        }[]
      }
      dash_school_subject_performance: {
        Args: { p_institution_id?: string }
        Returns: {
          results: number
          school_avg: number
          subject_id: string
          subject_name: string
        }[]
      }
      dash_scoped_attendance_compliance: {
        Args: { p_days?: number }
        Returns: Json
      }
      dash_scoped_attendance_trend: { Args: { p_days?: number }; Returns: Json }
      dash_scoped_cancel_flag_task: {
        Args: { p_flag_id: string }
        Returns: undefined
      }
      dash_scoped_class_list: { Args: never; Returns: Json }
      dash_scoped_class_performance: { Args: never; Returns: Json }
      dash_scoped_classes_table: {
        Args: { p_filters?: Json; p_limit?: number; p_offset?: number }
        Returns: Json
      }
      dash_scoped_create_task_from_flag: {
        Args: { p_assignee_id?: string; p_flag_id: string }
        Returns: string
      }
      dash_scoped_digest: {
        Args: never
        Returns: {
          code: string
          detail: string
          headline: string
          link_url: string
          severity: string
        }[]
      }
      dash_scoped_exam_trend: { Args: { p_limit?: number }; Returns: Json }
      dash_scoped_flag_in_scope: {
        Args: {
          p_classes: string[]
          p_flag: Database["public"]["Tables"]["dashboard_flags"]["Row"]
        }
        Returns: boolean
      }
      dash_scoped_get_flags: { Args: never; Returns: Json }
      dash_scoped_kpi_summary: { Args: never; Returns: Json }
      dash_scoped_reassign_flag_task: {
        Args: { p_assignee_id: string; p_flag_id: string }
        Returns: undefined
      }
      dash_scoped_recent_exams: {
        Args: { p_filters?: Json; p_limit?: number; p_offset?: number }
        Returns: Json
      }
      dash_scoped_recheck_queue: {
        Args: { p_limit?: number; p_offset?: number; p_status?: string }
        Returns: Json
      }
      dash_scoped_recheck_stats: { Args: never; Returns: Json }
      dash_scoped_resolve_recheck: {
        Args: {
          p_approve: boolean
          p_id: string
          p_new_marks?: number
          p_notes?: string
        }
        Returns: Json
      }
      dash_scoped_student_distribution: { Args: never; Returns: Json }
      dash_scoped_student_portal_adoption: {
        Args: { p_limit?: number }
        Returns: Json
      }
      dash_scoped_students_attention: {
        Args: {
          p_filters?: Json
          p_limit?: number
          p_offset?: number
          p_weights?: Json
        }
        Returns: Json
      }
      dash_scoped_subject_heatmap: { Args: never; Returns: Json }
      dash_scoped_subject_performance: {
        Args: { p_class_id: string }
        Returns: Json
      }
      dash_scoped_syllabus_coverage: {
        Args: {
          p_class_group_id?: string
          p_class_id?: string
          p_subject_id?: string
          p_teacher_id?: string
        }
        Returns: Json
      }
      dash_scoped_task_queue: {
        Args: { p_limit?: number; p_offset?: number }
        Returns: Json
      }
      dash_scoped_task_stats: { Args: never; Returns: Json }
      dash_scoped_teacher_adoption: {
        Args: { p_limit?: number }
        Returns: Json
      }
      dash_scoped_teachers_table: {
        Args: { p_filters?: Json; p_limit?: number; p_offset?: number }
        Returns: Json
      }
      dash_scoped_wing_standing: { Args: never; Returns: Json }
      dash_score_students: {
        Args: { p_institution_id: string; p_weights?: Json }
        Returns: {
          active_flags: number
          attendance: number
          band: string
          class_id: string
          reason: string
          recent_pct: number
          score: number
          student_id: string
          trend: string
        }[]
      }
      dash_score_students_scoped: {
        Args: {
          p_class_ids: string[]
          p_institution_id: string
          p_weights?: Json
        }
        Returns: {
          active_flags: number
          attendance: number
          band: string
          class_id: string
          reason: string
          recent_pct: number
          score: number
          student_id: string
          trend: string
        }[]
      }
      dash_student_distribution: {
        Args: { p_class_id?: string; p_institution_id?: string }
        Returns: Json
      }
      dash_student_portal_adoption: {
        Args: {
          p_class_id?: string
          p_institution_id?: string
          p_limit?: number
        }
        Returns: Json
      }
      dash_students_attention: {
        Args: {
          p_filters?: Json
          p_institution_id?: string
          p_limit?: number
          p_offset?: number
          p_weights?: Json
        }
        Returns: Json
      }
      dash_students_in_band: {
        Args: {
          p_after_id?: string
          p_after_pct?: number
          p_band: string
          p_class_id?: string
          p_institution_id?: string
          p_limit?: number
        }
        Returns: {
          class_name: string
          latest_pct: number
          name: string
          roll: string
          student_id: string
        }[]
      }
      dash_subject_heatmap: {
        Args: { p_institution_id?: string }
        Returns: Json
      }
      dash_subject_performance: {
        Args: { p_class_id: string; p_institution_id?: string }
        Returns: Json
      }
      dash_syllabus_coverage: {
        Args: {
          p_class_group_id?: string
          p_class_id?: string
          p_institution_id?: string
          p_subject_id?: string
          p_teacher_id?: string
        }
        Returns: Json
      }
      dash_syllabus_coverage_build: {
        Args: {
          p_class_group_id: string
          p_class_id: string
          p_class_ids: string[]
          p_combo_teacher: string
          p_inst: string
          p_scope_label: string
          p_subject_id: string
          p_teacher_id: string
        }
        Returns: Json
      }
      dash_teacher_action_queue: { Args: never; Returns: Json }
      dash_teacher_attendance_trend: {
        Args: { p_class_id?: string; p_days?: number }
        Returns: Json
      }
      dash_teacher_class_subjects: { Args: never; Returns: Json }
      dash_teacher_exam_trend: {
        Args: { p_class_id?: string; p_limit?: number; p_subject_id?: string }
        Returns: Json
      }
      dash_teacher_header: { Args: never; Returns: Json }
      dash_teacher_kpi_summary: { Args: never; Returns: Json }
      dash_teacher_portal_adoption: {
        Args: { p_class_id?: string }
        Returns: Json
      }
      dash_teacher_portal_laggards: {
        Args: { p_limit?: number }
        Returns: Json
      }
      dash_teacher_roster_gap: { Args: never; Returns: Json }
      dash_teacher_student_distribution: {
        Args: { p_class_id?: string }
        Returns: Json
      }
      dash_teacher_students_attention: {
        Args: { p_limit?: number }
        Returns: Json
      }
      dash_teacher_subject_performance: {
        Args: { p_class_id: string }
        Returns: Json
      }
      dash_teacher_syllabus_chapters: {
        Args: { p_class_id?: string; p_subject_id?: string }
        Returns: Json
      }
      dash_teacher_syllabus_coverage: { Args: never; Returns: Json }
      dash_teacher_weak_chapters: { Args: { p_limit?: number }; Returns: Json }
      dash_teachers_table: {
        Args: {
          p_filters?: Json
          p_institution_id?: string
          p_limit?: number
          p_offset?: number
        }
        Returns: Json
      }
      dash_wing_performance: {
        Args: { p_institution_id?: string }
        Returns: {
          avg_pct: number
          classes: number
          coordinators: string
          students: number
          wing_id: string
          wing_name: string
        }[]
      }
      dash5_assign_context: {
        Args: {
          p_class_id?: string
          p_institution_id?: string
          p_subject_id?: string
          p_wing_id?: string
        }
        Returns: Json
      }
      dash5_atom_rows: {
        Args: { p_inst: string }
        Returns: {
          acc: number
          att_present: number
          att_total: number
          attempts: number
          chapters: number
          chapters_done: number
          chapters_partial: number
          class_group_id: string
          class_id: string
          hw_slots: number
          hw_submitted: number
          lessons_planned: number
          lessons_taught: number
          papers: number
          pending_grading: number
          students: number
          subject_id: string
          subject_key: string
          wing_id: string
          wk_done: number
          wk_planned: number
        }[]
      }
      dash5_attendance_by_wing: {
        Args: { p_institution_id?: string }
        Returns: Json
      }
      dash5_attendance_series: {
        Args: { p_days?: number; p_institution_id?: string }
        Returns: Json
      }
      dash5_band: { Args: { p_score: number }; Returns: string }
      dash5_band_classes: {
        Args: { p_band: string; p_institution_id?: string; p_wing_id: string }
        Returns: Json
      }
      dash5_tree_targets: {
        Args: {
          p_class_id?: string
          p_institution_id?: string
          p_level?: string
          p_wing_id?: string
        }
        Returns: Json
      }
      dash5_band_donut: {
        Args: { p_institution_id?: string; p_wing_id?: string }
        Returns: Json
      }
      dash5_chronic_absentees: {
        Args: {
          p_class_id?: string
          p_days?: number
          p_institution_id?: string
          p_limit?: number
          p_streak?: number
          p_threshold?: number
          p_wing_id?: string
        }
        Returns: Json
      }
      dash5_communication: {
        Args: { p_institution_id?: string }
        Returns: Json
      }
      dash5_composite: {
        Args: {
          p_accuracy: number
          p_attendance: number
          p_lesson_pct: number
          p_syllabus: number
        }
        Returns: number
      }
      dash5_coord_attendance_by_class: { Args: { p_days?: number }; Returns: Json }
      dash5_coord_cards: { Args: Record<PropertyKey, never>; Returns: Json }
      dash5_coord_classes: { Args: Record<PropertyKey, never>; Returns: Json }
      dash5_coord_communication: { Args: Record<PropertyKey, never>; Returns: Json }
      dash5_coord_cover: { Args: { p_date?: string }; Returns: Json }
      dash5_coord_desk: { Args: Record<PropertyKey, never>; Returns: Json }
      dash5_coord_leave: { Args: { p_limit?: number }; Returns: Json }
      dash5_coord_lesson_plans: {
        Args: { p_class_id?: string; p_week_start?: string }
        Returns: Json
      }
      dash5_coord_log_backlog: { Args: Record<PropertyKey, never>; Returns: Json }
      dash5_coord_my_tasks: { Args: { p_limit?: number }; Returns: Json }
      dash5_coord_rechecks: { Args: { p_limit?: number }; Returns: Json }
      dash5_coord_scope: { Args: Record<PropertyKey, never>; Returns: Json }
      dash5_coord_subjects: { Args: { p_class_id?: string }; Returns: Json }
      dash5_coord_staff: { Args: Record<PropertyKey, never>; Returns: Json }
      dash5_coord_task_suggestions: { Args: Record<PropertyKey, never>; Returns: Json }
      dash5_coordinators: { Args: { p_institution_id?: string }; Returns: Json }
      dash5_exam_papers: {
        Args: {
          p_class_id?: string
          p_from?: string
          p_institution_id?: string
          p_limit?: number
          p_to?: string
          p_wing_id?: string
        }
        Returns: Json
      }
      dash5_exam_pipeline: {
        Args: {
          p_class_id?: string
          p_institution_id?: string
          p_subject_id?: string
          p_wing_id?: string
        }
        Returns: Json
      }
      dash5_filter_options: {
        Args: { p_institution_id?: string }
        Returns: Json
      }
      dash5_needs_by_wing: {
        Args: { p_institution_id?: string }
        Returns: Json
      }
      dash5_never_signed_in: {
        Args: {
          p_institution_id?: string
          p_limit?: number
          p_wing_id?: string
        }
        Returns: Json
      }
      dash5_paper_detail: {
        Args: {
          p_class_id: string
          p_exam_id: string
          p_institution_id?: string
        }
        Returns: Json
      }
      dash5_report_attendance: {
        Args: { p_institution_id?: string }
        Returns: Json
      }
      dash5_report_core: {
        Args: { p_institution_id?: string }
        Returns: Json
      }
      dash5_report_students: {
        Args: { p_institution_id?: string }
        Returns: Json
      }
      dash5_school_wide_needs: {
        Args: { p_institution_id?: string }
        Returns: Json
      }
      dash5_score_distribution: {
        Args: { p_institution_id?: string; p_wing_id?: string }
        Returns: Json
      }
      dash5_student_context: {
        Args: { p_institution_id?: string; p_student_id: string }
        Returns: Json
      }
      dash5_student_counts: {
        Args: { p_inst: string }
        Returns: {
          below_floor: number
          never_in: number
          students: number
          wing_id: string
        }[]
      }
      dash5_student_rows: {
        Args: { p_inst: string }
        Returns: {
          active7: boolean
          at_risk: boolean
          attendance_pct: number
          band: string
          class_id: string
          class_label: string
          full_name: string
          homework_pct: number
          never_in: boolean
          roll: string
          score: number
          student_id: string
          submission_pct: number
          wing_id: string
        }[]
      }
      dash5_student_subjects: {
        Args: { p_class_id: string; p_institution_id?: string }
        Returns: Json
      }
      dash5_student_tree: {
        Args: {
          p_class_id?: string
          p_institution_id?: string
          p_level?: string
          p_wing_id?: string
        }
        Returns: Json
      }
      dash5_students_at_risk: {
        Args: {
          p_class_id?: string
          p_institution_id?: string
          p_limit?: number
          p_offset?: number
          p_wing_id?: string
        }
        Returns: Json
      }
      dash5_subject_chapters: {
        Args: {
          p_class_id: string
          p_institution_id?: string
          p_subject_id: string
        }
        Returns: Json
      }
      dash5_subject_roster: {
        Args: {
          p_class_id: string
          p_institution_id?: string
          p_limit?: number
          p_subject_id: string
        }
        Returns: Json
      }
      dash5_task_suggestions: {
        Args: { p_institution_id?: string }
        Returns: Json
      }
      dash5_teacher_activity: {
        Args: { p_institution_id?: string; p_wing_id?: string }
        Returns: Json
      }
      dash5_tree: {
        Args: {
          p_class_id?: string
          p_institution_id?: string
          p_level?: string
          p_wing_id?: string
        }
        Returns: Json
      }
      delete_institution_subject: {
        Args: { _class_name?: string; _subject_id: string }
        Returns: Json
      }
      delete_optional_group: { Args: { _group_id: string }; Returns: undefined }
      delete_syllabus_progress: {
        Args: {
          p_class_id: string
          p_date: string
          p_subject_id: string
          p_topic_id: string
        }
        Returns: Json
      }
      delete_syllabus_segment: {
        Args: { _segment_id: string }
        Returns: undefined
      }
      delete_task: {
        Args: { p_apply_to_group?: boolean; p_task_id: string }
        Returns: Json
      }
      diary_can_manage: {
        Args: { _entry_id: string; _user_id: string }
        Returns: boolean
      }
      diary_can_read: {
        Args: { _entry_id: string; _user_id: string }
        Returns: boolean
      }
      diary_can_write_for: {
        Args: { _class_id: string; _student_id: string; _user_id: string }
        Returns: boolean
      }
      diary_delete_entry: { Args: { _entry_id: string }; Returns: undefined }
      diary_feed: {
        Args: {
          _before_created_at?: string
          _before_id?: string
          _class_id?: string
          _kind?: string
          _limit?: number
          _student_id?: string
        }
        Returns: {
          author_id: string
          author_name: string
          body: string
          can_manage: boolean
          class_id: string
          class_label: string
          created_at: string
          due_date: string
          entry_date: string
          id: string
          kind: string
          student_id: string
          student_name: string
          title: string
        }[]
      }
      diary_write_entry: {
        Args: {
          _body?: string
          _class_id: string
          _due_date?: string
          _entry_id: string
          _kind?: string
          _student_id?: string
          _title?: string
        }
        Returns: string
      }
      ensure_onboarding_snapshot: {
        Args: { _institution_id: string }
        Returns: {
          avg_completion_percent: number
          created_at: string
          created_by: string | null
          fully_complete_count: number
          id: string
          institution_id: string
          milestone_counts: Json
          per_user_data: Json
          snapshot_date: string
          total_users: number
        }
        SetofOptions: {
          from: "*"
          to: "onboarding_snapshots"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      ensure_support_institution: { Args: never; Returns: string }
      evaluate_homework_badges: { Args: { _user_id: string }; Returns: number }
      evaluate_student_badges: {
        Args: { _notify?: boolean; _scopes?: string[]; _user_id: string }
        Returns: number
      }
      evaluate_student_badges_safe: {
        Args: { _scopes?: string[]; _user_id: string }
        Returns: undefined
      }
      evaluate_teacher_badges: {
        Args: { _notify?: boolean; _user_id: string }
        Returns: number
      }
      exam_attempt_remaining_seconds: {
        Args: { _attempt_id: string }
        Returns: number
      }
      exam_has_blueprint: { Args: { _exam_id: string }; Returns: boolean }
      exam_has_complete_blueprint: {
        Args: { _exam_id: string }
        Returns: boolean
      }
      exam_marking_eligible_students: {
        Args: { _exam: string }
        Returns: {
          student_id: string
        }[]
      }
      exam_visible_to_student: {
        Args: { _exam: string; _student: string }
        Returns: boolean
      }
      generate_fee_receipt_number: {
        Args: { _institution_id: string }
        Returns: string
      }
      generate_receipt_number: { Args: never; Returns: string }
      generate_subscription_alerts: { Args: never; Returns: undefined }
      get_answer_attempt_id: { Args: { _answer_id: string }; Returns: string }
      get_attempt_class_id: { Args: { _attempt_id: string }; Returns: string }
      get_attempt_exam_id: { Args: { _attempt_id: string }; Returns: string }
      get_attempt_remaining_time: {
        Args: { _attempt_id: string }
        Returns: number
      }
      get_attempt_student_id: { Args: { _attempt_id: string }; Returns: string }
      get_class_institution: { Args: { _class_id: string }; Returns: string }
      get_exam_institution: { Args: { _exam_id: string }; Returns: string }
      get_exam_paper: { Args: { _exam_id: string }; Returns: Json }
      get_exam_result_progress: {
        Args: { _exam_ids: string[] }
        Returns: {
          exam_id: string
          published_results: number
          submitted_attempts: number
        }[]
      }
      get_exam_window_status: {
        Args: { p_exam_id: string }
        Returns: {
          active_attempt_count: number
          end_time: string
          is_window_closed: boolean
          is_window_open: boolean
          start_time: string
          time_until_end: string
          time_until_start: string
        }[]
      }
      get_extraction_upload_id: {
        Args: { _extraction_id: string }
        Returns: string
      }
      get_institution_fee_analytics: {
        Args: { _institution_id: string }
        Returns: {
          collection_rate: number
          defaulter_count: number
          total_collected: number
          total_expected: number
          total_overdue: number
          total_pending: number
          total_students: number
        }[]
      }
      get_institution_onboarding_progress: {
        Args: { _institution_id: string }
        Returns: {
          completed_count: number
          completion_percent: number
          email: string
          first_exam_published: boolean
          first_result_validated: boolean
          first_study_material_uploaded: boolean
          first_task_assigned: boolean
          first_task_completed: boolean
          full_name: string
          is_journey_completed: boolean
          role: string
          user_id: string
        }[]
      }
      get_question_bank_stats: {
        Args: {
          p_case_study_only?: boolean
          p_class_group_ids?: string[]
          p_exclude_case_study?: boolean
          p_exclude_sub_questions?: boolean
          p_global_only?: boolean
          p_institution_id?: string
          p_question_types?: string[]
          p_search?: string
          p_subject_id?: string
          p_subject_ids?: string[]
          p_topic_id?: string
        }
        Returns: {
          avg_marks: number
          distinct_types: number
          total_questions: number
        }[]
      }
      get_question_institution_id: {
        Args: { _question_id: string }
        Returns: string
      }
      get_school_exam_analytics: {
        Args: { _institution_id: string }
        Returns: Json
      }
      get_section_exam_id: { Args: { _section_id: string }; Returns: string }
      get_student_class_group_ids: {
        Args: { p_user_id: string }
        Returns: string[]
      }
      get_student_fee_summary: {
        Args: { _student_id: string }
        Returns: {
          total_fees: number
          total_late_fees: number
          total_overdue: number
          total_paid: number
          total_pending: number
        }[]
      }
      get_student_optional_group_assignment: {
        Args: { _student: string }
        Returns: Json
      }
      get_student_subject_assignment: {
        Args: { _student: string }
        Returns: Json
      }
      get_support_institution_id: { Args: never; Returns: string }
      get_support_owner_id: { Args: never; Returns: string }
      get_support_thread: {
        Args: { p_before?: string; p_limit?: number; p_ticket_id: string }
        Returns: Json
      }
      get_support_ticket_transcript: {
        Args: { p_ticket_id: string }
        Returns: Json
      }
      get_task_assignee: { Args: { _task_id: string }; Returns: string }
      get_task_assigner: { Args: { _task_id: string }; Returns: string }
      get_task_institution: { Args: { _task_id: string }; Returns: string }
      get_task_participant_profiles: {
        Args: { p_task_id: string }
        Returns: {
          assignee_email: string
          assignee_id: string
          assignee_name: string
          assigner_email: string
          assigner_id: string
          assigner_name: string
          supervisor_email: string
          supervisor_id: string
          supervisor_name: string
        }[]
      }
      get_task_supervisor: { Args: { _task_id: string }; Returns: string }
      get_top_institution_symbols: {
        Args: { p_limit?: number }
        Returns: {
          last_used_at: string
          symbol: string
          usage_count: number
        }[]
      }
      get_upload_class: { Args: { _upload_id: string }; Returns: string }
      get_upload_institution: { Args: { _upload_id: string }; Returns: string }
      get_user_institution: { Args: { _user_id: string }; Returns: string }
      get_user_institution_secure: {
        Args: { _user_id: string }
        Returns: string
      }
      get_user_onboarding_progress: {
        Args: { _user_id: string }
        Returns: {
          completed_count: number
          completion_percent: number
          email: string
          first_exam_published: boolean
          first_result_validated: boolean
          first_study_material_uploaded: boolean
          first_task_assigned: boolean
          first_task_completed: boolean
          full_name: string
          institution_id: string
          is_journey_completed: boolean
          role: string
          user_id: string
        }[]
      }
      grant_teacher_role: {
        Args: { _pairs?: Json; _user_id: string }
        Returns: Json
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      has_role_at_institution: {
        Args: {
          _institution_id: string
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      has_submitted_attempt_for_exam: {
        Args: { _exam_id: string; _user_id: string }
        Returns: boolean
      }
      has_super_admin_access: { Args: { _user_id: string }; Returns: boolean }
      homework_analytics_rollup: {
        Args: { _institution_id: string }
        Returns: Json
      }
      homework_auto_check_pass: { Args: never; Returns: number }
      homework_delete: { Args: { _homework_id: string }; Returns: string }
      homework_list_counts: {
        Args: { _homework_ids: string[] }
        Returns: {
          graded_count: number
          homework_assignment_id: string
          submitted_count: number
          total_students: number
        }[]
      }
      homework_marking_roster: {
        Args: { _homework_id: string }
        Returns: {
          class_id: string
          class_name: string
          class_section: string
          feedback: string
          full_name: string
          is_late: boolean
          marks_awarded: number
          result_status: string
          roll_number: string
          student_id: string
          submission_id: string
          submitted_at: string
        }[]
      }
      homework_open_for_submission: {
        Args: { _homework_id: string; _user_id: string }
        Returns: boolean
      }
      homework_publish_marks: { Args: { _homework_id: string }; Returns: Json }
      homework_student_feed: { Args: never; Returns: Json }
      homework_student_feed_for: {
        Args: { p_student_id: string }
        Returns: Json
      }
      homework_upsert_roster_marks: {
        Args: { _homework_id: string; _marks: Json }
        Returns: number
      }
      homework_visible_to_student: {
        Args: { _homework_id: string; _user_id: string }
        Returns: boolean
      }
      hybrid_close_expired_upload_windows: { Args: never; Returns: number }
      insert_question_with_scope: {
        Args: { _q: Json; _scope_class_ids: string[] }
        Returns: string
      }
      institution_student_count: {
        Args: { _institution: string }
        Returns: number
      }
      institution_student_ids: {
        Args: { _institution: string }
        Returns: {
          student_id: string
        }[]
      }
      is_assigned_to_class: {
        Args: { _class_id: string; _user_id: string }
        Returns: boolean
      }
      is_assigned_to_exam_class: {
        Args: { _exam_id: string; _user_id: string }
        Returns: boolean
      }
      is_attempt_finalized: { Args: { _attempt_id: string }; Returns: boolean }
      is_conversation_participant: {
        Args: { _conversation_id: string; _user_id: string }
        Returns: boolean
      }
      is_coordinator_for_class: {
        Args: { _class_id: string; _user_id: string }
        Returns: boolean
      }
      is_exam_attemptable: { Args: { _exam_id: string }; Returns: boolean }
      is_exam_creator: {
        Args: { _exam_id: string; _user_id: string }
        Returns: boolean
      }
      is_exam_modifiable: { Args: { _exam_id: string }; Returns: boolean }
      is_institution_admin: {
        Args: { _institution_id: string; _user_id: string }
        Returns: boolean
      }
      is_staff_for_exam_class: {
        Args: { _exam_id: string; _user_id: string }
        Returns: boolean
      }
      is_staff_manager: { Args: { _user_id: string }; Returns: boolean }
      is_student_assigned_to_exam: {
        Args: { _exam_id: string; _student_id: string }
        Returns: boolean
      }
      is_student_manager: { Args: { _user_id: string }; Returns: boolean }
      is_super_admin: { Args: { user_id: string }; Returns: boolean }
      is_support_ticket_reporter: {
        Args: { p_ticket: string }
        Returns: boolean
      }
      is_syllabus_manager: { Args: { _user_id: string }; Returns: boolean }
      is_task_supervisor: {
        Args: { _task_id: string; _user_id: string }
        Returns: boolean
      }
      is_teacher_for_class: {
        Args: { _class_id: string; _user_id: string }
        Returns: boolean
      }
      is_teacher_for_exam_class_subject: {
        Args: { _exam_id: string; _user_id: string }
        Returns: boolean
      }
      is_user_assigned_to_class: {
        Args: { _class_id: string; _user_id: string }
        Returns: boolean
      }
      is_uuid: { Args: { p: string }; Returns: boolean }
      leaderboard_badge_breakdown: {
        Args: { _user_id: string }
        Returns: {
          badge_count: number
          criteria_type: string
          latest_at: string
          metric: string
          points: number
          top_badge: string
          top_tier: string
          top_value: number
        }[]
      }
      list_message_recipients: {
        Args: {
          _after_id?: string
          _after_name?: string
          _class_id?: string
          _limit?: number
          _role: string
          _search?: string
        }
        Returns: {
          detail: string
          full_name: string
          user_id: string
        }[]
      }
      list_my_support_tickets: {
        Args: { p_limit?: number; p_offset?: number }
        Returns: Json
      }
      log_audit_event: {
        Args: {
          _action: string
          _entity_id?: string
          _entity_name?: string
          _entity_type: string
          _metadata?: Json
          _new_values?: Json
          _old_values?: Json
        }
        Returns: string
      }
      log_student_activity: {
        Args: { _activity_type: string; _metadata?: Json; _user_id: string }
        Returns: undefined
      }
      log_study_material_open: {
        Args: { _material_id: string }
        Returns: undefined
      }
      log_support_intake_failure: {
        Args: { p_error: string; p_page_url?: string; p_stage: string }
        Returns: undefined
      }
      mark_notice_read: {
        Args: { _acknowledge?: boolean; _notice_id: string }
        Returns: undefined
      }
      mark_onboarding_complete: { Args: { _steps?: Json }; Returns: undefined }
      mark_support_ticket_read: {
        Args: { p_ticket_id: string }
        Returns: undefined
      }
      my_dashboard_actions: { Args: { p_view?: string }; Returns: Json }
      my_optional_slot_choices: {
        Args: { _academic_year: string; _class_id: string }
        Returns: {
          slot_id: string
          subject_id: string
          subject_name: string
          teacher_id: string
          teacher_name: string
        }[]
      }
      my_teacher_optional_week: {
        Args: { _academic_year: string }
        Returns: {
          class_id: string
          class_name: string
          class_section: string
          day: string
          end_time: string
          group_name: string
          notes: string
          period_kind: string
          period_label: string
          period_slot_id: string
          slot_id: string
          start_time: string
          subject_id: string
          subject_name: string
        }[]
      }
      notice_audience_preview: {
        Args: {
          _audience_roles?: string[]
          _class_ids?: string[]
          _scope: string
          _teacher_ids?: string[]
          _wing_ids?: string[]
        }
        Returns: {
          recipient_role: string
          total: number
        }[]
      }
      notice_can_oversee: {
        Args: { _notice_id: string; _user_id: string }
        Returns: boolean
      }
      notice_class_staff: {
        Args: { _class_ids: string[] }
        Returns: {
          detail: string
          full_name: string
          kind: string
          user_id: string
        }[]
      }
      notice_class_students: {
        Args: { _class_ids: string[] }
        Returns: {
          detail: string
          full_name: string
          user_id: string
        }[]
      }
      notice_expand_audience: {
        Args: {
          _audience_roles: string[]
          _author: string
          _class_ids: string[]
          _include_wing_coordinators?: boolean
          _institution_id: string
          _scope: string
          _student_ids?: string[]
          _teacher_ids: string[]
          _wing_ids: string[]
        }
        Returns: {
          added_reason: string
          recipient_role: string
          user_id: string
        }[]
      }
      notice_id_from_path: { Args: { _name: string }; Returns: string }
      notice_inbox: {
        Args: {
          _before_id?: string
          _before_published_at?: string
          _limit?: number
        }
        Returns: {
          acknowledged_at: string
          attachments: Json
          content: string
          expires_at: string
          id: string
          priority: string
          published_at: string
          publisher_name: string
          read_at: string
          requires_acknowledgement: boolean
          scope: string
          title: string
          type: string
        }[]
      }
      notice_is_recipient: {
        Args: { _notice_id: string; _user_id: string }
        Returns: boolean
      }
      notice_outbox: {
        Args: {
          _before_id?: string
          _before_published_at?: string
          _limit?: number
        }
        Returns: {
          ack_count: number
          expires_at: string
          id: string
          priority: string
          published_at: string
          publisher_name: string
          read_count: number
          recipient_count: number
          requires_acknowledgement: boolean
          scope: string
          target_summary: string
          title: string
          type: string
        }[]
      }
      notice_reach: {
        Args: { _notice_id: string }
        Returns: {
          ack_count: number
          read_count: number
          recipient_role: string
          total: number
        }[]
      }
      notice_recipient_list: {
        Args: {
          _after_id?: string
          _after_name?: string
          _limit?: number
          _notice_id: string
          _status?: string
        }
        Returns: {
          acknowledged_at: string
          added_reason: string
          full_name: string
          read_at: string
          recipient_role: string
          user_id: string
        }[]
      }
      notice_target_options: {
        Args: never
        Returns: {
          id: string
          kind: string
          label: string
          sort_key: string
        }[]
      }
      notice_unread_count: { Args: never; Returns: number }
      oly_advance_scheduled_closures: { Args: never; Returns: Json }
      oly_batch_report: { Args: { p_batch_id: string }; Returns: Json }
      oly_batch_school_id: { Args: { p_batch_id: string }; Returns: string }
      oly_campaign_stats: { Args: never; Returns: Json }
      oly_can_read_published_pdf: {
        Args: { p_path: string; p_uid: string }
        Returns: boolean
      }
      oly_cleanup_stuck_attempts: { Args: never; Returns: Json }
      oly_dormancy_day30: { Args: { p_campaign_id?: string }; Returns: Json }
      oly_dormancy_day60: { Args: { p_campaign_id?: string }; Returns: Json }
      oly_enrollment_is_open: {
        Args: { p_oly_school_id: string }
        Returns: boolean
      }
      oly_generate_batch_pin: { Args: never; Returns: string }
      oly_generate_roll_number: {
        Args: {
          p_campaign_year: number
          p_class_label: string
          p_school_short_code: string
        }
        Returns: string
      }
      oly_get_attempt_questions: {
        Args: { p_attempt_id: string }
        Returns: Json
      }
      oly_get_attempt_state: { Args: { p_attempt_id: string }; Returns: Json }
      oly_get_public_school_payment_context: {
        Args: { p_school_code: string }
        Returns: Json
      }
      oly_get_published_result: {
        Args: { p_student_id?: string }
        Returns: Json
      }
      oly_get_published_signed_url_path: {
        Args: { p_kind: string; p_result_id: string }
        Returns: string
      }
      oly_get_student_study_material_path: {
        Args: { p_material_id: string }
        Returns: string
      }
      oly_is_school_admin_for: {
        Args: { p_oly_school_id: string; p_uid: string }
        Returns: boolean
      }
      oly_is_student_of_school: {
        Args: { p_oly_school_id: string; p_uid: string }
        Returns: boolean
      }
      oly_is_teacher_for_class: {
        Args: {
          p_grade_level_id: string
          p_oly_school_id: string
          p_uid: string
        }
        Returns: boolean
      }
      oly_list_salci_roster_for_grade: {
        Args: { p_grade_level_id: string; p_oly_school_id: string }
        Returns: {
          admission_number: string
          already_enrolled: boolean
          date_of_birth: string
          enrolled_roll_number: string
          full_name: string
          guardian_email: string
          guardian_name: string
          guardian_phone: string
          profile_id: string
          section_label: string
        }[]
      }
      oly_lookup_salci_student: {
        Args: { p_admission_number: string; p_school_short_code: string }
        Returns: Json
      }
      oly_next_receipt_number: { Args: { p_year: number }; Returns: string }
      oly_publish_compute_ranks: {
        Args: {
          p_batch_ids?: string[]
          p_grade_level_ids?: string[]
          p_oly_school_id: string
        }
        Returns: Json
      }
      oly_publish_initiate: {
        Args: {
          p_batch_ids?: string[]
          p_grade_level_ids?: string[]
          p_oly_school_id: string
        }
        Returns: Json
      }
      oly_question_bank_view: {
        Args: {
          p_grade_level_id: string
          p_page?: number
          p_page_size?: number
          p_sort?: string
          p_status?: string
          p_subject_id: string
          p_topic_id?: string
        }
        Returns: Json
      }
      oly_questions_upsert: { Args: { p_payload: Json }; Returns: Json }
      oly_record_event: {
        Args: { p_attempt_id: string; p_event_type: string; p_payload?: Json }
        Returns: Json
      }
      oly_regenerate_batch_pin: {
        Args: { p_batch_id: string }
        Returns: string
      }
      oly_save_answer: {
        Args: {
          p_attempt_id: string
          p_marked: boolean
          p_selected: string
          p_snapshot_id: string
          p_time_spent: number
        }
        Returns: Json
      }
      oly_school_class_subject_matrix: {
        Args: { p_oly_school_id: string }
        Returns: {
          class_label: string
          grade_level_id: string
          pct_correct: number
          students: number
          subject_id: string
          subject_name: string
        }[]
      }
      oly_school_derived_stage: {
        Args: { p_oly_school_id: string }
        Returns: string
      }
      oly_school_exam_paper: {
        Args: { p_grade_level_id: string; p_oly_school_id: string }
        Returns: {
          correct_answer: string
          id: string
          image_url: string
          option_a: string
          option_b: string
          option_c: string
          option_d: string
          question_text: string
          subject_id: string
          subject_name: string
          topic_name: string
        }[]
      }
      oly_school_overview: { Args: { p_oly_school_id: string }; Returns: Json }
      oly_school_payment_list: {
        Args: {
          p_channel: string
          p_cursor?: string
          p_cursor_id?: string
          p_limit?: number
          p_oly_school_id: string
        }
        Returns: {
          cursor_id: string
          full_name: string
          gateway_order_id: string
          gateway_payment_id: string
          gst_rupees: number
          oly_student_id: string
          paid_at: string
          roll_number: string
          total_rupees: number
        }[]
      }
      oly_school_report: { Args: { p_oly_school_id: string }; Returns: Json }
      oly_school_result_summary: {
        Args: { p_oly_school_id: string }
        Returns: Json
      }
      oly_school_revenue_by_class: {
        Args: { p_channel?: string; p_oly_school_id: string }
        Returns: {
          grade_level_id: string
          grade_name: string
          revenue_rupees: number
          students: number
        }[]
      }
      oly_school_score_distribution: {
        Args: { p_grade_level_id?: string; p_oly_school_id: string }
        Returns: Json
      }
      oly_school_staff_can_read_material: {
        Args: { _grade_level_id: string; _user_id: string }
        Returns: boolean
      }
      oly_school_subject_topic_stats: {
        Args: {
          p_grade_level_id?: string
          p_oly_school_id: string
          p_subject_id?: string
        }
        Returns: Json
      }
      oly_schools_by_stage: {
        Args: {
          p_bucket: string
          p_campaign_id: string
          p_cursor?: string
          p_cursor_id?: string
          p_limit?: number
          p_school_type?: string
        }
        Returns: {
          city: string
          created_at: string
          derived_stage: string
          enrolled_count: number
          id: string
          institution_name: string
          is_existing: boolean
          school_short_code: string
          state: string
          status: string
        }[]
      }
      oly_set_lab_capacity: {
        Args: { p_lab_pc_counts: number[]; p_oly_school_id: string }
        Returns: number
      }
      oly_start_attempt: { Args: never; Returns: Json }
      oly_student_can_read: {
        Args: { p_oly_student_id: string; p_uid: string }
        Returns: boolean
      }
      oly_student_can_read_material: {
        Args: { _grade_level_id: string; _subject_id: string; _user_id: string }
        Returns: boolean
      }
      oly_student_can_see_batch: {
        Args: { p_batch_id: string; p_uid: string }
        Returns: boolean
      }
      oly_student_dashboard_context: { Args: never; Returns: Json }
      oly_student_login_resolve: {
        Args: { p_dob_iso: string; p_identifier: string }
        Returns: Json
      }
      oly_student_performance_analysis: {
        Args: { p_student_id?: string }
        Returns: Json
      }
      oly_submit_attempt: {
        Args: { p_attempt_id: string; p_reason?: string }
        Returns: Json
      }
      oly_teacher_class_report: {
        Args: { p_grade_level_id: string; p_oly_school_id: string }
        Returns: Json
      }
      oly_user_active_campaign: { Args: { p_uid: string }; Returns: string }
      oly_validate_pin: {
        Args: { p_ip?: string; p_pin: string; p_user_agent?: string }
        Returns: Json
      }
      optional_batch_teacher_can_see: {
        Args: { _actor: string; _batch: string }
        Returns: boolean
      }
      optional_choices_recorded: {
        Args: { _class: string; _subject: string }
        Returns: boolean
      }
      optional_subject_enrolled_students: {
        Args: { _institution: string; _subject: string }
        Returns: {
          class_label: string
          full_name: string
          roll_number: string
          student_id: string
        }[]
      }
      post_support_message: {
        Args: {
          p_attachments?: Json
          p_body: string
          p_client_token?: string
          p_is_internal?: boolean
          p_ticket_id: string
        }
        Returns: Json
      }
      ptm_audience: {
        Args: { _ptm_id: string }
        Returns: {
          is_teacher: boolean
          user_id: string
        }[]
      }
      ptm_class_rows_readable: { Args: { _ptm_id: string }; Returns: boolean }
      ptm_includes_user_class: {
        Args: { _ptm_id: string; _user_id: string }
        Returns: boolean
      }
      ptm_send_day_before_reminders: { Args: never; Returns: number }
      publish_notice: {
        Args: {
          _attachments?: Json
          _audience_roles?: string[]
          _class_ids?: string[]
          _content: string
          _expires_at?: string
          _notice_id: string
          _priority: string
          _requires_acknowledgement?: boolean
          _scope: string
          _teacher_ids?: string[]
          _title: string
          _type: string
          _wing_ids?: string[]
        }
        Returns: string
      }
      question_has_section_scope: {
        Args: { _question_id: string }
        Returns: boolean
      }
      record_syllabus_progress: {
        Args: {
          p_action: string
          p_class_id: string
          p_date: string
          p_source: string
          p_subject_id: string
          p_topic_id: string
        }
        Returns: Json
      }
      record_symbol_usage: { Args: { p_symbol: string }; Returns: undefined }
      register_push_device: {
        Args: {
          _app_version?: string | null
          _device_id?: string | null
          _platform: string
          _token: string
        }
        Returns: undefined
      }
      rename_syllabus_segment: {
        Args: { _name: string; _segment_id: string }
        Returns: undefined
      }
      reorder_syllabus_segments: {
        Args: {
          _class_group_id: string
          _ordered_ids: string[]
          _subject_id: string
        }
        Returns: undefined
      }
      report_scope_class_ids: { Args: { _user_id: string }; Returns: string[] }
      report_staff_attendance: {
        Args: {
          p_from: string
          p_institution_id?: string
          p_limit?: number
          p_offset?: number
          p_to: string
        }
        Returns: {
          by_date: Json
          full_name: string
          role: string
          staff_id: string
          total_count: number
        }[]
      }
      report_student_activity: {
        Args: {
          p_class_id?: string
          p_from: string
          p_institution_id?: string
          p_limit?: number
          p_offset?: number
          p_to: string
        }
        Returns: {
          absent_days: number
          class_name: string
          exams_submitted: number
          exams_taken: number
          full_name: string
          homework_late: number
          homework_submitted: number
          last_sign_in_at: string
          present_days: number
          rechecks_raised: number
          roll_number: string
          section: string
          student_id: string
          total_count: number
        }[]
      }
      report_student_attendance: {
        Args: {
          p_class_id?: string
          p_from: string
          p_institution_id?: string
          p_limit?: number
          p_offset?: number
          p_to: string
        }
        Returns: {
          by_date: Json
          class_id: string
          class_name: string
          full_name: string
          roll_number: string
          section: string
          student_id: string
          total_count: number
        }[]
      }
      reset_password_expiry: { Args: { _user_id: string }; Returns: undefined }
      resolve_flag_assignee: {
        Args: {
          p_institution_id: string
          p_subject_key: string
          p_subject_type: string
        }
        Returns: string
      }
      resolve_grade_level_id_for_class_name: {
        Args: { _name: string }
        Returns: string
      }
      resolve_support_task: {
        Args: { p_note?: string; p_outcome: string; p_task_id: string }
        Returns: undefined
      }
      review_staff_leave: {
        Args: { p_decision: string; p_notes?: string; p_request_id: string }
        Returns: Json
      }
      review_student_leave: {
        Args: { p_decision: string; p_notes?: string; p_request_id: string }
        Returns: Json
      }
      revoke_teacher_role: { Args: { _user_id: string }; Returns: Json }
      save_class_attendance: {
        Args: { p_class_id: string; p_date: string; p_rows: Json }
        Returns: Json
      }
      save_exam_answer: {
        Args: {
          _answer_options?: Json
          _answer_text?: string
          _attempt_id: string
          _question_id: string
        }
        Returns: string
      }
      school_analytics_classes: {
        Args: {
          _assessed_only?: boolean
          _class_id?: string
          _institution_id?: string
          _limit?: number
          _offset?: number
          _range?: string
          _sort?: string
        }
        Returns: Json
      }
      school_analytics_exams: {
        Args: {
          _filters?: Json
          _institution_id?: string
          _limit?: number
          _offset?: number
          _range?: string
        }
        Returns: Json
      }
      school_analytics_guard: {
        Args: { _institution_id?: string }
        Returns: string
      }
      school_analytics_integrity: {
        Args: {
          _class_id?: string
          _institution_id?: string
          _platform?: boolean
          _range?: string
        }
        Returns: Json
      }
      school_analytics_overview: {
        Args: { _class_id?: string; _institution_id?: string; _range?: string }
        Returns: Json
      }
      school_analytics_students: {
        Args: {
          _band?: string
          _class_id?: string
          _institution_id?: string
          _limit?: number
          _offset?: number
          _range?: string
        }
        Returns: Json
      }
      send_direct_messages: {
        Args: { _batch_id: string; _body: string; _recipient_ids: string[] }
        Returns: number
      }
      set_class_teachers: {
        Args: { _class_id: string; _teacher_ids?: string[] }
        Returns: Json
      }
      set_optional_group_subject: {
        Args: { _group_id: string; _member: boolean; _subject_id: string }
        Returns: undefined
      }
      set_segment_chapters: {
        Args: { _chapter_ids: string[]; _segment_id: string }
        Returns: undefined
      }
      set_staff_class_assignments: {
        Args: {
          _kind?: string
          _pairs?: Json
          _role?: Database["public"]["Enums"]["app_role"]
          _scope_class_ids?: string[]
          _user_id: string
        }
        Returns: Json
      }
      set_student_class: {
        Args: { _class: string; _student: string }
        Returns: Json
      }
      set_student_optional_group_choices: {
        Args: { _choices: Json; _student: string }
        Returns: undefined
      }
      set_support_ticket_status: {
        Args: {
          p_client_token?: string
          p_note?: string
          p_status: string
          p_ticket_id: string
        }
        Returns: Json
      }
      set_user_avatar: {
        Args: { _path: string; _target: string }
        Returns: string
      }
      should_auto_lock_attempt: {
        Args: { _attempt_id: string }
        Returns: boolean
      }
      snapshot_student_activity_daily: {
        Args: { _days?: number }
        Returns: number
      }
      start_exam_attempt: {
        Args: { _class_id: string; _exam_id: string }
        Returns: string
      }
      student_achievements: { Args: never; Returns: Json }
      student_achievements_for: {
        Args: { p_student_id: string }
        Returns: Json
      }
      student_attendance_summary: { Args: { p_range?: string }; Returns: Json }
      student_attendance_summary_for: {
        Args: { p_range?: string; p_student_id: string }
        Returns: Json
      }
      student_band_resolution: {
        Args: { _academic_year: string; _class_id: string; _student: string }
        Returns: {
          band_slot_id: string
          batch_id: string
          subject_id: string
          subject_name: string
          teacher_id: string
          teacher_name: string
        }[]
      }
      student_blocked_subject_ids: {
        Args: { _student: string }
        Returns: string[]
      }
      student_chapter_analysis: {
        Args: {
          p_exam_type?: string
          p_from?: string
          p_last_n?: number
          p_subject: string
        }
        Returns: Json
      }
      student_chapter_performance: { Args: never; Returns: Json }
      student_chapter_performance_for: {
        Args: { p_student_id: string }
        Returns: Json
      }
      student_exam_class_comparison: {
        Args: { p_attempt_id: string }
        Returns: Json
      }
      student_hybrid_class_comparison: {
        Args: { p_attempt_id: string }
        Returns: Json
      }
      student_in_class: {
        Args: { _class: string; _student: string }
        Returns: boolean
      }
      student_in_class_group: {
        Args: { _class_group_id: string; _user_id: string }
        Returns: boolean
      }
      student_local_date: { Args: { _user_id: string }; Returns: string }
      student_overall_class_standing: { Args: never; Returns: Json }
      student_overall_class_standing_for: {
        Args: { p_student_id: string }
        Returns: Json
      }
      student_performance_trend: {
        Args: { p_range?: string; p_subject?: string }
        Returns: Json
      }
      student_performance_trend_for: {
        Args: { p_range?: string; p_student_id: string; p_subject?: string }
        Returns: Json
      }
      student_resolve_classes: { Args: never; Returns: string[] }
      student_roster_anomalies: {
        Args: never
        Returns: {
          detail: string
          institution: string
          kind: string
          student_id: string
          student_name: string
        }[]
      }
      student_score_trend: { Args: { p_limit?: number }; Returns: Json }
      student_score_trend_for: {
        Args: { p_limit?: number; p_student_id: string }
        Returns: Json
      }
      student_streak: { Args: { _user_id?: string }; Returns: Json }
      student_streak_for: { Args: { p_student_id: string }; Returns: Json }
      student_subject_class_comparison: { Args: never; Returns: Json }
      student_subject_class_comparison_for: {
        Args: { p_student_id: string }
        Returns: Json
      }
      student_visible_subject_ids: {
        Args: { _student: string }
        Returns: string[]
      }
      student_year_report: { Args: never; Returns: Json }
      student_year_report_for: { Args: { p_student_id: string }; Returns: Json }
      submit_exam_attempt: {
        Args: { _attempt_id: string; _auto_submit?: boolean }
        Returns: boolean
      }
      support_backfill_mirror_tasks: { Args: never; Returns: Json }
      support_health: { Args: never; Returns: Json }
      support_inbox_counts: {
        Args: { p_institution_id?: string; p_role?: string; p_status?: string }
        Returns: Json
      }
      support_inbox_stats: {
        Args: { p_institution_id?: string; p_role?: string }
        Returns: Json
      }
      syllabus_progress_state: {
        Args: { p_class_id: string; p_date?: string; p_subject_id: string }
        Returns: Json
      }
      task_has_evidence: { Args: { _task_id: string }; Returns: boolean }
      teacher_achievements: { Args: never; Returns: Json }
      teacher_badge_rarity: { Args: never; Returns: Json }
      teacher_controls_student: {
        Args: { _student: string; _teacher: string }
        Returns: boolean
      }
      teacher_engagement_standing: { Args: never; Returns: Json }
      teacher_pending_syllabus_days: {
        Args: { p_include_today?: boolean }
        Returns: Json
      }
      teacher_projection_for_range: {
        Args: { p_from: string; p_to: string }
        Returns: Json
      }
      teacher_roster_student_ids:
        | {
            Args: { _class_ids: string[]; _teacher: string }
            Returns: {
              student_id: string
            }[]
          }
        | {
            Args: { _class_ids: string[]; _subject: string; _teacher: string }
            Returns: {
              student_id: string
            }[]
          }
      tgt_can_manage: {
        Args: { _institution: string; _user: string }
        Returns: boolean
      }
      tgt_count_exams_awaiting_results: {
        Args: {
          _from: string
          _institution: string
          _teacher: string
          _to: string
        }
        Returns: number
      }
      tgt_count_exams_published: {
        Args: {
          _from: string
          _institution: string
          _teacher: string
          _to: string
        }
        Returns: number
      }
      tgt_count_homework_published: {
        Args: {
          _from: string
          _institution: string
          _teacher: string
          _to: string
          _tz: string
        }
        Returns: number
      }
      tgt_create_teacher_targets: {
        Args: {
          _cadence_n?: number
          _cadence_unit?: string
          _ends_on: string
          _metric: string
          _note?: string
          _starts_on: string
          _target_value: number
          _teacher_ids: string[]
        }
        Returns: Json
      }
      tgt_create_wing_target: {
        Args: {
          _cadence_n?: number
          _cadence_unit?: string
          _coordinator_id: string
          _ends_on: string
          _metric: string
          _note?: string
          _starts_on: string
          _target_value: number
          _wing_id: string
        }
        Returns: Json
      }
      tgt_eligible: {
        Args: { _institution: string; _user: string }
        Returns: boolean
      }
      tgt_evaluate_targets: {
        Args: { _institution_id?: string }
        Returns: Json
      }
      tgt_interval: { Args: { _n: number; _unit: string }; Returns: string }
      tgt_my_targets: { Args: never; Returns: Json }
      tgt_open_period: { Args: { _target: string }; Returns: Json }
      tgt_owns_target: {
        Args: { _target: string; _user: string }
        Returns: boolean
      }
      tgt_periods: {
        Args: {
          _ends_on: string
          _n: number
          _starts_on: string
          _unit: string
          _upto: string
        }
        Returns: {
          period_end: string
          period_index: number
          period_start: string
        }[]
      }
      tgt_split_wing_target: {
        Args: { _allocations: Json; _parent_id: string }
        Returns: Json
      }
      tgt_stop_target: { Args: { _target_id: string }; Returns: Json }
      tgt_targets_overview: { Args: { _metric?: string }; Returns: Json }
      tgt_wing_teachers: {
        Args: { _wing_id: string }
        Returns: {
          email: string
          full_name: string
          id: string
        }[]
      }
      tt_assign_substitute: {
        Args: { p_sub_id: string; p_substitute_id: string }
        Returns: {
          assigned_at: string | null
          assigned_by: string | null
          cancelled_reason: string | null
          created_at: string
          created_by: string | null
          date: string
          id: string
          original_teacher_id: string | null
          reason: string | null
          slot_id: string
          source: string
          status: string
          substitute_teacher_id: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tt_substitutions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      tt_class_fill_counts: {
        Args: { _academic_year: string; _class_ids: string[] }
        Returns: {
          class_id: string
          filled: number
          last_edit: string
        }[]
      }
      tt_create_pending_subs_for_absent_staff: {
        Args: { p_date: string; p_institution_id: string }
        Returns: number
      }
      tt_dow_to_text: { Args: { p_date: string }; Returns: string }
      tt_get_free_teachers_for_slot: {
        Args: { p_date: string; p_slot_id: string }
        Returns: {
          full_name: string
          rank: number
          same_class_group: boolean
          same_subject: boolean
          subs_today: number
          teacher_id: string
        }[]
      }
      tt_is_timetable_manager: { Args: { _user_id: string }; Returns: boolean }
      tt_lesson_plan_export: {
        Args: {
          p_class_group_id?: string
          p_class_id?: string
          p_institution_id?: string
          p_period?: string
          p_subject_id?: string
          p_teacher_id?: string
        }
        Returns: Json
      }
      tt_lesson_plan_export_filters: {
        Args: { p_institution_id?: string }
        Returns: Json
      }
      tt_record_period_note: {
        Args: {
          p_class_id: string
          p_date: string
          p_note: string
          p_slot_id?: string
          p_subject_id: string
        }
        Returns: string
      }
      tt_run_attendance_cron_pass: {
        Args: never
        Returns: {
          institution_id: string
          staff_marked: number
          subs_generated: number
        }[]
      }
      tt_run_attendance_pass_for_institution: {
        Args: { p_institution_id: string }
        Returns: {
          institution_id: string
          staff_marked: number
          subs_generated: number
        }[]
      }
      tt_set_publish_status: {
        Args: { p_academic_year: string; p_class_id: string; p_status: string }
        Returns: undefined
      }
      tt_slot_covers_subject: {
        Args: { _slot_group: string; _slot_subject: string; _subject: string }
        Returns: boolean
      }
      tt_slot_has_substitute_for: {
        Args: { p_slot_id: string; p_user: string }
        Returns: boolean
      }
      tt_slot_institution: { Args: { p_slot_id: string }; Returns: string }
      tt_user_can_edit_class_slots: {
        Args: { p_class: string; p_user: string }
        Returns: boolean
      }
      tt_user_can_edit_slot: {
        Args: { p_slot_id: string; p_user: string }
        Returns: boolean
      }
      unassign_subject_from_class: {
        Args: { _class_id: string; _subject_id: string }
        Returns: Json
      }
      update_student_details: {
        Args: {
          _admission_number: string
          _date_of_birth: string
          _full_name: string
          _guardian_email: string
          _guardian_name: string
          _guardian_phone: string
          _phone: string
          _roll_number: string
          _student: string
        }
        Returns: undefined
      }
      upsert_optional_group: {
        Args: { _class_group_id: string; _name: string }
        Returns: string
      }
      user_can_grade_exam: {
        Args: { _exam_id: string; _user_id: string }
        Returns: boolean
      }
      user_is_in_question_scope: {
        Args: { _question_id: string; _user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      answer_source: "online" | "offline_ocr" | "offline_manual"
      app_role:
        | "super_admin"
        | "school_admin"
        | "coordinator"
        | "teacher"
        | "student"
        | "employee"
        | "super_school_admin"
      attempt_action:
        | "started"
        | "resumed"
        | "answer_saved"
        | "answer_changed"
        | "submitted"
        | "auto_submitted"
        | "timed_out"
        | "abandoned"
      evaluation_status:
        | "pending"
        | "ai_evaluated"
        | "teacher_reviewed"
        | "finalized"
        | "disputed"
      exam_mode: "online" | "offline" | "hybrid"
      exam_status:
        | "draft"
        | "ready"
        | "published"
        | "active"
        | "completed"
        | "archived"
      question_type:
        | "mcq"
        | "short_answer"
        | "long_answer"
        | "true_false"
        | "fill_blank"
        | "matching"
        | "comprehension"
        | "numerical"
        | "match_column"
      section_type:
        | "mcq"
        | "true_false"
        | "fill_blank"
        | "short_answer"
        | "long_answer"
        | "matching"
        | "comprehension"
        | "case_study"
      task_status:
        | "open"
        | "in_progress"
        | "done_pending_approval"
        | "completed"
        | "rejected"
      task_type:
        | "exam_related"
        | "academic_content"
        | "student_support"
        | "administrative"
        | "general"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      answer_source: ["online", "offline_ocr", "offline_manual"],
      app_role: [
        "super_admin",
        "school_admin",
        "coordinator",
        "teacher",
        "student",
        "employee",
        "super_school_admin",
      ],
      attempt_action: [
        "started",
        "resumed",
        "answer_saved",
        "answer_changed",
        "submitted",
        "auto_submitted",
        "timed_out",
        "abandoned",
      ],
      evaluation_status: [
        "pending",
        "ai_evaluated",
        "teacher_reviewed",
        "finalized",
        "disputed",
      ],
      exam_mode: ["online", "offline", "hybrid"],
      exam_status: [
        "draft",
        "ready",
        "published",
        "active",
        "completed",
        "archived",
      ],
      question_type: [
        "mcq",
        "short_answer",
        "long_answer",
        "true_false",
        "fill_blank",
        "matching",
        "comprehension",
        "numerical",
        "match_column",
      ],
      section_type: [
        "mcq",
        "true_false",
        "fill_blank",
        "short_answer",
        "long_answer",
        "matching",
        "comprehension",
        "case_study",
      ],
      task_status: [
        "open",
        "in_progress",
        "done_pending_approval",
        "completed",
        "rejected",
      ],
      task_type: [
        "exam_related",
        "academic_content",
        "student_support",
        "administrative",
        "general",
      ],
    },
  },
} as const

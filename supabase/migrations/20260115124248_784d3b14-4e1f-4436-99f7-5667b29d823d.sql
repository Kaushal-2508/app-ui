-- Add topper tracking columns to class_aggregates
ALTER TABLE public.class_aggregates 
ADD COLUMN IF NOT EXISTS topper_student_id UUID REFERENCES public.profiles(id),
ADD COLUMN IF NOT EXISTS topper_accuracy_percent NUMERIC(5,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS topper_time_per_question_seconds NUMERIC(8,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS topper_name TEXT;

-- Add subject_id column to class_aggregates for subject-wise aggregates
ALTER TABLE public.class_aggregates 
ADD COLUMN IF NOT EXISTS subject_id UUID REFERENCES public.subjects(id),
ADD COLUMN IF NOT EXISTS subject_name TEXT;

-- Enhance school_aggregates with more structured data
ALTER TABLE public.school_aggregates 
ADD COLUMN IF NOT EXISTS grade_section_heatmap JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS underperforming_classes JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS teacher_effectiveness JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS subject_overview JSONB DEFAULT '[]'::jsonb;

-- Add teacher performance tracking to teacher_aggregates
ALTER TABLE public.teacher_aggregates 
ADD COLUMN IF NOT EXISTS classes_taught INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS school_avg_accuracy NUMERIC(5,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS performance_gap NUMERIC(5,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS remark TEXT;

-- Add efficiency and comparison data to student_performance_snapshots
ALTER TABLE public.student_performance_snapshots 
ADD COLUMN IF NOT EXISTS class_avg_accuracy NUMERIC(5,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS topper_accuracy NUMERIC(5,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS deviation_from_class NUMERIC(5,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS deviation_from_topper NUMERIC(5,2) DEFAULT 0;

-- Create index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_class_aggregates_subject ON public.class_aggregates(subject_id);
CREATE INDEX IF NOT EXISTS idx_class_aggregates_topper ON public.class_aggregates(topper_student_id);
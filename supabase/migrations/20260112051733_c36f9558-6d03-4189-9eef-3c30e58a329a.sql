
-- Badge definitions table
CREATE TABLE public.badge_definitions (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    icon_name VARCHAR(50) NOT NULL DEFAULT 'award',
    badge_type VARCHAR(50) NOT NULL,
    category VARCHAR(50) NOT NULL,
    tier VARCHAR(20) NOT NULL DEFAULT 'bronze',
    criteria_type VARCHAR(50) NOT NULL,
    criteria_value INTEGER NOT NULL DEFAULT 1,
    criteria_metric VARCHAR(100) NOT NULL,
    points INTEGER NOT NULL DEFAULT 10,
    is_active BOOLEAN NOT NULL DEFAULT true,
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- User badges (earned badges)
CREATE TABLE public.user_badges (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    badge_id UUID NOT NULL REFERENCES public.badge_definitions(id) ON DELETE CASCADE,
    institution_id UUID REFERENCES public.institutions(id) ON DELETE CASCADE,
    earned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    source_entity_id UUID,
    source_entity_type VARCHAR(50),
    metadata JSONB DEFAULT '{}',
    is_featured BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    UNIQUE(user_id, badge_id, source_entity_id)
);

-- Badge progress tracking
CREATE TABLE public.badge_progress (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    badge_id UUID NOT NULL REFERENCES public.badge_definitions(id) ON DELETE CASCADE,
    institution_id UUID REFERENCES public.institutions(id) ON DELETE CASCADE,
    current_value INTEGER NOT NULL DEFAULT 0,
    target_value INTEGER NOT NULL,
    last_updated TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    UNIQUE(user_id, badge_id)
);

-- User activity log for portal usage tracking
CREATE TABLE public.user_activity_log (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    institution_id UUID REFERENCES public.institutions(id),
    activity_type VARCHAR(50) NOT NULL,
    activity_date DATE NOT NULL DEFAULT CURRENT_DATE,
    count INTEGER NOT NULL DEFAULT 1,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    UNIQUE(user_id, activity_type, activity_date)
);

-- Student Learning Passport table
CREATE TABLE public.student_passport (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    institution_id UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
    total_exams_taken INTEGER NOT NULL DEFAULT 0,
    total_exams_passed INTEGER NOT NULL DEFAULT 0,
    average_percentage DECIMAL(5,2) DEFAULT 0,
    highest_percentage DECIMAL(5,2) DEFAULT 0,
    total_study_hours INTEGER DEFAULT 0,
    login_streak_current INTEGER DEFAULT 0,
    login_streak_max INTEGER DEFAULT 0,
    total_badges_earned INTEGER DEFAULT 0,
    total_points INTEGER DEFAULT 0,
    rank_in_class INTEGER,
    rank_in_institution INTEGER,
    subjects_mastered TEXT[] DEFAULT '{}',
    improvement_rate DECIMAL(5,2) DEFAULT 0,
    last_active_at TIMESTAMP WITH TIME ZONE,
    passport_level VARCHAR(20) DEFAULT 'beginner',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    UNIQUE(student_id, institution_id)
);

-- Enable RLS
ALTER TABLE public.badge_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.badge_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_activity_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_passport ENABLE ROW LEVEL SECURITY;

-- RLS Policies for badge_definitions
CREATE POLICY "Badge definitions viewable by all" ON public.badge_definitions FOR SELECT TO authenticated USING (true);

-- RLS Policies for user_badges
CREATE POLICY "Users view own badges" ON public.user_badges FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Staff view institution badges" ON public.user_badges FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.institution_id = user_badges.institution_id AND ur.role IN ('super_admin', 'school_admin', 'coordinator', 'teacher'))
);
CREATE POLICY "Insert badges" ON public.user_badges FOR INSERT WITH CHECK (true);

-- RLS Policies for badge_progress
CREATE POLICY "Users view own progress" ON public.badge_progress FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Manage progress" ON public.badge_progress FOR ALL USING (true);

-- RLS Policies for user_activity_log
CREATE POLICY "Users view own activity" ON public.user_activity_log FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Manage activity" ON public.user_activity_log FOR ALL USING (true);

-- RLS Policies for student_passport
CREATE POLICY "Students view own passport" ON public.student_passport FOR SELECT USING (student_id = auth.uid());
CREATE POLICY "Staff view institution passports" ON public.student_passport FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.institution_id = student_passport.institution_id AND ur.role IN ('super_admin', 'school_admin', 'coordinator', 'teacher'))
);
CREATE POLICY "Manage passports" ON public.student_passport FOR ALL USING (true);

-- Create trigger for updated_at
CREATE TRIGGER update_badge_definitions_updated_at BEFORE UPDATE ON public.badge_definitions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_student_passport_updated_at BEFORE UPDATE ON public.student_passport FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Insert default badge definitions
INSERT INTO public.badge_definitions (name, description, icon_name, badge_type, category, tier, criteria_type, criteria_value, criteria_metric, points, display_order) VALUES
('First Step', 'Complete your first exam', 'play-circle', 'student', 'exam_participation', 'bronze', 'count', 1, 'exams_completed', 10, 1),
('Exam Explorer', 'Complete 5 exams', 'compass', 'student', 'exam_participation', 'silver', 'count', 5, 'exams_completed', 25, 2),
('Exam Veteran', 'Complete 10 exams', 'shield', 'student', 'exam_participation', 'gold', 'count', 10, 'exams_completed', 50, 3),
('Exam Master', 'Complete 25 exams', 'crown', 'student', 'exam_participation', 'platinum', 'count', 25, 'exams_completed', 100, 4),
('Exam Legend', 'Complete 50 exams', 'star', 'student', 'exam_participation', 'diamond', 'count', 50, 'exams_completed', 200, 5),
('Rising Star', 'Score above 70%', 'trending-up', 'student', 'achievement', 'bronze', 'threshold', 70, 'exam_percentage', 15, 6),
('High Achiever', 'Score above 80%', 'award', 'student', 'achievement', 'silver', 'threshold', 80, 'exam_percentage', 30, 7),
('Excellence Award', 'Score above 90%', 'medal', 'student', 'achievement', 'gold', 'threshold', 90, 'exam_percentage', 50, 8),
('Perfect Score', 'Score 100%', 'trophy', 'student', 'achievement', 'diamond', 'threshold', 100, 'exam_percentage', 100, 9),
('Early Bird', 'Login 5 consecutive days', 'sun', 'student', 'portal_usage', 'bronze', 'streak', 5, 'login_streak', 10, 10),
('Dedicated Learner', 'Login 15 consecutive days', 'flame', 'student', 'portal_usage', 'silver', 'streak', 15, 'login_streak', 25, 11),
('Study Champion', 'Login 30 consecutive days', 'zap', 'student', 'portal_usage', 'gold', 'streak', 30, 'login_streak', 50, 12),
('First Exam Creator', 'Create your first exam', 'file-plus', 'teacher', 'exam_creation', 'bronze', 'count', 1, 'exams_created', 15, 20),
('Prolific Examiner', 'Create 10 exams', 'files', 'teacher', 'exam_creation', 'silver', 'count', 10, 'exams_created', 40, 21),
('Exam Architect', 'Create 25 exams', 'building', 'teacher', 'exam_creation', 'gold', 'count', 25, 'exams_created', 80, 22),
('Task Starter', 'Complete your first task', 'check-square', 'teacher', 'task_completion', 'bronze', 'count', 1, 'tasks_completed', 10, 23),
('Task Master', 'Complete 20 tasks', 'clipboard-check', 'teacher', 'task_completion', 'silver', 'count', 20, 'tasks_completed', 50, 24),
('Task Champion', 'Complete 50 tasks', 'badge-check', 'teacher', 'task_completion', 'gold', 'count', 50, 'tasks_completed', 100, 25),
('Speed Demon', 'Complete 5 tasks on time', 'zap', 'teacher', 'task_completion', 'silver', 'count', 5, 'tasks_on_time', 30, 26),
('Student Mentor', '10% student improvement', 'users', 'teacher', 'student_improvement', 'gold', 'percentage', 10, 'student_improvement_percent', 75, 27),
('Impact Creator', '20% student improvement', 'trending-up', 'teacher', 'student_improvement', 'platinum', 'percentage', 20, 'student_improvement_percent', 150, 28),
('Coordinator First Task', 'First coordination task', 'clipboard', 'coordinator', 'task_completion', 'bronze', 'count', 1, 'tasks_completed', 10, 30),
('Efficient Coordinator', 'Complete 15 tasks', 'check-circle-2', 'coordinator', 'task_completion', 'silver', 'count', 15, 'tasks_completed', 40, 31),
('Master Coordinator', 'Complete 30 tasks', 'award', 'coordinator', 'task_completion', 'gold', 'count', 30, 'tasks_completed', 80, 32),
('Lightning Fast', '10 tasks before deadline', 'clock', 'coordinator', 'task_completion', 'gold', 'count', 10, 'tasks_on_time', 60, 33);

-- Create indexes
CREATE INDEX idx_user_badges_user_id ON public.user_badges(user_id);
CREATE INDEX idx_user_badges_institution_id ON public.user_badges(institution_id);
CREATE INDEX idx_badge_progress_user_id ON public.badge_progress(user_id);
CREATE INDEX idx_user_activity_log_user_id ON public.user_activity_log(user_id);
CREATE INDEX idx_user_activity_log_date ON public.user_activity_log(activity_date);
CREATE INDEX idx_student_passport_student_id ON public.student_passport(student_id);
CREATE INDEX idx_student_passport_institution_id ON public.student_passport(institution_id);

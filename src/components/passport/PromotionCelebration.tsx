import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { GraduationCap, PartyPopper, Star } from "lucide-react";
import { formatClassName } from "@/lib/utils";

interface PromotionCelebrationProps {
  studentName?: string;
}

// Confetti particle component
function ConfettiParticle({ delay, color }: { delay: number; color: string }) {
  const x = Math.random() * 100;
  const size = Math.random() * 8 + 4;
  return (
    <motion.div
      className="absolute rounded-full"
      style={{
        left: `${x}%`,
        top: -10,
        width: size,
        height: size,
        backgroundColor: color,
      }}
      initial={{ y: -20, opacity: 1, rotate: 0 }}
      animate={{
        y: [0, window.innerHeight + 20],
        opacity: [1, 1, 0],
        rotate: Math.random() * 720 - 360,
        x: [0, (Math.random() - 0.5) * 200],
      }}
      transition={{
        duration: 3 + Math.random() * 2,
        delay,
        ease: "easeIn",
      }}
    />
  );
}

export function PromotionCelebration({ studentName }: PromotionCelebrationProps) {
  const { user } = useAuth();
  const [showCelebration, setShowCelebration] = useState(false);
  const [promotionInfo, setPromotionInfo] = useState<{
    newClass: string;
    newSection: string | null;
    previousYear?: string;
  } | null>(null);

  // Get current class assignment
  const { data: currentAssignment } = useQuery({
    queryKey: ["current-class-assignment", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("class_assignments")
        .select("class_id, classes(name, section, academic_year)")
        .eq("user_id", user!.id)
        .eq("role", "student")
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!user?.id,
  });

  // Get latest passport academic record
  const { data: latestRecord } = useQuery({
    queryKey: ["latest-passport-record", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("passport_academic_records")
        .select("class_name, section_name, academic_year, average_percentage, total_exams, exams_passed")
        .eq("student_id", user!.id)
        .order("academic_year", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!user?.id,
  });

  useEffect(() => {
    if (!currentAssignment || !latestRecord) return;

    const currentClass = (currentAssignment.classes as any)?.name;
    const currentSection = (currentAssignment.classes as any)?.section;
    const recordedClass = latestRecord.class_name;

    // If current class differs from the last recorded class, the student was promoted
    if (currentClass && recordedClass && currentClass !== recordedClass) {
      const key = `promotion_celebrated_${latestRecord.academic_year}_${currentClass}`;
      if (!localStorage.getItem(key)) {
        setPromotionInfo({
          newClass: currentClass,
          newSection: currentSection,
          previousYear: latestRecord.academic_year,
        });
        setShowCelebration(true);
      }
    }
  }, [currentAssignment, latestRecord]);

  const handleDismiss = () => {
    if (promotionInfo && latestRecord) {
      const key = `promotion_celebrated_${latestRecord.academic_year}_${promotionInfo.newClass}`;
      localStorage.setItem(key, "true");
    }
    setShowCelebration(false);
  };

  const confettiColors = [
    "hsl(var(--primary))",
    "#f59e0b",
    "#22c55e",
    "#3b82f6",
    "#ef4444",
    "#a855f7",
    "#ec4899",
  ];

  const particles = useMemo(
    () =>
      Array.from({ length: 50 }, (_, i) => ({
        id: i,
        delay: Math.random() * 1.5,
        color: confettiColors[i % confettiColors.length],
      })),
    []
  );

  return (
    <AnimatePresence>
      {showCelebration && promotionInfo && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-sm overflow-hidden"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {/* Confetti */}
          {particles.map((p) => (
            <ConfettiParticle key={p.id} delay={p.delay} color={p.color} />
          ))}

          <motion.div
            className="relative z-10 text-center space-y-6 p-8 max-w-md"
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", damping: 15, delay: 0.3 }}
          >
            {/* Celebration icon */}
            <motion.div
              className="mx-auto h-20 w-20 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-lg"
              animate={{ rotate: [0, -10, 10, -5, 5, 0] }}
              transition={{ duration: 0.8, delay: 0.5 }}
            >
              <PartyPopper className="h-10 w-10 text-white" />
            </motion.div>

            {/* Title */}
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.5 }}
            >
              <h1 className="text-3xl font-bold bg-gradient-to-r from-amber-500 to-orange-500 bg-clip-text text-transparent">
                Congratulations! 🎉
              </h1>
              <p className="text-lg text-foreground mt-2">
                {studentName || "Student"}
              </p>
            </motion.div>

            {/* Promotion message */}
            <motion.div
              className="p-4 rounded-2xl bg-primary/10 border border-primary/20"
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.7 }}
            >
              <div className="flex items-center justify-center gap-2 mb-2">
                <GraduationCap className="h-5 w-5 text-primary" />
                <span className="font-semibold text-primary">Promoted!</span>
              </div>
              <p className="text-xl font-bold">
                {formatClassName(promotionInfo.newClass, promotionInfo.newSection)}
              </p>
            </motion.div>

            {/* Previous year stats */}
            {latestRecord && (
              <motion.div
                className="grid grid-cols-3 gap-3 text-center"
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.9 }}
              >
                <div className="p-3 rounded-xl bg-muted/50">
                  <p className="text-2xl font-bold">{latestRecord.total_exams}</p>
                  <p className="text-xs text-muted-foreground">Exams</p>
                </div>
                <div className="p-3 rounded-xl bg-muted/50">
                  <p className="text-2xl font-bold">
                    {latestRecord.average_percentage?.toFixed(0) || 0}%
                  </p>
                  <p className="text-xs text-muted-foreground">Average</p>
                </div>
                <div className="p-3 rounded-xl bg-muted/50">
                  <p className="text-2xl font-bold">{latestRecord.exams_passed}</p>
                  <p className="text-xs text-muted-foreground">Passed</p>
                </div>
              </motion.div>
            )}

            {/* Stars */}
            <motion.div
              className="flex justify-center gap-1"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 1.1, type: "spring" }}
            >
              {[1, 2, 3, 4, 5].map((s) => (
                <Star
                  key={s}
                  className="h-6 w-6 text-amber-400 fill-amber-400"
                />
              ))}
            </motion.div>

            {/* CTA */}
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 1.3 }}
            >
              <Button onClick={handleDismiss} size="lg" className="w-full">
                Continue to Dashboard
              </Button>
            </motion.div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

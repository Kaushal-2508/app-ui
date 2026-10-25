import * as React from "react";
import { motion, type Variants } from "framer-motion";

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" } },
};

const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.3, ease: "easeOut" } },
};

const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.95 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0.3, ease: "easeOut" } },
};

const slideRight: Variants = {
  hidden: { opacity: 0, x: -20 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.3, ease: "easeOut" } },
};

const variantMap = { fadeUp, fadeIn, scaleIn, slideRight };

export type AnimationVariant = keyof typeof variantMap;

interface AnimatedContainerProps {
  variant?: AnimationVariant;
  className?: string;
  children: React.ReactNode;
  delay?: number;
  /** Animate when entering viewport instead of on mount */
  whileInView?: boolean;
}

export function AnimatedContainer({
  variant = "fadeUp",
  className,
  children,
  delay = 0,
  whileInView = false,
}: AnimatedContainerProps) {
  const v = variantMap[variant];
  const delayedV: Variants = {
    hidden: v.hidden,
    visible: {
      ...(typeof v.visible === "object" ? v.visible : {}),
      transition: {
        ...(typeof v.visible === "object" && "transition" in v.visible ? (v.visible as any).transition : {}),
        delay,
      },
    },
  };

  if (whileInView) {
    return (
      <motion.div
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: "-50px" }}
        variants={delayedV}
        className={className}
      >
        {children}
      </motion.div>
    );
  }

  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={delayedV}
      className={className}
    >
      {children}
    </motion.div>
  );
}

interface StaggerContainerProps {
  className?: string;
  children: React.ReactNode;
  staggerDelay?: number;
  whileInView?: boolean;
}

const staggerParent = (staggerDelay: number): Variants => ({
  hidden: {},
  visible: {
    transition: { staggerChildren: staggerDelay },
  },
});

const staggerChild: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: "easeOut" } },
};

export function StaggerContainer({
  className,
  children,
  staggerDelay = 0.08,
  whileInView = false,
}: StaggerContainerProps) {
  if (whileInView) {
    return (
      <motion.div
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: "-50px" }}
        variants={staggerParent(staggerDelay)}
        className={className}
      >
        {children}
      </motion.div>
    );
  }

  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={staggerParent(staggerDelay)}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <motion.div variants={staggerChild} className={className}>
      {children}
    </motion.div>
  );
}

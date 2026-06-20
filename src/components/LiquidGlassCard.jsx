import { forwardRef } from "react";
import { motion } from "framer-motion";
import { useGlassActive } from "../hooks/useGlassActive";

// High-damping spring tuned to feel like liquid inertia (a touch of overshoot,
// settles fast). Shared so every glass interaction reads with the same physics.
export const LIQUID_SPRING = { type: "spring", mass: 0.5, stiffness: 250, damping: 15 };

// A drop-in replacement for a glass container <div>. Under the Glass skin it
// becomes a motion.div that "squishes" on press — scaling down and bulging its
// corners like a pressurised gel capsule — and springs back with liquid
// physics. Under any other skin it renders a plain <div> with zero motion
// overhead, so the classic look is completely untouched.
const LiquidGlassCard = forwardRef(function LiquidGlassCard(
  { className, children, style, ...rest },
  ref,
) {
  const glass = useGlassActive();

  if (!glass) {
    return (
      <div ref={ref} className={className} style={style} {...rest}>
        {children}
      </div>
    );
  }

  return (
    <motion.div
      ref={ref}
      className={className}
      style={style}
      whileTap={{ scale: 0.97, borderRadius: 22 }}
      transition={LIQUID_SPRING}
      {...rest}
    >
      {children}
    </motion.div>
  );
});

export default LiquidGlassCard;

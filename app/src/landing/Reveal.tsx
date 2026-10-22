// Scrolling on the landing page: sections slide in as they come into view, and feature panels on phones animate while
// they're mid-screen. Everything shows at once when less motion is asked for.
import { useEffect, useRef, useState, type ReactNode } from "react";

const reduced = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Slides its content in the first time it comes into view */
export function Reveal({ children, delay = 0, className = "", as: Tag = "div" }: { children: ReactNode; delay?: number; className?: string; as?: "div" | "section" | "li" | "article" }) {
  const ref = useRef<HTMLElement>(null);
  const [shown, setShown] = useState(reduced);
  useEffect(() => {
    if (shown || !ref.current) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setShown(true); io.disconnect(); } }, { rootMargin: "0px 0px -12% 0px" });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [shown]);
  return <Tag ref={ref as never} className={`lp-reveal${shown ? " in" : ""} ${className}`} style={{ transitionDelay: `${delay}ms` }}>{children}</Tag>;
}

/** True while the element is in the middle of the screen: animations on phones, where there's no hover */
export function useInMiddle<T extends HTMLElement>(enabled: boolean) {
  const ref = useRef<T>(null);
  const [inMiddle, setIn] = useState(false);
  useEffect(() => {
    if (!enabled || !ref.current) return;
    const io = new IntersectionObserver(([e]) => setIn(e.isIntersecting), { rootMargin: "-35% 0px -35% 0px" });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [enabled]);
  return { ref, inMiddle };
}

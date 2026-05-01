import { useEffect, useRef, useState } from "react";

export function WordSwap({
  words,
  interval = 2500,
  className,
}: {
  words: string[];
  interval?: number;
  className?: string;
}) {
  const [i, setI] = useState(0);
  const [visible, setVisible] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    const id = setInterval(() => {
      setVisible(false);
      timerRef.current = setTimeout(() => {
        setI((p) => (p + 1) % words.length);
        setVisible(true);
      }, 200);
    }, interval);
    return () => {
      clearInterval(id);
      clearTimeout(timerRef.current);
    };
  }, [words.length, interval]);

  const longest = words.reduce((a, b) => (b.length > a.length ? b : a), "");

  return (
    <span
      className={className}
      style={{
        display: "inline-block",
        minWidth: `${longest.length}ch`,
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(6px)",
        transition: "opacity 200ms ease-out, transform 200ms ease-out",
      }}
    >
      {words[i]}
    </span>
  );
}

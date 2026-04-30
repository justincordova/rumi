import { Code2, FileText, PenLine } from "lucide-react";

export function getTabIcon(type: "tab" | "drawing", language: string | null) {
  if (type === "drawing") return PenLine;
  if (language === "markdown") return FileText;
  return Code2;
}

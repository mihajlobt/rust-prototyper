import { Sun, Moon } from "lucide-react";

interface ThemeFrameworkPillsProps {
  themesFramework: "shadcn" | "daisy" | "bootstrap" | "generic";
  themesDarkLightSupport: boolean;
  onSetFramework: (framework: "shadcn" | "daisy" | "bootstrap" | "generic") => void;
  onToggleDarkLight: () => void;
}

export function ThemeFrameworkPills({
  themesFramework,
  themesDarkLightSupport,
  onSetFramework,
  onToggleDarkLight,
}: ThemeFrameworkPillsProps) {
  return (
    <>
      {(["shadcn", "daisy", "bootstrap", "generic"] as const).map((f) => (
        <button
          key={f}
          onClick={() => onSetFramework(f)}
          className={[
            "px-1.5 py-0.5 rounded text-[10px] border transition-colors",
            themesFramework === f
              ? "bg-primary text-primary-foreground border-primary"
              : "border-border hover:bg-muted text-muted-foreground hover:text-foreground",
          ].join(" ")}
        >
          {f === "bootstrap" ? "BS" : f === "generic" ? "Gen" : f === "shadcn" ? "shadcn" : "Daisy"}
        </button>
      ))}
      <div className="w-px h-3.5 bg-border mx-0.5" />
      <button
        onClick={onToggleDarkLight}
        className={[
          "flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] border transition-colors",
          themesDarkLightSupport
            ? "bg-primary text-primary-foreground border-primary"
            : "border-border hover:bg-muted text-muted-foreground hover:text-foreground",
        ].join(" ")}
        title="Generate dark + light mode variants"
      >
        <Sun size={9} /><Moon size={9} />
      </button>
    </>
  );
}

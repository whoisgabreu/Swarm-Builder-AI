export type StudioMode = "landing" | "creative";

const MODES: Array<{ id: StudioMode; label: string }> = [
  { id: "landing", label: "LP" },
  { id: "creative", label: "Criativos" },
];

export function ModeToggle({
  mode,
  onChange,
}: {
  mode: StudioMode;
  onChange: (mode: StudioMode) => void;
}) {
  return (
    <div className="mode-toggle" role="tablist" aria-label="Modo de criação">
      {MODES.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={mode === item.id}
          className={mode === item.id ? "on" : ""}
          onClick={() => onChange(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

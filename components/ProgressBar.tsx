type FlowerProps = {
  color: string;
};

function Flower({ color }: FlowerProps) {
  return (
    <svg viewBox="0 0 100 100" className="block w-full h-full" aria-hidden="true">
      <rect x="4" y="4" width="92" height="92" rx="22" className="flower-shape" style={{ fill: color }} />
      {[0, 72, 144, 216, 288].map((angle) => (
        <ellipse key={angle} cx="50" cy="32" rx="17" ry="21" fill="#fdf8ec" transform={`rotate(${angle} 50 50)`} />
      ))}
      <path
        d="M50 35 C 52 46 54 48 65 50 C 54 52 52 54 50 65 C 48 54 46 52 35 50 C 46 48 48 46 50 35 Z"
        className="flower-shape"
        style={{ fill: color }}
      />
    </svg>
  );
}

type ProgressBarProps = {
  progress: number;
  height?: number;
};

const FLOWER_COLORS = ['#e8a5cf', '#8fb8f2', '#f4cf6b', '#8fc79a'];
const INACTIVE_COLOR = '#e4ddcf';

export function ProgressBar({ progress, height }: ProgressBarProps) {
  const pct = Math.max(0, Math.min(1, progress));

  return (
    <div style={{ height }} className="flex w-10 shrink-0 flex-col-reverse items-center justify-between py-1">
      {FLOWER_COLORS.map((color, i) => {
        const active = pct >= (i + 1) / FLOWER_COLORS.length - 0.001;
        return (
          <div key={i} className="w-9 h-9">
            <Flower color={active ? color : INACTIVE_COLOR} />
          </div>
        );
      })}
    </div>
  );
}

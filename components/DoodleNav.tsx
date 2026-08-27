const suits = [
  {
    key: "heart",
    label: "reprendre la partie",
    path: "M50 88C50 88 10 60 10 35C10 18 24 8 38 8C46 8 50 15 50 15C50 15 54 8 62 8C76 8 90 18 90 35C90 60 50 88 50 88Z",
  },
  {
    key: "club",
    label: "message 2",
    path: "M32 30 a18 18 0 1 0 36 0 a18 18 0 1 0 -36 0 Z M14 55 a18 18 0 1 0 36 0 a18 18 0 1 0 -36 0 Z M50 55 a18 18 0 1 0 36 0 a18 18 0 1 0 -36 0 Z M42 60 L58 60 L55 92 L45 92 Z",
  },
  {
    key: "spade",
    label: "message 3",
    path: "M50 10C50 10 15 40 15 62C15 75 25 82 35 80C40 79 45 75 47 70C45 82 38 88 25 90H75C62 88 55 82 53 70C55 75 60 79 65 80C75 82 85 75 85 62C85 40 50 10 50 10Z",
  },
  {
    key: "diamond",
    label: "message 4",
    path: "M50 10L85 50L50 90L15 50Z",
  },
] as const;

export function DoodleNav() {
  return (
    <>
      <svg
        style={{ visibility: "hidden", position: "absolute" }}
        width="0"
        height="0"
        xmlns="http://www.w3.org/2000/svg"
        version="1.1"
      >
        <defs>
          <filter id="pencil-texture" x="-10%" y="-10%" width="120%" height="120%">
            <feTurbulence type="fractalNoise" baseFrequency={0.04} numOctaves={3} result="noise" />
            <feDisplacementMap
              in="SourceGraphic"
              in2="noise"
              scale={3}
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        </defs>
      </svg>

      <ul className="doodle-container">
        {suits.map((suit) => (
          <li key={suit.key} className="doodle-icon-content">
            <a href="#" aria-label={suit.label} className={`doodle-link link-${suit.key}`}>
              <svg className="doodle-svg" viewBox="0 0 100 100">
                <path className="doodle-path" d={suit.path}></path>
              </svg>
            </a>
            <div className={`doodle-tooltip tooltip-${suit.key}`}>{suit.label}</div>
          </li>
        ))}
      </ul>
    </>
  );
}

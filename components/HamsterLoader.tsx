// Animation de chargement : un hamster qui court dans sa roue (d'après Uiverse.io, par Nawsome).
// Le style est dans app/globals.css (classes .wheel-and-hamster, .hamster..., .spoke).
export default function HamsterLoader({ label = 'Chargement...' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center gap-3" role="status">
      <div aria-label="Hamster qui court dans une roue" role="img" className="wheel-and-hamster">
        <div className="wheel" />
        <div className="hamster">
          <div className="hamster__body">
            <div className="hamster__head">
              <div className="hamster__ear" />
              <div className="hamster__eye" />
              <div className="hamster__nose" />
            </div>
            <div className="hamster__limb hamster__limb--fr" />
            <div className="hamster__limb hamster__limb--fl" />
            <div className="hamster__limb hamster__limb--br" />
            <div className="hamster__limb hamster__limb--bl" />
            <div className="hamster__tail" />
          </div>
        </div>
        <div className="spoke" />
      </div>
      {/* Texte lu par les lecteurs d'écran, et affiché discrètement sous l'animation */}
      <p className="text-sm opacity-60">{label}</p>
    </div>
  );
}

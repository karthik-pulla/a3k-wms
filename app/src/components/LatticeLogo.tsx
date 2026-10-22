// The product's own logo (Lattice), drawn in the text colour so it follows the light and dark themes. The image
// is a mask over currentColor (src/assets/lattice-logo.png, from Lattice_Branding/). The rounded square alone is the icon (public/lattice-icon.svg).
import logo from "../assets/lattice-logo.png";
import word from "../assets/lattice-word.png";

export function LatticeLogo({ height = 20, className = "" }: { height?: number; className?: string }) {
  return <span className={`lattice-logo ${className}`} role="img" aria-label="Lattice" style={{ height, width: height * (1879 / 313), maskImage: `url(${logo})`, WebkitMaskImage: `url(${logo})` }} />;
}

/** The word "Lattice." alone (the landing page draws the square itself, so it can spin) */
export function LatticeWord({ height = 20 }: { height?: number }) {
  return <span className="lattice-logo" role="img" aria-label="Lattice" style={{ height, width: height * (1405 / 313), maskImage: `url(${word})`, WebkitMaskImage: `url(${word})` }} />;
}

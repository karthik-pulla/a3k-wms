// The product's own logo (Lattice), drawn in the text colour so it follows the light and dark themes. The image
// is a mask over currentColor (src/assets/lattice-logo.png, from Lattice_Branding/). The square alone is the icon.
import logo from "../assets/lattice-logo.png";

export function LatticeLogo({ height = 20, className = "" }: { height?: number; className?: string }) {
  return <span className={`lattice-logo ${className}`} role="img" aria-label="Lattice" style={{ height, width: height * (1806 / 320), maskImage: `url(${logo})`, WebkitMaskImage: `url(${logo})` }} />;
}

/** Just the square, for small places */
export function LatticeMark({ size = 14 }: { size?: number }) {
  return <span className="lattice-mark" aria-hidden="true" style={{ width: size, height: size }} />;
}

/** Drifting colour behind the frosted glass. The Moving background setting decides; it starts off if the OS asks for less motion. */
export function Background({ moving }: { moving: boolean }) {
  return (
    <div className={`bg${moving ? "" : " still"}`} aria-hidden="true">
      <div className="blob b1" />
      <div className="blob b2" />
      <div className="blob b3" />
      <div className="blob b4" />
      <div className="grain" />
    </div>
  );
}

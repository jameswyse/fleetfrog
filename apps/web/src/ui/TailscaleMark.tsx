/** Tailscale's mark: a three-by-three grid of dots, with the middle row and bottom centre solid. */
export function TailscaleMark({ className }: { readonly className?: string }) {
  const solid = new Set(["0,1", "1,1", "2,1", "1,2"]);

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="currentColor">
      {[0, 1, 2].flatMap((row) =>
        [0, 1, 2].map((column) => (
          <circle
            key={`${column},${row}`}
            cx={4 + column * 8}
            cy={4 + row * 8}
            r={2.75}
            opacity={solid.has(`${column},${row}`) ? 1 : 0.2}
          />
        )),
      )}
    </svg>
  );
}

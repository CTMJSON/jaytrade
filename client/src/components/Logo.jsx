export default function Logo({ size = 36 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
      <rect width="64" height="64" rx="12" fill="#0b0e14" />
      <rect x="1" y="1" width="62" height="62" rx="11" fill="none" stroke="#1f2a3d" strokeWidth="1.5" />

      {/* candlesticks, ascending - the mark reads as both a chart and a rising trend */}
      <line x1="18" y1="34" x2="18" y2="54" stroke="#ff3b5c" strokeWidth="2" strokeLinecap="round" />
      <rect x="14.5" y="38" width="7" height="12" rx="1.5" fill="#ff3b5c" />

      <line x1="32" y1="20" x2="32" y2="44" stroke="#00e676" strokeWidth="2" strokeLinecap="round" />
      <rect x="28.5" y="26" width="7" height="14" rx="1.5" fill="#00e676" />

      <line x1="46" y1="10" x2="46" y2="34" stroke="#00e676" strokeWidth="2" strokeLinecap="round" />
      <rect x="42.5" y="14" width="7" height="16" rx="1.5" fill="#00e676" />

      {/* trend line + arrowhead, tying the candles together into one upward mark */}
      <path
        d="M14 44 L32 33 L46 22 L53 15"
        stroke="#4d8eff"
        strokeWidth="2.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M45 15 L53 15 L53 23"
        stroke="#4d8eff"
        strokeWidth="2.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

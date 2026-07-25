export default function Logo({ size = 36 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
      <rect width="64" height="64" rx="14" fill="#004080" />
      <path
        d="M20 40 L30 30 L37 37 L48 22"
        stroke="#00C853"
        strokeWidth="5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M40 22 L48 22 L48 30"
        stroke="#00C853"
        strokeWidth="5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

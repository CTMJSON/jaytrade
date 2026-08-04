// Small "i" glyph that reveals an explanatory bubble on hover/focus. Keyboard-accessible via
// tabIndex + :focus (not just :hover), and pure CSS so it never fights the panel's own state.
export default function InfoTip({ children, label = 'More info', align = 'center' }) {
  return (
    <span className="info-tip" tabIndex={0}>
      <span className="info-tip-icon" aria-hidden="true">i</span>
      <span className={`info-tip-bubble info-tip-align-${align}`} role="tooltip" aria-label={label}>
        {children}
      </span>
    </span>
  );
}

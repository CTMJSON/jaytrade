export function Skeleton({ width = '100%', height = 14, radius = 6, className = '' }) {
  return (
    <span
      className={`skeleton ${className}`}
      style={{ width, height, borderRadius: radius }}
      aria-hidden="true"
    />
  );
}

export function SkeletonRows({ rows = 5, height = 14, gap = 12 }) {
  return (
    <div className="skeleton-stack" style={{ gap }} aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} height={height} width={i === rows - 1 ? '65%' : '100%'} />
      ))}
    </div>
  );
}

export function SkeletonCards({ count = 4, height = 62 }) {
  return (
    <div className="skeleton-cards" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} height={height} radius={8} />
      ))}
    </div>
  );
}

/**
 * Replaces the old `if (error) return null` pattern. A section the user has
 * already seen should never silently disappear.
 */
export function PanelError({ message, onRetry, compact = false }) {
  return (
    <div className={`panel-error ${compact ? 'panel-error-compact' : ''}`} role="alert">
      <span className="panel-error-icon" aria-hidden="true">!</span>
      <div className="panel-error-body">
        <span className="panel-error-title">Couldn&rsquo;t load this data</span>
        {message && <span className="panel-error-detail">{message}</span>}
      </div>
      {onRetry && (
        <button className="panel-error-retry" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

export function LoadingLabel({ children = 'Loading…' }) {
  return (
    <span className="loading-label">
      <span className="loading-dot" aria-hidden="true" />
      {children}
    </span>
  );
}

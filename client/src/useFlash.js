import { useEffect, useRef, useState } from 'react';

/**
 * Returns a transient CSS class whenever `value` changes, so live-updating numbers
 * visibly react instead of silently swapping. Never fires on first render.
 */
export function useFlash(value, duration = 800) {
  const previous = useRef(value);
  const [flash, setFlash] = useState('');

  useEffect(() => {
    const prev = previous.current;
    previous.current = value;

    if (!Number.isFinite(value) || !Number.isFinite(prev) || value === prev) return;

    setFlash(value > prev ? 'flash-up' : 'flash-down');
    const timer = setTimeout(() => setFlash(''), duration);
    return () => clearTimeout(timer);
  }, [value, duration]);

  return flash;
}

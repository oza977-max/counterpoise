import { useEffect, useState, type ReactNode } from 'react';

// R18-G (NF-2): a status region that is put into the page already filled is not reliably announced by screen
// readers. This one is mounted empty and filled straight after, in the same element, like the nudge and the
// rating-instruction notice (which stay in the page across a whole screen and so need no such step).
export default function StatusAfterMount({ className, children }: { className?: string; children: ReactNode }) {
  const [filled, setFilled] = useState(false);
  useEffect(() => {
    setFilled(true);
  }, []);
  return (
    <p role="status" className={className}>
      {filled ? children : null}
    </p>
  );
}

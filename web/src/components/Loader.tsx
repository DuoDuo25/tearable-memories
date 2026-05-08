interface LoaderProps {
  message?: string;
  fading: boolean;
}

export function Loader({ message = 'Loading memories…', fading }: LoaderProps) {
  return (
    <>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div
        className={[
          'fixed inset-0 z-50 flex items-center justify-center',
          'bg-neutral-950 text-white',
          'transition-opacity duration-500',
          fading ? 'opacity-0 pointer-events-none' : 'opacity-100',
        ].join(' ')}
        style={{ fontFamily: "'Space Grotesk','Inter',sans-serif" }}
      >
        <div className="text-center text-xs font-semibold uppercase" style={{ letterSpacing: '0.18em', color: 'rgba(255,255,255,0.65)' }}>
          <div
            className="w-8 h-8 rounded-full mx-auto mb-3.5"
            style={{
              border: '2px solid rgba(255,255,255,0.15)',
              borderTopColor: 'rgba(255,255,255,0.85)',
              animation: 'spin 0.8s linear infinite',
            }}
          />
          {message}
        </div>
      </div>
    </>
  );
}

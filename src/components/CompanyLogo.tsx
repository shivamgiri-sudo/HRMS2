export function CompanyLogo({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const sizes = { sm: 32, md: 48, lg: 64 };
  const px = sizes[size];

  return (
    <div style={{
      width: px * 2.35,
      height: px,
      borderRadius: '10px',
      background: '#ffffff',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: Math.max(4, px * 0.12),
      boxShadow: '0 4px 14px rgba(15, 23, 42, 0.12)',
    }}>
      <img
        src="/mcn-logo.png"
        alt="MAS Services"
        style={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain' }}
      />
    </div>
  );
}

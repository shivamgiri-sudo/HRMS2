export function CompanyLogo({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const sizes = { sm: 32, md: 48, lg: 64 };
  const px = sizes[size];

  return (
    <div style={{
      width: px,
      height: px,
      borderRadius: '12px',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontWeight: 900,
      color: 'white',
      fontSize: px * 0.4,
      boxShadow: '0 4px 12px rgba(102,126,234,0.3)',
      fontFamily: 'Nunito, sans-serif'
    }}>
      MAS
    </div>
  );
}

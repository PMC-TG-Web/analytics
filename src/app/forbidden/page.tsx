import Link from 'next/link';

export default function ForbiddenPage() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f5f5f5',
        padding: '24px',
      }}
    >
      <div
        style={{
          maxWidth: '520px',
          width: '100%',
          background: '#ffffff',
          borderRadius: '12px',
          padding: '32px',
          boxShadow: '0 10px 30px rgba(0,0,0,0.08)',
          textAlign: 'center',
        }}
      >
        <h1 style={{ fontSize: '28px', marginBottom: '12px', color: '#E06C00' }}>
          Access denied
        </h1>
        <p style={{ color: '#444', marginBottom: '12px' }}>
          Your account does not have permission to open this page.
        </p>
        <p style={{ color: '#777', fontSize: '14px', marginBottom: '24px' }}>
          If you should have access, contact an administrator.
        </p>
        <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <Link
            href="/"
            style={{
              background: '#15616D',
              color: '#fff',
              textDecoration: 'none',
              padding: '10px 18px',
              borderRadius: '8px',
              fontWeight: 600,
            }}
          >
            Go home
          </Link>
          <a
            href="/api/auth/logout"
            style={{
              background: '#eee',
              color: '#333',
              textDecoration: 'none',
              padding: '10px 18px',
              borderRadius: '8px',
              fontWeight: 600,
            }}
          >
            Sign out
          </a>
        </div>
      </div>
    </main>
  );
}

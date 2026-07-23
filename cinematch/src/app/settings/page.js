'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';

const PLATFORMS = [
  { id: 1, name: 'Netflix', icon: '🟥' },
  { id: 2, name: 'Prime Video', icon: '🔵' },
  { id: 3, name: 'Hotstar', icon: '🌟' },
  { id: 4, name: 'Jio Cinema', icon: '🟣' },
  { id: 5, name: 'Zee5', icon: '🟪' },
  { id: 6, name: 'SonyLIV', icon: '🔴' },
  { id: 7, name: 'Apple TV+', icon: '🍎' },
  { id: 8, name: 'Lionsgate Play', icon: '🦁' }
];

export default function SettingsPage() {
  const { user, loading, logout, updateUserData } = useAuth();
  const router = useRouter();
  const [selectedPlatforms, setSelectedPlatforms] = useState(() => user?.platforms || []);
  const [name, setName] = useState(() => user?.name || '');
  const [saved, setSaved] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    queueMicrotask(() => setHydrated(true));
  }, []);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/');
    }
  }, [loading, user, router]);

  const togglePlatform = (id) => {
    setSelectedPlatforms(prev =>
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
    );
  };

  const handleSave = async () => {
    try {
      await fetch('/api/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, platformIds: selectedPlatforms })
      });
      updateUserData({ name, platforms: selectedPlatforms });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      console.error(err);
    }
  };

  if (!hydrated || loading) return null;
  if (!user) return null;

  const feedbackCount = user.feedback_count || 0;
  const profileCompleteness = Math.min(100, Math.round((feedbackCount / 10) * 100));

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)' }}>
      {/* Navbar */}
      <nav style={{
        height: 'var(--nav-height)', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', padding: '0 32px', borderBottom: '1px solid var(--border-color)',
        background: 'var(--bg-glass)', backdropFilter: 'blur(20px)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }} onClick={() => router.push('/home')}>
          <div style={{
            width: 36, height: 36, borderRadius: 'var(--radius-md)',
            background: 'var(--accent-gradient)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem'
          }}>🎬</div>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', fontWeight: 800 }}>
            Cine<span className="gradient-text">Match</span>
          </span>
        </div>
        <button className="btn btn-ghost" onClick={() => router.push('/home')}>← Back to Home</button>
      </nav>

      <div style={{ maxWidth: 700, margin: '0 auto', padding: '40px 24px' }}>
        <h1 style={{ marginBottom: 32 }}>⚙️ Settings</h1>

        {/* Profile Section */}
        <section style={{
          background: 'var(--bg-card)', border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-xl)', padding: 32, marginBottom: 24
        }}>
          <h2 style={{ fontSize: '1.2rem', marginBottom: 20 }}>👤 Profile</h2>
          <div className="input-group" style={{ marginBottom: 16 }}>
            <label>Name</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="input-group" style={{ marginBottom: 16 }}>
            <label>Email</label>
            <input className="input" value={user.email} disabled style={{ opacity: 0.6 }} />
          </div>

          {/* Taste Profile Progress */}
          <div style={{ marginTop: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Taste Profile</span>
              <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--accent-primary-light)' }}>{profileCompleteness}%</span>
            </div>
            <div style={{
              width: '100%', height: 8, borderRadius: 'var(--radius-full)',
              background: 'var(--bg-tertiary)', overflow: 'hidden'
            }}>
              <div style={{
                width: `${profileCompleteness}%`, height: '100%',
                background: 'var(--accent-gradient)', borderRadius: 'var(--radius-full)',
                transition: 'width 0.5s ease'
              }} />
            </div>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 6 }}>
              {feedbackCount} feedback{feedbackCount !== 1 ? 's' : ''} submitted.
              {feedbackCount < 3 && ` Rate ${3 - feedbackCount} more movie${3 - feedbackCount !== 1 ? 's' : ''} to unlock personalized recommendations!`}
              {feedbackCount >= 3 && feedbackCount < 10 && ' Your recommendations are being personalized.'}
              {feedbackCount >= 10 && ' Your taste profile is well-developed! 🎯'}
            </p>
          </div>
        </section>

        {/* OTT Subscriptions */}
        <section style={{
          background: 'var(--bg-card)', border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-xl)', padding: 32, marginBottom: 24
        }}>
          <h2 style={{ fontSize: '1.2rem', marginBottom: 20 }}>📺 Manage Subscriptions</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: 20 }}>
            Select the OTT platforms you currently subscribe to. Changes will update your recommendations immediately.
          </p>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
            gap: 12
          }}>
            {PLATFORMS.map((platform) => {
              const isSelected = selectedPlatforms.includes(platform.id);
              return (
                <div
                  key={platform.id}
                  onClick={() => togglePlatform(platform.id)}
                  style={{
                    padding: '16px 12px', borderRadius: 'var(--radius-lg)',
                    background: isSelected ? 'rgba(124, 58, 237, 0.08)' : 'var(--bg-tertiary)',
                    border: `2px solid ${isSelected ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                    cursor: 'pointer', textAlign: 'center',
                    transition: 'all 0.2s ease'
                  }}
                >
                  <div style={{ fontSize: '1.5rem', marginBottom: 6 }}>{platform.icon}</div>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>{platform.name}</div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 12, justifyContent: 'space-between' }}>
          <button className="btn btn-primary" onClick={handleSave}>
            {saved ? '✓ Saved!' : 'Save Changes'}
          </button>
          <button className="btn btn-danger" onClick={() => { logout(); router.push('/'); }}>
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}

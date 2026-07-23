'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { useAuth } from '@/lib/AuthContext';

function getImageUrl(path) {
  if (!path) return 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="500" height="750"%3E%3Crect fill="%231a1a2e" width="500" height="750"/%3E%3Ctext x="250" y="375" text-anchor="middle" fill="%236b6b82" font-size="24"%3E🎬%3C/text%3E%3C/svg%3E';
  if (path.startsWith('http')) return path;
  return `https://image.tmdb.org/t/p/w500${path}`;
}

function getBackdropUrl(path) {
  if (!path) return getImageUrl(null);
  if (path.startsWith('http')) return path;
  return `https://image.tmdb.org/t/p/w1280${path}`;
}

const SURPRISE_HOOKS = [
  "This one's outside your usual picks — but trust us.",
  "Your taste profile says no, but the ratings say YES.",
  "Break out of your comfort zone with this hidden gem.",
  "You haven't explored this territory yet. Dare to try?",
  "High quality, totally unexpected. Give it a shot!",
  "Our wild card algorithm found this just for you.",
];

export default function ExplorePage() {
  const { user } = useAuth();
  const router = useRouter();
  const [movie, setMovie] = useState(null);
  const [loading, setLoading] = useState(true);
  const [animating, setAnimating] = useState(false);
  const [hookText, setHookText] = useState('');

  const fetchSurprise = useCallback(async () => {
    setAnimating(true);
    setLoading(true);
    try {
      const res = await fetch(`/api/recommendations?userId=${user?.id || ''}&limit=20`);
      const data = await res.json();
      const movies = (data.movies || []).filter(m => (m.imdb_rating || 0) >= 7.0);
      if (movies.length > 0) {
        const randomIndex = Math.floor(Math.random() * movies.length);
        setMovie(movies[randomIndex]);
        setHookText(SURPRISE_HOOKS[Math.floor(Math.random() * SURPRISE_HOOKS.length)]);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
      setTimeout(() => setAnimating(false), 600);
    }
  }, [user]);

  useEffect(() => {
    if (!user) {
      router.push('/');
      return;
    }

    let active = true;
    const load = async () => {
      await fetchSurprise();
      return () => {
        active = false;
      };
    };

    void load();
    return () => {
      active = false;
    };
  }, [user, router, fetchSurprise]);

  if (!user) return null;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', position: 'relative', overflow: 'hidden' }}>
      {/* Background glow */}
      <div style={{
        position: 'fixed', top: '-20%', left: '50%', transform: 'translateX(-50%)',
        width: '800px', height: '800px', borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(124,58,237,0.1) 0%, transparent 70%)',
        pointerEvents: 'none', zIndex: 0
      }} />

      {/* Navbar */}
      <nav style={{
        height: 'var(--nav-height)', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', padding: '0 32px',
        borderBottom: '1px solid var(--border-color)', background: 'var(--bg-glass)',
        backdropFilter: 'blur(20px)', position: 'relative', zIndex: 10
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

      {/* Main Content */}
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        minHeight: 'calc(100vh - var(--nav-height))', padding: '40px 24px', position: 'relative', zIndex: 1
      }}>
        {loading ? (
          <div className="loading-screen">
            <div className="spinner" />
            <p>Finding your surprise pick...</p>
          </div>
        ) : movie ? (
          <div style={{
            maxWidth: 500, width: '100%', textAlign: 'center',
            animation: animating ? 'scaleIn 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)' : 'none'
          }}>
            {/* Surprise badge */}
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '6px 18px', borderRadius: 'var(--radius-full)',
              background: 'rgba(245, 158, 11, 0.12)', border: '1px solid rgba(245, 158, 11, 0.25)',
              color: 'var(--warning)', fontSize: '0.9rem', fontWeight: 600, marginBottom: 24
            }}>
              🎲 Surprise Pick
            </div>

            {/* Movie poster */}
            <div style={{
              width: '100%', maxWidth: 320, margin: '0 auto 24px',
              borderRadius: 'var(--radius-xl)', overflow: 'hidden',
              boxShadow: '0 20px 60px rgba(124, 58, 237, 0.2)',
              border: '2px solid rgba(124, 58, 237, 0.2)',
              aspectRatio: '2/3', position: 'relative'
            }}>
              <Image width={500} height={750}
                src={getImageUrl(movie.poster_url)}
                alt={movie.title}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
              {/* Rating overlay */}
              <div style={{
                position: 'absolute', top: 12, left: 12,
                padding: '4px 10px', borderRadius: 'var(--radius-sm)',
                background: 'rgba(16, 185, 129, 0.9)', color: 'white',
                fontSize: '0.85rem', fontWeight: 700
              }}>
                ⭐ {movie.imdb_rating?.toFixed(1)}
              </div>
            </div>

            {/* Movie info */}
            <h1 style={{ fontSize: '2rem', fontFamily: 'var(--font-display)', marginBottom: 8 }}>
              {movie.title}
            </h1>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
              {movie.release_date && (
                <span className="badge">{new Date(movie.release_date).getFullYear()}</span>
              )}
              {(movie.genres || []).map((g, i) => (
                <span key={i} style={{
                  padding: '4px 10px', borderRadius: 'var(--radius-full)',
                  background: 'rgba(124, 58, 237, 0.1)', border: '1px solid rgba(124, 58, 237, 0.2)',
                  color: 'var(--accent-primary-light)', fontSize: '0.75rem', fontWeight: 500
                }}>
                  {typeof g === 'string' ? g : g.name || g}
                </span>
              ))}
            </div>

            {/* Why this pick */}
            <p style={{
              color: 'var(--text-secondary)', fontSize: '1rem', fontStyle: 'italic',
              marginBottom: 24, lineHeight: 1.6
            }}>
              &ldquo;{hookText}&rdquo;
            </p>

            {movie.overview && (
              <p style={{
                color: 'var(--text-secondary)', fontSize: '0.95rem', lineHeight: 1.7,
                marginBottom: 32, maxWidth: 450, margin: '0 auto 32px'
              }}>
                {movie.overview}
              </p>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button className="btn btn-primary btn-lg" onClick={() => {
                if (movie.platforms?.[0]) {
                  const urls = {
                    'Netflix': 'https://www.netflix.com',
                    'Prime Video': 'https://www.primevideo.com',
                    'Hotstar': 'https://www.hotstar.com',
                  };
                  window.open(urls[movie.platforms[0].name] || '#', '_blank');
                }
              }}>
                🎬 I&apos;m Going to Watch This
              </button>
              <button className="btn btn-secondary btn-lg" onClick={fetchSurprise}>
                🎲 Surprise Me Again
              </button>
            </div>

            {/* Available on */}
            {movie.platforms && movie.platforms.length > 0 && (
              <div style={{ marginTop: 24 }}>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 8 }}>Available on</p>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                  {movie.platforms.map((p, i) => (
                    <span key={i} className="badge">{p.name}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
            <p style={{ fontSize: '3rem', marginBottom: 16 }}>🎲</p>
            <p>No surprise picks available right now.</p>
            <button className="btn btn-primary" style={{ marginTop: 20 }} onClick={() => router.push('/home')}>
              Browse Movies
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

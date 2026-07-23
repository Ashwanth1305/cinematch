'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { useAuth } from '@/lib/AuthContext';
import styles from '../onboarding.module.css';

export default function PickMoviesPage() {
  const [movies, setMovies] = useState([]);
  const [selected, setSelected] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { user, updateUserData } = useAuth();
  const router = useRouter();

  useEffect(() => {
    let active = true;

    const fetchMovies = async () => {
      try {
        const res = await fetch(`/api/movies/popular?userId=${user?.id || ''}`);
        const data = await res.json();
        if (active) {
          setMovies(data.movies || []);
        }
      } catch (err) {
        console.error('Error fetching movies:', err);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void fetchMovies();

    return () => {
      active = false;
    };
  }, [user?.id]);

  const toggleMovie = (movieId) => {
    setSelected(prev => {
      if (prev.includes(movieId)) {
        return prev.filter(id => id !== movieId);
      }
      if (prev.length >= 5) return prev; // Max 5
      return [...prev, movieId];
    });
  };

  const handleDone = async () => {
    if (selected.length !== 5) return;

    setSaving(true);
    try {
      const res = await fetch('/api/onboarding/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, movieIds: selected })
      });

      if (res.ok) {
        updateUserData({ onboarding_completed: true });
        router.push('/home');
      }
    } catch (err) {
      console.error('Error completing onboarding:', err);
    } finally {
      setSaving(false);
    }
  };

  const getImageUrl = (path) => {
    if (!path) return '/placeholder-poster.jpg';
    return `https://image.tmdb.org/t/p/w342${path}`;
  };

  return (
    <div className={styles.onboarding}>
      <div className={styles.header}>
        <Link href="/" className={styles.logo}>
          <div className={styles.logoIcon}>🎬</div>
          <span>Cine<span className="gradient-text">Match</span></span>
        </Link>

        <div className={styles.stepIndicator}>
          <div className={`${styles.stepDot} ${styles.stepDotCompleted}`} />
          <div className={`${styles.stepLine} ${styles.stepLineActive}`} />
          <div className={`${styles.stepDot} ${styles.stepDotActive}`} />
        </div>

        <h1>Pick 5 Movies You Loved</h1>
        <p>Help us understand your taste. Select exactly 5 movies you&apos;ve enjoyed — this seeds your personalized recommendations.</p>
      </div>

      <div className={styles.selectionCounter}>
        <span className={styles.counterText}>
          <span className={styles.counterNum}>{selected.length}</span> / 5 selected
        </span>
      </div>

      {loading ? (
        <div className={styles.skeletonGrid}>
          {Array.from({ length: 20 }).map((_, i) => (
            <div key={i} className={`${styles.skeletonCard} skeleton`} />
          ))}
        </div>
      ) : (
        <div className={styles.movieGrid}>
          {movies.map((movie) => {
            const isSelected = selected.includes(movie.id);
            const selectionIndex = selected.indexOf(movie.id);

            return (
              <div
                key={movie.id}
                className={`${styles.moviePickCard} ${isSelected ? styles.moviePickCardSelected : ''}`}
                onClick={() => toggleMovie(movie.id)}
                role="checkbox"
                aria-checked={isSelected}
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && toggleMovie(movie.id)}
                style={{ opacity: selected.length >= 5 && !isSelected ? 0.4 : 1 }}
              >
                <Image width={342} height={513}
                  src={getImageUrl(movie.poster_path || movie.poster_url)}
                  alt={movie.title}
                  loading="lazy"
                />
                <div className={styles.moviePickRating}>
                  ⭐ {(movie.vote_average || movie.imdb_rating || 0).toFixed(1)}
                </div>
                <div className={`${styles.moviePickBadge} ${isSelected ? styles.moviePickBadgeVisible : ''}`}>
                  {selectionIndex + 1}
                </div>
                <div className={styles.moviePickOverlay}>
                  <div className={styles.moviePickTitle}>
                    {movie.title || movie.name}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className={styles.actions}>
        <button
          className="btn btn-secondary"
          onClick={() => router.push('/onboarding/platforms')}
        >
          ← Back
        </button>
        <button
          className="btn btn-primary btn-lg"
          disabled={selected.length !== 5 || saving}
          onClick={handleDone}
        >
          {saving ? 'Setting up your feed...' : '🎬 Start Discovering'}
        </button>
      </div>
    </div>
  );
}

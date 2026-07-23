'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/AuthContext';
import styles from '../onboarding.module.css';

const PLATFORMS = [
  { id: 1, name: 'Netflix',        icon: '🟥', tmdb_id: 8   },
  { id: 2, name: 'Prime Video',    icon: '🔵', tmdb_id: 119 },
  { id: 3, name: 'Hotstar',        icon: '🌟', tmdb_id: 122 },
  { id: 4, name: 'Jio Cinema',     icon: '🟣', tmdb_id: 220 },
  { id: 5, name: 'Zee5',           icon: '🟪', tmdb_id: 232 },
  { id: 6, name: 'SonyLIV',        icon: '🔴', tmdb_id: 237 },
  { id: 7, name: 'Apple TV+',      icon: '🍎', tmdb_id: 350 },
  { id: 8, name: 'Lionsgate Play', icon: '🦁', tmdb_id: 561 }
];

export default function PlatformSelectionPage() {
  const [selected, setSelected] = useState([]);
  const [loading, setLoading] = useState(false);
  const { user, updateUserData } = useAuth();
  const router = useRouter();

  const togglePlatform = (id) => {
    setSelected(prev =>
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
    );
  };

  const handleContinue = async () => {
    if (selected.length === 0) return;

    setLoading(true);
    try {
      const res = await fetch('/api/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, platformIds: selected })
      });

      if (res.ok) {
        updateUserData({ platforms: selected });
        router.push('/onboarding/pick-movies');
      }
    } catch (err) {
      console.error('Error saving platforms:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.onboarding}>
      <div className={styles.header}>
        <Link href="/" className={styles.logo}>
          <div className={styles.logoIcon}>🎬</div>
          <span>Cine<span className="gradient-text">Match</span></span>
        </Link>

        <div className={styles.stepIndicator}>
          <div className={`${styles.stepDot} ${styles.stepDotActive}`} />
          <div className={`${styles.stepLine}`} />
          <div className={styles.stepDot} />
        </div>

        <h1>Select Your Streaming Platforms</h1>
        <p>Which OTT platforms do you subscribe to? We&apos;ll only recommend movies available on your platforms.</p>
      </div>

      <div className={styles.platformGrid}>
        {PLATFORMS.map((platform) => (
          <div
            key={platform.id}
            className={`${styles.platformCard} ${selected.includes(platform.id) ? styles.platformCardSelected : ''}`}
            onClick={() => togglePlatform(platform.id)}
            role="checkbox"
            aria-checked={selected.includes(platform.id)}
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && togglePlatform(platform.id)}
          >
            <div className={`${styles.platformCheck} ${selected.includes(platform.id) ? styles.platformCheckActive : ''}`}>
              {selected.includes(platform.id) ? '✓' : ''}
            </div>
            <div className={styles.platformLogo}>
              {platform.icon}
            </div>
            <span className={styles.platformName}>{platform.name}</span>
          </div>
        ))}
      </div>

      <div className={styles.selectionCounter}>
        <span className={styles.counterText}>
          <span className={styles.counterNum}>{selected.length}</span> platform{selected.length !== 1 ? 's' : ''} selected
        </span>
      </div>

      <div className={styles.actions}>
        <button
          className="btn btn-primary btn-lg"
          disabled={selected.length === 0 || loading}
          onClick={handleContinue}
        >
          {loading ? 'Saving...' : 'Continue →'}
        </button>
      </div>
    </div>
  );
}

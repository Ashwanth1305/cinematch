import './globals.css';
import { AuthProvider } from '@/lib/AuthContext';

export const metadata = {
  title: 'CineMatch — Personalized Movie & Series Recommendations',
  description: 'Discover movies and series tailored to your taste across all your streaming platforms. Get AI-powered recommendations from Netflix, Prime Video, Hotstar, and more — all in one place.',
  keywords: 'movie recommendations, OTT platforms, Netflix, Prime Video, Hotstar, personalized streaming, movie discovery',
  openGraph: {
    title: 'CineMatch — Your Personal Movie Guide',
    description: 'One app, all your streaming platforms. AI-powered recommendations that learn your taste.',
    type: 'website',
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#0a0a0f" />
      </head>
      <body>
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}

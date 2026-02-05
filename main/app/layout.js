import './globals.css';
import { ThemeProvider } from '@/components/theme-provider';

export const metadata = {
  title: 'IMAGICITY Invoice Manager',
  description: 'Firebase secured Next.js invoice manager',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}

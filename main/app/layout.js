import './globals.css';

export const metadata = {
  title: 'IMAGICITY Invoice Manager',
  description: 'Firebase secured Next.js invoice manager',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

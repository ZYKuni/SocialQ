import "./globals.css";

export const metadata = {
  title: "Create My Claw",
  description: "A playful mobile-first SocialQ mini-program mockup",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

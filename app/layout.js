import "./globals.css";

export const metadata = {
  title: "SocialQ claw匹配 Demo",
  description: "一个移动端优先的 SocialQ QQ 小程序风格交互 Demo",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

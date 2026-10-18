import "./globals.css";

export const metadata = {
  title: "SocialQ · AI 分身交友 Demo",
  description: "让 AI 分身先替你破冰：人格提炼、Agent 代聊、匹配判断，以及对匹配效果的离线验证",
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}

export const metadata = { title: '设置' };

// page.jsx 本身是客户端组件，metadata 由这层服务端 layout 提供
export default function SettingsLayout({ children }) {
  return children;
}

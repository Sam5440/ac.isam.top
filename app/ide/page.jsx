import IdePage from '@/components/ide/IdePage';

export const metadata = { title: 'IDE 编程台' };

/** /ide 在线编程工作台：薄壳服务端组件，主体为客户端 IdePage。 */
export default function Page() {
  return <IdePage />;
}

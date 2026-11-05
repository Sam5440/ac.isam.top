'use client';

/**
 * 根级错误边界（layout / 根渲染崩溃时使用，Next 要求自带 <html>/<body>）。
 * 此刻全局样式与路由器都可能不可用：全部内联样式、用 <a> 做返回首页，
 * 保证任何情况下用户都有出口。
 */

export default function GlobalError({ error, reset }) {
  const btn = {
    display: 'inline-block',
    margin: '0.25rem',
    padding: '0.5rem 1rem',
    borderRadius: '0.5rem',
    fontSize: '14px',
    textDecoration: 'none',
    cursor: 'pointer',
    border: '1px solid #303038',
    background: 'transparent',
    color: '#d4d4d8',
  };

  return (
    <html lang="zh-CN">
      <body
        style={{
          margin: 0,
          background: '#16151a',
          color: '#d4d4d8',
          font: '15px/1.7 system-ui, sans-serif',
          display: 'flex',
          minHeight: '100vh',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div style={{ maxWidth: '26rem', padding: '2rem', textAlign: 'center' }}>
          <p style={{ fontSize: '2rem', margin: '0 0 .5rem' }}>⚠️</p>
          <h1 style={{ fontSize: '1.1rem', margin: '0 0 .5rem' }}>页面出错了</h1>
          <p style={{ color: '#9ca3af', margin: '0 0 1.25rem' }}>
            应用发生了严重错误。可尝试重试或返回首页；离线时可先浏览已缓存的题目。
          </p>
          <div>
            <button type="button" onClick={() => reset()} style={{ ...btn, color: '#5b8dff' }}>
              重试
            </button>
            <a href="/" style={{ ...btn, color: '#5b8dff', borderColor: '#3b4cc0' }}>
              🏠 返回首页
            </a>
            <a href="/problems" style={btn}>
              📚 题库
            </a>
            <a href="/contests" style={btn}>
              🏆 比赛
            </a>
          </div>
          {error?.digest ? (
            <p style={{ color: '#6b7280', margin: '1rem 0 0', fontSize: '12px' }}>
              错误标识：{error.digest}
            </p>
          ) : null}
        </div>
      </body>
    </html>
  );
}

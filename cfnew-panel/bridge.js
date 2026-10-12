// 原界面的订阅和配置入口连接到各自的服务器。
document.addEventListener('DOMContentLoaded', () => {
  const bar = document.createElement('div');
  bar.style.cssText = 'position:relative;padding:12px 20px;color:#b2efda;text-align:center;background:#171322';
  const back = document.createElement('a');
  back.href = '/'; back.textContent = '切换 Worker'; back.style.color = '#b2efda';
  bar.append(back, document.createTextNode(' · ' + new URL(window.CFNEW.host).host));
  document.body.prepend(bar);
  const links = document.querySelectorAll('[onclick]');
  for (const link of links) {
    const action = link.getAttribute('onclick');
    if (action.includes('window.location.href') && action.includes('/sub')) {
      link.removeAttribute('onclick');
      link.addEventListener('click', () => navigator.clipboard.writeText(window.CFNEW.subUrl));
    }
  }
});

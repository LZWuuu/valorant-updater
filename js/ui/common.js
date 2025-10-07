// 通用 UI 功能模块

// 显示标签页
export function showTab(tab) {
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
  document.getElementById('tab_' + tab)?.classList.add('active');
  const content = document.getElementById('content');
  if (!content) return;

  // 根据标签动态加载内容
  import(`./${tab}.js`).then(module => {
    if (module.render) {
      module.render();
    }
  }).catch(error => {
    console.error(`加载 ${tab} 模块失败:`, error);
    content.innerHTML = `<div class="error">加载页面失败</div>`;
  });
}

// 显示加载指示器
export function showLoadingIndicator(show) {
  let indicator = document.getElementById('loading-indicator');

  if (show) {
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'loading-indicator';
      indicator.className = 'loading-indicator';
      indicator.innerHTML = `
        <div class="loading-spinner"></div>
        <div class="loading-text">菜鸡正在互啄中...</div>
      `;
      document.body.appendChild(indicator);
    }
  } else {
    if (indicator) {
      document.body.removeChild(indicator);
    }
  }
}

// 显示错误消息
export function showErrorMessage(message) {
  const errorDiv = document.createElement('div');
  errorDiv.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: #ff4444;
    color: white;
    padding: 15px 20px;
    border-radius: 5px;
    z-index: 10001;
    max-width: 400px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.3);
    animation: slideIn 0.3s ease-out;
  `;
  errorDiv.innerHTML = `
    <div style="display: flex; align-items: center;">
      <span style="margin-right: 10px;">❌</span>
      <span>${message}</span>
    </div>
  `;

  document.body.appendChild(errorDiv);

  setTimeout(() => {
    document.body.removeChild(errorDiv);
  }, 5000);
}
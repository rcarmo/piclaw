export interface WidgetAction {
  label: string;
  action: string;
  variant?: 'primary' | 'secondary' | 'danger';
}

export function createRecoveryWidget(type: string, actions: WidgetAction[]): string {
  const buttons = actions.map(action => {
    const variantClass = action.variant || 'secondary';
    return `<button class="widget-btn widget-btn-${variantClass}" data-action="${action.action}">${escapeHtml(action.label)}</button>`;
  }).join('');

  return `
<div class="widget recovery-widget">
  <div class="widget-header">Recovery Required</div>
  <div class="widget-body">
    <p>Session ${escapeHtml(type)}. Please select an action:</p>
    <div class="widget-actions">${buttons}</div>
  </div>
</div>
${widgetStyles()}
  `;
}

export function createAutoresearchWidget(isRunning: boolean): string {
  const status = isRunning ? 'Active' : 'Inactive';
  const buttonLabel = isRunning ? 'Stop Autoresearch' : 'Launch Autoresearch';
  const buttonAction = isRunning ? 'stop-autoresearch' : 'launch-autoresearch';
  const buttonVariant = isRunning ? 'danger' : 'primary';

  return `
<div class="widget autoresearch-widget">
  <div class="widget-header">Autoresearch Control</div>
  <div class="widget-body">
    <p>Status: <span class="status-badge ${isRunning ? 'status-active' : 'status-inactive'}">${status}</span></p>
    <div class="widget-actions">
      <button class="widget-btn widget-btn-${buttonVariant}" data-action="${buttonAction}">${buttonLabel}</button>
    </div>
  </div>
</div>
${widgetStyles()}
  `;
}

function widgetStyles(): string {
  return `
<style>
.widget {
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  margin: 1rem 0;
  font-family: system-ui, -apple-system, sans-serif;
  max-width: 400px;
}
.widget-header {
  padding: 12px 16px;
  background: #f5f5f5;
  border-bottom: 1px solid #e0e0e0;
  font-weight: 600;
  border-radius: 8px 8px 0 0;
}
.widget-body {
  padding: 16px;
}
.widget-actions {
  display: flex;
  gap: 12px;
  margin-top: 12px;
  flex-wrap: wrap;
}
.widget-btn {
  padding: 8px 16px;
  border-radius: 6px;
  border: none;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s;
}
.widget-btn-primary {
  background: #0066cc;
  color: white;
}
.widget-btn-primary:hover {
  background: #0052a3;
}
.widget-btn-secondary {
  background: #e0e0e0;
  color: #333;
}
.widget-btn-secondary:hover {
  background: #cccccc;
}
.widget-btn-danger {
  background: #dc3545;
  color: white;
}
.widget-btn-danger:hover {
  background: #b02a37;
}
.status-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 500;
}
.status-active {
  background: #d4edda;
  color: #155724;
}
.status-inactive {
  background: #f8d7da;
  color: #721c24;
}
</style>
  `;
}

function escapeHtml(str: string): string {
  return str.replace(/[&<>]/g, function(m) {
    if (m === '&') return '&amp;';
    if (m === '<') return '&lt;';
    if (m === '>') return '&gt;';
    return m;
  });
}

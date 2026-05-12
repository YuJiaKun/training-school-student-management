const STATUS_LABELS = {
  active: '在读',
  archived: '已归档',
  pending: '待处理',
  submitted: '已提交',
  reviewed: '已批改',
  passed: '通过',
  failed: '未通过',
  hired: '已入职',
  not_hired: '未入职',
  requested: '待接收',
  scheduled: '已排期',
  confirmed: '已确认',
  rescheduled: '已改期',
  completed: '已完成',
  cancelled: '已取消'
};

const TONE_BY_STATUS = {
  active: 'success',
  archived: 'muted',
  pending: 'warning',
  requested: 'warning',
  submitted: 'info',
  reviewed: 'success',
  passed: 'success',
  hired: 'success',
  failed: 'danger',
  not_hired: 'muted',
  confirmed: 'info',
  scheduled: 'info',
  rescheduled: 'warning',
  completed: 'success',
  cancelled: 'muted'
};

export function statusText(value) {
  return STATUS_LABELS[value] || value || '未知';
}

export default function StatusBadge({ children, status, tone }) {
  const resolvedTone = tone || TONE_BY_STATUS[status] || 'info';
  return <span className={`status-badge status-${resolvedTone}`}>{children || statusText(status)}</span>;
}

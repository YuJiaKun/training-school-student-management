import { TONE_BY_STATUS, statusText } from '../status.js';

export { statusText };

export default function StatusBadge({ children, status, tone }) {
  const resolvedTone = tone || TONE_BY_STATUS[status] || 'info';
  return <span className={`status-badge status-${resolvedTone}`}>{children || statusText(status)}</span>;
}

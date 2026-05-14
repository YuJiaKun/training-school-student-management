import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BriefcaseBusiness,
  CalendarClock,
  Clock3,
  RefreshCw,
  TrendingUp,
  UserCheck,
  Users
} from 'lucide-react';
import EChart from '../components/EChart.jsx';
import { apiGet } from '../api.js';
import {
  buildEmploymentOption,
  buildHiredStatusOption,
  buildInterviewResultOption,
  buildInterviewTrendOption
} from './adminDashboardCharts.js';

const defaultStats = {
  students: { total: 0, active: 0, archived: 0 },
  homework: { total: 0, completed: 0 },
  interviews: { total: 0, pending: 0, passed: 0, failed: 0 },
  interviewResults: { pending: 0, passed: 0, failed: 0 },
  hiredStatuses: { pending: 0, hired: 0, not_hired: 0 },
  pendingSchedules: [],
  recentInterviews: [],
  employmentRate: 0
};

export default function AdminDashboard() {
  const [stats, setStats] = useState(defaultStats);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastUpdatedAt, setLastUpdatedAt] = useState('');

  async function loadStats() {
    setError('');
    try {
      const payload = await apiGet('/api/dashboard/stats');
      setStats({ ...defaultStats, ...payload });
      setLastUpdatedAt(new Date().toISOString());
    } catch (err) {
      setError(err.message || '就业与面试数据加载失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    loadStats();
  }, []);

  const pendingSchedules = stats.pendingSchedules || [];
  const recentInterviews = stats.recentInterviews || [];
  const hasInterviews = Number(stats.interviews.total || 0) > 0;
  const metrics = useMemo(() => [
    {
      label: '在读学生',
      value: stats.students.active,
      hint: `学生总数 ${stats.students.total} 人`,
      icon: Users,
      tone: 'cyan'
    },
    {
      label: '面试总数',
      value: stats.interviews.total,
      hint: `待反馈 ${stats.interviews.pending || 0} 条`,
      icon: BriefcaseBusiness,
      tone: 'violet'
    },
    {
      label: '已通过面试',
      value: stats.interviewResults.passed || 0,
      hint: `未通过 ${stats.interviewResults.failed || 0} 条`,
      icon: UserCheck,
      tone: 'blue'
    },
    {
      label: '就业率',
      value: percent(stats.employmentRate),
      hint: `已入职 ${stats.hiredStatuses.hired || 0} 人次`,
      icon: TrendingUp,
      tone: 'green'
    },
    {
      label: '待审批排期',
      value: pendingSchedules.length,
      hint: '学生发起的排期申请',
      icon: CalendarClock,
      tone: 'amber'
    }
  ], [pendingSchedules.length, stats]);

  return (
    <section className="homework-analytics-page admin-employment-page">
      <div className="analytics-screen admin-employment-screen">
        <header className="analytics-hero">
          <div className="analytics-title-block">
            <span className="analytics-live-dot">ADMIN</span>
            <div>
              <h1>就业与面试数据大屏</h1>
              <p>管理员只看全局就业转化、面试反馈和排期压力，不下钻作业细节。</p>
            </div>
          </div>

          <div className="analytics-command-bar">
            <button className="screen-action" type="button" onClick={loadStats} disabled={loading}>
              <RefreshCw size={16} aria-hidden="true" />
              <span>刷新数据</span>
            </button>
          </div>
        </header>

        <div className="analytics-sync-row">
          <span><Clock3 size={15} aria-hidden="true" />最近更新：{formatDateTime(lastUpdatedAt)}</span>
          <span><BriefcaseBusiness size={15} aria-hidden="true" />统计范围：全校学生与面试记录</span>
        </div>

        {error ? <div className="screen-alert"><AlertTriangle size={18} aria-hidden="true" />{error}</div> : null}
        {loading ? <div className="screen-loading">正在加载就业与面试数据...</div> : null}

        <section className="analytics-metric-grid">
          {metrics.map((metric) => (
            <MetricCard key={metric.label} {...metric} />
          ))}
        </section>

        {!hasInterviews && !loading ? (
          <EmptyState text="暂无面试数据。录入面试记录后，大屏会展示就业率、面试结果和近期趋势。" />
        ) : null}

        <section className="analytics-dashboard-grid admin-dashboard-grid">
          <ChartPanel
            className="employment-panel"
            title="就业转化率"
            subtitle={`已入职 ${stats.hiredStatuses.hired || 0} 条，面试总数 ${stats.interviews.total || 0} 条`}
            icon={TrendingUp}
            empty={!hasInterviews}
            emptyText="暂无面试记录"
          >
            <EChart className="employment-chart" option={buildEmploymentOption(stats)} />
          </ChartPanel>

          <ChartPanel
            className="interview-result-panel"
            title="面试结果分布"
            subtitle="待反馈、已通过、未通过"
            icon={BriefcaseBusiness}
            empty={!hasInterviews}
            emptyText="暂无面试结果"
          >
            <EChart className="interview-result-chart" option={buildInterviewResultOption(stats.interviewResults)} />
          </ChartPanel>

          <SchedulePanel items={pendingSchedules} />

          <ChartPanel
            className="interview-trend-panel"
            title="近期面试趋势"
            subtitle="按面试日期聚合最近记录"
            icon={CalendarClock}
            empty={!recentInterviews.length}
            emptyText="暂无近期面试"
          >
            <EChart className="interview-trend-chart" option={buildInterviewTrendOption(recentInterviews)} />
          </ChartPanel>

          <ChartPanel
            className="hired-status-panel"
            title="入职状态分布"
            subtitle="待定、已入职、未入职"
            icon={UserCheck}
            empty={!hasInterviews}
            emptyText="暂无入职状态"
          >
            <EChart className="hired-status-chart" option={buildHiredStatusOption(stats.hiredStatuses)} />
          </ChartPanel>

          <RecentInterviewPanel items={recentInterviews} />
        </section>
      </div>
    </section>
  );
}

function MetricCard({ label, value, hint, icon: Icon, tone }) {
  return (
    <article className={`analytics-metric analytics-metric-${tone}`}>
      <div className="metric-icon"><Icon size={18} aria-hidden="true" /></div>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </article>
  );
}

function ChartPanel({ title, subtitle, icon: Icon, children, className = '', empty, emptyText }) {
  return (
    <article className={`screen-panel ${className}`}>
      <div className="screen-panel-header">
        <div>
          <h2><Icon size={18} aria-hidden="true" />{title}</h2>
          <p>{subtitle}</p>
        </div>
      </div>
      {empty ? <EmptyState text={emptyText} compact /> : children}
    </article>
  );
}

function SchedulePanel({ items }) {
  return (
    <article className="screen-panel pending-schedule-panel">
      <div className="screen-panel-header">
        <div>
          <h2><CalendarClock size={18} aria-hidden="true" />待审批排期</h2>
          <p>学生发起、等待管理员确认</p>
        </div>
      </div>
      {!items.length ? (
        <EmptyState text="暂无待审批排期" compact tone="success" />
      ) : (
        <div className="screen-list">
          {items.map((item) => (
            <div className="screen-list-item" key={item.id}>
              <div>
                <strong>{item.studentName || `学生 #${item.studentId}`}</strong>
                <span>{item.companyName || '未填写公司'} / {formatDateTime(item.startsAt)}</span>
              </div>
              <span className="missing-tag">待审</span>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

function RecentInterviewPanel({ items }) {
  return (
    <article className="screen-panel recent-interview-panel">
      <div className="screen-panel-header">
        <div>
          <h2><BriefcaseBusiness size={18} aria-hidden="true" />近期面试动态</h2>
          <p>最近录入的面试记录</p>
        </div>
      </div>
      {!items.length ? (
        <EmptyState text="暂无近期面试" compact />
      ) : (
        <div className="screen-list">
          {items.map((item) => (
            <div className="screen-list-item" key={item.id}>
              <div>
                <strong>{item.companyName || '未填写公司'}</strong>
                <span>{item.studentName || `学生 #${item.studentId}`} / {item.positionName || '未填写岗位'}</span>
              </div>
              <span className={`screen-state screen-state-${item.result || 'pending'}`}>{resultText(item.result)}</span>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

function EmptyState({ text, compact = false, tone = 'muted' }) {
  return <div className={`screen-empty screen-empty-${tone} ${compact ? 'is-compact' : ''}`}>{text}</div>;
}

function percent(value) {
  const number = Math.max(0, Math.min(100, Number(value || 0)));
  return `${number}%`;
}

function formatDateTime(value) {
  if (!value) return '-';
  return String(value).replace('T', ' ').slice(0, 16);
}

function resultText(value) {
  if (value === 'passed') return '通过';
  if (value === 'failed') return '未过';
  return '待反馈';
}

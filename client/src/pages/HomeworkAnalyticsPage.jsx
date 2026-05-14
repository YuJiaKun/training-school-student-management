import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ClipboardList,
  Clock3,
  FileText,
  Filter,
  GraduationCap,
  RefreshCw,
  TrendingUp,
  Users
} from 'lucide-react';
import EChart from '../components/EChart.jsx';
import { apiGet } from '../api.js';
import { buildPath } from '../utils/url.js';
import {
  buildAssignmentOption,
  buildClassOption,
  buildCompletionOption,
  buildStudentDistributionOption
} from './homeworkAnalyticsCharts.js';

const emptyAnalytics = {
  overview: {
    studentCount: 0,
    assignmentCount: 0,
    recordCount: 0,
    submittedCount: 0,
    pendingCount: 0,
    completionRate: 0
  },
  classes: [],
  assignments: [],
  students: [],
  latestAssignment: null
};

function openHomeworkAssignment(assignmentId) {
  if (assignmentId) {
    sessionStorage.setItem('homework:selectedAssignmentId', String(assignmentId));
  }
  window.location.hash = 'homework';
}

export default function HomeworkAnalyticsPage() {
  const [analytics, setAnalytics] = useState(emptyAnalytics);
  const [classes, setClasses] = useState([]);
  const [className, setClassName] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastUpdatedAt, setLastUpdatedAt] = useState('');

  async function loadAnalytics() {
    setError('');
    try {
      const [analyticsPayload, classPayload] = await Promise.all([
        apiGet(buildPath('/api/homework-analytics', { className })),
        apiGet('/api/classes')
      ]);
      setAnalytics({ ...emptyAnalytics, ...analyticsPayload });
      setClasses(classPayload.items || []);
      setLastUpdatedAt(new Date().toISOString());
    } catch (err) {
      setError(err.message || '作业大屏数据加载失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    loadAnalytics();
  }, [className]);

  useEffect(() => {
    if (!autoRefresh) return undefined;
    const timer = window.setInterval(loadAnalytics, 30000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, className]);

  const overview = analytics.overview || emptyAnalytics.overview;
  const latestAssignment = analytics.latestAssignment;
  const hasRecords = Number(overview.recordCount || 0) > 0;
  const classRanking = useMemo(
    () => [...(analytics.classes || [])].sort((left, right) => Number(right.completionRate || 0) - Number(left.completionRate || 0)),
    [analytics.classes]
  );
  const assignmentRanking = useMemo(
    () => [...(analytics.assignments || [])].slice(0, 8),
    [analytics.assignments]
  );
  const studentWarnings = useMemo(
    () => [...(analytics.students || [])].filter((student) => Number(student.assignedCount || 0) > 0).slice(0, 8),
    [analytics.students]
  );
  const missingStudents = latestAssignment?.missingStudents || [];

  const metrics = [
    {
      label: '在读人数',
      value: overview.studentCount,
      hint: `当前范围：${className || '全部班级'}`,
      icon: Users,
      tone: 'cyan'
    },
    {
      label: '作业任务',
      value: overview.assignmentCount,
      hint: '已发布的作业批次',
      icon: ClipboardList,
      tone: 'violet'
    },
    {
      label: '应交记录',
      value: overview.recordCount,
      hint: '按学生作业记录统计',
      icon: FileText,
      tone: 'blue'
    },
    {
      label: '总完成率',
      value: percent(overview.completionRate),
      hint: `已交 ${overview.submittedCount} / 未交 ${overview.pendingCount}`,
      icon: TrendingUp,
      tone: 'green'
    },
    {
      label: '缺交记录',
      value: overview.pendingCount,
      hint: latestAssignment ? `最新作业缺交 ${latestAssignment.pendingCount} 人` : '暂无最新作业',
      icon: AlertTriangle,
      tone: 'amber'
    }
  ];

  return (
    <section className="homework-analytics-page">
      <div className="analytics-screen">
        <header className="analytics-hero">
          <div className="analytics-title-block">
            <span className="analytics-live-dot">LIVE</span>
            <div>
              <h1>作业完成大屏</h1>
              <p>聚合作业提交、班级完成率、学生风险和最新缺交名单，只看有没有做。</p>
            </div>
          </div>

          <div className="analytics-command-bar">
            <label className="analytics-select">
              <Filter size={16} aria-hidden="true" />
              <select value={className} onChange={(event) => setClassName(event.target.value)} aria-label="班级筛选">
                <option value="">全部班级</option>
                {classes.map((item) => (
                  <option key={item.className} value={item.className}>{item.className}</option>
                ))}
              </select>
            </label>
            <button className={autoRefresh ? 'screen-toggle is-active' : 'screen-toggle'} type="button" onClick={() => setAutoRefresh((value) => !value)}>
              <RefreshCw size={16} aria-hidden="true" />
              <span>{autoRefresh ? '自动刷新 30s' : '手动刷新'}</span>
            </button>
            <button className="screen-action" type="button" onClick={loadAnalytics} disabled={loading}>
              <RefreshCw size={16} aria-hidden="true" />
              <span>立即刷新</span>
            </button>
          </div>
        </header>

        <div className="analytics-sync-row">
          <span><Clock3 size={15} aria-hidden="true" />最近更新：{formatDateTime(lastUpdatedAt)}</span>
          <span><GraduationCap size={15} aria-hidden="true" />统计范围：{className || '全部班级'}</span>
        </div>

        {error ? <div className="screen-alert"><AlertTriangle size={18} aria-hidden="true" />{error}</div> : null}
        {loading ? <div className="screen-loading">正在加载作业大屏...</div> : null}

        <section className="analytics-metric-grid">
          {metrics.map((metric) => (
            <MetricCard key={metric.label} {...metric} />
          ))}
        </section>

        {!hasRecords && !loading ? (
          <EmptyState text="暂无作业提交数据。发布作业并生成待提交名单后，大屏会自动展示完成情况。" />
        ) : null}

        <section className="analytics-dashboard-grid">
          <ChartPanel
            className="completion-panel"
            title="总体完成率"
            subtitle={`已交 ${overview.submittedCount} 条，未交 ${overview.pendingCount} 条`}
            icon={CheckCircle2}
            empty={!hasRecords}
            emptyText="暂无应交记录"
          >
            <EChart className="completion-chart" option={buildCompletionOption(overview)} />
          </ChartPanel>

          <ChartPanel
            className="assignment-panel"
            title="每次作业完成情况"
            subtitle="最近 8 次作业提交进度"
            icon={BarChart3}
            empty={!assignmentRanking.length}
            emptyText="暂无作业任务"
          >
            <EChart className="assignment-chart" option={buildAssignmentOption(assignmentRanking)} />
          </ChartPanel>

          <ChartPanel
            className="class-panel"
            title="班级完成率排行"
            subtitle="按班级名称聚合作业记录"
            icon={Users}
            empty={!classRanking.length}
            emptyText="暂无班级数据"
          >
            <EChart className="class-chart" option={buildClassOption(classRanking)} />
          </ChartPanel>

          <ChartPanel
            className="student-distribution-panel"
            title="学生完成率分布"
            subtitle="快速判断低完成率学生占比"
            icon={GraduationCap}
            empty={!studentWarnings.length}
            emptyText="暂无学生作业记录"
          >
            <EChart className="distribution-chart" option={buildStudentDistributionOption(analytics.students)} />
          </ChartPanel>

          <StudentRiskPanel students={studentWarnings} />
          <LatestMissingPanel latestAssignment={latestAssignment} students={missingStudents} />
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

function StudentRiskPanel({ students }) {
  return (
    <article className="screen-panel student-risk-panel">
      <div className="screen-panel-header">
        <div>
          <h2><AlertTriangle size={18} aria-hidden="true" />学生完成率预警</h2>
          <p>优先显示完成率最低的学生</p>
        </div>
      </div>
      {!students.length ? <EmptyState text="暂无学生作业记录" compact /> : null}
      <div className="risk-list">
        {students.map((student) => (
          <div className="risk-item" key={student.studentId}>
            <div className="risk-main">
              <strong>{student.studentName || `学生 #${student.studentId}`}</strong>
              <span>{student.className || '-'} / 已交 {student.submittedCount}/{student.assignedCount}</span>
            </div>
            <div className="risk-score">
              <b>{percent(student.completionRate)}</b>
              <small>{formatDateTime(student.latestSubmitAt)}</small>
            </div>
            <div className="risk-progress" style={progressStyle(student.completionRate)}>
              <span />
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}

function LatestMissingPanel({ latestAssignment, students }) {
  return (
    <article className="screen-panel latest-missing-panel">
      <div className="screen-panel-header">
        <div>
          <h2><AlertTriangle size={18} aria-hidden="true" />最新作业缺交名单</h2>
          <p>{latestAssignment ? `${latestAssignment.homeworkName} / ${latestAssignment.className || '-'}` : '暂无作业任务'}</p>
        </div>
        {latestAssignment ? (
          <button className="screen-link-button" type="button" onClick={() => openHomeworkAssignment(latestAssignment.id)}>
            查看作业跟进
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {!latestAssignment ? <EmptyState text="暂无作业任务" compact /> : null}
      {latestAssignment && !students.length ? <EmptyState text="最新作业已全部提交" compact tone="success" /> : null}
      <div className="missing-list">
        {students.slice(0, 12).map((student) => (
          <div className="missing-item" key={student.studentId}>
            <div>
              <strong>{student.studentName || `学生 #${student.studentId}`}</strong>
              <span>{student.className || '-'} / {student.studentPhone || '-'}</span>
            </div>
            <span className="missing-tag">未交</span>
          </div>
        ))}
      </div>
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

function progressStyle(value) {
  return { '--progress': `${Math.max(0, Math.min(100, Number(value || 0)))}%` };
}

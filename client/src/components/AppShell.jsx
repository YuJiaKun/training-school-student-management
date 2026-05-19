import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import StatusBadge from './StatusBadge.jsx';

const AdminDashboard = lazy(() => import('../pages/AdminDashboard.jsx'));
const AdminScheduleQueue = lazy(() => import('../pages/AdminScheduleQueue.jsx'));
const AccountsPage = lazy(() => import('../pages/AccountsPage.jsx'));
const HomeworkAnalyticsPage = lazy(() => import('../pages/HomeworkAnalyticsPage.jsx'));
const HomeworkPage = lazy(() => import('../pages/HomeworkPage.jsx'));
const InterviewsPage = lazy(() => import('../pages/InterviewsPage.jsx'));
const SchedulesPage = lazy(() => import('../pages/SchedulesPage.jsx'));
const StudentSchedulesPage = lazy(() => import('../pages/StudentSchedulesPage.jsx'));
const StudentWorkspace = lazy(() => import('../pages/StudentWorkspace.jsx'));
const StudentsPage = lazy(() => import('../pages/StudentsPage.jsx'));
const TeacherStudentsPage = lazy(() => import('../pages/TeacherStudentsPage.jsx'));
const TeacherWorkspace = lazy(() => import('../pages/TeacherWorkspace.jsx'));

export const ROLE_TEXT = {
  admin: '管理员',
  teacher: '老师',
  student: '学生'
};

const NAV_ITEMS = [
  { key: 'dashboard', label: '工作台', roles: ['admin', 'teacher', 'student'] },
  { key: 'student-schedules', label: '我的排期', roles: ['student'] },
  { key: 'students', label: '学生管理', roles: ['admin'] },
  { key: 'accounts', label: '账号管理', roles: ['admin'] },
  { key: 'teacher-students', label: '班级学生', roles: ['teacher'] },
  { key: 'homework', label: '作业跟进', roles: ['teacher'] },
  { key: 'homework-analytics', label: '作业大屏', roles: ['teacher'] },
  { key: 'interviews', label: '面试记录', roles: ['admin'] },
  { key: 'schedules', label: '排期总览', roles: ['admin', 'teacher'] },
  { key: 'schedule-queue', label: '排期审批', roles: ['admin'] }
];

export default function AppShell({ user, onLogout }) {
  const [route, setRoute] = useHashRoute();
  const availableNav = useMemo(
    () => NAV_ITEMS.filter((item) => item.roles.includes(user.role)),
    [user.role]
  );
  const activeRoute = availableNav.some((item) => item.key === route) ? route : 'dashboard';
  const isStudent = user.role === 'student';

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark">教</div>
          <div>
            <strong>培训教务 CRM</strong>
            <span>学生管理系统</span>
          </div>
        </div>

        <nav className="side-nav" aria-label="主导航">
          {availableNav.map((item) => (
            <button
              className={item.key === activeRoute ? 'nav-item is-active' : 'nav-item'}
              type="button"
              key={item.key}
              onClick={() => setRoute(item.key)}
            >
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      <div className="workspace">
        <header className={isStudent ? 'topbar topbar-student' : 'topbar'}>
          <div>
            {!isStudent ? <p className="eyebrow">当前身份</p> : null}
            <h1>{isStudent ? '我的学习工作台' : `${ROLE_TEXT[user.role] || '用户'}工作台`}</h1>
          </div>
          <div className="user-actions">
            <StatusBadge tone="info">{ROLE_TEXT[user.role] || user.role}</StatusBadge>
            <span className="user-name">{user.username}</span>
            <button className="secondary-button" type="button" onClick={onLogout}>
              退出登录
            </button>
          </div>
        </header>

        <main className="main-content">
          <Suspense fallback={<div className="empty-state">正在加载页面...</div>}>
            <RouteView route={activeRoute} user={user} />
          </Suspense>
        </main>
      </div>
    </div>
  );
}

function RouteView({ route, user }) {
  if (route === 'students') return <StudentsPage />;
  if (route === 'accounts') return <AccountsPage />;
  if (route === 'teacher-students') return <TeacherStudentsPage />;
  if (route === 'homework') return <HomeworkPage />;
  if (route === 'homework-analytics') return <HomeworkAnalyticsPage />;
  if (route === 'interviews') return <InterviewsPage />;
  if (route === 'schedules') return <SchedulesPage user={user} />;
  if (route === 'student-schedules') return <StudentSchedulesPage user={user} />;
  if (route === 'schedule-queue') return <AdminScheduleQueue />;
  if (user.role === 'teacher') return <TeacherWorkspace user={user} />;
  if (user.role === 'student') return <StudentWorkspace user={user} />;
  return <AdminDashboard />;
}

function useHashRoute() {
  const readRoute = () => window.location.hash.replace(/^#\/?/, '') || 'dashboard';
  const [route, setRouteState] = useState(readRoute);

  useEffect(() => {
    const handleHashChange = () => setRouteState(readRoute());
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const setRoute = (nextRoute) => {
    window.location.hash = nextRoute;
    setRouteState(nextRoute);
  };

  return [route, setRoute];
}

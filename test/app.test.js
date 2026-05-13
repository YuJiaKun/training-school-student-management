const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDatabase } = require('../src/db');
const { createApp } = require('../src/app');
const { createServerApp } = require('../src/server');

function createSampleScheduleApp() {
  const db = createDatabase();
  const app = createApp({ db });
  const student1 = app.createStudent({ name: 'Alice', phone: '13800000001', className: '前端1班' });
  const student2 = app.createStudent({ name: 'Bob', phone: '13800000002', className: '前端1班' });
  return { app, student1, student2 };
}

async function withServer(app, callback, options = {}) {
  const server = createServerApp({ app, ...options }).listen(0);
  await once(server, 'listening');
  const { port } = server.address();
  try {
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
  }
}

function createClientDist() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'student-client-'));
  const assetsDir = path.join(dir, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html><head><title>前端入口</title></head><body><div id="root">React App Shell</div><script type="module" src="/assets/app.js"></script></body></html>');
  fs.writeFileSync(path.join(assetsDir, 'app.js'), 'console.log("client asset");');
  return dir;
}

async function loginAs(baseUrl, username = 'admin', password = `${username}123`) {
  const response = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const cookie = response.headers.get('set-cookie');

  assert.equal(response.status, 200);
  assert.match(cookie || '', /session=/);
  return cookie;
}

function jsonHeaders(cookie) {
  return { 'content-type': 'application/json', cookie };
}

test('student lifecycle supports create, archive, query, stats, and export', () => {
  const db = createDatabase();
  const app = createApp({ db });

  const alice = app.createStudent({
    name: 'Alice',
    phone: '13800000001',
    gender: 'female',
    birthday: '2001-01-01',
    className: '前端1班',
    enrolledAt: '2026-05-01',
    remark: '认真'
  });
  const bob = app.createStudent({
    name: 'Bob',
    phone: '13800000002',
    gender: 'male',
    birthday: '2000-02-02',
    className: '前端1班',
    enrolledAt: '2026-05-02',
    remark: ''
  });

  app.addHomeworkRecord({ studentId: alice.id, homeworkName: 'HTML作业', submitStatus: 'submitted', submitAt: '2026-05-08', reviewResult: 'passed', remark: '' });
  app.addHomeworkRecord({ studentId: bob.id, homeworkName: 'HTML作业', submitStatus: 'pending', submitAt: '', reviewResult: '', remark: '' });
  app.addInterviewRecord({ studentId: alice.id, companyName: 'A公司', positionName: '前端工程师', interviewAt: '2026-05-09', result: 'passed', feedback: '表现稳定', hiredStatus: 'hired', remark: '' });
  app.addInterviewRecord({ studentId: bob.id, companyName: 'B公司', positionName: '测试工程师', interviewAt: '2026-05-10', result: 'failed', feedback: '基础薄弱', hiredStatus: 'not_hired', remark: '' });

  app.archiveStudent(alice.id);

  assert.equal(app.listStudents({ status: 'active' }).items[0].name, 'Bob');
  assert.equal(app.listStudents({ status: 'archived' }).items[0].name, 'Alice');
  assert.deepEqual(app.getDashboardStats(), {
    students: { active: 1, archived: 1, total: 2 },
    homework: { total: 2, completed: 1 },
    interviews: { total: 2 },
    employmentRate: 50
  });
  assert.match(app.exportStudents({ status: 'active' }), /Bob/);
  assert.doesNotMatch(app.exportStudents({ status: 'active' }), /Alice/);
});

test('student name and phone are required', () => {
  const app = createApp({ db: createDatabase() });

  assert.throws(() => {
    app.createStudent({ name: '', phone: '', className: '前端1班' });
  }, /name and phone are required/);
});

test('student api creates, updates, filters, and archives records over http', async () => {
  const app = createApp({ db: createDatabase() });

  await withServer(app, async (baseUrl) => {
    const cookie = await loginAs(baseUrl);
    const created = await fetch(`${baseUrl}/api/students`, {
      method: 'POST',
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ name: 'Alice', phone: '13800000001', className: '前端1班', enrolledAt: '2026-05-01' })
    }).then((response) => response.json());

    const updated = await fetch(`${baseUrl}/api/students/${created.student.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ phone: '13900000001', remark: '已更新' })
    }).then((response) => response.json());

    const filtered = await fetch(`${baseUrl}/api/students?keyword=13900000001`, { headers: { cookie } }).then((response) => response.json());
    const archived = await fetch(`${baseUrl}/api/students/${created.student.id}/archive`, { method: 'POST', headers: { cookie } }).then((response) => response.json());

    assert.equal(updated.student.phone, '13900000001');
    assert.equal(filtered.total, 1);
    assert.equal(archived.student.status, 'archived');
  });
});

test('homework and interview records can be listed, filtered, updated, and exported', async () => {
  const app = createApp({ db: createDatabase() });
  const alice = app.createStudent({ name: 'Alice', phone: '13800000001', className: '前端1班' });
  const bob = app.createStudent({ name: 'Bob', phone: '13800000002', className: 'Java1班' });

  app.addHomeworkRecord({ studentId: alice.id, homeworkName: 'HTML作业', className: '前端1班', submitStatus: 'submitted', submitAt: '2026-05-08', reviewResult: 'passed', remark: '' });
  app.addHomeworkRecord({ studentId: bob.id, homeworkName: 'SQL作业', className: 'Java1班', submitStatus: 'pending', submitAt: '', reviewResult: '', remark: '' });
  app.addInterviewRecord({ studentId: alice.id, companyName: 'A公司', positionName: '前端工程师', interviewAt: '2026-05-09', result: 'passed', feedback: '表现稳定', hiredStatus: 'hired', remark: '' });
  app.addInterviewRecord({ studentId: bob.id, companyName: 'B公司', positionName: 'Java工程师', interviewAt: '2026-05-10', result: 'failed', feedback: '基础薄弱', hiredStatus: 'not_hired', remark: '' });

  assert.equal(app.listHomeworkRecords({ submitStatus: 'submitted' }).total, 1);
  assert.equal(app.listInterviewRecords({ result: 'failed' }).items[0].companyName, 'B公司');

  await withServer(app, async (baseUrl) => {
    const cookie = await loginAs(baseUrl);
    const homework = app.listHomeworkRecords({ submitStatus: 'pending' }).items[0];
    const interview = app.listInterviewRecords({ result: 'failed' }).items[0];

    const updatedHomework = await fetch(`${baseUrl}/api/homework/${homework.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ submitStatus: 'submitted', reviewResult: 'passed' })
    }).then((response) => response.json());
    const updatedInterview = await fetch(`${baseUrl}/api/interviews/${interview.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ result: 'passed', hiredStatus: 'hired' })
    }).then((response) => response.json());
    const homeworkCsv = await fetch(`${baseUrl}/api/export/homework?className=${encodeURIComponent('前端1班')}`, { headers: { cookie } }).then((response) => response.text());
    const interviewCsv = await fetch(`${baseUrl}/api/export/interviews?result=passed`, { headers: { cookie } }).then((response) => response.text());

    assert.equal(updatedHomework.record.reviewResult, 'passed');
    assert.equal(updatedInterview.record.hiredStatus, 'hired');
    assert.match(homeworkCsv, /HTML作业/);
    assert.match(interviewCsv, /A公司/);
  });
});

test('database state can be saved and loaded from disk', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'student-management-'));
  const filePath = path.join(tempDir, 'data.json');
  const app = createApp({ db: createDatabase({ filePath }) });
  app.createStudent({ name: 'Alice', phone: '13800000001', className: '前端1班' });
  app.saveDatabase();

  const loadedApp = createApp({ db: createDatabase({ filePath }) });

  assert.equal(loadedApp.listStudents().items[0].name, 'Alice');
});

test('login returns a role based session and /api/me exposes the current user', async () => {
  const app = createApp({ db: createDatabase() });

  await withServer(app, async (baseUrl) => {
    const login = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'teacher', password: 'teacher123' })
    });
    const body = await login.json();
    const cookie = login.headers.get('set-cookie');
    const me = await fetch(`${baseUrl}/api/me`, { headers: { cookie } }).then((response) => response.json());

    assert.equal(login.status, 200);
    assert.equal(body.user.role, 'teacher');
    assert.equal(me.user.username, 'teacher');
    assert.equal(me.user.teacherId, 1);
  });
});

test('invalid logins are rejected and business apis require a session', async () => {
  const app = createApp({ db: createDatabase() });
  app.createStudent({ name: 'Alice', phone: '13800000001', className: '前端1班' });

  await withServer(app, async (baseUrl) => {
    const login = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'wrong-password' })
    });
    const me = await fetch(`${baseUrl}/api/me`);
    const students = await fetch(`${baseUrl}/api/students`);
    const exportStudents = await fetch(`${baseUrl}/api/export/students`);

    assert.equal(login.status, 401);
    assert.doesNotMatch(login.headers.get('set-cookie') || '', /session=/);
    assert.equal(me.status, 401);
    assert.equal(students.status, 401);
    assert.equal(exportStudents.status, 401);
  });
});

test('logout deletes the server session and production cookies include security attributes', async () => {
  const app = createApp({ db: createDatabase() });

  await withServer(app, async (baseUrl) => {
    const cookie = await loginAs(baseUrl, 'teacher', 'teacher123');
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.match(cookie, /Max-Age=123/);
    assert.match(cookie, /Secure/);

    const logout = await fetch(`${baseUrl}/api/logout`, { method: 'POST', headers: { cookie } });
    const meAfterLogout = await fetch(`${baseUrl}/api/me`, { headers: { cookie } });

    assert.equal(logout.status, 200);
    assert.equal(meAfterLogout.status, 401);
  }, { cookieSecure: true, sessionMaxAgeSeconds: 123 });
});

test('role permissions protect admin apis and teacher schedule ownership', async () => {
  const { app, student1 } = createSampleScheduleApp();
  const teacherSchedule = app.createInterviewSchedule({
    studentId: student1.id,
    teacherId: 1,
    teacherName: '张老师',
    companyName: 'A公司',
    positionName: '前端工程师',
    startsAt: '2026-05-18T09:00:00',
    endsAt: '2026-05-18T09:30:00',
    status: 'requested',
    requestSource: 'student',
    remark: ''
  });

  await withServer(app, async (baseUrl) => {
    const adminCookie = await loginAs(baseUrl);
    const teacherCookie = await loginAs(baseUrl, 'teacher', 'teacher123');
    const studentCookie = await loginAs(baseUrl, 'student', 'student123');

    const adminStudents = await fetch(`${baseUrl}/api/students`, { headers: { cookie: adminCookie } });
    const teacherStudents = await fetch(`${baseUrl}/api/students`, { headers: { cookie: teacherCookie } });
    const studentStudents = await fetch(`${baseUrl}/api/students`, { headers: { cookie: studentCookie } });
    const teacherOwnSchedules = await fetch(`${baseUrl}/api/schedules?teacherId=1`, { headers: { cookie: teacherCookie } });
    const teacherOtherSchedules = await fetch(`${baseUrl}/api/schedules?teacherId=2`, { headers: { cookie: teacherCookie } });
    const teacherApprove = await fetch(`${baseUrl}/api/schedules/${teacherSchedule.id}/approve`, {
      method: 'POST',
      headers: jsonHeaders(teacherCookie),
      body: JSON.stringify({ approverName: '张老师' })
    });
    const teacherAccept = await fetch(`${baseUrl}/api/schedules/${teacherSchedule.id}/accept`, {
      method: 'POST',
      headers: jsonHeaders(teacherCookie),
      body: JSON.stringify({ confirmedByName: '张老师' })
    });

    assert.equal(adminStudents.status, 200);
    assert.equal(teacherStudents.status, 403);
    assert.equal(studentStudents.status, 403);
    assert.equal(teacherOwnSchedules.status, 200);
    assert.equal(teacherOtherSchedules.status, 403);
    assert.equal(teacherApprove.status, 403);
    assert.equal(teacherAccept.status, 200);
  });
});

test('student workspace only returns the bound student and only allows own schedule requests', async () => {
  const db = createDatabase();
  const studentApp = createApp({
    db,
    authAccounts: [
      { username: 'admin', password: 'admin123', role: 'admin' },
      { username: 'student-a', password: 'student123', role: 'student', studentId: 1 }
    ]
  });
  const alice = studentApp.createStudent({ name: 'Alice', phone: '13800000001', className: '前端1班' });
  const bob = studentApp.createStudent({ name: 'Bob', phone: '13800000002', className: '前端1班' });
  studentApp.addHomeworkRecord({ studentId: alice.id, homeworkName: 'HTML作业', submitStatus: 'submitted' });
  studentApp.addHomeworkRecord({ studentId: bob.id, homeworkName: 'SQL作业', submitStatus: 'pending' });
  studentApp.addInterviewRecord({ studentId: alice.id, companyName: 'A公司', positionName: '前端工程师' });

  await withServer(studentApp, async (baseUrl) => {
    const cookie = await loginAs(baseUrl, 'student-a', 'student123');
    const workspace = await fetch(`${baseUrl}/api/student-workspace`, { headers: { cookie } }).then((response) => response.json());
    const students = await fetch(`${baseUrl}/api/students`, { headers: { cookie } });
    const otherSchedule = await fetch(`${baseUrl}/api/schedules`, {
      method: 'POST',
      headers: jsonHeaders(cookie),
      body: JSON.stringify({
        studentId: bob.id,
        teacherId: 1,
        teacherName: '张老师',
        companyName: 'B公司',
        positionName: '测试工程师',
        startsAt: '2026-05-18T10:00:00',
        endsAt: '2026-05-18T10:30:00'
      })
    });
    const ownSchedule = await fetch(`${baseUrl}/api/schedules`, {
      method: 'POST',
      headers: jsonHeaders(cookie),
      body: JSON.stringify({
        studentId: alice.id,
        teacherId: 1,
        teacherName: '张老师',
        companyName: 'A公司',
        positionName: '前端工程师',
        startsAt: '2026-05-18T11:00:00',
        endsAt: '2026-05-18T11:30:00'
      })
    });

    assert.equal(workspace.student.id, alice.id);
    assert.equal(workspace.homeworkRecords.length, 1);
    assert.equal(workspace.interviewRecords.length, 1);
    assert.equal(students.status, 403);
    assert.equal(otherSchedule.status, 403);
    assert.equal(ownSchedule.status, 201);
  });
});

test('dashboard stats are available for the frontend', async () => {
  const app = createApp({ db: createDatabase() });
  app.createStudent({ name: 'Alice', phone: '13800000001', className: '前端1班' });

  await withServer(app, async (baseUrl) => {
    const cookie = await loginAs(baseUrl);
    const stats = await fetch(`${baseUrl}/api/dashboard/stats`, { headers: { cookie } }).then((response) => response.json());

    assert.equal(stats.students.total, 1);
    assert.equal(stats.homework.total, 0);
  });
});

test('schedule workflow supports request, approval, teacher acceptance, and timeline filtering', async () => {
  const { app, student1, student2 } = createSampleScheduleApp();

  const approvedRequest = app.createInterviewSchedule({
    studentId: student1.id,
    teacherId: 1,
    teacherName: '张老师',
    companyName: 'A公司',
    positionName: '前端工程师',
    startsAt: '2026-05-18T09:00:00',
    endsAt: '2026-05-18T09:30:00',
    status: 'requested',
    requestSource: 'student',
    remark: '请安排'
  });
  const acceptedRequest = app.createInterviewSchedule({
    studentId: student2.id,
    teacherId: 1,
    teacherName: '张老师',
    companyName: 'B公司',
    positionName: '测试工程师',
    startsAt: '2026-05-18T10:00:00',
    endsAt: '2026-05-18T10:30:00',
    status: 'requested',
    requestSource: 'student',
    remark: '请安排'
  });

  await withServer(app, async (baseUrl) => {
    const adminCookie = await loginAs(baseUrl);
    const teacherCookie = await loginAs(baseUrl, 'teacher', 'teacher123');
    const approved = await fetch(`${baseUrl}/api/schedules/${approvedRequest.id}/approve`, {
      method: 'POST',
      headers: jsonHeaders(adminCookie),
      body: JSON.stringify({ approverName: '管理员' })
    }).then((response) => response.json());
    const accepted = await fetch(`${baseUrl}/api/schedules/${acceptedRequest.id}/accept`, {
      method: 'POST',
      headers: jsonHeaders(teacherCookie),
      body: JSON.stringify({ confirmedByName: '张老师' })
    }).then((response) => response.json());
    const timeline = await fetch(`${baseUrl}/api/schedules/timeline?weekStart=2026-05-18`, { headers: { cookie: adminCookie } }).then((response) => response.json());

    assert.equal(approved.schedule.confirmedByRole, 'admin');
    assert.equal(accepted.schedule.confirmedByRole, 'teacher');
    assert.equal(timeline.teachers[0].entries.length, 2);
  });
});

test('schedule conflicts block overlapping teacher and student bookings', () => {
  const { app, student1, student2 } = createSampleScheduleApp();

  app.createInterviewSchedule({
    studentId: student1.id,
    teacherId: 1,
    teacherName: '张老师',
    companyName: 'A公司',
    positionName: '前端工程师',
    startsAt: '2026-05-18T09:00:00',
    endsAt: '2026-05-18T09:30:00',
    status: 'scheduled',
    remark: ''
  });

  assert.throws(() => {
    app.createInterviewSchedule({
      studentId: student2.id,
      teacherId: 1,
      teacherName: '张老师',
      companyName: 'B公司',
      positionName: '测试工程师',
      startsAt: '2026-05-18T09:15:00',
      endsAt: '2026-05-18T09:45:00',
      status: 'scheduled',
      remark: ''
    });
  }, /teacher conflict/);

  assert.throws(() => {
    app.createInterviewSchedule({
      studentId: student1.id,
      teacherId: 2,
      teacherName: '李老师',
      companyName: 'C公司',
      positionName: 'Java工程师',
      startsAt: '2026-05-18T09:10:00',
      endsAt: '2026-05-18T09:40:00',
      status: 'scheduled',
      remark: ''
    });
  }, /student conflict/);
});

test('cancelled schedules do not block the same time slot', () => {
  const { app, student1, student2 } = createSampleScheduleApp();
  const first = app.createInterviewSchedule({
    studentId: student1.id,
    teacherId: 1,
    teacherName: '张老师',
    companyName: 'A公司',
    positionName: '前端工程师',
    startsAt: '2026-05-18T09:00:00',
    endsAt: '2026-05-18T09:30:00',
    status: 'scheduled',
    remark: ''
  });

  app.cancelInterviewSchedule(first.id);
  const second = app.createInterviewSchedule({
    studentId: student2.id,
    teacherId: 1,
    teacherName: '张老师',
    companyName: 'B公司',
    positionName: '测试工程师',
    startsAt: '2026-05-18T09:15:00',
    endsAt: '2026-05-18T09:45:00',
    status: 'scheduled',
    remark: ''
  });

  assert.equal(second.teacherId, 1);
});

test('client assets are served and deep links fall back to the React entry', async () => {
  const app = createApp({ db: createDatabase() });
  const clientDistPath = createClientDist();

  await withServer(app, async (baseUrl) => {
    const deepLink = await fetch(`${baseUrl}/dashboard`);
    const html = await deepLink.text();
    const asset = await fetch(`${baseUrl}/assets/app.js`);

    assert.equal(deepLink.status, 200);
    assert.match(html, /React App Shell/);
    assert.match(deepLink.headers.get('content-type') || '', /text\/html/);
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get('content-type') || '', /javascript/);
  }, { clientDistPath });
});

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

function createUploadRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'homework-uploads-'));
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
  const charlie = app.createStudent({ name: 'Charlie', phone: '13800000003', className: '前端1班' });

  app.addHomeworkRecord({ studentId: alice.id, homeworkName: 'HTML作业', className: '前端1班', submitStatus: 'submitted', submitAt: '2026-05-08', reviewResult: 'passed', remark: '' });
  app.addHomeworkRecord({ studentId: bob.id, homeworkName: 'SQL作业', className: 'Java1班', submitStatus: 'pending', submitAt: '', reviewResult: '', remark: '' });
  app.addHomeworkRecord({ studentId: charlie.id, homeworkName: 'Legacy作业', className: '前端1班', submitStatus: 'reviewed', submitAt: '2026-05-08', reviewResult: 'passed', remark: '' });
  app.addInterviewRecord({ studentId: alice.id, companyName: 'A公司', positionName: '前端工程师', interviewAt: '2026-05-09', result: 'passed', feedback: '表现稳定', hiredStatus: 'hired', remark: '' });
  app.addInterviewRecord({ studentId: bob.id, companyName: 'B公司', positionName: 'Java工程师', interviewAt: '2026-05-10', result: 'failed', feedback: '基础薄弱', hiredStatus: 'not_hired', remark: '' });

  assert.equal(app.listHomeworkRecords({ submitStatus: 'submitted' }).total, 2);
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

test('homework assignments create student submission records and export original files as zip', () => {
  const uploadRoot = createUploadRoot();
  const app = createApp({ db: createDatabase(), uploadRoot });
  const alice = app.createStudent({ name: 'Alice', phone: '13800000001', className: '前端1班' });
  const bob = app.createStudent({ name: 'Bob', phone: '13800000002', className: '前端1班' });
  app.createStudent({ name: 'Charlie', phone: '13800000003', className: 'Java1班' });

  const created = app.createHomeworkAssignment({
    homeworkName: '第1周作业',
    className: '前端1班',
    dueDate: '2026-05-20',
    description: '上传 txt 文件'
  });

  assert.equal(created.assignment.homeworkName, '第1周作业');
  assert.equal(created.records.length, 2);
  assert.deepEqual(created.records.map((record) => record.studentId).sort((left, right) => left - right), [alice.id, bob.id]);

  const aliceRecord = created.records.find((record) => record.studentId === alice.id);
  const updated = app.submitHomeworkFile(aliceRecord.id, {
    studentId: alice.id,
    fileName: 'alice-homework.txt',
    contentType: 'text/plain',
    content: Buffer.from('Alice answer', 'utf8'),
    remark: '已完成'
  });
  const assignments = app.listHomeworkAssignments().items;
  const zip = app.exportHomeworkAssignmentZip(created.assignment.id);

  assert.equal(updated.submitStatus, 'submitted');
  assert.equal(updated.fileName, 'alice-homework.txt');
  assert.equal(fs.readFileSync(updated.filePath, 'utf8'), 'Alice answer');
  assert.equal(assignments[0].submittedCount, 1);
  assert.equal(assignments[0].pendingCount, 1);
  assert.equal(zip.contentType, 'application/zip');
  assert.equal(zip.fileName, '第1周作业-作业提交.zip');
  assert.equal(zip.body.subarray(0, 2).toString('utf8'), 'PK');
  assert.match(zip.body.toString('utf8'), /alice-homework\.txt/);
  assert.match(zip.body.toString('utf8'), /提交清单\.csv/);
});

test('student homework upload endpoint only accepts own txt submission and exposes downloads', async () => {
  const uploadRoot = createUploadRoot();
  const db = createDatabase();
  const app = createApp({
    db,
    uploadRoot,
    authAccounts: [
      { username: 'admin', password: 'admin123', role: 'admin' },
      { username: 'teacher', password: 'teacher123', role: 'teacher', teacherId: 1 },
      { username: 'student-a', password: 'student123', role: 'student', studentId: 1 },
      { username: 'student-b', password: 'student123', role: 'student', studentId: 2 }
    ]
  });
  const alice = app.createStudent({ name: 'Alice', phone: '13800000001', className: '前端1班' });
  const bob = app.createStudent({ name: 'Bob', phone: '13800000002', className: '前端1班' });

  await withServer(app, async (baseUrl) => {
    const teacherCookie = await loginAs(baseUrl, 'teacher', 'teacher123');
    const studentCookie = await loginAs(baseUrl, 'student-a', 'student123');
    const otherStudentCookie = await loginAs(baseUrl, 'student-b', 'student123');

    const created = await fetch(`${baseUrl}/api/homework-assignments`, {
      method: 'POST',
      headers: jsonHeaders(teacherCookie),
      body: JSON.stringify({
        homeworkName: '第2周作业',
        className: '前端1班',
        dueDate: '2026-05-27',
        description: '请上传 TXT 文件'
      })
    }).then((response) => response.json());
    const aliceRecord = created.records.find((record) => record.studentId === alice.id);
    const bobRecord = created.records.find((record) => record.studentId === bob.id);

    const rejectedFile = new FormData();
    rejectedFile.append('file', new Blob(['bad'], { type: 'application/javascript' }), 'bad.js');
    const rejected = await fetch(`${baseUrl}/api/homework/${aliceRecord.id}/submission`, {
      method: 'POST',
      headers: { cookie: studentCookie },
      body: rejectedFile
    });

    const rejectedWordFile = new FormData();
    rejectedWordFile.append('file', new Blob(['word'], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), 'homework.docx');
    const rejectedWord = await fetch(`${baseUrl}/api/homework/${aliceRecord.id}/submission`, {
      method: 'POST',
      headers: { cookie: studentCookie },
      body: rejectedWordFile
    });

    const forbiddenFile = new FormData();
    forbiddenFile.append('file', new Blob(['wrong student'], { type: 'text/plain' }), 'wrong.txt');
    const forbidden = await fetch(`${baseUrl}/api/homework/${bobRecord.id}/submission`, {
      method: 'POST',
      headers: { cookie: studentCookie },
      body: forbiddenFile
    });

    const form = new FormData();
    form.append('remark', '我的作业');
    form.append('file', new Blob(['Alice document'], { type: 'text/plain' }), 'alice.txt');
    const submitted = await fetch(`${baseUrl}/api/homework/${aliceRecord.id}/submission`, {
      method: 'POST',
      headers: { cookie: studentCookie },
      body: form
    }).then((response) => response.json());
    const fileResponse = await fetch(`${baseUrl}/api/homework/${aliceRecord.id}/file`, { headers: { cookie: teacherCookie } });
    const downloaded = await fileResponse.text();
    const deniedDownload = await fetch(`${baseUrl}/api/homework/${aliceRecord.id}/file`, { headers: { cookie: otherStudentCookie } });
    const zipResponse = await fetch(`${baseUrl}/api/export/homework/${created.assignment.id}.zip`, { headers: { cookie: teacherCookie } });
    const zip = Buffer.from(await zipResponse.arrayBuffer());

    assert.equal(rejected.status, 400);
    assert.equal(rejectedWord.status, 400);
    assert.equal(forbidden.status, 403);
    assert.equal(submitted.record.submitStatus, 'submitted');
    assert.equal(submitted.record.fileName, 'alice.txt');
    assert.equal(fileResponse.headers.get('content-type'), 'text/plain; charset=utf-8');
    assert.equal(downloaded, 'Alice document');
    assert.equal(deniedDownload.status, 403);
    assert.equal(zipResponse.headers.get('content-type'), 'application/zip');
    assert.match(zip.toString('utf8'), /alice\.txt/);
    assert.match(zip.toString('utf8'), /提交清单\.csv/);
  });
});

test('homework student zip export includes only one student files and summary', () => {
  const uploadRoot = createUploadRoot();
  const app = createApp({ db: createDatabase(), uploadRoot });
  const alice = app.createStudent({ name: 'Alice', phone: '13800000001', className: 'Frontend1' });
  const bob = app.createStudent({ name: 'Bob', phone: '13800000002', className: 'Frontend1' });
  const charlie = app.createStudent({ name: 'Charlie', phone: '13800000003', className: 'Frontend1' });
  const created = app.createHomeworkAssignment({
    homeworkName: 'Week 1',
    className: 'Frontend1',
    dueDate: '2026-05-27',
    description: 'Upload TXT'
  });

  const aliceRecord = created.records.find((record) => record.studentId === alice.id);
  const bobRecord = created.records.find((record) => record.studentId === bob.id);
  app.submitHomeworkFile(aliceRecord.id, {
    studentId: alice.id,
    fileName: 'alice.txt',
    content: Buffer.from('Alice answer', 'utf8')
  });
  app.submitHomeworkFile(bobRecord.id, {
    studentId: bob.id,
    fileName: 'bob.txt',
    content: Buffer.from('Bob answer', 'utf8')
  });

  const aliceZip = app.exportHomeworkStudentZip(alice.id);
  const aliceZipText = aliceZip.body.toString('utf8');
  const charlieZip = app.exportHomeworkStudentZip(charlie.id);
  const charlieZipText = charlieZip.body.toString('utf8');

  assert.equal(aliceZip.contentType, 'application/zip');
  assert.match(aliceZip.fileName, /Alice/);
  assert.match(aliceZipText, /alice\.txt/);
  assert.match(aliceZipText, /Alice answer/);
  assert.match(aliceZipText, /提交清单\.csv/);
  assert.doesNotMatch(aliceZipText, /bob\.txt/);
  assert.doesNotMatch(aliceZipText, /Bob answer/);
  assert.match(charlieZipText, /提交清单\.csv/);
  assert.doesNotMatch(charlieZipText, /alice\.txt|bob\.txt/);
});

test('homework analytics summarizes overview classes assignments and students', async () => {
  const app = createApp({ db: createDatabase() });
  const alice = app.createStudent({ name: 'Alice', phone: '13800000001', className: 'Frontend1' });
  const bob = app.createStudent({ name: 'Bob', phone: '13800000002', className: 'Frontend1' });
  const charlie = app.createStudent({ name: 'Charlie', phone: '13800000003', className: 'Java1' });
  app.archiveStudent(app.createStudent({ name: 'Archived', phone: '13800000004', className: 'Frontend1' }).id);

  const frontendWeek1 = app.createHomeworkAssignment({ homeworkName: 'Frontend Week 1', className: 'Frontend1', dueDate: '2026-05-20' });
  const frontendWeek2 = app.createHomeworkAssignment({ homeworkName: 'Frontend Week 2', className: 'Frontend1', dueDate: '2026-05-27' });
  const javaWeek1 = app.createHomeworkAssignment({ homeworkName: 'Java Week 1', className: 'Java1', dueDate: '2026-05-21' });

  const aliceWeek1 = frontendWeek1.records.find((record) => record.studentId === alice.id);
  const bobWeek1 = frontendWeek1.records.find((record) => record.studentId === bob.id);
  const charlieWeek1 = javaWeek1.records.find((record) => record.studentId === charlie.id);
  app.updateHomeworkRecord(aliceWeek1.id, { submitStatus: 'submitted', submitAt: '2026-05-18T09:00:00' });
  app.updateHomeworkRecord(bobWeek1.id, { submitStatus: 'reviewed', submitAt: '2026-05-18T10:00:00' });
  app.updateHomeworkRecord(charlieWeek1.id, { submitStatus: 'submitted', submitAt: '2026-05-19T09:00:00' });

  const analytics = app.getHomeworkAnalytics();
  const frontendOnly = app.getHomeworkAnalytics({ className: 'Frontend1' });
  const latest = analytics.latestAssignment;

  assert.equal(analytics.overview.studentCount, 3);
  assert.equal(analytics.overview.assignmentCount, 3);
  assert.equal(analytics.overview.recordCount, 5);
  assert.equal(analytics.overview.submittedCount, 3);
  assert.equal(analytics.overview.pendingCount, 2);
  assert.equal(analytics.overview.completionRate, 60);
  assert.equal(analytics.classes.find((item) => item.className === 'Frontend1').studentCount, 2);
  assert.equal(analytics.classes.find((item) => item.className === 'Frontend1').completionRate, 50);
  assert.equal(analytics.assignments.find((item) => item.id === frontendWeek1.assignment.id).completionRate, 100);
  assert.equal(analytics.students.find((item) => item.studentId === alice.id).completionRate, 50);
  assert.equal(analytics.students.find((item) => item.studentId === bob.id).completionRate, 50);
  assert.equal(latest.id, javaWeek1.assignment.id);
  assert.equal(frontendOnly.overview.studentCount, 2);
  assert.equal(frontendOnly.overview.assignmentCount, 2);
  assert.equal(frontendOnly.overview.recordCount, 4);
  assert.equal(frontendOnly.latestAssignment.id, frontendWeek2.assignment.id);

  await withServer(app, async (baseUrl) => {
    const teacherCookie = await loginAs(baseUrl, 'teacher', 'teacher123');
    const studentCookie = await loginAs(baseUrl, 'student', 'student123');
    const analyticsResponse = await fetch(`${baseUrl}/api/homework-analytics?className=Frontend1`, { headers: { cookie: teacherCookie } });
    const analyticsBody = await analyticsResponse.json();
    const studentZip = await fetch(`${baseUrl}/api/export/homework/student/${alice.id}.zip`, { headers: { cookie: teacherCookie } });
    const unauthorizedAnalytics = await fetch(`${baseUrl}/api/homework-analytics`);
    const forbiddenAnalytics = await fetch(`${baseUrl}/api/homework-analytics`, { headers: { cookie: studentCookie } });
    const forbiddenStudentZip = await fetch(`${baseUrl}/api/export/homework/student/${alice.id}.zip`, { headers: { cookie: studentCookie } });

    assert.equal(analyticsResponse.status, 200);
    assert.equal(analyticsBody.overview.recordCount, 4);
    assert.equal(studentZip.status, 200);
    assert.equal(studentZip.headers.get('content-type'), 'application/zip');
    assert.equal(unauthorizedAnalytics.status, 401);
    assert.equal(forbiddenAnalytics.status, 403);
    assert.equal(forbiddenStudentZip.status, 403);
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

test('records reject unknown students and invalid status values', () => {
  const app = createApp({ db: createDatabase() });
  const alice = app.createStudent({ name: 'Alice', phone: '13800000001', className: '前端1班' });

  assert.throws(() => {
    app.addHomeworkRecord({ studentId: 999, homeworkName: 'HTML作业', submitStatus: 'pending' });
  }, /student not found/);

  assert.throws(() => {
    app.addHomeworkRecord({ studentId: alice.id, homeworkName: 'HTML作业', submitStatus: 'done' });
  }, /invalid homework submit status/);

  assert.throws(() => {
    app.addInterviewRecord({ studentId: alice.id, companyName: 'A公司', result: 'unknown' });
  }, /invalid interview result/);

  assert.throws(() => {
    app.addInterviewRecord({ studentId: alice.id, companyName: 'A公司', hiredStatus: 'maybe' });
  }, /invalid hired status/);

  const homework = app.addHomeworkRecord({ studentId: String(alice.id), homeworkName: 'CSS作业' });
  const interview = app.addInterviewRecord({ studentId: String(alice.id), companyName: 'B公司' });

  assert.equal(homework.studentId, alice.id);
  assert.equal(interview.studentId, alice.id);
});

test('homework and interview edits can move records to another existing student', () => {
  const app = createApp({ db: createDatabase() });
  const alice = app.createStudent({ name: 'Alice', phone: '13800000001', className: '前端1班' });
  const bob = app.createStudent({ name: 'Bob', phone: '13800000002', className: 'Java1班' });
  const homework = app.addHomeworkRecord({ studentId: alice.id, homeworkName: 'HTML作业' });
  const interview = app.addInterviewRecord({ studentId: alice.id, companyName: 'A公司' });

  assert.equal(app.updateHomeworkRecord(homework.id, { studentId: bob.id }).studentId, bob.id);
  assert.equal(app.updateInterviewRecord(interview.id, { studentId: bob.id }).studentId, bob.id);
  assert.throws(() => {
    app.updateHomeworkRecord(homework.id, { studentId: 999 });
  }, /student not found/);
});

test('schedule state machine rejects invalid and terminal transitions', () => {
  const { app, student1, student2 } = createSampleScheduleApp();
  const requested = app.createInterviewSchedule({
    studentId: student1.id,
    teacherId: 1,
    teacherName: '张老师',
    companyName: 'A公司',
    positionName: '前端工程师',
    startsAt: '2026-05-18T09:00:00',
    endsAt: '2026-05-18T09:30:00',
    status: 'requested',
    requestSource: 'student'
  });
  const confirmed = app.createInterviewSchedule({
    studentId: student2.id,
    teacherId: 1,
    teacherName: '张老师',
    companyName: 'B公司',
    positionName: '测试工程师',
    startsAt: '2026-05-18T10:00:00',
    endsAt: '2026-05-18T10:30:00',
    status: 'confirmed'
  });

  app.rejectInterviewSchedule(requested.id);
  assert.throws(() => {
    app.approveInterviewSchedule(requested.id, { approverName: '管理员' });
  }, /invalid schedule transition/);

  app.completeInterviewSchedule(confirmed.id);
  assert.throws(() => {
    app.cancelInterviewSchedule(confirmed.id);
  }, /invalid schedule transition/);
});

test('admin schedule creation confirms immediately and teachers are exposed over http', async () => {
  const app = createApp({ db: createDatabase() });
  const alice = app.createStudent({ name: 'Alice', phone: '13800000001', className: '前端1班' });

  await withServer(app, async (baseUrl) => {
    const cookie = await loginAs(baseUrl);
    const created = await fetch(`${baseUrl}/api/schedules`, {
      method: 'POST',
      headers: jsonHeaders(cookie),
      body: JSON.stringify({
        studentId: alice.id,
        teacherId: 1,
        teacherName: '张老师',
        companyName: 'A公司',
        positionName: '前端工程师',
        startsAt: '2026-05-18T09:00:00',
        endsAt: '2026-05-18T09:30:00'
      })
    }).then((response) => response.json());
    const teachers = await fetch(`${baseUrl}/api/teachers`, { headers: { cookie } }).then((response) => response.json());

    assert.equal(created.schedule.status, 'confirmed');
    assert.equal(created.schedule.confirmedByRole, 'admin');
    assert.deepEqual(teachers.items, [{ id: 1, name: '张老师' }]);
  });
});

test('oversized request bodies are rejected before mutation', async () => {
  const app = createApp({ db: createDatabase() });

  await withServer(app, async (baseUrl) => {
    const cookie = await loginAs(baseUrl);
    const response = await fetch(`${baseUrl}/api/students`, {
      method: 'POST',
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ name: 'Alice', phone: '13800000001', remark: 'x'.repeat(1024 * 1024 + 1) })
    });
    const payload = await response.json();

    assert.equal(response.status, 413);
    assert.equal(payload.error, 'request body too large');
    assert.equal(app.listStudents().total, 0);
  });
});

test('login failures are throttled temporarily', async () => {
  const app = createApp({ db: createDatabase() });

  await withServer(app, async (baseUrl) => {
    for (let index = 0; index < 5; index += 1) {
      const response = await fetch(`${baseUrl}/api/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'wrong-password' })
      });
      assert.equal(response.status, 401);
    }

    const throttled = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'wrong-password' })
    });
    const payload = await throttled.json();

    assert.equal(throttled.status, 429);
    assert.equal(payload.error, 'too many login attempts');
  });
});

test('database saves with schema version, backup, and explicit damaged file errors', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'student-management-stable-'));
  const filePath = path.join(tempDir, 'data.json');
  fs.writeFileSync(filePath, JSON.stringify({
    students: [{ id: 1, name: 'Alice', phone: '13800000001' }],
    nextStudentId: 2
  }));

  const db = createDatabase({ filePath });
  assert.equal(db.schemaVersion, 2);
  assert.equal(db.students[0].status, 'active');

  db.save();
  const saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  assert.equal(saved.schemaVersion, 2);
  assert.equal(fs.existsSync(`${filePath}.tmp`), false);
  assert.equal(fs.existsSync(`${filePath}.bak`), true);

  fs.writeFileSync(filePath, '{broken json');
  assert.throws(() => {
    createDatabase({ filePath });
  }, /database file is not valid JSON/);
});

test('student CSV export includes UTF-8 BOM for spreadsheet compatibility', () => {
  const app = createApp({ db: createDatabase() });
  app.createStudent({ name: 'Alice', phone: '13800000001', className: '前端1班' });

  const csv = app.exportStudents();

  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.match(csv, /Alice/);
});

test('student import preview validates rows and commit creates valid students', async () => {
  const app = createApp({ db: createDatabase() });
  const importText = [
    '姓名,手机号,班级/课程',
    'Alice,13800000001,前端1班',
    ',13900000002,Java1班',
    'Bob,13800000001,Java1班'
  ].join('\n');

  await withServer(app, async (baseUrl) => {
    const cookie = await loginAs(baseUrl);
    const preview = await fetch(`${baseUrl}/api/students/import/preview`, {
      method: 'POST',
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ text: importText })
    }).then((response) => response.json());

    assert.equal(preview.validCount, 1);
    assert.equal(preview.invalidCount, 2);
    assert.deepEqual(preview.rows[1].errors, ['姓名不能为空']);
    assert.deepEqual(preview.rows[2].errors, ['手机号重复']);

    const commit = await fetch(`${baseUrl}/api/students/import/commit`, {
      method: 'POST',
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ text: '姓名,手机号,班级/课程\nCharlie,13800000003,前端2班\nDana,13800000004,Java2班' })
    }).then((response) => response.json());

    assert.equal(commit.created.length, 2);
    assert.equal(app.listStudents().total, 2);
  });
});

test('student import template and commit can generate bound student accounts', async () => {
  const app = createApp({
    db: createDatabase(),
    authAccounts: [
      { username: 'admin', password: 'admin123', role: 'admin' },
      { username: 'teacher', password: 'teacher123', role: 'teacher', teacherId: 1 }
    ]
  });

  await withServer(app, async (baseUrl) => {
    const cookie = await loginAs(baseUrl);
    const templateResponse = await fetch(`${baseUrl}/api/students/import/template.csv`, {
      headers: { cookie }
    });
    const templateBody = Buffer.from(await templateResponse.arrayBuffer());
    const template = templateBody.toString('utf8');

    assert.equal(templateResponse.status, 200);
    assert.deepEqual([...templateBody.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
    assert.match(template, /^﻿姓名,手机号,性别,出生日期,班级\/课程,入学日期,备注/);

    const commit = await fetch(`${baseUrl}/api/students/import/commit`, {
      method: 'POST',
      headers: jsonHeaders(cookie),
      body: JSON.stringify({
        generateAccounts: true,
        text: '姓名,手机号,性别,出生日期,班级/课程,入学日期,备注\nAlice,13800000001,女,2001-01-01,前端1班,2026-05-01,认真'
      })
    }).then((response) => response.json());

    assert.equal(commit.created.length, 1);
    assert.equal(commit.accounts.length, 1);
    assert.equal(commit.accounts[0].username, '13800000001');
    assert.equal(commit.accounts[0].studentId, commit.created[0].id);
    assert.ok(commit.accounts[0].password.length >= 8);

    const students = await fetch(`${baseUrl}/api/students`, {
      headers: { cookie }
    }).then((response) => response.json());
    assert.equal(students.items[0].hasAccount, true);
    assert.equal(students.items[0].accountUsername, '13800000001');

    const studentCookie = await loginAs(baseUrl, commit.accounts[0].username, commit.accounts[0].password);
    const workspace = await fetch(`${baseUrl}/api/student-workspace`, {
      headers: { cookie: studentCookie }
    }).then((response) => response.json());
    assert.equal(workspace.student.name, 'Alice');
  });
});

test('student account generation skips existing accounts and exports credentials', async () => {
  const app = createApp({
    db: createDatabase(),
    authAccounts: [
      { username: 'admin', password: 'admin123', role: 'admin' }
    ]
  });
  const alice = app.createStudent({ name: 'Alice', phone: '13800000001', className: '前端1班' });
  const bob = app.createStudent({ name: 'Bob', phone: '13800000002', className: '前端1班' });

  await withServer(app, async (baseUrl) => {
    const cookie = await loginAs(baseUrl);

    const first = await fetch(`${baseUrl}/api/students/accounts/generate`, {
      method: 'POST',
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ studentIds: [alice.id] })
    }).then((response) => response.json());
    assert.equal(first.accounts.length, 1);
    assert.equal(first.skippedCount, 0);

    const second = await fetch(`${baseUrl}/api/students/accounts/generate`, {
      method: 'POST',
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ studentIds: [alice.id, bob.id] })
    }).then((response) => response.json());
    assert.equal(second.accounts.length, 1);
    assert.equal(second.accounts[0].studentId, bob.id);
    assert.equal(second.skippedCount, 1);

    const exportBody = await fetch(`${baseUrl}/api/export/student-accounts`, {
      headers: { cookie }
    }).then((response) => response.arrayBuffer());
    const exportBuffer = Buffer.from(exportBody);
    const exportCsv = exportBuffer.toString('utf8');
    assert.deepEqual([...exportBuffer.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
    assert.match(exportCsv, /学生姓名,班级\/课程,手机号,用户名,初始密码/);
    assert.match(exportCsv, /Alice,前端1班,13800000001,13800000001,/);
    assert.match(exportCsv, /Bob,前端1班,13800000002,13800000002,/);
  });
});

test('student account management endpoints are admin only', async () => {
  const app = createApp({
    db: createDatabase(),
    authAccounts: [
      { username: 'admin', password: 'admin123', role: 'admin' },
      { username: 'teacher', password: 'teacher123', role: 'teacher', teacherId: 1 },
      { username: 'student-a', password: 'student123', role: 'student', studentId: 1 }
    ]
  });
  app.createStudent({ name: 'Alice', phone: '13800000001', className: '前端1班' });

  await withServer(app, async (baseUrl) => {
    const teacherCookie = await loginAs(baseUrl, 'teacher', 'teacher123');
    const studentCookie = await loginAs(baseUrl, 'student-a', 'student123');

    const teacherGenerate = await fetch(`${baseUrl}/api/students/accounts/generate`, {
      method: 'POST',
      headers: jsonHeaders(teacherCookie),
      body: JSON.stringify({ studentIds: [1] })
    });
    const studentExport = await fetch(`${baseUrl}/api/export/student-accounts`, {
      headers: { cookie: studentCookie }
    });

    assert.equal(teacherGenerate.status, 403);
    assert.equal(studentExport.status, 403);
  });
});

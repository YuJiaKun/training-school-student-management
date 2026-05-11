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

test('student lifecycle supports create, archive, query, stats, and export', async () => {
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

  const activeStudents = app.listStudents({ status: 'active' });
  assert.equal(activeStudents.total, 1);
  assert.equal(activeStudents.items[0].name, 'Bob');

  const archivedStudents = app.listStudents({ status: 'archived' });
  assert.equal(archivedStudents.total, 1);
  assert.equal(archivedStudents.items[0].name, 'Alice');

  const stats = app.getDashboardStats();
  assert.equal(stats.students.active, 1);
  assert.equal(stats.students.archived, 1);
  assert.equal(stats.homework.completed, 1);
  assert.equal(stats.interviews.total, 2);
  assert.equal(stats.employmentRate, 50);

  const exportedStudents = app.exportStudents({ status: 'active' });
  assert.match(exportedStudents, /Bob/);
  assert.doesNotMatch(exportedStudents, /Alice/);
});

test('student name and phone are required', () => {
  const db = createDatabase();
  const app = createApp({ db });

  assert.throws(() => {
    app.createStudent({
      name: '',
      phone: '',
      gender: 'female',
      birthday: '2001-01-01',
      className: '前端1班',
      enrolledAt: '2026-05-01',
      remark: ''
    });
  }, /name and phone are required/);
});

test('dashboard html shows statistics and student navigation', () => {
  const db = createDatabase();
  const app = createApp({ db });
  app.createStudent({
    name: 'Alice',
    phone: '13800000001',
    gender: 'female',
    birthday: '2001-01-01',
    className: '前端1班',
    enrolledAt: '2026-05-01',
    remark: ''
  });

  const html = createServerApp({ app }).renderHomePage();

  assert.match(html, /学生信息管理系统/);
  assert.match(html, /学生总数/);
  assert.match(html, /新增学生/);
  assert.match(html, /Alice/);
});

test('student api creates records and archives them over http', async () => {
  const db = createDatabase();
  const app = createApp({ db });
  const serverApp = createServerApp({ app });
  const server = serverApp.listen(0);
  await once(server, 'listening');
  const { port } = server.address();

  const created = await fetch(`http://127.0.0.1:${port}/api/students`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Alice',
      phone: '13800000001',
      className: '前端1班',
      enrolledAt: '2026-05-01'
    })
  }).then((response) => response.json());

  assert.equal(created.student.name, 'Alice');

  const archived = await fetch(`http://127.0.0.1:${port}/api/students/${created.student.id}/archive`, {
    method: 'POST'
  }).then((response) => response.json());

  assert.equal(archived.student.status, 'archived');

  server.close();
});

test('homework and interview records can be listed, filtered, and exported', () => {
  const db = createDatabase();
  const app = createApp({ db });
  const alice = app.createStudent({ name: 'Alice', phone: '13800000001', className: '前端1班' });
  const bob = app.createStudent({ name: 'Bob', phone: '13800000002', className: 'Java1班' });

  app.addHomeworkRecord({ studentId: alice.id, homeworkName: 'HTML作业', className: '前端1班', submitStatus: 'submitted', submitAt: '2026-05-08', reviewResult: 'passed', remark: '' });
  app.addHomeworkRecord({ studentId: bob.id, homeworkName: 'SQL作业', className: 'Java1班', submitStatus: 'pending', submitAt: '', reviewResult: '', remark: '' });
  app.addInterviewRecord({ studentId: alice.id, companyName: 'A公司', positionName: '前端工程师', interviewAt: '2026-05-09', result: 'passed', feedback: '表现稳定', hiredStatus: 'hired', remark: '' });
  app.addInterviewRecord({ studentId: bob.id, companyName: 'B公司', positionName: 'Java工程师', interviewAt: '2026-05-10', result: 'failed', feedback: '基础薄弱', hiredStatus: 'not_hired', remark: '' });

  assert.equal(app.listHomeworkRecords({ submitStatus: 'submitted' }).total, 1);
  assert.equal(app.listInterviewRecords({ result: 'failed' }).items[0].companyName, 'B公司');
  assert.match(app.exportHomeworkRecords({ className: '前端1班' }), /HTML作业/);
  assert.doesNotMatch(app.exportHomeworkRecords({ className: '前端1班' }), /SQL作业/);
  assert.match(app.exportInterviewRecords({ result: 'passed' }), /A公司/);
  assert.doesNotMatch(app.exportInterviewRecords({ result: 'passed' }), /B公司/);
});

test('homework and interview pages expose table data', () => {
  const db = createDatabase();
  const app = createApp({ db });
  const alice = app.createStudent({ name: 'Alice', phone: '13800000001', className: '前端1班' });
  app.addHomeworkRecord({ studentId: alice.id, homeworkName: 'HTML作业', className: '前端1班', submitStatus: 'submitted', submitAt: '2026-05-08', reviewResult: 'passed', remark: '' });
  app.addInterviewRecord({ studentId: alice.id, companyName: 'A公司', positionName: '前端工程师', interviewAt: '2026-05-09', result: 'passed', feedback: '表现稳定', hiredStatus: 'hired', remark: '' });

  const serverApp = createServerApp({ app });

  assert.match(serverApp.renderHomeworkPage(), /作业管理/);
  assert.match(serverApp.renderHomeworkPage(), /HTML作业/);
  assert.match(serverApp.renderInterviewPage(), /面试记录/);
  assert.match(serverApp.renderInterviewPage(), /A公司/);
});

test('export routes return csv content over http', async () => {
  const db = createDatabase();
  const app = createApp({ db });
  const alice = app.createStudent({ name: 'Alice', phone: '13800000001', className: '前端1班' });
  app.addHomeworkRecord({ studentId: alice.id, homeworkName: 'HTML作业', className: '前端1班', submitStatus: 'submitted' });
  app.addInterviewRecord({ studentId: alice.id, companyName: 'A公司', positionName: '前端工程师', result: 'passed', hiredStatus: 'hired' });

  const server = createServerApp({ app }).listen(0);
  await once(server, 'listening');
  const { port } = server.address();

  const studentsCsv = await fetch(`http://127.0.0.1:${port}/api/export/students`).then((response) => response.text());
  const homeworkCsv = await fetch(`http://127.0.0.1:${port}/api/export/homework`).then((response) => response.text());
  const interviewCsv = await fetch(`http://127.0.0.1:${port}/api/export/interviews`).then((response) => response.text());

  assert.match(studentsCsv, /姓名,手机号/);
  assert.match(homeworkCsv, /作业名称/);
  assert.match(interviewCsv, /公司,岗位/);

  server.close();
});

test('database state can be saved and loaded from disk', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'student-management-'));
  const filePath = path.join(tempDir, 'data.json');
  const db = createDatabase({ filePath });
  const app = createApp({ db });
  app.createStudent({ name: 'Alice', phone: '13800000001', className: '前端1班' });
  app.saveDatabase();

  const loadedDb = createDatabase({ filePath });
  const loadedApp = createApp({ db: loadedDb });

  assert.equal(loadedApp.listStudents().total, 1);
  assert.equal(loadedApp.listStudents().items[0].name, 'Alice');
});

test('login returns a role based session token', () => {
  const db = createDatabase();
  const app = createApp({ db });

  const session = app.login({ username: 'admin', password: 'admin123' });

  assert.equal(session.role, 'admin');
  assert.ok(session.token);
});

test('student records can be updated and paginated', () => {
  const db = createDatabase();
  const app = createApp({ db });
  app.createStudent({ name: 'Alice', phone: '13800000001', className: '前端1班' });
  app.createStudent({ name: 'Bob', phone: '13800000002', className: '前端1班' });
  const charlie = app.createStudent({ name: 'Charlie', phone: '13800000003', className: 'Java1班' });

  const updated = app.updateStudent(charlie.id, { phone: '13900000003', remark: '已更新' });
  const page1 = app.listStudents({ page: 1, pageSize: 2 });
  const page2 = app.listStudents({ page: 2, pageSize: 2 });

  assert.equal(updated.phone, '13900000003');
  assert.equal(updated.remark, '已更新');
  assert.equal(page1.items.length, 2);
  assert.equal(page1.total, 3);
  assert.equal(page2.items.length, 1);
  assert.equal(page2.items[0].name, 'Charlie');
});

test('homework and interview records can be updated', () => {
  const db = createDatabase();
  const app = createApp({ db });
  const student = app.createStudent({ name: 'Alice', phone: '13800000001', className: '前端1班' });
  const homework = app.addHomeworkRecord({ studentId: student.id, homeworkName: 'HTML作业', className: '前端1班', submitStatus: 'pending' });
  const interview = app.addInterviewRecord({ studentId: student.id, companyName: 'A公司', positionName: '前端工程师', result: 'pending', hiredStatus: 'pending' });

  const updatedHomework = app.updateHomeworkRecord(homework.id, { submitStatus: 'submitted', reviewResult: 'passed' });
  const updatedInterview = app.updateInterviewRecord(interview.id, { result: 'passed', hiredStatus: 'hired' });

  assert.equal(updatedHomework.submitStatus, 'submitted');
  assert.equal(updatedHomework.reviewResult, 'passed');
  assert.equal(updatedInterview.result, 'passed');
  assert.equal(updatedInterview.hiredStatus, 'hired');
});

test('schedule conflicts block overlapping teacher and student bookings', () => {
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

  assert.equal(first.teacherName, '张老师');
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

test('schedule page shows weekly timeline and cards', () => {
  const { app, student1 } = createSampleScheduleApp();
  app.createInterviewSchedule({
    studentId: student1.id,
    teacherId: 1,
    teacherName: '张老师',
    companyName: 'A公司',
    positionName: '前端工程师',
    startsAt: '2026-05-18T09:00:00',
    endsAt: '2026-05-18T09:30:00',
    status: 'scheduled',
    remark: '第一次面试'
  });

  const html = createServerApp({ app }).renderSchedulePage({ weekStart: '2026-05-18' });

  assert.match(html, /面试排期/);
  assert.match(html, /张老师/);
  assert.match(html, /A公司/);
  assert.match(html, /前端工程师/);
});

test('schedule creation requires student, teacher, and time fields', () => {
  const { app } = createSampleScheduleApp();

  assert.throws(() => {
    app.createInterviewSchedule({
      studentId: 1,
      teacherName: '张老师',
      companyName: 'A公司',
      positionName: '前端工程师',
      startsAt: '2026-05-18T09:00:00',
      endsAt: '2026-05-18T09:30:00'
    });
  }, /required/);
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



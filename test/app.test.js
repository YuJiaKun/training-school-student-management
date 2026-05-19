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
    learningStage: 'job_seeking',
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
  assert.equal(alice.learningStage, 'job_seeking');
  assert.equal(bob.learningStage, 'studying');
  assert.equal(app.listStudents({ learningStage: 'job_seeking' }).items[0].name, 'Alice');
  const stats = app.getDashboardStats();
  assert.deepEqual(stats.students, { active: 1, archived: 1, total: 2 });
  assert.deepEqual(stats.homework, { total: 2, completed: 1 });
  assert.equal(stats.interviews.total, 2);
  assert.equal(stats.employmentRate, 50);
  assert.match(app.exportStudents({ status: 'active' }), /Bob/);
  assert.match(app.exportStudents({ learningStage: 'job_seeking' }), /求职中/);
  assert.doesNotMatch(app.exportStudents({ status: 'active' }), /Alice/);
});

test('student name and class are required while phone is optional', () => {
  const app = createApp({ db: createDatabase() });

  assert.throws(() => {
    app.createStudent({ name: '', phone: '', className: '前端1班' });
  }, /student name and class are required/);

  assert.throws(() => {
    app.createStudent({ name: 'Alice', phone: '', className: '' });
  }, /student name and class are required/);

  const student = app.createStudent({ name: 'Alice', className: '前端1班' });

  assert.equal(student.name, 'Alice');
  assert.equal(student.className, '前端1班');
  assert.equal(student.phone, '');
  assert.equal(student.learningStage, 'studying');
});

test('student api creates, updates, filters, and archives records over http', async () => {
  const app = createApp({ db: createDatabase() });

  await withServer(app, async (baseUrl) => {
    const cookie = await loginAs(baseUrl);
    const created = await fetch(`${baseUrl}/api/students`, {
      method: 'POST',
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ name: 'Alice', phone: '13800000001', className: '前端1班', enrolledAt: '2026-05-01', learningStage: 'studying' })
    }).then((response) => response.json());

    const updated = await fetch(`${baseUrl}/api/students/${created.student.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ phone: '13900000001', remark: '已更新', learningStage: 'job_seeking' })
    }).then((response) => response.json());

    const filtered = await fetch(`${baseUrl}/api/students?keyword=13900000001`, { headers: { cookie } }).then((response) => response.json());
    const stageFiltered = await fetch(`${baseUrl}/api/students?learningStage=job_seeking`, { headers: { cookie } }).then((response) => response.json());
    const archived = await fetch(`${baseUrl}/api/students/${created.student.id}/archive`, { method: 'POST', headers: { cookie } }).then((response) => response.json());

    assert.equal(updated.student.phone, '13900000001');
    assert.equal(updated.student.learningStage, 'job_seeking');
    assert.equal(filtered.total, 1);
    assert.equal(stageFiltered.total, 1);
    assert.equal(archived.student.status, 'archived');
  });
});

test('student learning stage defaults, bulk updates, and teacher scoped edits are enforced', async () => {
  const filePath = path.join(os.tmpdir(), `student-stage-${Date.now()}.json`);
  fs.writeFileSync(filePath, JSON.stringify({
    students: [{ id: 1, name: 'Legacy', className: 'Frontend', status: 'active' }],
    nextStudentId: 2
  }));
  const db = createDatabase({ filePath });
  const app = createApp({
    db,
    authAccounts: [
      { username: 'admin', password: 'admin123', role: 'admin' },
      { username: 'front-teacher', password: 'teacher123', role: 'teacher', teacherId: 1, classNames: ['Frontend', 'Data'] },
      { username: 'java-teacher', password: 'teacher123', role: 'teacher', teacherId: 2, classNames: ['Java'] }
    ]
  });
  app.createClass({ className: 'Frontend' });
  app.createClass({ className: 'Data' });
  app.createClass({ className: 'Java' });
  const alice = db.students[0];
  const bob = app.createStudent({ name: 'Bob', className: 'Frontend', learningStage: 'job_seeking' });
  const charlie = app.createStudent({ name: 'Charlie', className: 'Java' });
  app.archiveStudent(charlie.id);

  assert.equal(alice.learningStage, 'studying');
  assert.equal(bob.learningStage, 'job_seeking');
  assert.equal(charlie.learningStage, 'studying');

  await withServer(app, async (baseUrl) => {
    const adminCookie = await loginAs(baseUrl);
    const frontTeacherCookie = await loginAs(baseUrl, 'front-teacher', 'teacher123');
    const javaTeacherCookie = await loginAs(baseUrl, 'java-teacher', 'teacher123');

    const adminBulk = await fetch(`${baseUrl}/api/students/bulk-learning-stage`, {
      method: 'POST',
      headers: jsonHeaders(adminCookie),
      body: JSON.stringify({ className: 'Frontend', learningStage: 'employed' })
    }).then(async (response) => ({ status: response.status, body: await response.json() }));
    const teacherMove = await fetch(`${baseUrl}/api/teacher/students/${bob.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(frontTeacherCookie),
      body: JSON.stringify({ className: 'Data', learningStage: 'job_seeking' })
    }).then(async (response) => ({ status: response.status, body: await response.json() }));
    const forbiddenTeacherMove = await fetch(`${baseUrl}/api/teacher/students/${bob.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(javaTeacherCookie),
      body: JSON.stringify({ className: 'Java', learningStage: 'studying' })
    });
    const forbiddenBulk = await fetch(`${baseUrl}/api/students/bulk-learning-stage`, {
      method: 'POST',
      headers: jsonHeaders(javaTeacherCookie),
      body: JSON.stringify({ className: 'Frontend', learningStage: 'studying' })
    });
    const stageFiltered = await fetch(`${baseUrl}/api/students?learningStage=job_seeking`, {
      headers: { cookie: adminCookie }
    }).then((response) => response.json());

    assert.equal(adminBulk.status, 200);
    assert.equal(adminBulk.body.updatedCount, 2);
    assert.equal(teacherMove.status, 200);
    assert.equal(teacherMove.body.student.className, 'Data');
    assert.equal(teacherMove.body.student.learningStage, 'job_seeking');
    assert.equal(forbiddenTeacherMove.status, 403);
    assert.equal(forbiddenBulk.status, 403);
    assert.deepEqual(stageFiltered.items.map((student) => student.name), ['Bob']);
  });
});

test('admins and teachers can create class options and teacher-created classes bind to the teacher', async () => {
  const app = createApp({
    db: createDatabase(),
    authAccounts: [
      { username: 'admin', password: 'admin123', role: 'admin' },
      { username: 'teacher', password: 'teacher123', role: 'teacher', teacherId: 1, classNames: ['前端1班'] },
      { username: 'student', password: 'student123', role: 'student', studentId: 1 }
    ]
  });
  app.createClass({ className: '前端1班' }, { role: 'admin', username: 'admin' });

  await withServer(app, async (baseUrl) => {
    const adminCookie = await loginAs(baseUrl);
    const teacherCookie = await loginAs(baseUrl, 'teacher', 'teacher123');
    const studentCookie = await loginAs(baseUrl, 'student', 'student123');

    const adminClass = await fetch(`${baseUrl}/api/classes`, {
      method: 'POST',
      headers: jsonHeaders(adminCookie),
      body: JSON.stringify({ className: 'Java1班' })
    }).then((response) => response.json());
    const teacherClass = await fetch(`${baseUrl}/api/classes`, {
      method: 'POST',
      headers: jsonHeaders(teacherCookie),
      body: JSON.stringify({ className: 'Vue1班' })
    }).then((response) => response.json());
    const teacherClasses = await fetch(`${baseUrl}/api/classes`, {
      headers: { cookie: teacherCookie }
    }).then((response) => response.json());
    const teacherAssignment = await fetch(`${baseUrl}/api/homework-assignments`, {
      method: 'POST',
      headers: jsonHeaders(teacherCookie),
      body: JSON.stringify({ homeworkName: 'Vue作业', className: 'Vue1班' })
    });
    const emptyClass = await fetch(`${baseUrl}/api/classes`, {
      method: 'POST',
      headers: jsonHeaders(adminCookie),
      body: JSON.stringify({ className: '' })
    });
    const unauthorized = await fetch(`${baseUrl}/api/classes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ className: '未登录班级' })
    });
    const forbidden = await fetch(`${baseUrl}/api/classes`, {
      method: 'POST',
      headers: jsonHeaders(studentCookie),
      body: JSON.stringify({ className: '学生班级' })
    });

    assert.equal(adminClass.class.className, 'Java1班');
    assert.equal(teacherClass.class.className, 'Vue1班');
    assert.equal(teacherClasses.items.some((item) => item.className === '前端1班'), true);
    assert.equal(teacherClasses.items.some((item) => item.className === 'Vue1班'), true);
    assert.equal(teacherClasses.items.some((item) => item.className === 'Java1班'), false);
    assert.equal(teacherAssignment.status, 201);
    assert.equal(emptyClass.status, 400);
    assert.equal(unauthorized.status, 401);
    assert.equal(forbidden.status, 403);
  });
});

test('admins and teachers can delete only empty permitted classes', async () => {
  const app = createApp({
    db: createDatabase(),
    authAccounts: [
      { username: 'admin', password: 'admin123', role: 'admin' },
      { username: 'front-teacher', password: 'teacher123', role: 'teacher', teacherId: 1, classNames: ['Frontend'] },
      { username: 'java-teacher', password: 'teacher123', role: 'teacher', teacherId: 2, classNames: ['Java'] }
    ]
  });
  app.createClass({ className: 'Frontend' }, { role: 'admin', username: 'admin' });
  app.createClass({ className: 'Java' }, { role: 'admin', username: 'admin' });
  app.createClass({ className: 'Admin Empty' }, { role: 'admin', username: 'admin' });
  app.createStudent({ name: 'Alice', className: 'Frontend' });
  app.createHomeworkAssignment({ homeworkName: 'Java作业', className: 'Java' });

  await withServer(app, async (baseUrl) => {
    const adminCookie = await loginAs(baseUrl);
    const frontCookie = await loginAs(baseUrl, 'front-teacher', 'teacher123');
    const javaCookie = await loginAs(baseUrl, 'java-teacher', 'teacher123');
    const teacherClass = await fetch(`${baseUrl}/api/classes`, {
      method: 'POST',
      headers: jsonHeaders(frontCookie),
      body: JSON.stringify({ className: 'Teacher Empty' })
    }).then((response) => response.json());
    const classesBefore = await fetch(`${baseUrl}/api/classes`, {
      headers: { cookie: adminCookie }
    }).then((response) => response.json());
    const frontendId = classesBefore.items.find((item) => item.className === 'Frontend').id;
    const javaId = classesBefore.items.find((item) => item.className === 'Java').id;
    const adminEmptyId = classesBefore.items.find((item) => item.className === 'Admin Empty').id;

    const nonEmptyStudent = await fetch(`${baseUrl}/api/classes/${frontendId}`, {
      method: 'DELETE',
      headers: { cookie: adminCookie }
    }).then(async (response) => ({ status: response.status, body: await response.json() }));
    const nonEmptyAssignment = await fetch(`${baseUrl}/api/classes/${javaId}`, {
      method: 'DELETE',
      headers: { cookie: adminCookie }
    }).then(async (response) => ({ status: response.status, body: await response.json() }));
    const forbiddenTeacherDelete = await fetch(`${baseUrl}/api/classes/${teacherClass.class.id}`, {
      method: 'DELETE',
      headers: { cookie: javaCookie }
    });
    const teacherDelete = await fetch(`${baseUrl}/api/classes/${teacherClass.class.id}`, {
      method: 'DELETE',
      headers: { cookie: frontCookie }
    }).then(async (response) => ({ status: response.status, body: await response.json() }));
    const adminDelete = await fetch(`${baseUrl}/api/classes/${adminEmptyId}`, {
      method: 'DELETE',
      headers: { cookie: adminCookie }
    });
    const classesAfter = await fetch(`${baseUrl}/api/classes`, {
      headers: { cookie: adminCookie }
    }).then((response) => response.json());

    assert.equal(nonEmptyStudent.status, 400);
    assert.equal(nonEmptyStudent.body.error, 'class has active students');
    assert.equal(nonEmptyAssignment.status, 400);
    assert.equal(nonEmptyAssignment.body.error, 'class has active homework assignments');
    assert.equal(forbiddenTeacherDelete.status, 403);
    assert.equal(teacherDelete.status, 200);
    assert.equal(teacherDelete.body.class.className, 'Teacher Empty');
    assert.equal(adminDelete.status, 200);
    assert.equal(classesAfter.items.some((item) => item.className === 'Teacher Empty'), false);
    assert.equal(classesAfter.items.some((item) => item.className === 'Admin Empty'), false);
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
      { username: 'teacher', password: 'teacher123', role: 'teacher', teacherId: 1, classNames: ['前端1班'] },
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

test('teacher homework APIs are scoped to responsible classes and can sync missing records', async () => {
  const uploadRoot = createUploadRoot();
  const app = createApp({
    db: createDatabase(),
    uploadRoot,
    authAccounts: [
      { username: 'admin', password: 'admin123', role: 'admin' },
      { username: 'front-teacher', password: 'teacher123', role: 'teacher', teacherId: 1, classNames: ['Frontend1'] },
      { username: 'java-teacher', password: 'teacher123', role: 'teacher', teacherId: 2, classNames: ['Java1'] },
      { username: 'student-a', password: 'student123', role: 'student', studentId: 1 },
      { username: 'student-c', password: 'student123', role: 'student', studentId: 3 }
    ]
  });
  const alice = app.createStudent({ name: 'Alice', phone: '13800000001', className: 'Frontend1' });
  const charlie = app.createStudent({ name: 'Charlie', phone: '13800000003', className: 'Java1' });

  await withServer(app, async (baseUrl) => {
    const frontCookie = await loginAs(baseUrl, 'front-teacher', 'teacher123');
    const javaCookie = await loginAs(baseUrl, 'java-teacher', 'teacher123');
    const studentCookie = await loginAs(baseUrl, 'student-c', 'student123');

    const frontAssignment = await fetch(`${baseUrl}/api/homework-assignments`, {
      method: 'POST',
      headers: jsonHeaders(frontCookie),
      body: JSON.stringify({ homeworkName: 'Frontend Week 1', className: 'Frontend1', dueDate: '2026-05-20' })
    }).then((response) => response.json());
    const forbiddenCreate = await fetch(`${baseUrl}/api/homework-assignments`, {
      method: 'POST',
      headers: jsonHeaders(frontCookie),
      body: JSON.stringify({ homeworkName: 'Java Week 1', className: 'Java1' })
    });
    const javaAssignment = await fetch(`${baseUrl}/api/homework-assignments`, {
      method: 'POST',
      headers: jsonHeaders(javaCookie),
      body: JSON.stringify({ homeworkName: 'Java Week 1', className: 'Java1' })
    }).then((response) => response.json());

    const javaRecord = javaAssignment.records.find((record) => record.studentId === charlie.id);
    const javaForm = new FormData();
    javaForm.append('file', new Blob(['Java answer'], { type: 'text/plain' }), 'java.txt');
    await fetch(`${baseUrl}/api/homework/${javaRecord.id}/submission`, {
      method: 'POST',
      headers: { cookie: studentCookie },
      body: javaForm
    });

    app.createStudent({ name: 'Bob', phone: '13800000002', className: 'Frontend1' });
    const sync = await fetch(`${baseUrl}/api/homework-assignments/${frontAssignment.assignment.id}/sync-records`, {
      method: 'POST',
      headers: { cookie: frontCookie }
    }).then((response) => response.json());
    const secondSync = await fetch(`${baseUrl}/api/homework-assignments/${frontAssignment.assignment.id}/sync-records`, {
      method: 'POST',
      headers: { cookie: frontCookie }
    }).then((response) => response.json());
    const forbiddenSync = await fetch(`${baseUrl}/api/homework-assignments/${javaAssignment.assignment.id}/sync-records`, {
      method: 'POST',
      headers: { cookie: frontCookie }
    });

    const assignments = await fetch(`${baseUrl}/api/homework-assignments`, { headers: { cookie: frontCookie } }).then((response) => response.json());
    const records = await fetch(`${baseUrl}/api/homework`, { headers: { cookie: frontCookie } }).then((response) => response.json());
    const csv = await fetch(`${baseUrl}/api/export/homework`, { headers: { cookie: frontCookie } }).then((response) => response.text());
    const forbiddenZip = await fetch(`${baseUrl}/api/export/homework/${javaAssignment.assignment.id}.zip`, { headers: { cookie: frontCookie } });
    const forbiddenFile = await fetch(`${baseUrl}/api/homework/${javaRecord.id}/file`, { headers: { cookie: frontCookie } });
    const forbiddenStudentZip = await fetch(`${baseUrl}/api/export/homework/student/${charlie.id}.zip`, { headers: { cookie: frontCookie } });

    assert.equal(forbiddenCreate.status, 403);
    assert.equal(sync.createdCount, 1);
    assert.equal(sync.records[0].studentName, 'Bob');
    assert.equal(secondSync.createdCount, 0);
    assert.equal(forbiddenSync.status, 403);
    assert.deepEqual(assignments.items.map((assignment) => assignment.className), ['Frontend1']);
    assert.equal(records.items.every((record) => record.className === 'Frontend1'), true);
    assert.match(csv, /Frontend Week 1/);
    assert.doesNotMatch(csv, /Java Week 1/);
    assert.equal(forbiddenZip.status, 403);
    assert.equal(forbiddenFile.status, 403);
    assert.equal(forbiddenStudentZip.status, 403);
    assert.equal(frontAssignment.records[0].studentId, alice.id);
  });
});

test('homework records and assignment stats exclude archived students by default', async () => {
  const app = createApp({
    db: createDatabase(),
    authAccounts: [
      { username: 'admin', password: 'admin123', role: 'admin' },
      { username: 'teacher', password: 'teacher123', role: 'teacher', teacherId: 1, classNames: ['Frontend'] }
    ]
  });
  const alice = app.createStudent({ name: 'Alice', phone: '13800000001', className: 'Frontend', learningStage: 'job_seeking' });
  const assignment = app.createHomeworkAssignment({
    homeworkName: 'Archive Check',
    className: 'Frontend'
  }, { role: 'teacher', classNames: ['Frontend'] });
  app.archiveStudent(alice.id);

  await withServer(app, async (baseUrl) => {
    const teacherCookie = await loginAs(baseUrl, 'teacher', 'teacher123');
    const defaultAssignments = await fetch(`${baseUrl}/api/homework-assignments`, {
      headers: { cookie: teacherCookie }
    }).then((response) => response.json());
    const historicalAssignments = await fetch(`${baseUrl}/api/homework-assignments?includeArchivedStudents=1`, {
      headers: { cookie: teacherCookie }
    }).then((response) => response.json());
    const defaultRecords = await fetch(`${baseUrl}/api/homework?assignmentId=${assignment.assignment.id}`, {
      headers: { cookie: teacherCookie }
    }).then((response) => response.json());
    const historicalRecords = await fetch(`${baseUrl}/api/homework?assignmentId=${assignment.assignment.id}&includeArchivedStudents=1`, {
      headers: { cookie: teacherCookie }
    }).then((response) => response.json());

    assert.equal(defaultAssignments.items[0].totalCount, 0);
    assert.equal(defaultAssignments.items[0].pendingCount, 0);
    assert.equal(historicalAssignments.items[0].totalCount, 1);
    assert.equal(historicalAssignments.items[0].pendingCount, 1);
    assert.equal(defaultRecords.total, 0);
    assert.equal(historicalRecords.total, 1);
  });
});

test('homework assignments can be soft deleted by responsible teachers only', async () => {
  const app = createApp({
    db: createDatabase(),
    authAccounts: [
      { username: 'admin', password: 'admin123', role: 'admin' },
      { username: 'front-teacher', password: 'teacher123', role: 'teacher', teacherId: 1, classNames: ['Frontend'] },
      { username: 'java-teacher', password: 'teacher123', role: 'teacher', teacherId: 2, classNames: ['Java'] }
    ]
  });
  app.createStudent({ name: 'Alice', phone: '13800000001', className: 'Frontend' });
  const assignment = app.createHomeworkAssignment({
    homeworkName: 'Delete Me',
    className: 'Frontend'
  }, { role: 'teacher', classNames: ['Frontend'] });

  await withServer(app, async (baseUrl) => {
    const frontCookie = await loginAs(baseUrl, 'front-teacher', 'teacher123');
    const javaCookie = await loginAs(baseUrl, 'java-teacher', 'teacher123');
    const forbidden = await fetch(`${baseUrl}/api/homework-assignments/${assignment.assignment.id}`, {
      method: 'DELETE',
      headers: { cookie: javaCookie }
    });
    const deleted = await fetch(`${baseUrl}/api/homework-assignments/${assignment.assignment.id}`, {
      method: 'DELETE',
      headers: { cookie: frontCookie }
    }).then(async (response) => ({ status: response.status, body: await response.json() }));
    const assignments = await fetch(`${baseUrl}/api/homework-assignments`, {
      headers: { cookie: frontCookie }
    }).then((response) => response.json());
    const records = await fetch(`${baseUrl}/api/homework?assignmentId=${assignment.assignment.id}&includeArchivedStudents=1`, {
      headers: { cookie: frontCookie }
    }).then((response) => response.json());

    assert.equal(forbidden.status, 403);
    assert.equal(deleted.status, 200);
    assert.ok(deleted.body.assignment.deletedAt);
    assert.equal(assignments.total, 0);
    assert.equal(records.total, 0);
    assert.equal(app.listHomeworkRecords({ assignmentId: assignment.assignment.id, includeDeletedAssignments: true, includeArchivedStudents: true }).total, 1);
  });
});

test('homework late status is calculated for assignment stats records and exports', () => {
  const app = createApp({ db: createDatabase() });
  assert.throws(() => {
    app.createHomeworkAssignment({ homeworkName: 'Missing Class Homework', className: 'MissingClass' });
  }, /class not found/);
  const alice = app.createStudent({ name: 'Alice', phone: '13800000001', className: 'Frontend1' });
  const bob = app.createStudent({ name: 'Bob', phone: '13800000002', className: 'Frontend1' });
  const created = app.createHomeworkAssignment({
    homeworkName: 'Late Homework',
    className: 'Frontend1',
    dueDate: '2026-05-01'
  });
  const aliceRecord = created.records.find((record) => record.studentId === alice.id);
  const bobRecord = created.records.find((record) => record.studentId === bob.id);

  app.updateHomeworkRecord(aliceRecord.id, { submitStatus: 'submitted', submitAt: '2026-05-02T09:00:00', fileName: 'late.txt' });
  app.updateHomeworkRecord(bobRecord.id, { submitStatus: 'pending' });

  const assignments = app.listHomeworkAssignments({ now: '2026-05-03T00:00:00' }).items;
  const overdueRecords = app.listHomeworkRecords({ lateStatus: 'overduePending', now: '2026-05-03T00:00:00' }).items;
  const lateRecords = app.listHomeworkRecords({ lateStatus: 'lateSubmitted', now: '2026-05-03T00:00:00' }).items;
  const csv = app.exportHomeworkRecords({ now: '2026-05-03T00:00:00' });

  assert.equal(assignments[0].overduePendingCount, 1);
  assert.equal(assignments[0].lateSubmittedCount, 1);
  assert.equal(overdueRecords.length, 1);
  assert.equal(overdueRecords[0].studentName, 'Bob');
  assert.equal(overdueRecords[0].lateStatus, 'overduePending');
  assert.equal(lateRecords.length, 1);
  assert.equal(lateRecords[0].studentName, 'Alice');
  assert.equal(lateRecords[0].lateStatus, 'lateSubmitted');
  assert.match(csv, /逾期状态/);
  assert.match(csv, /逾期未交/);
  assert.match(csv, /迟交/);
});

test('student repeated homework uploads keep latest file and remove previous stored file', async () => {
  const uploadRoot = createUploadRoot();
  const app = createApp({
    db: createDatabase(),
    uploadRoot,
    authAccounts: [
      { username: 'teacher', password: 'teacher123', role: 'teacher', teacherId: 1, classNames: ['Frontend1'] },
      { username: 'student-a', password: 'student123', role: 'student', studentId: 1 }
    ]
  });
  const alice = app.createStudent({ name: 'Alice', phone: '13800000001', className: 'Frontend1' });
  const created = app.createHomeworkAssignment({ homeworkName: 'Repeat Upload', className: 'Frontend1' });
  const record = created.records.find((item) => item.studentId === alice.id);

  await withServer(app, async (baseUrl) => {
    const studentCookie = await loginAs(baseUrl, 'student-a', 'student123');

    const firstForm = new FormData();
    firstForm.append('file', new Blob(['first answer'], { type: 'text/plain' }), 'first.txt');
    const first = await fetch(`${baseUrl}/api/homework/${record.id}/submission`, {
      method: 'POST',
      headers: { cookie: studentCookie },
      body: firstForm
    }).then((response) => response.json());

    const secondForm = new FormData();
    secondForm.append('file', new Blob(['second answer'], { type: 'text/plain' }), 'second.txt');
    const second = await fetch(`${baseUrl}/api/homework/${record.id}/submission`, {
      method: 'POST',
      headers: { cookie: studentCookie },
      body: secondForm
    }).then((response) => response.json());
    const downloaded = await fetch(`${baseUrl}/api/homework/${record.id}/file`, { headers: { cookie: studentCookie } }).then((response) => response.text());

    assert.equal(first.record.fileName, 'first.txt');
    assert.equal(second.record.fileName, 'second.txt');
    assert.equal(downloaded, 'second answer');
    assert.equal(fs.existsSync(first.record.filePath), false);
    assert.equal(fs.existsSync(second.record.filePath), true);
  });
});

test('homework analytics summarizes overview classes assignments and students', async () => {
  const app = createApp({
    db: createDatabase(),
    authAccounts: [
      { username: 'admin', password: 'admin123', role: 'admin' },
      { username: 'teacher', password: 'teacher123', role: 'teacher', teacherId: 1, classNames: ['Frontend1'] },
      { username: 'open-teacher', password: 'teacher123', role: 'teacher', teacherId: 2 },
      { username: 'student', password: 'student123', role: 'student', studentId: 1 }
    ]
  });
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
    const adminCookie = await loginAs(baseUrl);
    const openTeacherCookie = await loginAs(baseUrl, 'open-teacher', 'teacher123');
    const studentCookie = await loginAs(baseUrl, 'student', 'student123');
    const teacherMe = await fetch(`${baseUrl}/api/me`, { headers: { cookie: teacherCookie } }).then((response) => response.json());
    const analyticsResponse = await fetch(`${baseUrl}/api/homework-analytics?className=Frontend1`, { headers: { cookie: teacherCookie } });
    const analyticsBody = await analyticsResponse.json();
    const teacherClasses = await fetch(`${baseUrl}/api/classes`, { headers: { cookie: teacherCookie } }).then((response) => response.json());
    const forbiddenClassAnalytics = await fetch(`${baseUrl}/api/homework-analytics?className=Java1`, { headers: { cookie: teacherCookie } });
    const openTeacherAnalytics = await fetch(`${baseUrl}/api/homework-analytics`, { headers: { cookie: openTeacherCookie } }).then((response) => response.json());
    const studentZip = await fetch(`${baseUrl}/api/export/homework/student/${alice.id}.zip`, { headers: { cookie: teacherCookie } });
    const unauthorizedAnalytics = await fetch(`${baseUrl}/api/homework-analytics`);
    const adminAnalytics = await fetch(`${baseUrl}/api/homework-analytics`, { headers: { cookie: adminCookie } });
    const forbiddenAnalytics = await fetch(`${baseUrl}/api/homework-analytics`, { headers: { cookie: studentCookie } });
    const forbiddenStudentZip = await fetch(`${baseUrl}/api/export/homework/student/${alice.id}.zip`, { headers: { cookie: studentCookie } });

    assert.equal(analyticsResponse.status, 200);
    assert.deepEqual(teacherMe.user.classNames, ['Frontend1']);
    assert.equal(analyticsBody.overview.recordCount, 4);
    assert.deepEqual(teacherClasses.items.map((item) => item.className), ['Frontend1']);
    assert.equal(forbiddenClassAnalytics.status, 403);
    assert.equal(openTeacherAnalytics.overview.recordCount, 0);
    assert.deepEqual(openTeacherAnalytics.classes, []);
    assert.equal(studentZip.status, 200);
    assert.equal(studentZip.headers.get('content-type'), 'application/zip');
    assert.equal(unauthorizedAnalytics.status, 401);
    assert.equal(adminAnalytics.status, 403);
    assert.equal(forbiddenAnalytics.status, 403);
    assert.equal(forbiddenStudentZip.status, 403);
  });
});

test('homework analytics class ranking uses the same active record scope as overview', () => {
  const app = createApp({ db: createDatabase() });
  const alice = app.createStudent({ name: 'Alice', phone: '13800000001', className: '大数据' });
  const bob = app.createStudent({ name: 'Bob', phone: '13800000002', className: '大数据' });

  const activeAssignment = app.createHomeworkAssignment({ homeworkName: '0518', className: '大数据', dueDate: '2026-05-20' });
  const deletedAssignment = app.createHomeworkAssignment({ homeworkName: '历史作业', className: '大数据', dueDate: '2026-05-01' });

  for (const record of activeAssignment.records) {
    app.updateHomeworkRecord(record.id, { submitStatus: 'submitted', submitAt: '2026-05-18T09:00:00' });
  }
  app.deleteHomeworkAssignment(deletedAssignment.assignment.id, { role: 'admin' });

  const analytics = app.getHomeworkAnalytics({ className: '大数据' });
  const classStats = analytics.classes.find((item) => item.className === '大数据');

  assert.equal(analytics.overview.recordCount, 2);
  assert.equal(analytics.overview.submittedCount, 2);
  assert.equal(analytics.overview.completionRate, 100);
  assert.equal(classStats.recordCount, 2);
  assert.equal(classStats.submittedCount, 2);
  assert.equal(classStats.completionRate, 100);
  assert.equal(alice.className, '大数据');
  assert.equal(bob.className, '大数据');
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

test('class options and teacher bindings persist across reloads', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'student-management-classes-'));
  const filePath = path.join(tempDir, 'data.json');
  const authAccounts = [
    { username: 'admin', password: 'admin123', role: 'admin' },
    { username: 'teacher', password: 'teacher123', role: 'teacher', teacherId: 1 }
  ];
  const app = createApp({ db: createDatabase({ filePath }), authAccounts });
  app.createClass({ className: '管理员班级' }, { role: 'admin', username: 'admin' });
  app.createClass({ className: '老师班级' }, { role: 'teacher', username: 'teacher', teacherId: 1 });
  app.saveDatabase();

  const reloadedApp = createApp({ db: createDatabase({ filePath }), authAccounts });

  await withServer(reloadedApp, async (baseUrl) => {
    const teacherCookie = await loginAs(baseUrl, 'teacher', 'teacher123');
    const me = await fetch(`${baseUrl}/api/me`, { headers: { cookie: teacherCookie } }).then((response) => response.json());
    const classes = await fetch(`${baseUrl}/api/classes`, { headers: { cookie: teacherCookie } }).then((response) => response.json());

    assert.deepEqual(me.user.classNames, ['老师班级']);
    assert.deepEqual(classes.items.map((item) => item.className), ['老师班级']);
  });
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

test('legacy stored account passwords are upgraded to hashes after login', async () => {
  const db = createDatabase();
  db.authAccounts.push({
    id: 1,
    username: 'legacy-student',
    password: 'student123',
    role: 'student',
    studentId: 1,
    status: 'active',
    createdAt: '2026-05-01T00:00:00.000Z'
  });
  db.nextAuthAccountId = 2;
  const app = createApp({
    db,
    authAccounts: [{ username: 'admin', password: 'admin123', role: 'admin' }]
  });

  await withServer(app, async (baseUrl) => {
    await loginAs(baseUrl, 'legacy-student', 'student123');

    assert.equal(db.authAccounts[0].password, '');
    assert.match(db.authAccounts[0].passwordHash, /^pbkdf2_sha256\$/);
    assert.ok(db.authAccounts[0].passwordUpdatedAt);
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
    const teacherStudents = await fetch(`${baseUrl}/api/students`, { headers: { cookie: teacherCookie } })
      .then(async (response) => ({ status: response.status, body: await response.json() }));
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
    assert.equal(teacherStudents.status, 200);
    assert.equal(teacherStudents.body.total, 0);
    assert.equal(studentStudents.status, 403);
    assert.equal(teacherOwnSchedules.status, 200);
    assert.equal(teacherOtherSchedules.status, 403);
    assert.equal(teacherApprove.status, 200);
    assert.equal(teacherAccept.status, 200);
  });
});

test('teacher scheduling participation gates student calendar requests', async () => {
  const app = createApp({
    db: createDatabase(),
    authAccounts: [
      { username: 'admin', password: 'admin123', role: 'admin' },
      { username: 'teacher-off', password: 'teacher123', role: 'teacher', teacherId: 1, teacherName: 'Teacher Off' },
      { username: 'teacher-on', password: 'teacher123', role: 'teacher', teacherId: 2, teacherName: 'Teacher On', participatesInScheduling: true },
      { username: 'student-a', password: 'student123', role: 'student', studentId: 1 }
    ]
  });
  const alice = app.createStudent({ name: 'Alice', phone: '13800000001', className: 'Frontend', learningStage: 'job_seeking' });

  await withServer(app, async (baseUrl) => {
    const adminCookie = await loginAs(baseUrl);
    const teacherCookie = await loginAs(baseUrl, 'teacher-off', 'teacher123');
    const studentCookie = await loginAs(baseUrl, 'student-a', 'student123');

    const studentTeachersBefore = await fetch(`${baseUrl}/api/teachers`, { headers: { cookie: studentCookie } }).then((response) => response.json());
    const adminTeachers = await fetch(`${baseUrl}/api/teachers`, { headers: { cookie: adminCookie } }).then((response) => response.json());
    const blockedRequest = await fetch(`${baseUrl}/api/schedules`, {
      method: 'POST',
      headers: jsonHeaders(studentCookie),
      body: JSON.stringify({
        studentId: alice.id,
        teacherId: 1,
        teacherName: 'Teacher Off',
        companyName: 'A Corp',
        positionName: 'Frontend Engineer',
        startsAt: '2026-05-18T09:00:00',
        endsAt: '2026-05-18T09:30:00'
      })
    });
    const allowedRequest = await fetch(`${baseUrl}/api/schedules`, {
      method: 'POST',
      headers: jsonHeaders(studentCookie),
      body: JSON.stringify({
        studentId: 999,
        teacherId: 2,
        teacherName: 'Teacher On',
        companyName: 'B Corp',
        positionName: 'Frontend Engineer',
        startsAt: '2099-05-18T10:00:00',
        endsAt: '2099-05-18T11:00:00'
      })
    }).then(async (response) => ({ status: response.status, body: await response.json() }));

    const schedulingPatch = await fetch(`${baseUrl}/api/teacher-workspace/scheduling`, {
      method: 'PATCH',
      headers: jsonHeaders(teacherCookie),
      body: JSON.stringify({ participatesInScheduling: true })
    }).then((response) => response.json());
    const studentTeachersAfter = await fetch(`${baseUrl}/api/teachers`, { headers: { cookie: studentCookie } }).then((response) => response.json());

    assert.deepEqual(studentTeachersBefore.items.map((teacher) => teacher.id), [2]);
    assert.equal(adminTeachers.items.find((teacher) => teacher.id === 1).participatesInScheduling, false);
    assert.equal(adminTeachers.items.find((teacher) => teacher.id === 2).participatesInScheduling, true);
    assert.equal(blockedRequest.status, 400);
    assert.equal(allowedRequest.status, 201);
    assert.equal(allowedRequest.body.schedule.status, 'requested');
    assert.equal(allowedRequest.body.schedule.studentId, alice.id);
    assert.equal(schedulingPatch.teacher.participatesInScheduling, true);
    assert.deepEqual(studentTeachersAfter.items.map((teacher) => teacher.id).sort(), [1, 2]);
  });
});

test('student schedule requests require active job seeking students', async () => {
  const app = createApp({
    db: createDatabase(),
    authAccounts: [
      { username: 'admin', password: 'admin123', role: 'admin' },
      { username: 'teacher', password: 'teacher123', role: 'teacher', teacherId: 1, teacherName: 'Teacher A', participatesInScheduling: true },
      { username: 'student-study', password: 'student123', role: 'student', studentId: 1 },
      { username: 'student-employed', password: 'student123', role: 'student', studentId: 2 },
      { username: 'student-archived', password: 'student123', role: 'student', studentId: 3 },
      { username: 'student-job', password: 'student123', role: 'student', studentId: 4 }
    ],
    teachers: [{ id: 1, name: 'Teacher A' }]
  });
  const studying = app.createStudent({ name: 'Studying', className: 'Frontend' });
  const employed = app.createStudent({ name: 'Employed', className: 'Frontend', learningStage: 'employed' });
  const archived = app.createStudent({ name: 'Archived', className: 'Frontend', learningStage: 'job_seeking' });
  const jobSeeking = app.createStudent({ name: 'Job Seeking', className: 'Frontend', learningStage: 'job_seeking' });
  app.archiveStudent(archived.id);

  async function requestSchedule(baseUrl, cookie, startsAt) {
    return fetch(`${baseUrl}/api/schedules`, {
      method: 'POST',
      headers: jsonHeaders(cookie),
      body: JSON.stringify({
        teacherId: 1,
        teacherName: 'Teacher A',
        companyName: 'Stage Co',
        positionName: 'Frontend Engineer',
        startsAt,
        endsAt: startsAt.replace('09:00:00', '10:00:00')
      })
    }).then(async (response) => ({ status: response.status, body: await response.json() }));
  }

  await withServer(app, async (baseUrl) => {
    const studyingCookie = await loginAs(baseUrl, 'student-study', 'student123');
    const employedCookie = await loginAs(baseUrl, 'student-employed', 'student123');
    const archivedCookie = await loginAs(baseUrl, 'student-archived', 'student123');
    const jobCookie = await loginAs(baseUrl, 'student-job', 'student123');
    const studyingWorkspace = await fetch(`${baseUrl}/api/student-workspace`, {
      headers: { cookie: studyingCookie }
    }).then((response) => response.json());

    const studyingRequest = await requestSchedule(baseUrl, studyingCookie, '2099-06-01T09:00:00');
    const employedRequest = await requestSchedule(baseUrl, employedCookie, '2099-06-02T09:00:00');
    const archivedRequest = await requestSchedule(baseUrl, archivedCookie, '2099-06-03T09:00:00');
    const jobRequest = await requestSchedule(baseUrl, jobCookie, '2099-06-04T09:00:00');

    assert.equal(studying.learningStage, 'studying');
    assert.equal(studyingWorkspace.scheduleGuard.canRequest, false);
    assert.equal(studyingWorkspace.scheduleGuard.reason, 'student not eligible for scheduling');
    assert.equal(studyingRequest.status, 400);
    assert.equal(employedRequest.status, 400);
    assert.equal(archivedRequest.status, 400);
    assert.equal(jobSeeking.learningStage, 'job_seeking');
    assert.equal(jobRequest.status, 201);
    assert.equal(jobRequest.body.schedule.studentId, jobSeeking.id);
  });
});

test('teachers can approve reject and filter their own interview schedules', async () => {
  const app = createApp({
    db: createDatabase(),
    authAccounts: [
      { username: 'admin', password: 'admin123', role: 'admin' },
      { username: 'teacher-a', password: 'teacher123', role: 'teacher', teacherId: 1, teacherName: 'Teacher A', participatesInScheduling: true },
      { username: 'teacher-b', password: 'teacher123', role: 'teacher', teacherId: 2, teacherName: 'Teacher B', participatesInScheduling: true }
    ]
  });
  const alice = app.createStudent({ name: 'Alice', phone: '13800000001', className: 'Frontend' });
  const own = app.createInterviewSchedule({
    studentId: alice.id,
    teacherId: 1,
    teacherName: 'Teacher A',
    companyName: 'Acme',
    positionName: 'Frontend Engineer',
    startsAt: '2026-05-18T09:00:00',
    endsAt: '2026-05-18T09:30:00',
    status: 'requested',
    requestSource: 'student'
  });
  const rejectable = app.createInterviewSchedule({
    studentId: alice.id,
    teacherId: 1,
    teacherName: 'Teacher A',
    companyName: 'Beta',
    positionName: 'Frontend Engineer',
    startsAt: '2026-05-18T11:00:00',
    endsAt: '2026-05-18T11:30:00',
    status: 'requested',
    requestSource: 'student'
  });

  await withServer(app, async (baseUrl) => {
    const teacherACookie = await loginAs(baseUrl, 'teacher-a', 'teacher123');
    const teacherBCookie = await loginAs(baseUrl, 'teacher-b', 'teacher123');

    const forbidden = await fetch(`${baseUrl}/api/schedules/${own.id}/approve`, {
      method: 'POST',
      headers: jsonHeaders(teacherBCookie),
      body: JSON.stringify({ confirmedByName: 'Teacher B' })
    });
    const approved = await fetch(`${baseUrl}/api/schedules/${own.id}/approve`, {
      method: 'POST',
      headers: jsonHeaders(teacherACookie),
      body: JSON.stringify({ confirmedByName: 'Teacher A' })
    }).then((response) => response.json());
    const rejected = await fetch(`${baseUrl}/api/schedules/${rejectable.id}/reject`, {
      method: 'POST',
      headers: jsonHeaders(teacherACookie),
      body: JSON.stringify({})
    }).then((response) => response.json());
    const keywordMatches = await fetch(`${baseUrl}/api/schedules?teacherId=1&keyword=Acme`, {
      headers: { cookie: teacherACookie }
    }).then((response) => response.json());

    assert.equal(forbidden.status, 403);
    assert.equal(approved.schedule.status, 'confirmed');
    assert.equal(approved.schedule.confirmedByRole, 'teacher');
    assert.equal(rejected.schedule.status, 'cancelled');
    assert.equal(keywordMatches.total, 1);
    assert.equal(keywordMatches.items[0].companyName, 'Acme');
  });
});

test('student workspace returns learning data and schedule guard without exposing all students', async () => {
  const db = createDatabase();
  const studentApp = createApp({
    db,
    authAccounts: [
      { username: 'admin', password: 'admin123', role: 'admin' },
      { username: 'teacher', password: 'teacher123', role: 'teacher', teacherId: 1, teacherName: '张老师', participatesInScheduling: true },
      { username: 'student-a', password: 'student123', role: 'student', studentId: 1 }
    ]
  });
  const alice = studentApp.createStudent({ name: 'Alice', phone: '13800000001', className: '前端1班', learningStage: 'job_seeking' });
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
        startsAt: '2099-05-18T10:00:00',
        endsAt: '2099-05-18T10:30:00'
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
        startsAt: '2099-05-18T11:00:00',
        endsAt: '2099-05-18T12:00:00'
      })
    }).then(async (response) => ({ status: response.status, body: await response.json() }));

    assert.equal(workspace.student.id, alice.id);
    assert.equal(workspace.homeworkRecords.length, 1);
    assert.equal(workspace.interviewRecords.length, 1);
    assert.equal(workspace.scheduleGuard.canRequest, true);
    assert.equal(workspace.scheduleGuard.unfinishedCount, 0);
    assert.equal(students.status, 403);
    assert.equal(otherSchedule.status, 201);
    assert.equal(ownSchedule.status, 201);
    assert.equal(ownSchedule.body.schedule.studentId, alice.id);
  });
});

test('dashboard stats are available for the frontend', async () => {
  const app = createApp({ db: createDatabase() });
  const alice = app.createStudent({ name: 'Alice', phone: '13800000001', className: '前端1班' });
  const bob = app.createStudent({ name: 'Bob', phone: '13800000002', className: 'Java1班' });
  const cindy = app.createStudent({ name: 'Cindy', phone: '13800000003', className: '数据分析班' });
  app.addInterviewRecord({ studentId: alice.id, companyName: 'A公司', positionName: '前端工程师', interviewAt: '2026-05-10T09:00:00', result: 'passed', hiredStatus: 'hired' });
  app.addInterviewRecord({ studentId: bob.id, companyName: 'B公司', positionName: 'Java工程师', interviewAt: '2026-05-11T09:00:00', result: 'failed', hiredStatus: 'not_hired' });
  app.addInterviewRecord({ studentId: cindy.id, companyName: 'C公司', positionName: '数据分析师', interviewAt: '2026-05-12T09:00:00', result: 'pending', hiredStatus: 'pending' });

  await withServer(app, async (baseUrl) => {
    const cookie = await loginAs(baseUrl);
    const stats = await fetch(`${baseUrl}/api/dashboard/stats`, { headers: { cookie } }).then((response) => response.json());

    assert.equal(stats.students.total, 3);
    assert.equal(stats.homework.total, 0);
    assert.equal(stats.interviews.total, 3);
    assert.equal(stats.interviews.pending, 1);
    assert.equal(stats.employmentRate, 33);
    assert.deepEqual(stats.interviewResults, { pending: 1, passed: 1, failed: 1 });
    assert.deepEqual(stats.hiredStatuses, { pending: 1, hired: 1, not_hired: 1 });
    assert.equal(stats.recentInterviews[0].companyName, 'C公司');
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

test('student weekly schedule view redacts classmates and supports own requests', async () => {
  const app = createApp({
    db: createDatabase(),
    authAccounts: [
      { username: 'admin', password: 'admin123', role: 'admin' },
      { username: 'teacher', password: 'teacher123', role: 'teacher', teacherId: 1, teacherName: 'Teacher A', participatesInScheduling: true },
      { username: 'teacher-b', password: 'teacher123', role: 'teacher', teacherId: 2, teacherName: 'Teacher B', participatesInScheduling: true },
      { username: 'teacher-off', password: 'teacher123', role: 'teacher', teacherId: 3, teacherName: 'Teacher Off', participatesInScheduling: false },
      { username: 'student-a', password: 'student123', role: 'student', studentId: 1 },
      { username: 'student-b', password: 'student123', role: 'student', studentId: 2 }
    ],
    teachers: [
      { id: 1, name: 'Teacher A' },
      { id: 2, name: 'Teacher B' },
      { id: 3, name: 'Teacher Off' }
    ]
  });
  const alice = app.createStudent({ name: 'Alice', className: 'Frontend', learningStage: 'job_seeking' });
  const bob = app.createStudent({ name: 'Bob', className: 'Frontend', learningStage: 'job_seeking' });
  app.createInterviewSchedule({
    studentId: alice.id,
    teacherId: 1,
    teacherName: 'Teacher A',
    companyName: 'Alice Co',
    positionName: 'Frontend Engineer',
    startsAt: '2099-05-18T09:00:00',
    endsAt: '2099-05-18T09:30:00',
    status: 'confirmed'
  });
  app.createInterviewSchedule({
    studentId: bob.id,
    teacherId: 1,
    teacherName: 'Teacher A',
    companyName: 'Bob Co',
    positionName: 'Backend Engineer',
    startsAt: '2099-05-19T10:00:00',
    endsAt: '2099-05-19T10:30:00',
    status: 'confirmed'
  });
  app.createInterviewSchedule({
    studentId: bob.id,
    teacherId: 2,
    teacherName: 'Teacher B',
    companyName: 'Teacher B Co',
    positionName: 'Data Engineer',
    startsAt: '2099-05-19T14:00:00',
    endsAt: '2099-05-19T14:30:00',
    status: 'confirmed'
  });
  app.createInterviewSchedule({
    studentId: bob.id,
    teacherId: 3,
    teacherName: 'Teacher Off',
    companyName: 'Hidden Co',
    positionName: 'QA Engineer',
    startsAt: '2099-05-19T15:00:00',
    endsAt: '2099-05-19T15:30:00',
    status: 'confirmed'
  });

  await withServer(app, async (baseUrl) => {
    const studentCookie = await loginAs(baseUrl, 'student-a', 'student123');
    const request = await fetch(`${baseUrl}/api/schedules`, {
      method: 'POST',
      headers: jsonHeaders(studentCookie),
      body: JSON.stringify({
        studentId: bob.id,
        teacherId: 1,
        teacherName: 'Teacher A',
        companyName: 'Alice Request Co',
        positionName: 'Frontend Engineer',
        startsAt: '2099-05-20T09:00:00',
        endsAt: '2099-05-20T10:00:00'
      })
    }).then(async (response) => ({ status: response.status, body: await response.json() }));
    const weekly = await fetch(`${baseUrl}/api/student-workspace/schedules/week?weekStart=2099-05-18`, {
      headers: { cookie: studentCookie }
    }).then(async (response) => ({ status: response.status, body: await response.json() }));
    const teacherFiltered = await fetch(`${baseUrl}/api/student-workspace/schedules/week?weekStart=2099-05-18&teacherId=2`, {
      headers: { cookie: studentCookie }
    }).then(async (response) => ({ status: response.status, body: await response.json() }));
    const unavailableTeacher = await fetch(`${baseUrl}/api/student-workspace/schedules/week?weekStart=2099-05-18&teacherId=3`, {
      headers: { cookie: studentCookie }
    });
    const scheduleList = await fetch(`${baseUrl}/api/schedules`, {
      headers: { cookie: studentCookie }
    });

    assert.equal(request.status, 201);
    assert.equal(request.body.schedule.studentId, alice.id);
    assert.equal(request.body.schedule.status, 'requested');
    assert.equal(weekly.status, 200);
    assert.equal(weekly.body.entries.length, 4);
    assert.equal(weekly.body.entries.find((entry) => entry.companyName === 'Alice Co').studentName, 'Alice');
    assert.equal(weekly.body.entries.find((entry) => entry.companyName === 'Bob Co').studentName, '');
    assert.equal(weekly.body.entries.find((entry) => entry.companyName === 'Alice Request Co').isOwn, true);
    assert.equal(weekly.body.entries.some((entry) => entry.companyName === 'Hidden Co'), false);
    assert.equal(teacherFiltered.status, 200);
    assert.deepEqual(teacherFiltered.body.entries.map((entry) => entry.teacherId), [2]);
    assert.equal(teacherFiltered.body.entries[0].studentName, '');
    assert.equal(unavailableTeacher.status, 403);
    assert.equal(scheduleList.status, 403);
    assert.equal(bob.id, 2);
  });
});

test('student schedule requests enforce slot rules conflicts and owner cancellation', async () => {
  const app = createApp({
    db: createDatabase(),
    authAccounts: [
      { username: 'admin', password: 'admin123', role: 'admin' },
      { username: 'teacher', password: 'teacher123', role: 'teacher', teacherId: 1, teacherName: 'Teacher A', participatesInScheduling: true },
      { username: 'student-a', password: 'student123', role: 'student', studentId: 1 },
      { username: 'student-b', password: 'student123', role: 'student', studentId: 2 }
    ],
    teachers: [{ id: 1, name: 'Teacher A' }]
  });
  const alice = app.createStudent({ name: 'Alice', className: 'Frontend', learningStage: 'job_seeking' });
  const bob = app.createStudent({ name: 'Bob', className: 'Frontend', learningStage: 'job_seeking' });

  await withServer(app, async (baseUrl) => {
    const aliceCookie = await loginAs(baseUrl, 'student-a', 'student123');
    const bobCookie = await loginAs(baseUrl, 'student-b', 'student123');
    const baseRequest = {
      studentId: bob.id,
      teacherId: 1,
      teacherName: 'Teacher A',
      companyName: 'Calendar Co',
      positionName: 'Frontend Engineer'
    };
    const valid = await fetch(`${baseUrl}/api/schedules`, {
      method: 'POST',
      headers: jsonHeaders(aliceCookie),
      body: JSON.stringify({
        ...baseRequest,
        startsAt: '2099-05-21T09:00:00',
        endsAt: '2099-05-21T10:00:00'
      })
    }).then(async (response) => ({ status: response.status, body: await response.json() }));
    const unaligned = await fetch(`${baseUrl}/api/schedules`, {
      method: 'POST',
      headers: jsonHeaders(aliceCookie),
      body: JSON.stringify({
        ...baseRequest,
        startsAt: '2099-05-21T10:15:00',
        endsAt: '2099-05-21T11:15:00'
      })
    });
    const tooLong = await fetch(`${baseUrl}/api/schedules`, {
      method: 'POST',
      headers: jsonHeaders(aliceCookie),
      body: JSON.stringify({
        ...baseRequest,
        startsAt: '2099-05-21T11:00:00',
        endsAt: '2099-05-21T13:30:00'
      })
    });
    const past = await fetch(`${baseUrl}/api/schedules`, {
      method: 'POST',
      headers: jsonHeaders(aliceCookie),
      body: JSON.stringify({
        ...baseRequest,
        startsAt: '2020-05-21T09:00:00',
        endsAt: '2020-05-21T10:00:00'
      })
    });
    const conflict = await fetch(`${baseUrl}/api/schedules`, {
      method: 'POST',
      headers: jsonHeaders(bobCookie),
      body: JSON.stringify({
        ...baseRequest,
        studentId: bob.id,
        startsAt: '2099-05-21T09:30:00',
        endsAt: '2099-05-21T10:30:00'
      })
    });
    const forbiddenCancel = await fetch(`${baseUrl}/api/schedules/${valid.body.schedule.id}/cancel`, {
      method: 'POST',
      headers: { cookie: bobCookie }
    });
    const cancelled = await fetch(`${baseUrl}/api/schedules/${valid.body.schedule.id}/cancel`, {
      method: 'POST',
      headers: { cookie: aliceCookie }
    }).then(async (response) => ({ status: response.status, body: await response.json() }));

    assert.equal(valid.status, 201);
    assert.equal(valid.body.schedule.studentId, alice.id);
    assert.equal(unaligned.status, 400);
    assert.equal(tooLong.status, 400);
    assert.equal(past.status, 400);
    assert.equal(conflict.status, 400);
    assert.equal(forbiddenCancel.status, 403);
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.schedule.status, 'cancelled');
  });
});

test('student uploads completed interview transcript before requesting another schedule', async () => {
  const uploadRoot = createUploadRoot();
  const app = createApp({
    db: createDatabase(),
    uploadRoot,
    authAccounts: [
      { username: 'admin', password: 'admin123', role: 'admin' },
      { username: 'teacher', password: 'teacher123', role: 'teacher', teacherId: 1, teacherName: 'Teacher A', participatesInScheduling: true },
      { username: 'student-a', password: 'student123', role: 'student', studentId: 1 },
      { username: 'student-b', password: 'student123', role: 'student', studentId: 2 }
    ],
    teachers: [{ id: 1, name: 'Teacher A' }]
  });
  const alice = app.createStudent({ name: 'Alice', className: 'Frontend', learningStage: 'job_seeking' });
  const bob = app.createStudent({ name: 'Bob', className: 'Frontend', learningStage: 'job_seeking' });
  const completed = app.createInterviewSchedule({
    studentId: alice.id,
    teacherId: 1,
    teacherName: 'Teacher A',
    companyName: 'Transcript Co',
    positionName: 'Frontend Engineer',
    startsAt: '2026-05-18T09:00:00',
    endsAt: '2026-05-18T09:30:00',
    status: 'completed'
  });
  const requested = app.createInterviewSchedule({
    studentId: alice.id,
    teacherId: 1,
    teacherName: 'Teacher A',
    companyName: 'Pending Co',
    positionName: 'Frontend Engineer',
    startsAt: '2026-05-19T09:00:00',
    endsAt: '2026-05-19T09:30:00',
    status: 'requested'
  });

  await withServer(app, async (baseUrl) => {
    const adminCookie = await loginAs(baseUrl);
    const teacherCookie = await loginAs(baseUrl, 'teacher', 'teacher123');
    const studentCookie = await loginAs(baseUrl, 'student-a', 'student123');
    const otherStudentCookie = await loginAs(baseUrl, 'student-b', 'student123');

    const workspaceBefore = await fetch(`${baseUrl}/api/student-workspace`, {
      headers: { cookie: studentCookie }
    }).then((response) => response.json());
    const blockedRequest = await fetch(`${baseUrl}/api/schedules`, {
      method: 'POST',
      headers: jsonHeaders(studentCookie),
      body: JSON.stringify({
        teacherId: 1,
        teacherName: 'Teacher A',
        startsAt: '2099-05-22T09:00:00',
        endsAt: '2099-05-22T09:30:00'
      })
    });
    const forbiddenUpload = new FormData();
    forbiddenUpload.append('file', new Blob(['Bob transcript'], { type: 'text/plain' }), 'bob-transcript.txt');
    const otherStudentUpload = await fetch(`${baseUrl}/api/schedules/${completed.id}/transcript`, {
      method: 'POST',
      headers: { cookie: otherStudentCookie },
      body: forbiddenUpload
    });
    const pendingUpload = new FormData();
    pendingUpload.append('file', new Blob(['Pending transcript'], { type: 'text/plain' }), 'pending-transcript.txt');
    const incompleteUpload = await fetch(`${baseUrl}/api/schedules/${requested.id}/transcript`, {
      method: 'POST',
      headers: { cookie: studentCookie },
      body: pendingUpload
    });
    const wrongType = new FormData();
    wrongType.append('file', new Blob(['PDF content'], { type: 'application/pdf' }), 'alice-transcript.pdf');
    const invalidTypeUpload = await fetch(`${baseUrl}/api/schedules/${completed.id}/transcript`, {
      method: 'POST',
      headers: { cookie: studentCookie },
      body: wrongType
    });
    const transcript = new FormData();
    transcript.append('file', new Blob(['Alice transcript'], { type: 'text/plain' }), 'alice-transcript.txt');
    const uploaded = await fetch(`${baseUrl}/api/schedules/${completed.id}/transcript`, {
      method: 'POST',
      headers: { cookie: studentCookie },
      body: transcript
    }).then(async (response) => ({ status: response.status, body: await response.json() }));
    const replacementTranscript = new FormData();
    replacementTranscript.append('file', new Blob(['Alice transcript updated'], { type: 'text/plain' }), 'alice-transcript-updated.txt');
    const uploadedAgain = await fetch(`${baseUrl}/api/schedules/${completed.id}/transcript`, {
      method: 'POST',
      headers: { cookie: studentCookie },
      body: replacementTranscript
    }).then(async (response) => ({ status: response.status, body: await response.json() }));

    const teacherDownload = await fetch(`${baseUrl}/api/schedules/${completed.id}/transcript`, { headers: { cookie: teacherCookie } });
    const adminDownload = await fetch(`${baseUrl}/api/schedules/${completed.id}/transcript`, { headers: { cookie: adminCookie } });
    const studentDownload = await fetch(`${baseUrl}/api/schedules/${completed.id}/transcript`, { headers: { cookie: studentCookie } });
    const otherStudentDownload = await fetch(`${baseUrl}/api/schedules/${completed.id}/transcript`, { headers: { cookie: otherStudentCookie } });
    const adminInterviews = await fetch(`${baseUrl}/api/interviews`, { headers: { cookie: adminCookie } })
      .then(async (response) => ({ status: response.status, body: await response.json() }));
    const syncedInterview = adminInterviews.body.items.find((record) => Number(record.scheduleId) === Number(completed.id));
    const interviewDownload = await fetch(`${baseUrl}/api/interviews/${syncedInterview?.id || 0}/transcript`, { headers: { cookie: adminCookie } });
    const interviewCsv = await fetch(`${baseUrl}/api/export/interviews`, { headers: { cookie: adminCookie } }).then((response) => response.text());
    const interviewZipResponse = await fetch(`${baseUrl}/api/export/interviews.zip`, { headers: { cookie: adminCookie } });
    const interviewZip = Buffer.from(await interviewZipResponse.arrayBuffer());
    const nextRequest = await fetch(`${baseUrl}/api/schedules`, {
      method: 'POST',
      headers: jsonHeaders(studentCookie),
      body: JSON.stringify({
        studentId: alice.id,
        teacherId: 1,
        teacherName: 'Teacher A',
        startsAt: '2026-05-22T09:00:00',
        endsAt: '2026-05-22T09:30:00'
      })
    });
    const workspaceAfter = await fetch(`${baseUrl}/api/student-workspace`, {
      headers: { cookie: studentCookie }
    }).then((response) => response.json());

    assert.equal(workspaceBefore.scheduleGuard.canRequest, false);
    assert.equal(workspaceBefore.scheduleGuard.reason, 'interview transcript required');
    assert.equal(blockedRequest.status, 400);
    assert.equal(otherStudentUpload.status, 403);
    assert.equal(incompleteUpload.status, 400);
    assert.equal(invalidTypeUpload.status, 400);
    assert.equal(uploaded.status, 200);
    assert.equal(uploadedAgain.status, 200);
    assert.equal(uploaded.body.schedule.transcriptFileName, 'alice-transcript.txt');
    assert.equal(uploadedAgain.body.schedule.transcriptFileName, 'alice-transcript-updated.txt');
    assert.ok(uploadedAgain.body.schedule.transcriptFilePath);
    assert.equal(uploaded.body.schedule.transcriptFileSize, 'Alice transcript'.length);
    assert.ok(uploadedAgain.body.schedule.transcriptUploadedAt);
    assert.equal(await teacherDownload.text(), 'Alice transcript updated');
    assert.equal(await adminDownload.text(), 'Alice transcript updated');
    assert.equal(await studentDownload.text(), 'Alice transcript updated');
    assert.equal(teacherDownload.headers.get('content-type'), 'text/plain; charset=utf-8');
    assert.equal(otherStudentDownload.status, 403);
    assert.equal(adminInterviews.status, 200);
    assert.ok(syncedInterview);
    assert.equal(syncedInterview.studentId, alice.id);
    assert.equal(syncedInterview.teacherName, 'Teacher A');
    assert.equal(syncedInterview.companyName, 'Transcript Co');
    assert.equal(syncedInterview.positionName, 'Frontend Engineer');
    assert.equal(syncedInterview.interviewAt, '2026-05-18T09:00:00');
    assert.equal(syncedInterview.source, 'schedule');
    assert.equal(syncedInterview.transcriptFileName, 'alice-transcript-updated.txt');
    assert.equal(adminInterviews.body.items.filter((record) => Number(record.scheduleId) === Number(completed.id)).length, 1);
    assert.equal(await interviewDownload.text(), 'Alice transcript updated');
    assert.match(interviewCsv, /alice-transcript-updated\.txt/);
    assert.match(interviewCsv, /排期同步/);
    assert.equal(interviewZipResponse.headers.get('content-type'), 'application/zip');
    assert.match(interviewZip.toString('utf8'), /alice-transcript-updated\.txt/);
    assert.match(interviewZip.toString('utf8'), /面试记录清单\.csv/);
    assert.equal(nextRequest.status, 201);
    assert.equal(workspaceAfter.scheduleGuard.canRequest, true);
    assert.equal(workspaceAfter.scheduleGuard.pendingTranscriptSchedules.length, 0);
    assert.equal(bob.id, 2);
  });
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
  const bob = app.createStudent({ name: 'Bob', phone: '13800000002', className: '前端1班' });

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
    const other = await fetch(`${baseUrl}/api/schedules`, {
      method: 'POST',
      headers: jsonHeaders(cookie),
      body: JSON.stringify({
        studentId: bob.id,
        teacherId: 1,
        teacherName: '张老师',
        companyName: 'B公司',
        positionName: '测试工程师',
        startsAt: '2026-05-18T10:00:00',
        endsAt: '2026-05-18T11:00:00'
      })
    }).then((response) => response.json());
    const conflictPatch = await fetch(`${baseUrl}/api/schedules/${created.schedule.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(cookie),
      body: JSON.stringify({
        startsAt: '2026-05-18T10:30:00',
        endsAt: '2026-05-18T11:30:00'
      })
    });
    const moved = await fetch(`${baseUrl}/api/schedules/${created.schedule.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(cookie),
      body: JSON.stringify({
        startsAt: '2026-05-18T11:30:00',
        endsAt: '2026-05-18T12:30:00'
      })
    }).then((response) => response.json());
    const teachers = await fetch(`${baseUrl}/api/teachers`, { headers: { cookie } }).then((response) => response.json());

    assert.equal(created.schedule.status, 'confirmed');
    assert.equal(created.schedule.confirmedByRole, 'admin');
    assert.equal(other.schedule.status, 'confirmed');
    assert.equal(conflictPatch.status, 400);
    assert.equal(moved.schedule.status, 'rescheduled');
    assert.equal(moved.schedule.startsAt, '2026-05-18T11:30:00');
    assert.equal(teachers.items[0].id, 1);
    assert.equal(teachers.items[0].name, '张老师');
    assert.equal(teachers.items[0].participatesInScheduling, false);
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
  assert.equal(db.schemaVersion, 5);
  assert.equal(db.students[0].status, 'active');

  db.save();
  const saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  assert.equal(saved.schemaVersion, 5);
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
  app.createClass({ className: '前端1班' });
  app.createClass({ className: 'Java1班' });
  app.createClass({ className: '前端2班' });
  app.createClass({ className: 'Java2班' });
  app.createStudent({ name: 'Existing', phone: '13800000001', className: '前端1班' });
  const importText = [
    '姓名,手机号,班级/课程',
    'Alice,,前端1班',
    ',13900000002,Java1班',
    'Bob,13800000001,Java1班',
    'Cindy,13900000003,',
    'Dora,13900000004,不存在班'
  ].join('\n');

  await withServer(app, async (baseUrl) => {
    const cookie = await loginAs(baseUrl);
    const preview = await fetch(`${baseUrl}/api/students/import/preview`, {
      method: 'POST',
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ text: importText })
    }).then((response) => response.json());

    assert.equal(preview.validCount, 1);
    assert.equal(preview.invalidCount, 4);
    assert.deepEqual(preview.rows[1].errors, ['姓名不能为空']);
    assert.deepEqual(preview.rows[2].errors, ['手机号重复']);
    assert.deepEqual(preview.rows[3].errors, ['班级不能为空']);
    assert.deepEqual(preview.rows[4].errors, ['班级不存在，请先新增班级']);

    const mixedCommit = await fetch(`${baseUrl}/api/students/import/commit`, {
      method: 'POST',
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ text: importText })
    }).then((response) => response.json());
    assert.equal(mixedCommit.created.length, 1);
    assert.equal(mixedCommit.invalidCount, 4);
    assert.equal(app.listStudents().total, 2);

    const commit = await fetch(`${baseUrl}/api/students/import/commit`, {
      method: 'POST',
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ text: '姓名,手机号,班级/课程\nCharlie,13800000003,前端2班\nDana,13800000004,Java2班' })
    }).then((response) => response.json());

    assert.equal(commit.created.length, 2);
    assert.equal(app.listStudents().total, 4);
  });
});

test('simple paste student import supports two columns and default class without CSV upload', async () => {
  const app = createApp({ db: createDatabase() });
  app.createClass({ className: 'Frontend' });
  app.createClass({ className: 'Java' });

  await withServer(app, async (baseUrl) => {
    const cookie = await loginAs(baseUrl);
    const preview = await fetch(`${baseUrl}/api/students/import/preview`, {
      method: 'POST',
      headers: jsonHeaders(cookie),
      body: JSON.stringify({
        mode: 'simplePaste',
        text: 'Alice\tFrontend\nBob\tUnknown\n\tJava'
      })
    }).then((response) => response.json());

    assert.equal(preview.validCount, 1);
    assert.equal(preview.invalidCount, 2);
    assert.equal(preview.rows[0].student.name, 'Alice');
    assert.equal(preview.rows[0].student.className, 'Frontend');
    assert.deepEqual(preview.rows[1].errors, ['班级不存在，请先新增班级']);
    assert.deepEqual(preview.rows[2].errors, ['姓名不能为空']);

    const commit = await fetch(`${baseUrl}/api/students/import/commit`, {
      method: 'POST',
      headers: jsonHeaders(cookie),
      body: JSON.stringify({
        mode: 'simplePaste',
        defaultClassName: 'Java',
        text: 'Cindy\nDana'
      })
    }).then((response) => response.json());

    assert.equal(commit.created.length, 2);
    assert.equal(commit.invalidCount, 0);
    assert.equal(app.listStudents({ className: 'Java' }).total, 2);
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
  app.createClass({ className: '前端1班' });

  await withServer(app, async (baseUrl) => {
    const cookie = await loginAs(baseUrl);
    const templateResponse = await fetch(`${baseUrl}/api/students/import/template.csv`, {
      headers: { cookie }
    });
    const templateBody = Buffer.from(await templateResponse.arrayBuffer());
    const template = templateBody.toString('utf8');

    assert.equal(templateResponse.status, 200);
    assert.deepEqual([...templateBody.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
    assert.match(template, /^﻿姓名（必填）,手机号（选填）,性别（选填）,出生日期（选填）,班级\/课程（必填）,入学日期（选填）,备注（选填）/);

    const commit = await fetch(`${baseUrl}/api/students/import/commit`, {
      method: 'POST',
      headers: jsonHeaders(cookie),
      body: JSON.stringify({
        generateAccounts: true,
        text: '姓名,手机号,性别,出生日期,班级/课程,入学日期,备注\nAlice,,女,2001-01-01,前端1班,2026-05-01,认真'
      })
    }).then((response) => response.json());

    assert.equal(commit.created.length, 1);
    assert.equal(commit.accounts.length, 1);
    assert.equal(commit.accounts[0].username, `student${commit.created[0].id}`);
    assert.equal(commit.accounts[0].studentId, commit.created[0].id);
    assert.ok(commit.accounts[0].initialPassword.length >= 8);
    const generatedStudents = app.listStudents({ accountStatus: 'generated' });
    const missingStudents = app.listStudents({ accountStatus: 'missing' });
    const accountExport = app.exportStudentAccounts();
    assert.equal(generatedStudents.total, 1);
    assert.equal(generatedStudents.items[0].accountUsername, commit.accounts[0].username);
    assert.equal(generatedStudents.items[0].password, undefined);
    assert.equal(generatedStudents.items[0].passwordHash, undefined);
    assert.equal(missingStudents.total, 0);
    assert.equal(accountExport.includes(commit.accounts[0].initialPassword), false);
    assert.equal(accountExport.includes('初始密码'), false);
    assert.equal(accountExport.includes('账号状态'), true);

    const students = await fetch(`${baseUrl}/api/students`, {
      headers: { cookie }
    }).then((response) => response.json());
    assert.equal(students.items[0].hasAccount, true);
    assert.equal(students.items[0].accountUsername, commit.accounts[0].username);

    const studentCookie = await loginAs(baseUrl, commit.accounts[0].username, commit.accounts[0].initialPassword);
    const workspace = await fetch(`${baseUrl}/api/student-workspace`, {
      headers: { cookie: studentCookie }
    }).then((response) => response.json());
    assert.equal(workspace.student.name, 'Alice');
  });
});

test('students can complete optional profile fields without changing identity or class', async () => {
  const app = createApp({
    db: createDatabase(),
    authAccounts: [
      { username: 'admin', password: 'admin123', role: 'admin' },
      { username: 'teacher', password: 'teacher123', role: 'teacher', teacherId: 1 },
      { username: 'student', password: 'student123', role: 'student', studentId: 1 }
    ]
  });
  const alice = app.createStudent({ name: 'Alice', className: '前端1班' });
  app.createStudent({ name: 'Bob', phone: '13800000002', className: '前端1班' });

  await withServer(app, async (baseUrl) => {
    const studentCookie = await loginAs(baseUrl, 'student', 'student123');
    const adminCookie = await loginAs(baseUrl);
    const teacherCookie = await loginAs(baseUrl, 'teacher', 'teacher123');

    const updated = await fetch(`${baseUrl}/api/student-workspace/profile`, {
      method: 'PATCH',
      headers: jsonHeaders(studentCookie),
      body: JSON.stringify({
        name: 'Bad Name',
        className: 'Bad Class',
        status: 'archived',
        phone: '13800000003',
        gender: '女',
        graduationDate: '2026-07-01',
        enrolledAt: '2026-05-01',
        remark: '自己补全'
      })
    }).then((response) => response.json());
    const duplicatePhone = await fetch(`${baseUrl}/api/student-workspace/profile`, {
      method: 'PATCH',
      headers: jsonHeaders(studentCookie),
      body: JSON.stringify({ phone: '13800000002' })
    });
    const adminForbidden = await fetch(`${baseUrl}/api/student-workspace/profile`, {
      method: 'PATCH',
      headers: jsonHeaders(adminCookie),
      body: JSON.stringify({ phone: '13800000004' })
    });
    const teacherForbidden = await fetch(`${baseUrl}/api/student-workspace/profile`, {
      method: 'PATCH',
      headers: jsonHeaders(teacherCookie),
      body: JSON.stringify({ phone: '13800000005' })
    });

    assert.equal(updated.student.id, alice.id);
    assert.equal(updated.student.name, 'Alice');
    assert.equal(updated.student.className, '前端1班');
    assert.equal(updated.student.status, 'active');
    assert.equal(updated.student.phone, '13800000003');
    assert.equal(updated.student.gender, '女');
    assert.equal(updated.student.graduationDate, '2026-07-01');
    assert.equal(updated.student.enrolledAt, '2026-05-01');
    assert.equal(updated.student.remark, '自己补全');
    assert.equal(duplicatePhone.status, 400);
    assert.equal(adminForbidden.status, 403);
    assert.equal(teacherForbidden.status, 403);
  });
});

test('student account generation skips existing accounts and exports account status', async () => {
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
    assert.ok(first.accounts[0].initialPassword.length >= 8);
    assert.equal(first.accounts[0].password, undefined);

    const second = await fetch(`${baseUrl}/api/students/accounts/generate`, {
      method: 'POST',
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ studentIds: [alice.id, bob.id] })
    }).then((response) => response.json());
    assert.equal(second.accounts.length, 1);
    assert.equal(second.accounts[0].studentId, bob.id);
    assert.equal(second.skippedCount, 1);
    assert.ok(second.accounts[0].initialPassword.length >= 8);

    const reset = await fetch(`${baseUrl}/api/students/accounts/reset`, {
      method: 'POST',
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ studentIds: [bob.id] })
    }).then((response) => response.json());
    assert.equal(reset.accounts.length, 1);
    assert.equal(reset.accounts[0].studentId, bob.id);
    assert.ok(reset.accounts[0].initialPassword.length >= 8);
    assert.notEqual(reset.accounts[0].initialPassword, second.accounts[0].initialPassword);

    await loginAs(baseUrl, reset.accounts[0].username, reset.accounts[0].initialPassword);

    const exportBody = await fetch(`${baseUrl}/api/export/student-accounts`, {
      headers: { cookie }
    }).then((response) => response.arrayBuffer());
    const exportBuffer = Buffer.from(exportBody);
    const exportCsv = exportBuffer.toString('utf8');
    assert.deepEqual([...exportBuffer.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
    assert.match(exportCsv, /学生姓名,班级\/课程,手机号,用户名,账号状态,创建时间/);
    assert.match(exportCsv, /Alice,前端1班,13800000001,13800000001,正常,/);
    assert.match(exportCsv, /Bob,前端1班,13800000002,13800000002,正常,/);
    assert.doesNotMatch(exportCsv, new RegExp(first.accounts[0].initialPassword));
    assert.doesNotMatch(exportCsv, new RegExp(reset.accounts[0].initialPassword));
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
    const teacherReset = await fetch(`${baseUrl}/api/students/accounts/reset`, {
      method: 'POST',
      headers: jsonHeaders(teacherCookie),
      body: JSON.stringify({ studentIds: [1] })
    });
    const studentExport = await fetch(`${baseUrl}/api/export/student-accounts`, {
      headers: { cookie: studentCookie }
    });

    assert.equal(teacherGenerate.status, 403);
    assert.equal(teacherReset.status, 403);
    assert.equal(studentExport.status, 403);
  });
});

test('teachers can reset and export passwords only for their managed class students', async () => {
  const app = createApp({
    db: createDatabase(),
    authAccounts: [
      { username: 'admin', password: 'admin123', role: 'admin' },
      { username: 'front-teacher', password: 'teacher123', role: 'teacher', teacherId: 1, classNames: ['Frontend'] },
      { username: 'java-teacher', password: 'teacher123', role: 'teacher', teacherId: 2, classNames: ['Java'] }
    ]
  });
  const alice = app.createStudent({ name: 'Alice', phone: '13800000001', className: 'Frontend' });
  const bob = app.createStudent({ name: 'Bob', phone: '13800000002', className: 'Java' });
  const generated = app.generateStudentAccounts({ studentIds: [alice.id, bob.id] });
  const aliceAccount = generated.accounts.find((account) => Number(account.studentId) === Number(alice.id));

  await withServer(app, async (baseUrl) => {
    const frontCookie = await loginAs(baseUrl, 'front-teacher', 'teacher123');
    const javaCookie = await loginAs(baseUrl, 'java-teacher', 'teacher123');
    const oldPasswordLogin = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: aliceAccount.username, password: aliceAccount.initialPassword })
    });
    const forbiddenClass = await fetch(`${baseUrl}/api/teacher/students/accounts/reset`, {
      method: 'POST',
      headers: jsonHeaders(javaCookie),
      body: JSON.stringify({ className: 'Frontend' })
    });
    const forbiddenStudent = await fetch(`${baseUrl}/api/teacher/students/accounts/reset`, {
      method: 'POST',
      headers: jsonHeaders(javaCookie),
      body: JSON.stringify({ studentIds: [alice.id] })
    });
    const reset = await fetch(`${baseUrl}/api/teacher/students/accounts/reset`, {
      method: 'POST',
      headers: jsonHeaders(frontCookie),
      body: JSON.stringify({ className: 'Frontend' })
    }).then(async (response) => ({ status: response.status, body: await response.json() }));
    const oldPasswordAfterReset = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: aliceAccount.username, password: aliceAccount.initialPassword })
    });
    const newCookie = await loginAs(baseUrl, reset.body.accounts[0].username, reset.body.accounts[0].initialPassword);

    assert.equal(oldPasswordLogin.status, 200);
    assert.equal(forbiddenClass.status, 403);
    assert.equal(forbiddenStudent.status, 403);
    assert.equal(reset.status, 200);
    assert.equal(reset.body.accounts.length, 1);
    assert.equal(reset.body.accounts[0].studentName, 'Alice');
    assert.equal(reset.body.accounts[0].className, 'Frontend');
    assert.ok(reset.body.accounts[0].initialPassword);
    assert.equal(oldPasswordAfterReset.status, 401);
    assert.match(newCookie, /session=/);
  });
});

test('students do not access scheduling overview and teachers can remove managed class students', async () => {
  const app = createApp({
    db: createDatabase(),
    authAccounts: [
      { username: 'admin', password: 'admin123', role: 'admin' },
      { username: 'front-teacher', password: 'teacher123', role: 'teacher', teacherId: 1, classNames: ['Frontend'] },
      { username: 'java-teacher', password: 'teacher123', role: 'teacher', teacherId: 2, classNames: ['Java'] }
    ]
  });
  const alice = app.createStudent({ name: 'Alice', phone: '13800000001', className: 'Frontend' });
  const charlie = app.createStudent({ name: 'Charlie', phone: '13800000003', className: 'Frontend' });
  const bob = app.createStudent({ name: 'Bob', phone: '13800000002', className: 'Java' });
  const existingAssignment = app.createHomeworkAssignment({
    homeworkName: 'Before Remove',
    className: 'Frontend'
  }, { role: 'teacher', classNames: ['Frontend'] });

  await withServer(app, async (baseUrl) => {
    const adminCookie = await loginAs(baseUrl);
    const frontTeacherCookie = await loginAs(baseUrl, 'front-teacher', 'teacher123');
    const javaTeacherCookie = await loginAs(baseUrl, 'java-teacher', 'teacher123');
    const generated = await fetch(`${baseUrl}/api/students/accounts/generate`, {
      method: 'POST',
      headers: jsonHeaders(adminCookie),
      body: JSON.stringify({ studentIds: [alice.id] })
    }).then((response) => response.json());
    const aliceCookie = await loginAs(baseUrl, generated.accounts[0].username, generated.accounts[0].initialPassword);

    const studentTimeline = await fetch(`${baseUrl}/api/schedules/timeline?weekStart=2026-05-18`, {
      headers: { cookie: aliceCookie }
    });
    const frontStudents = await fetch(`${baseUrl}/api/students?className=Frontend`, {
      headers: { cookie: frontTeacherCookie }
    }).then(async (response) => ({ status: response.status, body: await response.json() }));
    const forbiddenClass = await fetch(`${baseUrl}/api/students?className=Java`, {
      headers: { cookie: frontTeacherCookie }
    });
    const forbiddenRemove = await fetch(`${baseUrl}/api/teacher/students/${bob.id}/remove-from-class`, {
      method: 'POST',
      headers: { cookie: frontTeacherCookie }
    });
    const ownRemove = await fetch(`${baseUrl}/api/teacher/students/${alice.id}/remove-from-class`, {
      method: 'POST',
      headers: { cookie: frontTeacherCookie }
    }).then(async (response) => ({ status: response.status, body: await response.json() }));
    const secondRemove = await fetch(`${baseUrl}/api/teacher/students/${charlie.id}/remove-from-class`, {
      method: 'POST',
      headers: { cookie: javaTeacherCookie }
    });
    const remainingFrontStudents = await fetch(`${baseUrl}/api/students?className=Frontend`, {
      headers: { cookie: frontTeacherCookie }
    }).then(async (response) => ({ status: response.status, body: await response.json() }));
    const disabledLogin = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: generated.accounts[0].username, password: generated.accounts[0].initialPassword })
    });
    const afterRemoveAssignment = app.createHomeworkAssignment({
      homeworkName: 'After Remove',
      className: 'Frontend'
    }, { role: 'teacher', classNames: ['Frontend'] });

    assert.equal(studentTimeline.status, 403);
    assert.equal(frontStudents.status, 200);
    assert.deepEqual(frontStudents.body.items.map((student) => student.name).sort(), ['Alice', 'Charlie']);
    assert.equal(forbiddenClass.status, 403);
    assert.equal(forbiddenRemove.status, 403);
    assert.equal(ownRemove.status, 200);
    assert.equal(ownRemove.body.accountDisabled, true);
    assert.equal(ownRemove.body.student.status, 'archived');
    assert.equal(secondRemove.status, 403);
    assert.equal(remainingFrontStudents.status, 200);
    assert.deepEqual(remainingFrontStudents.body.items.map((student) => student.name), ['Charlie']);
    assert.equal(disabledLogin.status, 401);
    assert.equal(app.listHomeworkRecords({ assignmentId: existingAssignment.assignment.id, studentId: alice.id }).total, 0);
    assert.equal(app.listHomeworkRecords({ assignmentId: existingAssignment.assignment.id, studentId: alice.id, includeArchivedStudents: true }).total, 1);
    assert.equal(afterRemoveAssignment.records.some((record) => record.studentId === alice.id), false);
  });
});

test('admin can create update and disable teacher accounts and disable student accounts', async () => {
  const app = createApp({
    db: createDatabase(),
    authAccounts: [
      { username: 'admin', password: 'admin123', role: 'admin' },
      { username: 'teacher-config', password: 'teacher123', role: 'teacher', teacherId: 1, teacherName: 'Config Teacher' }
    ]
  });
  app.createClass({ className: 'Frontend' });
  const alice = app.createStudent({ name: 'Alice', phone: '13800000001', className: 'Frontend' });

  await withServer(app, async (baseUrl) => {
    const adminCookie = await loginAs(baseUrl);
    const generated = await fetch(`${baseUrl}/api/students/accounts/generate`, {
      method: 'POST',
      headers: jsonHeaders(adminCookie),
      body: JSON.stringify({ studentIds: [alice.id] })
    }).then((response) => response.json());

    const created = await fetch(`${baseUrl}/api/admin/teacher-accounts`, {
      method: 'POST',
      headers: jsonHeaders(adminCookie),
      body: JSON.stringify({
        username: 'teacher-new',
        teacherName: 'New Teacher',
        classNames: ['Frontend'],
        participatesInScheduling: true
      })
    }).then((response) => response.json());
    await loginAs(baseUrl, 'teacher-new', created.account.initialPassword);

    const patched = await fetch(`${baseUrl}/api/admin/teacher-accounts/${encodeURIComponent(created.account.accountKey)}`, {
      method: 'PATCH',
      headers: jsonHeaders(adminCookie),
      body: JSON.stringify({
        teacherName: 'Updated Teacher',
        classNames: [],
        participatesInScheduling: false
      })
    }).then((response) => response.json());
    const teacherAccounts = await fetch(`${baseUrl}/api/admin/teacher-accounts`, {
      headers: { cookie: adminCookie }
    }).then((response) => response.json());

    const configTeacher = teacherAccounts.items.find((account) => account.username === 'teacher-config');
    const disabledConfig = await fetch(`${baseUrl}/api/admin/teacher-accounts/${encodeURIComponent(configTeacher.accountKey)}`, {
      method: 'DELETE',
      headers: { cookie: adminCookie }
    });
    const disabledStudent = await fetch(`${baseUrl}/api/students/${alice.id}/account`, {
      method: 'DELETE',
      headers: { cookie: adminCookie }
    });
    const configLogin = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'teacher-config', password: 'teacher123' })
    });
    const studentLogin = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: generated.accounts[0].username, password: generated.accounts[0].initialPassword })
    });

    assert.equal(created.account.username, 'teacher-new');
    assert.ok(created.account.initialPassword.length >= 8);
    assert.equal(patched.account.teacherName, 'Updated Teacher');
    assert.equal(patched.account.participatesInScheduling, false);
    assert.equal(disabledConfig.status, 200);
    assert.equal(disabledStudent.status, 200);
    assert.equal(configLogin.status, 401);
    assert.equal(studentLogin.status, 401);
    assert.equal(app.listStudents({ keyword: 'Alice' }).total, 1);
  });
});

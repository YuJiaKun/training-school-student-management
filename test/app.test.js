const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase } = require('../src/db');
const { createApp } = require('../src/app');

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

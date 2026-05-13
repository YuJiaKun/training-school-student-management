const fs = require('node:fs');
const path = require('node:path');

const CURRENT_SCHEMA_VERSION = 1;

function createDatabase(options = {}) {
  const filePath = options.filePath || null;
  const state = loadState(filePath);

  return {
    filePath,
    schemaVersion: state.schemaVersion,
    students: state.students,
    homeworkRecords: state.homeworkRecords,
    interviewRecords: state.interviewRecords,
    interviewSchedules: state.interviewSchedules,
    nextStudentId: state.nextStudentId,
    nextHomeworkId: state.nextHomeworkId,
    nextInterviewId: state.nextInterviewId,
    nextInterviewScheduleId: state.nextInterviewScheduleId,
    save() {
      if (!filePath) return;
      const payload = JSON.stringify({
        schemaVersion: CURRENT_SCHEMA_VERSION,
        students: this.students,
        homeworkRecords: this.homeworkRecords,
        interviewRecords: this.interviewRecords,
        interviewSchedules: this.interviewSchedules,
        nextStudentId: this.nextStudentId,
        nextHomeworkId: this.nextHomeworkId,
        nextInterviewId: this.nextInterviewId,
        nextInterviewScheduleId: this.nextInterviewScheduleId
      }, null, 2);
      const tmpPath = `${filePath}.tmp`;
      const backupPath = `${filePath}.bak`;

      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      if (fs.existsSync(filePath)) {
        fs.copyFileSync(filePath, backupPath);
      }
      fs.writeFileSync(tmpPath, payload);
      fs.renameSync(tmpPath, filePath);
    }
  };
}

function loadState(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return createEmptyState();
  }

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`database file is not valid JSON: ${filePath}`);
  }

  return normalizeState(raw);
}

function createEmptyState() {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    students: [],
    homeworkRecords: [],
    interviewRecords: [],
    interviewSchedules: [],
    nextStudentId: 1,
    nextHomeworkId: 1,
    nextInterviewId: 1,
    nextInterviewScheduleId: 1
  };
}

function normalizeState(raw) {
  const students = normalizeStudents(raw.students || []);
  const homeworkRecords = normalizeRecords(raw.homeworkRecords || [], 'studentId');
  const interviewRecords = normalizeRecords(raw.interviewRecords || [], 'studentId');
  const interviewSchedules = normalizeRecords(raw.interviewSchedules || [], 'studentId');

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    students,
    homeworkRecords,
    interviewRecords,
    interviewSchedules,
    nextStudentId: nextId(raw.nextStudentId, students),
    nextHomeworkId: nextId(raw.nextHomeworkId, homeworkRecords),
    nextInterviewId: nextId(raw.nextInterviewId, interviewRecords),
    nextInterviewScheduleId: nextId(raw.nextInterviewScheduleId, interviewSchedules)
  };
}

function normalizeStudents(students) {
  return students.map((student) => ({
    id: Number(student.id),
    name: student.name || '',
    phone: student.phone || '',
    gender: student.gender || '',
    birthday: student.birthday || '',
    className: student.className || '',
    enrolledAt: student.enrolledAt || '',
    status: student.status || 'active',
    archivedAt: student.archivedAt || null,
    remark: student.remark || ''
  })).filter((student) => Number.isInteger(student.id) && student.id > 0);
}

function normalizeRecords(records, numericKey) {
  return records.map((record) => ({
    ...record,
    id: Number(record.id),
    [numericKey]: Number(record[numericKey])
  })).filter((record) => Number.isInteger(record.id) && record.id > 0);
}

function nextId(rawNextId, records) {
  const configured = Number(rawNextId);
  const maxExisting = records.reduce((max, record) => Math.max(max, Number(record.id) || 0), 0) + 1;
  if (Number.isInteger(configured) && configured > 0) {
    return Math.max(configured, maxExisting);
  }
  return maxExisting;
}

module.exports = { createDatabase, CURRENT_SCHEMA_VERSION };

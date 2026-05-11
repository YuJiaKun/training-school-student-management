const fs = require('node:fs');
const path = require('node:path');

function createDatabase(options = {}) {
  const filePath = options.filePath || null;
  const state = loadState(filePath);

  return {
    filePath,
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
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify({
        students: this.students,
        homeworkRecords: this.homeworkRecords,
        interviewRecords: this.interviewRecords,
        interviewSchedules: this.interviewSchedules,
        nextStudentId: this.nextStudentId,
        nextHomeworkId: this.nextHomeworkId,
        nextInterviewId: this.nextInterviewId,
        nextInterviewScheduleId: this.nextInterviewScheduleId
      }, null, 2));
    }
  };
}

function loadState(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return {
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

  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return {
    students: raw.students || [],
    homeworkRecords: raw.homeworkRecords || [],
    interviewRecords: raw.interviewRecords || [],
    interviewSchedules: raw.interviewSchedules || [],
    nextStudentId: raw.nextStudentId || 1,
    nextHomeworkId: raw.nextHomeworkId || 1,
    nextInterviewId: raw.nextInterviewId || 1,
    nextInterviewScheduleId: raw.nextInterviewScheduleId || 1
  };
}

module.exports = { createDatabase };

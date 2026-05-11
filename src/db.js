function createDatabase() {
  return {
    students: [],
    homeworkRecords: [],
    interviewRecords: [],
    nextStudentId: 1,
    nextHomeworkId: 1,
    nextInterviewId: 1
  };
}

module.exports = { createDatabase };

function toCsv(rows) {
  return rows.map((row) => row.map(csvCell).join(',')).join('\n');
}

function toCsvWithBom(rows) {
  return `\ufeff${toCsv(rows)}`;
}

function csvCell(value) {
  const text = String(value ?? '');
  if (/[",\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

module.exports = {
  toCsv,
  toCsvWithBom
};

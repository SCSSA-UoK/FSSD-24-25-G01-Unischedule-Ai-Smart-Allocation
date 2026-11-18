const { z } = require('zod');
const { AllocationInputError, parseSession, parseRoom } = require('../validation/allocation-input');

const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const clockTime = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function invalid(message, field) {
  throw new AllocationInputError(422, 'INVALID_REFERENCE_DATA', message, [{ field, message }]);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// The source weekday needs an explicit fictional date and requirements from the caller.
function normalizeTimetableRow(row, options = {}) {
  if (!isRecord(row) || !isRecord(options)) {
    invalid('A timetable row and explicit mapping options are required.', 'row');
  }

  const date = z.iso.date().safeParse(options.date);
  if (!date.success) {
    invalid('A valid dated YYYY-MM-DD value is required.', 'date');
  }
  const expectedDay = weekdays[new Date(`${date.data}T00:00:00Z`).getUTCDay()];
  if (typeof row.day !== 'string' || row.day.toLowerCase() !== expectedDay.toLowerCase()) {
    invalid('The explicit date must match the source weekday.', 'day');
  }

  if (typeof row.registered_count !== 'string' || !/^\d+$/.test(row.registered_count)) {
    invalid('The registered count must be a string containing only digits.', 'registered_count');
  }
  for (const field of ['start_time', 'end_time']) {
    if (typeof row[field] !== 'string' || !clockTime.test(row[field])) {
      invalid('Source times must use the 24-hour HH:mm format.', field);
    }
  }

  return parseSession({
    sessionId: row.session_id,
    lecturerId: row.lecturer_code,
    studentGroupId: row.student_group,
    roomId: row.room_code === '' ? null : row.room_code,
    registeredStudents: Number(row.registered_count),
    requiredFacilities: options.requiredFacilities,
    requiredWorkingComputers: options.requiredWorkingComputers,
    startAt: `${date.data}T${row.start_time}:00+05:30`,
    endAt: `${date.data}T${row.end_time}:00+05:30`,
  });
}

function normalizeFacilitiesRoom(room) {
  if (!isRecord(room)) {
    invalid('A room metadata object is required.', 'room');
  }

  let usableComputers = room.usableComputers;
  // Computer-equipped rooms need an explicit working count.
  if (usableComputers === undefined && Array.isArray(room.features) && !room.features.includes('computers')) {
    usableComputers = 0;
  }

  return parseRoom({
    roomId: room.roomId,
    seats: room.seats,
    features: room.features,
    usableComputers,
    building: room.building,
  });
}

module.exports = { normalizeTimetableRow, normalizeFacilitiesRoom };

const {
  parseId, parseRoom, parseSession, parseSessions, parseRestrictions,
} = require('../validation/allocation-input');
const { intervalsOverlap } = require('./interval-overlap');

function checkRoomSuitability(rawRoom, rawSession, rawRestrictions = []) {
  const room = parseRoom(rawRoom);
  const session = parseSession(rawSession);
  const restrictions = parseRestrictions(rawRestrictions)
    .filter((restriction) => restriction.roomId === room.roomId && intervalsOverlap(restriction, session))
    .sort((first, second) => first.restrictionId < second.restrictionId ? -1 : 1);
  const availableFacilities = new Set(room.features);
  let effectiveUsableComputers = room.usableComputers;
  const reasons = [];

  if (room.seats < session.registeredStudents) {
    reasons.push({
      code: 'CAPACITY_EXCEEDED',
      message: `Room has ${room.seats} seats; ${session.registeredStudents} are required.`,
    });
  }

  for (const restriction of restrictions) {
    if (restriction.kind === 'closure') {
      reasons.push({
        code: 'ROOM_CLOSED',
        message: `Room is closed during the session (${restriction.restrictionId}): ${restriction.reason}`,
      });
    }
    for (const facility of restriction.unavailableFacilities) {
      availableFacilities.delete(facility);
      if (facility === 'computers') effectiveUsableComputers = 0;
    }
    if (restriction.usableComputers !== null) {
      // Counts are caps, not faults to subtract again from the room snapshot.
      effectiveUsableComputers = Math.min(effectiveUsableComputers, restriction.usableComputers);
    }
  }

  const missingFacilities = session.requiredFacilities
    .filter((facility) => !availableFacilities.has(facility)).sort();
  for (const facility of missingFacilities) {
    reasons.push({ code: 'MISSING_FACILITY', message: `Required facility "${facility}" is unavailable.` });
  }
  if (effectiveUsableComputers < session.requiredWorkingComputers) {
    reasons.push({
      code: 'INSUFFICIENT_COMPUTERS',
      message: `Room has ${effectiveUsableComputers} working computers during the session; ${session.requiredWorkingComputers} are required.`,
    });
  }

  return {
    roomId: room.roomId,
    suitable: reasons.length === 0,
    effectiveUsableComputers,
    missingFacilities,
    activeRestrictionIds: restrictions.map((restriction) => restriction.restrictionId),
    reasons,
  };
}

function findRoomConflicts(rawRoomId, rawSession, rawSessions = []) {
  const roomId = parseId(rawRoomId);
  const session = parseSession(rawSession);
  return parseSessions(rawSessions)
    .filter((booking) => booking.sessionId !== session.sessionId
      && booking.roomId === roomId && intervalsOverlap(booking, session))
    .map((booking) => booking.sessionId).sort();
}

function evaluateRoomChecks(room, session, { sessions = [], restrictions = [] } = {}) {
  const physical = checkRoomSuitability(room, session, restrictions);
  const blockingSessionIds = findRoomConflicts(physical.roomId, session, sessions);
  const available = blockingSessionIds.length === 0;
  const reasons = [...physical.reasons];
  if (!available) {
    reasons.push({ code: 'ROOM_OCCUPIED', message: 'Room has overlapping session bookings.' });
  }
  return {
    ...physical,
    available,
    eligible: physical.suitable && available,
    blockingSessionIds,
    reasons,
  };
}

module.exports = { checkRoomSuitability, findRoomConflicts, evaluateRoomChecks };

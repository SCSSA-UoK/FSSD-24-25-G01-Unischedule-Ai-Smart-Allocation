const {
  AllocationInputError,
  parseCandidateRequest,
  parsePlatformSnapshot,
  parseFacilitiesSnapshot,
} = require('../validation/allocation-input');

async function prepareAllocationInput(rawRequest, { platformClient, facilitiesClient }) {
  const request = parseCandidateRequest(rawRequest);
  const [platformData, facilitiesData] = await Promise.all([
    platformClient.getScenarioSnapshot(request.scenarioId),
    facilitiesClient.getRoomSnapshot(),
  ]);
  const platform = parsePlatformSnapshot(platformData);
  const facilities = parseFacilitiesSnapshot(facilitiesData);

  if (request.scenarioId !== platform.scenarioId) {
    throw new AllocationInputError(404, 'SCENARIO_NOT_FOUND', 'The snapshot belongs to another scenario.');
  }
  if (request.scenarioRevision !== platform.scenarioRevision) {
    throw new AllocationInputError(409, 'STALE_SCENARIO', 'Reload the scenario revision before preparing inputs.');
  }

  const rooms = new Set(facilities.rooms.map((room) => room.roomId));
  for (const session of platform.sessions) {
    if (session.roomId !== null && !rooms.has(session.roomId)) {
      throw new AllocationInputError(422, 'INVALID_SNAPSHOT', 'A session references an unknown room.');
    }
  }
  for (const restriction of facilities.restrictions) {
    if (!rooms.has(restriction.roomId)) {
      throw new AllocationInputError(422, 'INVALID_SNAPSHOT', 'A restriction references an unknown room.');
    }
  }

  const affectedSession = platform.sessions.find((session) => session.sessionId === request.affectedSessionId);
  if (!affectedSession) {
    throw new AllocationInputError(404, 'SESSION_NOT_FOUND', 'Affected session is not present in the scenario.');
  }
  if (request.searchWindow && (
    Date.parse(request.searchWindow.startAt) > Date.parse(affectedSession.startAt)
    || Date.parse(request.searchWindow.endAt) < Date.parse(affectedSession.endAt)
  )) {
    throw new AllocationInputError(422, 'INVALID_REQUIREMENTS', 'Search window must contain the affected session interval.');
  }

  // This prepares data only; it does not search, validate a proposal or change bookings.
  return {
    mode: 'fixture',
    validationStatus: 'pending',
    request,
    snapshot: {
      scenarioId: platform.scenarioId,
      scenarioRevision: platform.scenarioRevision,
      facilitiesVersion: facilities.facilitiesVersion,
      timezone: platform.timezone,
      constraints: platform.constraints,
      sessions: platform.sessions,
      rooms: facilities.rooms,
      restrictions: facilities.restrictions,
    },
    affectedSession: structuredClone(affectedSession),
  };
}

module.exports = { prepareAllocationInput };

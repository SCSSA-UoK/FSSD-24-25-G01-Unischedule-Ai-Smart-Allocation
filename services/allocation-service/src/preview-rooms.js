const { loadFixture, createFixtureClients } = require('./clients/fixture-clients');
const { inspectRoomOptions } = require('./services/inspect-room-options');

async function previewRooms(name = 'single-relocation') {
  const fixture = loadFixture(name);
  return inspectRoomOptions(fixture.request, createFixtureClients({ fixture }));
}

if (require.main === module) {
  previewRooms(process.argv[2]).then(
    (report) => console.log(JSON.stringify(report, null, 2)),
    (error) => {
      console.error(`${error.code || 'ROOM_INSPECTION_FAILED'}: ${error.message}`);
      process.exitCode = 1;
    },
  );
}

module.exports = { previewRooms };

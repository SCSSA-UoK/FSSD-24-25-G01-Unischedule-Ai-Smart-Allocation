const { loadFixture, createFixtureClients } = require('./clients/fixture-clients');
const { prepareAllocationInput } = require('./services/prepare-allocation-input');

async function previewInput(name = 'single-relocation') {
  const fixture = loadFixture(name);
  return prepareAllocationInput(fixture.request, createFixtureClients({ fixture }));
}

if (require.main === module) {
  previewInput(process.argv[2]).then(
    (input) => console.log(JSON.stringify(input, null, 2)),
    (error) => {
      console.error(`${error.code || 'INPUT_PREPARATION_FAILED'}: ${error.message}`);
      process.exitCode = 1;
    },
  );
}

module.exports = { previewInput };

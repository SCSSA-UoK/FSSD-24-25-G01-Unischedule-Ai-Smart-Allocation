const express = require('express');
const {
  handleCreateDisruption,
  handleGetDisruption,
  handleListDisruptions
} = require('../controllers/disruptions');

const disruptionsRouter = express.Router();

disruptionsRouter.post('/operations/disruptions', handleCreateDisruption);
disruptionsRouter.get('/operations/disruptions', handleListDisruptions);
disruptionsRouter.get('/operations/disruptions/:disruptionId', handleGetDisruption);

module.exports = { disruptionsRouter };

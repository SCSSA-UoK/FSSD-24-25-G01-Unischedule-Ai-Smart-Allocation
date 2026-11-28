const express = require('express');
const {
  handleStartInvestigation,
  handleGetRecommendations
} = require('../controllers/investigations');

const investigationsRouter = express.Router();

investigationsRouter.post('/operations/cases/:caseId/investigations', handleStartInvestigation);
investigationsRouter.get('/operations/cases/:caseId/recommendations', handleGetRecommendations);

module.exports = { investigationsRouter };

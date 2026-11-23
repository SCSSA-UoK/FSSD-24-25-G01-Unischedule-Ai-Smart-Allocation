const express = require('express');
const {
  handleListRecoveryCases,
  handleGetRecoveryCase,
  handleUpdateCasePriority,
  handleSyncCaseConstraints
} = require('../controllers/recovery-cases');

const recoveryCasesRouter = express.Router();

recoveryCasesRouter.get('/operations/recovery-cases', handleListRecoveryCases);
recoveryCasesRouter.get('/operations/cases/:caseId', handleGetRecoveryCase);
recoveryCasesRouter.patch('/operations/cases/:caseId/priority', handleUpdateCasePriority);
recoveryCasesRouter.post('/operations/cases/:caseId/sync-constraints', handleSyncCaseConstraints);

module.exports = { recoveryCasesRouter };

// backend/src/modules/communication/communication.routes.ts
import { Router } from 'express';
import { communicationController } from './communication.controller.js';

export const communicationRoutes = Router();

// Templates
communicationRoutes.get('/templates', communicationController.getTemplates);
communicationRoutes.get('/templates/:id', communicationController.getTemplateById);
communicationRoutes.post('/templates', communicationController.createTemplate);
communicationRoutes.patch('/templates/:id', communicationController.updateTemplate);
communicationRoutes.delete('/templates/:id', communicationController.deactivateTemplate);

// Dispatch
communicationRoutes.post('/dispatch/send', communicationController.sendMessage);
communicationRoutes.post('/dispatch/bulk', communicationController.bulkSend);
communicationRoutes.post('/dispatch/:id/retry', communicationController.retryDispatch);
communicationRoutes.get('/dispatch/logs', communicationController.getDispatchLogs);
communicationRoutes.get('/dispatch/stats', communicationController.getDispatchStats);

// Preferences
communicationRoutes.get('/preferences/:employeeId', communicationController.getPreferences);
communicationRoutes.put('/preferences/:employeeId', communicationController.updatePreferences);

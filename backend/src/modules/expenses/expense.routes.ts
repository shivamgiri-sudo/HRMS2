import { Router } from 'express';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import { expenseController } from './expense.controller.js';

export const expenseRouter = Router();
expenseRouter.use(requireAuth);

const h = (fn: any) => (req: any, res: any, next: any) => fn(req, res).catch(next);

expenseRouter.get('/categories', h(expenseController.listCategories.bind(expenseController)));
expenseRouter.post('/categories', requireRole('admin', 'hr'), h(expenseController.createCategory.bind(expenseController)));
expenseRouter.put('/categories/:id', requireRole('admin', 'hr'), h(expenseController.updateCategory.bind(expenseController)));
expenseRouter.delete('/categories/:id', requireRole('admin', 'hr'), h(expenseController.deleteCategory.bind(expenseController)));

expenseRouter.get('/claims/my-claims', h(expenseController.getMyClaims.bind(expenseController)));
expenseRouter.get('/claims/pending-approval', requireRole('manager'), h(expenseController.getPendingApprovals.bind(expenseController)));
expenseRouter.get('/claims/finance-queue', requireRole('finance', 'admin'), h(expenseController.getFinanceQueue.bind(expenseController)));
expenseRouter.get('/claims/export-for-payment', requireRole('finance', 'admin'), h(expenseController.exportForPayment.bind(expenseController)));
expenseRouter.get('/claims/:claimId', h(expenseController.getClaimDetails.bind(expenseController)));

expenseRouter.post('/claims', h(expenseController.createClaim.bind(expenseController)));
expenseRouter.post('/claims/:claimId/items', h(expenseController.addClaimItem.bind(expenseController)));
expenseRouter.delete('/claims/items/:itemId', h(expenseController.deleteClaimItem.bind(expenseController)));
expenseRouter.post('/claims/:claimId/items/:itemId/receipt', h(expenseController.uploadReceipt.bind(expenseController)));
expenseRouter.post('/claims/:claimId/submit', h(expenseController.submitClaim.bind(expenseController)));
expenseRouter.post('/claims/:claimId/manager-approve', requireRole('manager'), h(expenseController.managerApprove.bind(expenseController)));
expenseRouter.post('/claims/:claimId/reject', requireRole('manager', 'finance'), h(expenseController.rejectClaim.bind(expenseController)));
expenseRouter.post('/claims/:claimId/finance-approve', requireRole('finance', 'admin'), h(expenseController.financeApprove.bind(expenseController)));
expenseRouter.post('/claims/:claimId/mark-paid', requireRole('finance', 'admin'), h(expenseController.markAsPaid.bind(expenseController)));

expenseRouter.get('/reports/summary', requireRole('finance', 'admin'), h(expenseController.getExpenseSummary.bind(expenseController)));
expenseRouter.get('/reports/monthly-trends', requireRole('finance', 'admin'), h(expenseController.getMonthlyTrends.bind(expenseController)));
expenseRouter.get('/reports/top-spenders', requireRole('finance', 'admin'), h(expenseController.getTopSpenders.bind(expenseController)));

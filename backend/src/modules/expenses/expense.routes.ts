import { Router } from 'express';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import { expenseController } from './expense.controller.js';
import { expenseService } from './expense.service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RECEIPTS_DIR = path.resolve(__dirname, '../../../../uploads/expense-receipts');
fs.mkdirSync(RECEIPTS_DIR, { recursive: true });

const ALLOWED_TYPES = new Map([
  ['image/jpeg', '.jpg'], ['image/png', '.png'], ['image/webp', '.webp'],
  ['image/gif', '.gif'], ['application/pdf', '.pdf'],
]);

const receiptUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, RECEIPTS_DIR),
    filename: (_req, file, cb) => {
      const ext = ALLOWED_TYPES.get(file.mimetype) ?? path.extname(file.originalname).toLowerCase() ?? '.bin';
      cb(null, `${randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_TYPES.has(file.mimetype)) return cb(null, true);
    return cb(new Error('Only images and PDFs are allowed'));
  },
});

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
expenseRouter.delete('/claims/:claimId/items/:itemId', h(expenseController.deleteClaimItem.bind(expenseController)));
expenseRouter.post('/claims/:claimId/items/:itemId/receipt', h(expenseController.uploadReceipt.bind(expenseController)));
expenseRouter.post('/claims/:claimId/items/:itemId/receipt-upload', (req: any, res: any, next: any) => {
  receiptUpload.single('receipt')(req, res, (err: any) => {
    if (err instanceof multer.MulterError) return res.status(400).json({ error: err.message });
    if (err) return res.status(400).json({ error: err.message });
    return next();
  });
}, h(async (req: any, res: any) => {
  if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return; }
  const claimId = parseInt(req.params.claimId, 10);
  const itemId = parseInt(req.params.itemId, 10);
  if (isNaN(claimId) || isNaN(itemId)) { res.status(400).json({ error: 'Invalid ID' }); return; }
  const receiptPath = `/api/files/expense-receipts/${req.file.filename}`;
  await expenseService.updateItemReceipt(itemId, receiptPath);
  res.json({ receipt_path: receiptPath });
}));
expenseRouter.post('/claims/:claimId/submit', h(expenseController.submitClaim.bind(expenseController)));
expenseRouter.post('/claims/:claimId/manager-approve', requireRole('manager'), h(expenseController.managerApprove.bind(expenseController)));
expenseRouter.post('/claims/:claimId/reject', requireRole('manager', 'finance'), h(expenseController.rejectClaim.bind(expenseController)));
expenseRouter.post('/claims/:claimId/finance-approve', requireRole('finance', 'admin'), h(expenseController.financeApprove.bind(expenseController)));
expenseRouter.post('/claims/:claimId/mark-paid', requireRole('finance', 'admin'), h(expenseController.markAsPaid.bind(expenseController)));

expenseRouter.get('/reports/summary', requireRole('finance', 'admin'), h(expenseController.getExpenseSummary.bind(expenseController)));
expenseRouter.get('/reports/monthly-trends', requireRole('finance', 'admin'), h(expenseController.getMonthlyTrends.bind(expenseController)));
expenseRouter.get('/reports/top-spenders', requireRole('finance', 'admin'), h(expenseController.getTopSpenders.bind(expenseController)));

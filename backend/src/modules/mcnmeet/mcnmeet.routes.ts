import { Router, Response, NextFunction } from "express";
import { env } from "../../config/env.js";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import {
  createMeetingSchema, updateMeetingSchema, cancelMeetingSchema,
  attendanceUpdateSchema, recordingUpdateSchema,
} from "./mcnmeet.validation.js";
import * as service from "./mcnmeet.service.js";
import type { MeetingStatus, MeetingType } from "./mcnmeet.types.js";

const router = Router();

const ADMIN_ROLES = ['super_admin', 'admin', 'hr_admin', 'hr'];
const MANAGER_ROLES = [...ADMIN_ROLES, 'manager', 'process_manager', 'branch_head', 'trainer', 'coordinator', 'wfm', 'tl', 'team_leader'];

// Meeting type -> allowed creator roles
const MEETING_TYPE_PERMISSIONS: Record<MeetingType, string[]> = {
  team_meeting: ['super_admin', 'admin', 'hr_admin', 'hr', 'manager', 'process_manager', 'branch_head', 'tl', 'team_leader', 'coordinator'],
  live_broadcast: ['super_admin', 'admin', 'hr_admin', 'branch_head'],
  training_induction: ['super_admin', 'admin', 'hr_admin', 'hr', 'trainer', 'coordinator'],
  interview: ['super_admin', 'admin', 'hr_admin', 'hr', 'recruiter', 'recruitment_hr', 'manager', 'process_manager'],
  coaching_1on1: ['super_admin', 'admin', 'hr_admin', 'hr', 'manager', 'process_manager', 'tl', 'team_leader'],
  compliance_policy: ['super_admin', 'admin', 'hr_admin', 'compliance'],
};

function canCreateMeetingType(role: string | undefined, meetingType: MeetingType): boolean {
  if (!role) return false;
  const allowedRoles = MEETING_TYPE_PERMISSIONS[meetingType] ?? [];
  return allowedRoles.includes(role);
}

function getAllowedMeetingTypes(role: string | undefined): MeetingType[] {
  if (!role) return [];
  return (Object.keys(MEETING_TYPE_PERMISSIONS) as MeetingType[]).filter(
    type => MEETING_TYPE_PERMISSIONS[type].includes(role)
  );
}

function featureGuard(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!env.MCNMEET_ENABLED) {
    return res.status(404).json({ success: false, message: 'MCNmeet module is disabled' });
  }
  next();
}

router.use(featureGuard);
router.use(requireAuth);

router.get('/config', (req: AuthenticatedRequest, res: Response) => {
  const role = req.authUser?.role;
  const allowedTypes = getAllowedMeetingTypes(role);

  res.json({
    success: true,
    enabled: env.MCNMEET_ENABLED,
    base_url: env.MCNMEET_BASE_URL,
    google_backup_enabled: env.MCNMEET_GOOGLE_BACKUP_ENABLED,
    google_auto_create: env.MCNMEET_GOOGLE_AUTO_CREATE_ENABLED,
    can_create: allowedTypes.length > 0,
    allowed_meeting_types: allowedTypes,
  });
});

router.get('/preview-room', (req, res) => {
  const roomName = service.generateRoomName('team_meeting', new Date().toISOString());
  const joinUrl = service.buildJoinUrl(roomName);
  res.json({ success: true, roomName, joinUrl });
});

router.get('/meetings', requireRole(...MANAGER_ROLES), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { status, type, from, to, page } = req.query;
    const result = await service.listMeetings({
      status: status as MeetingStatus | undefined,
      type: type as MeetingType | undefined,
      from: from as string | undefined,
      to: to as string | undefined,
      page: page ? parseInt(page as string) : undefined,
    });
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
});

router.post('/meetings', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = createMeetingSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, errors: parsed.error.flatten().fieldErrors });
    }

    // Check type-specific permission
    const role = req.authUser?.role;
    if (!canCreateMeetingType(role, parsed.data.meeting_type)) {
      return res.status(403).json({
        success: false,
        message: `Your role (${role}) cannot create meetings of type '${parsed.data.meeting_type}'`,
      });
    }

    const id = await service.createMeeting(parsed.data, req.authUser!.id);
    res.status(201).json({ success: true, id });
  } catch (err) { next(err); }
});

router.get('/meetings/:id', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const meeting = await service.getMeetingWithDetails(req.params.id);
    if (!meeting) {
      return res.status(404).json({ success: false, message: 'Meeting not found' });
    }
    res.json({ success: true, meeting });
  } catch (err) { next(err); }
});

router.patch('/meetings/:id', requireRole(...MANAGER_ROLES), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = updateMeetingSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, errors: parsed.error.flatten().fieldErrors });
    }
    const updated = await service.updateMeeting(req.params.id, parsed.data, req.authUser!.id);
    res.json({ success: true, updated });
  } catch (err) { next(err); }
});

router.post('/meetings/:id/cancel', requireRole(...MANAGER_ROLES), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = cancelMeetingSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, errors: parsed.error.flatten().fieldErrors });
    }
    const cancelled = await service.cancelMeeting(req.params.id, parsed.data.cancel_reason, req.authUser!.id);
    res.json({ success: true, cancelled });
  } catch (err) { next(err); }
});

router.post('/meetings/:id/invitees/resolve', requireRole(...MANAGER_ROLES), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const inviteesAdded = await service.resolveInvitees(req.params.id, req.authUser!.id);
    res.json({ success: true, invitees_added: inviteesAdded });
  } catch (err) { next(err); }
});

router.post('/meetings/:id/attendance', requireRole(...MANAGER_ROLES), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = attendanceUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, errors: parsed.error.flatten().fieldErrors });
    }
    const updated = await service.updateAttendance(
      req.params.id,
      parsed.data.invitee_id,
      parsed.data.joined_status,
      parsed.data.remarks,
      req.authUser!.id
    );
    res.json({ success: true, updated });
  } catch (err) { next(err); }
});

router.post('/meetings/:id/self-join', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const updated = await service.selfJoin(req.params.id, req.authUser!.id);
    res.json({ success: true, updated });
  } catch (err) { next(err); }
});

router.post('/meetings/:id/acknowledge', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const updated = await service.acknowledgeInvite(req.params.id, req.authUser!.id);
    res.json({ success: true, updated });
  } catch (err) { next(err); }
});

router.post('/meetings/:id/recording', requireRole(...ADMIN_ROLES), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = recordingUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, errors: parsed.error.flatten().fieldErrors });
    }
    const updated = await service.updateRecording(req.params.id, parsed.data.recording_url, req.authUser!.id);
    res.json({ success: true, updated });
  } catch (err) { next(err); }
});

router.get('/my-meetings', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { status, from, to, page } = req.query;
    const result = await service.listMyMeetings(req.authUser!.id, {
      status: status as MeetingStatus | undefined,
      from: from as string | undefined,
      to: to as string | undefined,
      page: page ? parseInt(page as string) : undefined,
    });
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
});

router.get('/reports/summary', requireRole(...ADMIN_ROLES), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { from, to } = req.query;
    const report = await service.getSummaryReport(from as string | undefined, to as string | undefined);
    res.json({ success: true, report });
  } catch (err) { next(err); }
});

export const mcnmeetRouter = router;

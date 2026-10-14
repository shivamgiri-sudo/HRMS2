"""
Idempotent GlitchTip setup for HRMS. Run inside the gt-web container:

    docker compose exec -T -e GT_ADMIN_EMAIL=... -e GT_ADMIN_PASSWORD=... gt-web \
        ./manage.py shell < glitchtip_provision.py

Creates (or reuses) the admin user, the "MAS Callnet" organisation, an "hrms" team and three
projects: hrms-frontend, hrms-backend, hrms-workers. Turns on server-side PII scrubbing for each
project, as a second line of defence behind the scrubbing HRMS does before sending. Prints one
line per project: "DSN <slug> <dsn>".
"""
import json
import os

from apps.organizations_ext.constants import OrganizationUserRole
from apps.organizations_ext.models import Organization, OrganizationUser
from apps.projects.models import Project, ProjectKey
from apps.teams.models import Team
from apps.users.models import User

ADMIN_EMAIL = os.environ["GT_ADMIN_EMAIL"].strip().lower()
ADMIN_PASSWORD = os.environ["GT_ADMIN_PASSWORD"]
ORG_NAME = os.environ.get("GT_ORG_NAME", "MAS Callnet")

# Keys whose values must never be stored, matched token-aware by GlitchTip (so "pan_number",
# "panNumber" and "employee_pan" are all caught). Mirrors the HRMS-side scrubber.
SENSITIVE_KEYS = [
    "password", "passwd", "secret", "token", "authorization", "cookie", "session", "otp", "pin",
    "pan", "aadhaar", "aadhar", "uid", "uan", "esic", "pf", "account", "ifsc", "bank", "salary",
    "ctc", "gross", "net", "basic", "dob", "mobile", "phone", "email", "address",
]
SCRUB_CONFIG = {
    "enabled": True,
    "scrub_defaults": True,
    "sensitive_keys": SENSITIVE_KEYS,
    "scrub_credit_cards": True,
    "scrub_private_keys": True,
    "scrub_emails": True,
}

user = User.objects.filter(email=ADMIN_EMAIL).first()
if user is None:
    user = User.objects.create_superuser(email=ADMIN_EMAIL, password=ADMIN_PASSWORD)
    print("CREATED admin", ADMIN_EMAIL)
else:
    print("EXISTS admin", ADMIN_EMAIL)

org = Organization.objects.filter(name=ORG_NAME).first()
if org is None:
    org = Organization.objects.create(name=ORG_NAME)
    print("CREATED org", org.slug)
org_user = OrganizationUser.objects.filter(organization=org, user=user).first()
if org_user is None:
    org_user = org.add_user(user, role=OrganizationUserRole.OWNER)

team, _ = Team.objects.get_or_create(organization=org, slug="hrms")
team.members.add(org_user)

for slug, platform in (
    ("hrms-frontend", "javascript-react"),
    ("hrms-backend", "node-express"),
    ("hrms-workers", "node"),
):
    project = Project.objects.filter(organization=org, name=slug).first()
    if project is None:
        project = Project.objects.create(organization=org, name=slug, platform=platform)
        print("CREATED project", slug)
    project.scrub_ip_addresses = True
    project.scrub_config = SCRUB_CONFIG
    project.save()
    team.projects.add(project)
    key = ProjectKey.objects.filter(project=project, is_active=True).first()
    if key is None:
        key = ProjectKey.objects.create(project=project)
    print("DSN", slug, key.get_dsn())
